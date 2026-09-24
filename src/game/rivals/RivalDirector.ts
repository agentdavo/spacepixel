import { Vector3 } from 'three';
import type { ShipEntity, Team } from '@/sim/Fleet';
import { brainOf, flyToPoint, setPersonality } from '@/sim/ai';
import { postFx } from '@/render/post/PostFx';
import type { Character } from '@/game/campaign/types';
import { hashStr } from '@/dialog/people';
import { npcVoice, registerVoice } from '@/audio/voice';
import type { Comms } from '@/ui/Comms';
import type { TrafficEvent, Ambush } from '@/world/Traffic';
import type { FlightScene } from '@/world/scenes/FlightScene';
import { world } from '@/game/world/WorldState';
import { advanceNpcs, noteEvent, npcNow } from '@/game/npc/live';
import { RIVALS, allies, beginEncounter, endEncounter, pickEncounter, rivalByMark, rivalLine, rivalPersonId, rivalState, wingDown, type Encounter, type LineKind, type Rival } from './rivals';

/**
 * Rivals in flight: the runtime half of rivals.ts. Every half minute of free
 * flight (out of combat, away from stations) it asks the pure picker whether
 * a rival turns up; Rustwake traffic ambushes may be led by one. A rival is
 * an ordinary fleet ship flown by the ordinary fighter AI, with their tier's
 * hull, wing and personality (skill / aggression / reaction), a comms face
 * and voice, and lines from their table — intro, grudge (quoting the world
 * log), taunts, their wing going down, retreat, death.
 *
 * Beaten below their mortal tier they break off and jump out (and come back
 * upgraded); shot down there, they eject; at it, they die for good. Allies
 * (rivals turned in conversation) fly on your wing.
 *
 *   ?rival=<id>[&rivalt=<s>]   force an intercept a moment into flight (captures)
 */
const _v = new Vector3();
const _a = new Vector3();
const COLOR_BANNER = '#ff5f7a';
/** Break off below this hull fraction (when they still can). */
const RETREAT_AT = 0.33;
const CHECK_EVERY = 30;

interface LiveRival {
  rival: Rival;
  enc: Encounter;
  ship: ShipEntity;
  wing: ShipEntity[];
  sysName: string;
  sysId: string;
  ambush: Ambush | null;
  retreat: number;
  talkT: number;
  age: number;
  done: boolean;
}

export function rivalCharacter(r: Rival): Character {
  return { id: rivalPersonId(r), callsign: r.callsign, name: r.name, role: r.role, faction: r.faction, voice: r.blurb, portrait: r.portrait, commsColor: r.color };
}

const voiced = new Set<string>();
function voice(r: Rival): void {
  const id = rivalPersonId(r);
  if (voiced.has(id)) return;
  voiced.add(id);
  // Same derivation as the concourse, so a rival sounds the same over the radio and across a bar.
  registerVoice(id, npcVoice(hashStr(id), { ...r.voice, faction: r.faction }));
}

function tune(s: ShipEntity, r: Rival, tier: number): void {
  const t = r.ships[Math.min(2, tier)];
  setPersonality(s, { aggression: t.aggression, skill: t.skill, reaction: t.reaction });
}

/**
 * A bounty op's mark who is also a rival (contracts runtime): fly with their
 * tier's personality and speak with their voice.
 */
export function tuneRivalMark(s: ShipEntity, name: string): void {
  const r = rivalByMark(name);
  if (!r) return;
  voice(r);
  tune(s, r, rivalState(world().state, r.id).tier);
}

export class RivalDirector {
  private live: LiveRival | null = null;
  private checkT = CHECK_EVERY;
  private tickT = 0;
  private n = 0;
  private flying = new Set<string>();
  private force: { id: string; t: number } | null = null;

  constructor(private scene: FlightScene) {
    for (const r of RIVALS) voice(r);
    const q = new URLSearchParams(location.search);
    const f = q.get('rival');
    if (f) this.force = { id: f, t: Number(q.get('rivalt') ?? 1.5) || 1.5 };
    advanceNpcs(scene.ledger.clock);
    this.spawnAllies();
  }

