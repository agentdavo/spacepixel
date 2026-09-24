import type { Character } from '@/game/campaign/types';
import { CAST } from '@/game/campaign/cast';
import { Comms } from '@/ui/Comms';
import { Subtitles } from '@/ui/Subtitles';
import { npcVoice, registerVoice } from '@/audio/voice';
import { BANTER, BARK_PRIORITY, BarkLimiter, barkLine, orderKind, pickBanter, trafficCargo, trafficHail, type BarkKind } from './barks';

/**
 * In-flight radio: wingman and enemy combat barks (target splashed, taking
 * hits, missile inbound, wing down, open-band taunts and last words) and
 * hails from passing traffic ("Freighter Anselm's Patience, cargo: rations").
 * The lead wingman answers the Point's wing orders (keys 1–4) in their own
 * voice, and on a long quiet leg the wing chats among itself.
 * Everything is voiced and subtitled through Comms and rate-limited by
 * BarkLimiter so a furball never becomes a wall of chatter.
 *
 * During a campaign episode the story's Comms is used and barks only speak
 * into silence — they never interrupt or queue behind the script.
 */
export interface RadioShip {
  id: number;
  name: string;
  faction: string;
  team: string;
  alive: boolean;
  isPlayer: boolean;
  radius: number;
  flight: { position: { distanceTo(v: unknown): number } };
}
export interface RadioEvent {
  kind: string;
  ship: RadioShip | null;
  shooter: RadioShip | null;
}
export interface RadioFrame {
  player: RadioShip;
  ships: readonly RadioShip[];
  events: readonly RadioEvent[];
  missileIncoming: boolean;
  /** The campaign's Comms when an episode is running. */
  story: Comms | null;
  /** Docked / cutscene: stay quiet. */
  quiet: boolean;
  systemName: string;
}

const WING_IDS = ['', '', 'kade', 'jackpot', 'candle', 'sparrow', 'salt'];

/** Which cast member flies this wingman ship ("Vanguard 3 · Jackpot" → jackpot). */
export function wingSpeaker(name: string): string | null {
  const m = /Vanguard\s*(\d)/i.exec(name);
  if (m) return WING_IDS[Number(m[1])] || null;
  const low = name.toLowerCase();
  for (const id of ['kade', 'jackpot', 'candle', 'sparrow', 'salt']) if (low.includes(id)) return id;
  if (low.includes('abbess')) return 'kade';
  return null;
}

const PORTRAIT_BY_FACTION: Record<string, Character['portrait']> = {
  choir: { skin: '#f4e2e6', hair: '#d8c8f0', eyes: '#ff3fa8', suit: '#1d1729', hairStyle: 'long', accessory: 'visor', seed: 0 },
  rustwake: { skin: '#c8966a', hair: '#e8e0d0', eyes: '#ffb347', suit: '#6b4a2c', hairStyle: 'spiky', accessory: 'goggles', seed: 0 },
  concord: { skin: '#e8c4a0', hair: '#26283a', eyes: '#3a5a8a', suit: '#eceae4', hairStyle: 'short', accessory: 'visor', seed: 0 },
};
const COLOR: Record<string, string> = { choir: '#ff5fd0', rustwake: '#ffae4f', concord: '#7dffb2' };
const LABEL: Record<string, string> = { choir: 'ZENITH HEGEMONY · CHOIR', rustwake: 'RUSTWAKE · SCRAPJACK', concord: 'TERRAN DIRECTORATE' };

const DOCK_LINES: Record<string, { cleared: string; auto: string; launch: string }> = {
  concord: {
    cleared: '{name} Control. Vanguard, you are cleared to berth {berth}. Corridor is lit. Keep the light.',
    auto: 'Guidance has you, Vanguard. Hands off the stick. Seals standing by.',
    launch: 'Catapult hot. Good hunting, Vanguard.',
  },
  choir: {
    cleared: 'Be witnessed, Directorate. {name} grants you berth {berth}. Fly the corridor exactly.',
    auto: 'Our guidance holds you now. Be still, and be welcome.',
    launch: 'Ascend, pilot. The Line is watching.',
  },
  rustwake: {
    cleared: '{name}. Berth {berth}\'s yours. Don\'t scratch anything you can\'t pay for.',
    auto: 'Tractor\'s got you, love. Don\'t touch anything shiny.',
    launch: 'Off you go. Bring us back something worth breaking.',
  },
  carrier: {
    cleared: 'Dawn Control, Vanguard One: you are cleared to the bow hangar. Deck is green.',
    auto: 'Guidance has you. Deck is green. Welcome home, Point.',
    launch: 'Catapult hot. Deck is green. Good hunting, Vanguard.',
  },
};