  private radio(): Comms {
    const c = this.scene.contracts.radio();
    if (!c.hasSpeaker(rivalPersonId(RIVALS[0]))) c.addCast(RIVALS.map(rivalCharacter));
    return c;
  }

  private sysName(): string {
    const id = this.scene.currentSystemId();
    return this.scene.universe.systems.get(id)?.name ?? id;
  }

  private sysFaction(): string {
    return this.scene.universe.systems.get(this.scene.currentSystemId())?.faction ?? '';
  }

  private now(): number {
    return npcNow(this.scene.ledger.clock);
  }

  // ── per frame ───────────────────────────────────────────────────────

  update(dt: number): void {
    const s = this.scene;
    if (s.campaign) {
      if (this.live) this.finish('lost-contact', true);
      return;
    }
    if ((this.tickT -= dt) <= 0) {
      this.tickT = CHECK_EVERY;
      advanceNpcs(s.ledger.clock);
      this.spawnAllies();
    }
    if (dt <= 0) return;
    if (this.live) return this.fly(dt);
    if (this.force) {
      if ((this.force.t -= dt) <= 0 && s.player.alive && !s.docking.busy) {
        const id = this.force.id;
        this.force = null;
        this.intercept(id);
      }
      return;
    }
    if ((this.checkT -= dt) > 0) return;
    this.checkT = CHECK_EVERY;
    if (!s.player.alive || s.docking.busy || this.hostilesNear(5000) || this.nearStation(18_000)) return;
    const sys = s.currentSystemId();
    const enc = pickEncounter(world().state, { now: this.now(), system: { id: sys, faction: this.sysFaction() }, mode: 'lane', seed: hashStr(`${sys}:${Math.floor(this.now() / CHECK_EVERY)}`) });
    if (enc) this.begin(enc, 'lane', null);
  }

  /** Captures / dev: this rival, now. */
  intercept(id: string): void {
    const enc = pickEncounter(world().state, { now: this.now(), system: { id: this.scene.currentSystemId(), faction: this.sysFaction() }, mode: 'lane', seed: 0, force: id });
    if (enc) this.begin(enc, 'lane', null);
  }

  /** Traffic events: a rival may lead an ambush; broken ambushes are remembered. */
  onTraffic(e: TrafficEvent): void {
    const s = this.scene;
    if (s.campaign) return;
    const sys = { id: s.currentSystemId(), faction: this.sysFaction() };
    if (e.kind === 'ambush' && !this.live && s.player.alive) {
      const d = e.ambush.position.distanceTo(s.player.flight.position);
      if (d > 14_000) return;
      const enc = pickEncounter(world().state, { now: this.now(), system: sys, mode: 'ambush', seed: hashStr(`ambush:${e.ambush.id}:${Math.floor(this.now())}`) });
      if (enc) this.begin(enc, 'ambush', e.ambush);
    } else if (e.kind === 'raider-down' && e.byPlayer && this.live?.ambush === e.ambush) {
      world().update((w) => wingDown(w, this.live!.rival.id, this.sysName(), `a ${e.ambush.band} raider`));
      this.say('wing', 1);
    } else if (e.kind === 'repelled' || e.kind === 'lost') {
      const a = e.ambush;
      const near = a.position.distanceTo(s.player.flight.position) < 12_000;
      if (!a.playerJoined && !(e.kind === 'lost' && near)) return;
      const rival = this.live?.ambush === a ? this.live.rival.id : undefined;
      noteEvent(e.kind === 'repelled' ? 'ambush.broken' : 'ambush.lost', `system:${sys.id}`, { sys: this.sysName(), victim: a.victim.manifest.name, band: a.band, ...(rival ? { rival } : {}) }, sys);
    }
  }

  // ── encounters ──────────────────────────────────────────────────────

  private begin(enc: Encounter, mode: 'lane' | 'ambush', ambush: Ambush | null): void {
    const s = this.scene;
    const r = enc.rival;
    const p = s.player.flight;
    const fwd = p.forward(new Vector3());
    const right = new Vector3(-1, 0, 0).applyQuaternion(p.orientation);
    const up = new Vector3(0, 1, 0).applyQuaternion(p.orientation);
    const base = ambush
      ? ambush.position.clone().addScaledVector(right, 1400).addScaledVector(up, 300)
      : p.position.clone().addScaledVector(fwd, 3200).addScaledVector(right, (enc.tier % 2 ? 1 : -1) * 900).addScaledVector(up, 260);
    const team: Team = r.faction === 'choir' ? 'choir' : 'renegade';
    const facing = _v.subVectors(p.position, base).normalize().clone();
    const ship = s.fleet.spawn(enc.ship.blueprint, r.faction, base, facing, { name: r.callsign, team });
    ship.hullMax *= enc.ship.hull;
    ship.hull = ship.hullMax;
    tune(ship, r, enc.tier);
    ship.flight.velocity.copy(facing).multiplyScalar(180);
    const wing: ShipEntity[] = [];
    const side = _a.crossVectors(facing, up).normalize();
    for (let i = 0; i < enc.ship.wing.count; i++) {
      const pos = base.clone().addScaledVector(side, (i % 2 ? 1 : -1) * (120 + 60 * i)).addScaledVector(facing, -140 * (i + 1));
      const w = s.fleet.spawn(enc.ship.wing.blueprint, r.faction, pos, facing, { name: `${r.callsign.split(' ').pop()}'s wing ${i + 1}`, team });
      tune(w, r, Math.max(0, enc.tier - 1));
      w.flight.velocity.copy(facing).multiplyScalar(180);
      wing.push(w);
    }
    // They came for you: aim the brains at the Point.
    for (const x of [ship, ...wing]) {
      const b = brainOf(x);
      b.order = 'engageAtWill';
      x.target = s.player;
    }
    const sysName = this.sysName();
    this.live = { rival: r, enc, ship, wing, sysName, sysId: s.currentSystemId(), ambush, retreat: -1, talkT: 14, age: 0, done: false };
    world().update((w) => beginEncounter(w, r.id, this.now(), sysName));
    const tier = ['', ' · UPGRADED', ' · UPGRADED TWICE'][enc.tier];
    s.flashBanner(`RIVAL · ${r.callsign}`, `${r.role.toUpperCase()}${tier}${mode === 'ambush' ? ' · LEADING THE AMBUSH' : ' · INTERCEPT'}`, r.color || COLOR_BANNER, 5);
    this.say(enc.first ? 'intro' : enc.returning && enc.tier > 0 ? 'back' : 'grudge', 2);
  }

  private fly(dt: number): void {
    const L = this.live!;
    const s = this.scene;
    L.age += dt;
    // Left the system, or a story episode took the sky.
    if (s.currentSystemId() !== L.sysId) return this.finish('lost-contact', true);
    if (!s.player.alive) {
      if (L.age > 0) this.say('win', 2);
      return this.finish('won', true);
    }
    for (const e of s.weapons.events) {
      if (e.kind !== 'kill' || !e.ship) continue;
      if (e.ship === L.ship) {
        this.say('death', 3);
        return this.finish('killed', false);
      }
      const wi = L.wing.indexOf(e.ship);
      if (wi >= 0 && e.shooter === s.player) {
        world().update((w) => wingDown(w, L.rival.id, L.sysName, e.ship!.name));
        this.say('wing', 1);
      }
    }
    // Retreat: break off below a third of the hull while there's a tier left to come back with.
    const canRun = L.enc.tier < L.rival.mortalTier;
    if (L.retreat < 0 && canRun && L.ship.alive && L.ship.hull / L.ship.hullMax < RETREAT_AT) {
      L.retreat = 0;
      brainOf(L.ship).scripted = true;
      this.say('retreat', 3);
    }
    if (L.retreat >= 0) {
      L.retreat += dt;
      const f = L.ship.flight;
      _v.subVectors(f.position, s.player.flight.position).normalize().multiplyScalar(20_000).add(f.position);
      flyToPoint(L.ship.controls, f, _v, 400, brainOf(L.ship).pilot, dt);
      L.ship.controls.afterburner = true;
      L.ship.controls.fire = false;
      if (L.retreat > 4.5) {
        // Through a jump flash, not a kill.
        L.ship.alive = false;
        L.ship.model.root.visible = false;
        postFx.flash = Math.max(postFx.flash, 0.15);
        return this.finish('retreated', false);
      }
    } else if ((L.talkT -= dt) <= 0) {
      L.talkT = 22 + (this.n % 3) * 7;
      this.say(this.n % 3 === 1 ? 'grudge' : 'taunt', 0);
    }
    // Lost them (or they lost you).
    if (L.ship.alive && L.ship.flight.position.distanceTo(s.player.flight.position) > 22_000) this.finish('lost-contact', true);
  }