export class FlightRadio {
  private own: Comms | null = null;
  private readonly limiter = new BarkLimiter();
  private time = 0;
  private n = 0;
  private readonly hailed = new Set<number>();
  private lastHail = -Infinity;
  private wasIncoming = false;
  private hotT = 0;
  private engaged = false;
  private readonly known = new Set<string>();
  /** Cutscene subtitles (docking / launch cutaways own the frame; no HUD comms). */
  private subs: Subtitles | null = null;
  private dockPhase = 'free';
  /** The last frame, so a wing order between frames knows who is flying. */
  private frame: RadioFrame | null = null;
  private lastBanter = 0;
  private readonly banterUsed = new Set<number>();

  constructor(private readonly uiRoot: HTMLElement) {}

  /**
   * Station control on the docking sequence: clearance on the comms panel,
   * then guidance and launch as cutscene subtitles over the cutaway.
   */
  dock(phase: string, target: { id: string; name: string; faction: string; kind: string } | null, berth: string, dt: number): void {
    this.subs?.update(dt);
    if (!this.enabled || phase === this.dockPhase) return;
    const prev = this.dockPhase;
    this.dockPhase = phase;
    // Berthed: the dock screen owns the bottom of the frame (its ticker); guidance has finished talking.
    if (phase === 'docked') this.subs?.clear();
    if (!target) return;
    const carrier = target.kind === 'carrier';
    const fac = COLOR[target.faction] ? target.faction : 'concord';
    const who = carrier ? 'control' : `station:${target.id}`;
    if (!carrier && !this.known.has(who)) {
      this.known.add(who);
      registerVoice(who, npcVoice(target.id.length * 131 + target.name.charCodeAt(0), { sex: target.name.length % 2 ? 'f' : 'm', age: 'adult', faction: fac, temper: 'calm' }));
    }
    const plate = carrier ? 'DAWN CONTROL' : `${target.name.toUpperCase()} CONTROL`;
    const lines = DOCK_LINES[carrier ? 'carrier' : fac];
    const fill = (t: string) => t.replace('{name}', target.name).replace('{berth}', berth);
    if (phase === 'cleared' && prev === 'free') {
      const story = this.story && !this.story.busy ? this.story : null;
      if (this.story && !story) return;
      if (!carrier) {
        const ch: Character = { id: who, callsign: plate, name: `${target.name} traffic control`, role: `${LABEL[fac]} · DOCKING CONTROL`, faction: fac as Character['faction'], voice: '', portrait: { skin: '#e6c4a4', hair: '#2a2a3a', eyes: '#4a6a8a', suit: fac === 'choir' ? '#1d1729' : fac === 'rustwake' ? '#6b4a2c' : '#1f2f5a', hairStyle: 'bob', accessory: 'headset', seed: 800 + (target.id.length % 50) }, commsColor: COLOR[fac] };
        this.own ??= new Comms(this.uiRoot, CAST);
        this.own.addCast([ch]);
        story?.addCast([ch]);
      }
      (story ?? (this.own ??= new Comms(this.uiRoot, CAST))).play({ id: `dock-clear-${target.id}`, trigger: { on: 'start' }, lines: [{ who, text: fill(lines.cleared) }], priority: story ? 0 : 1 });
      return;
    }
    if (phase === 'auto' || phase === 'launch') {
      this.own?.clear();
      this.subs ??= new Subtitles(this.uiRoot, 'cut');
      this.subs.clear();
      void this.subs.say({ who, speaker: plate, color: COLOR[fac], text: fill(phase === 'auto' ? lines.auto : lines.launch), channel: 'radio' });
    }
  }

  private story: Comms | null = null;

  private comms(f: RadioFrame): Comms {
    this.story = f.story;
    if (f.story) return f.story;
    this.own ??= new Comms(this.uiRoot, CAST);
    return this.own;
  }

  /** `?radio=0` silences barks and hails (captures that want a clean HUD). */
  enabled = typeof location === 'undefined' || new URLSearchParams(location.search).get('radio') !== '0';

  /** `?bark=<kind>` fires one bark on the first frame (captures). */
  private capture = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('bark');