  private finish(end: 'killed' | 'retreated' | 'won' | 'lost-contact', despawn: boolean): void {
    const L = this.live;
    if (!L || L.done) return;
    L.done = true;
    this.live = null;
    world().update((w) => endEncounter(w, L.rival.id, end, this.now(), L.sysName));
    const st = rivalState(world().state, L.rival.id);
    const s = this.scene;
    if (end === 'killed') s.flashBanner(st.status === 'dead' ? `${L.rival.callsign} · KILLED` : `${L.rival.callsign} · EJECTED`, st.status === 'dead' ? 'THEY WON\'T BE BACK' : 'HER PEOPLE WILL FISH THEM OUT — EXPECT THEM AGAIN'.replace('HER', L.rival.voice.sex === 'f' ? 'HER' : 'HIS'), '#7dffb2', 5);
    else if (end === 'retreated') s.flashBanner(`${L.rival.callsign} · BROKE OFF`, st.status === 'hiding' ? 'BEATEN — WORD IS THEY\'VE GONE TO GROUND ON A CONCOURSE' : 'BEATEN — THEY\'LL BE BACK, UPGRADED', '#7dffb2', 5);
    if (despawn) for (const x of [L.ship, ...L.wing]) {
      x.alive = false;
      x.model.root.visible = false;
    }
    this.checkT = CHECK_EVERY;
    advanceNpcs(s.ledger.clock);
  }

  private say(kind: LineKind, priority: number): void {
    const L = this.live;
    if (!L) return;
    const who = rivalPersonId(L.rival);
    const text = rivalLine(world().state, L.rival, kind, this.n++, {});
    if (!text || text === '—') return;
    const c = this.radio();
    if (priority < 1 && c.busy) return;
    c.play({ id: `rival-${L.rival.id}-${kind}-${this.n}`, trigger: { on: 'start' }, lines: [{ who, text }], priority: 1 + priority });
  }

  // ── allies ──────────────────────────────────────────────────────────

  private spawnAllies(): void {
    const s = this.scene;
    if (s.campaign) return;
    for (const r of allies(world().state)) {
      if (this.flying.has(r.id)) continue;
      this.flying.add(r.id);
      voice(r);
      const t = r.ships[Math.min(2, rivalState(world().state, r.id).tier)];
      const ship = s.addWingman(t.blueprint, r.callsign, r.faction);
      tune(ship, r, 2);
      if (s.docking.phase === 'docked' || s.docking.busy) continue;
      const c = this.radio();
      c.play({ id: `ally-${r.id}`, trigger: { on: 'start' }, lines: [{ who: rivalPersonId(r), text: r.lines.ally[0] }], priority: 1 });
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private hostilesNear(range: number): boolean {
    const p = this.scene.player;
    for (const o of this.scene.fleet.ships) {
      if (!o.alive || o === p || o.team === 'neutral' || o.team === p.team || o.radius > 60) continue;
      if (o.flight.position.distanceTo(p.flight.position) < range) return true;
    }
    return false;
  }

  private nearStation(range: number): boolean {
    return this.scene.stationDistance() < range;
  }
}