  update(dt: number, f: RadioFrame): void {
    if (!this.enabled) return;
    this.story = f.story;
    this.frame = f;
    this.time += dt;
    if (this.capture) {
      const kind = this.capture as BarkKind;
      this.capture = null;
      const lead = f.ships.find((s) => s.alive && !s.isPlayer && s.team === f.player.team && wingSpeaker(s.name));
      const foe = f.ships.find((s) => s.alive && s.team !== f.player.team && s.team !== 'neutral' && s.radius < 60);
      if ((kind === 'enemy-taunt' || kind === 'enemy-down') && foe) this.enemy(kind, f, foe);
      else if (lead && kind in BARK_PRIORITY) this.bark(kind, f, wingSpeaker(lead.name)!, { name: 'JACKPOT' });
      this.engaged = true;
    }
    this.own?.update(dt);
    if (f.quiet || !f.player.alive) {
      if (f.quiet) this.own?.clear();
      return;
    }
    const p = f.player;
    const wing = f.ships.filter((s) => s.alive && !s.isPlayer && s.team === p.team && wingSpeaker(s.name));
    const lead = wing[0] ?? null;

    // ── engagement: hostiles inside 3 km after a quiet spell ──
    let near: RadioShip | null = null;
    let nearD = Infinity;
    for (const s of f.ships) {
      if (!s.alive || s.team === p.team || s.team === 'neutral' || s.radius > 60) continue;
      const d = s.flight.position.distanceTo(p.flight.position);
      if (d < nearD) {
        nearD = d;
        near = s;
      }
    }
    if (nearD < 3000) {
      this.hotT = 0;
      if (!this.engaged) {
        this.engaged = true;
        if (lead) this.bark('engage', f, wingSpeaker(lead.name)!);
        else if (near) this.enemy('enemy-taunt', f, near);
      } else if (near && nearD < 1500 && Math.random() < dt * 0.05) this.enemy('enemy-taunt', f, near);
    } else if ((this.hotT += dt) > 25) this.engaged = false;

    // ── weapon events ──
    let playerHit = false;
    for (const e of f.events) {
      const ship = e.ship;
      if (!ship) continue;
      if (e.kind === 'kill') {
        if (ship.isPlayer) continue;
        if (ship.team === p.team && wingSpeaker(ship.name)) {
          const other = wing.find((w) => w !== ship);
          const who = other ? wingSpeaker(other.name)! : 'system';
          const name = (wingSpeaker(ship.name) ?? ship.name).toUpperCase();
          this.bark('wing-down', f, who, { name: CAST.find((c) => c.id === wingSpeaker(ship.name))?.callsign ?? name });
        } else if (ship.team !== p.team && ship.team !== 'neutral') {
          if (e.shooter?.isPlayer && lead) this.bark('splash-player', f, wingSpeaker(lead.name)!);
          else if (e.shooter && !e.shooter.isPlayer && e.shooter.team === p.team && wingSpeaker(e.shooter.name)) this.bark('splash-wing', f, wingSpeaker(e.shooter.name)!);
          else if (ship.flight.position.distanceTo(p.flight.position) < 2500) this.enemy('enemy-down', f, ship);
        }
      } else if (e.kind === 'hit' || e.kind === 'shield') {
        if (ship.isPlayer) playerHit ||= e.kind === 'hit';
        else if (ship.team === p.team && wingSpeaker(ship.name) && e.kind === 'hit') this.bark('wing-hit', f, wingSpeaker(ship.name)!);
      }
    }
    if (playerHit && lead) this.bark('player-hit', f, wingSpeaker(lead.name)!);

    // ── missile warning (rising edge) ──
    if (f.missileIncoming && !this.wasIncoming && lead) this.bark('missile', f, wingSpeaker(lead.name)!);
    this.wasIncoming = f.missileIncoming;

    // ── traffic hails: neutral ships passing within 2.5 km, out of combat ──
    if (!this.engaged && this.time - this.lastHail > 20) {
      for (const s of f.ships) {
        if (!s.alive || s.isPlayer || s.team !== 'neutral' || this.hailed.has(s.id) || s.radius < 5) continue;
        if (s.flight.position.distanceTo(p.flight.position) > 2500) continue;
        this.hailed.add(s.id);
        this.hail(f, s);
        break;
      }
    }

    // ── cruise banter: the wing talks among itself on a long quiet leg ──
    if (!f.story && !this.engaged && this.hotT > 30 && this.time - this.lastBanter > 90 && this.time - this.lastHail > 12 && !this.own?.busy) {
      this.lastBanter = this.time;
      const flying = wing.map((w) => wingSpeaker(w.name)!);
      const i = pickBanter(flying, this.banterUsed, this.n++);
      if (i >= 0) {
        this.banterUsed.add(i);
        if (this.banterUsed.size >= BANTER.length) this.banterUsed.clear();
        this.comms(f).play({ id: `banter-${i}-${this.n}`, trigger: { on: 'start' }, lines: BANTER[i].map(([who, text]) => ({ who, text })), priority: 0 });
      }
    }
  }

  /** The Point gave a wing order (keys 1–4): the lead wingman answers it. */
  order(order: 'formUp' | 'attackMyTarget' | 'engageAtWill' | 'coverMe', hasTarget: boolean): void {
    const f = this.frame;
    if (!this.enabled || !f || f.quiet || !f.player.alive) return;
    const lead = f.ships.find((s) => s.alive && !s.isPlayer && s.team === f.player.team && wingSpeaker(s.name));
    if (!lead) return;
    this.lastBanter = this.time;
    this.bark(orderKind(order, hasTarget), f, wingSpeaker(lead.name)!);
  }

  private bark(kind: BarkKind, f: RadioFrame, who: string, vars: Record<string, string> = {}): void {
    const c = this.comms(f);
    // The script owns the story channel: barks only fill silence there.
    if (f.story && c.busy) return;
    if (!f.story && c.busy && BARK_PRIORITY[kind] < 1) return;
    if (!this.limiter.allow(kind, this.time)) return;
    const text = barkLine(kind, who, this.n++, vars);
    c.play({ id: `bark-${kind}-${this.n}`, trigger: { on: 'start' }, lines: [{ who, text }], priority: f.story ? 0 : BARK_PRIORITY[kind] });
  }

  /** An enemy on the open band (a Cantor, a Scrapjack). */
  private enemy(kind: BarkKind, f: RadioFrame, ship: RadioShip): void {
    const who = this.speakerFor(ship, f);
    const c = this.comms(f);
    if (c.busy || !this.limiter.allow(kind, this.time)) return;
    const group = ship.faction === 'choir' || ship.faction === 'rustwake' ? ship.faction : 'concord';
    c.play({ id: `bark-${kind}-${this.n}`, trigger: { on: 'start' }, lines: [{ who, text: barkLine(kind, who === 'psalm' ? 'choir' : group, this.n++) }], priority: 0 });
  }

  private hail(f: RadioFrame, ship: RadioShip): void {
    const c = this.comms(f);
    if (c.busy) return;
    this.lastHail = this.time;
    const who = this.speakerFor(ship, f, 'traffic');
    const cargo = trafficCargo(ship.name, ship.faction);
    c.play({ id: `hail-${ship.id}`, trigger: { on: 'start' }, lines: [{ who, text: trafficHail(ship.name, ship.faction, cargo, f.systemName, this.n++) }], priority: 0 });
  }

  /** A comms Character (portrait, plate, voice) for a non-cast ship. */
  private speakerFor(ship: RadioShip, f: RadioFrame, kind: 'enemy' | 'traffic' = 'enemy'): string {
    if (/psalm/i.test(ship.name)) return 'psalm';
    const id = `${kind}:${ship.faction}:${ship.id % 6}`;
    if (!this.known.has(id)) {
      this.known.add(id);
      const fac = COLOR[ship.faction] ? ship.faction : 'concord';
      const seed = 700 + (ship.id % 97);
      const ch: Character = {
        id,
        callsign: ship.name.toUpperCase(),
        name: kind === 'traffic' ? `${ship.name}` : `${ship.name}, open band`,
        role: kind === 'traffic' ? `${LABEL[fac]} · TRAFFIC` : `${LABEL[fac]} · HOSTILE`,
        faction: fac as Character['faction'],
        voice: '',
        portrait: { ...PORTRAIT_BY_FACTION[fac], accessory: kind === 'traffic' ? 'headset' : PORTRAIT_BY_FACTION[fac].accessory, seed },
        commsColor: COLOR[fac],
      };
      this.comms(f).addCast([ch]);
      this.own?.addCast([ch]);
      f.story?.addCast([ch]);
      registerVoice(id, npcVoice(seed * 7, { sex: ship.id % 2 ? 'f' : 'm', age: 'adult', faction: fac, temper: kind === 'enemy' ? 'loud' : 'calm' }));
    } else if (f.story && !f.story.hasSpeaker(id)) {
      // A new episode's Comms: teach it the speaker too.
      this.known.delete(id);
      return this.speakerFor(ship, f, kind);
    }
    return id;
  }

  dispose(): void {
    this.subs?.destroy();
    this.own?.destroy();
    this.own = null;
  }
}
