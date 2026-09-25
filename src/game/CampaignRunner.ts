import { Vector3 } from 'three';
import { validateRunnerSnapshot } from './campaign/validateRunnerSnapshot.ts';
import type { FactionId } from '@/assets/Blueprint';
import type { ShipEntity } from '@/sim/Fleet';
import type {
  CampaignContext,
  CampaignMission,
  ChatterBeat,
  ChatterTrigger,
  Placement,
  SetPieceSpec,
  SpawnSpec,
} from './campaign/types';

/**
 * Runs one CampaignMission against the live flight sim.
 *
 * It owns no rendering and no simulation. The host scene gives it adapters
 * (spawn a ship, build a set piece, play a chatter beat, unlock a codex
 * entry) and a frame of facts; the runner resolves placements, releases
 * delayed/flagged spawns, fires chatter triggers exactly once, advances
 * objectives and reports the outcome. Everything is data-driven from the
 * mission file.
 */
export interface SetPieceHandle {
  readonly tag: string;
  readonly position: Vector3;
  readonly radius: number;
}

/** An escort group the host should fly along its route (AI flyToPoint). */
export interface EscortRoute {
  tag: string;
  ships: ShipEntity[];
  target: Vector3 | null;
  halted: boolean;
}

/** A beacon the player must hold inside (HUD draws a ring + progress). */
export interface DwellZone {
  tag: string;
  position: Vector3;
  radius: number;
  hold: number;
  progress: number; // 0..1
}

export interface CampaignHost {
  playerPosition: Vector3;
  playerAlive: boolean;
  playerHull: number;
  systemId: string;
  jumps: number;
  /** Universe position of gate `i` in the current system. */
  gatePosition(i: number): Vector3 | null;
  spawnShip(spec: SpawnSpec, index: number, position: Vector3): ShipEntity;
  spawnSetPiece(spec: SetPieceSpec, position: Vector3): SetPieceHandle;
  playChatter(beat: ChatterBeat): void;
  unlockCodex(id: string): void;
  ships: readonly ShipEntity[];
  /** Script commands from flags: cinematic destruction, or break off and leave. */
  command?(verb: 'destroy' | 'depart', ships: ShipEntity[]): void;
}

interface TaggedShip {
  tag: string;
  ship: ShipEntity;
  /** Index into mission.spawns and member index within the group (snapshots). */
  spawn: number;
  member: number;
}

type V3 = [number, number, number];

/**
 * A running mission's progress as plain JSON (free-roam contracts persist
 * it when the pilot leaves the system or dies, and resume from it): clock,
 * flags (with the time each was set, so flag-delayed spawns keep counting),
 * objective states, chatter already played, kills, which spawn groups were
 * released and where each member was (dead members stay dead), dwell progress.
 */
export interface RunnerSnapshot {
  time: number;
  flags: [string, number][];
  state: ('locked' | 'active' | 'done' | 'failed')[];
  fired: string[];
  kills: [string, number][];
  released: number[];
  ships: { spawn: number; member: number; alive: boolean; pos: V3; vel: V3; hull: number }[];
  dwells: [string, number][];
}

export class CampaignRunner {
  readonly flags = new Set<string>();
  readonly state: ('locked' | 'active' | 'done' | 'failed')[];
  outcome: 'running' | 'success' | 'failure' = 'running';
  time = 0;

  private tagged: TaggedShip[] = [];
  private pieces: (SetPieceHandle & { spec: SetPieceSpec })[] = [];
  private flagTime = new Map<string, number>();
  private halted = new Set<string>();
  readonly escorts: EscortRoute[] = [];
  readonly dwells: DwellZone[] = [];
  private pendingSpawns: SpawnSpec[];
  private pendingPieces: SetPieceSpec[];
  private fired = new Set<string>();
  private kills = new Map<FactionId, number>();
  private lastJumps = 0;
  private released = new Set<number>();
  private restoredDwells = new Map<string, number>();
  readonly ctx: CampaignContext;

  constructor(
    readonly mission: CampaignMission,
    private host: CampaignHost,
  ) {
    // First objective + every optional (visible side objectives and hidden
    // script cues) start active; the rest unlock in order.
    this.state = mission.objectives.map((o, i) => (i === 0 || o.optional ? 'active' : 'locked'));
    this.pendingSpawns = [...mission.spawns];
    this.pendingPieces = [...mission.setpieces];
    const self = this;
    this.ctx = {
      get time() {
        return self.time;
      },
      get systemId() {
        return host.systemId;
      },
      get jumps() {
        return host.jumps;
      },
      get playerAlive() {
        return host.playerAlive;
      },
      get playerHull() {
        return host.playerHull;
      },
      kills: (f) => this.kills.get(f) ?? 0,
      alive: (tag) => this.tagged.some((t) => matches(t.tag, tag) && t.ship.alive) || this.pieces.some((p) => matches(p.tag, tag)),
      aliveCount: (tag) => this.tagged.filter((t) => matches(t.tag, tag) && t.ship.alive).length,
      hull: (tag) => {
        let h = Infinity;
        for (const t of this.tagged) if (matches(t.tag, tag)) h = Math.min(h, t.ship.alive ? t.ship.hull / t.ship.hullMax : 0);
        return h === Infinity ? 0 : h;
      },
      distanceTo: (tag) => {
        let d = Infinity;
        for (const t of this.tagged) if (matches(t.tag, tag) && t.ship.alive) d = Math.min(d, t.ship.flight.position.distanceTo(host.playerPosition));
        for (const p of this.pieces) if (matches(p.tag, tag)) d = Math.min(d, Math.max(0, p.position.distanceTo(host.playerPosition) - p.radius));
        return d;
      },
      flag: (name) => this.flags.has(name),
      objectiveDone: (id) => this.state[mission.objectives.findIndex((o) => o.id === id)] === 'done',
    };
  }

  /** Derived each frame so completed, hidden and failed objectives cannot leave stale markers. */
  navigation(): { tag: string; label: string; position: Vector3 } | undefined {
    if (this.outcome !== 'running') return;
    const objective = this.mission.objectives.find((o, i) => !o.hidden && this.state[i] === 'active' && o.navTag);
    if (!objective) return;
    const piece = this.pieces.find((p) => p.tag === objective.navTag);
    if (!piece) return;
    const label = piece.spec.params?.label;
    return { tag: piece.tag, label: typeof label === 'string' ? label : objective.text, position: piece.position };
  }

  /** Immediate spawns, then set pieces (which may be placed relative to them); start codex + chatter. */
  begin(): void {
    this.releaseSpawns();
    this.releasePieces();
    for (const id of this.mission.codexOnStart ?? []) this.host.unlockCodex(id);
    this.trigger((t) => t.on === 'start');
  }

  /**
   * Docking hook (free-roam trade): the player berthed at `stationId`. Sets
   * the story flags `docked` and `docked:<stationId>`, so a mission can key
   * an objective or a chatter beat off it (`{ on: 'flag', flag: 'docked' }`).
   */
  onDocked(stationId: string): void {
    this.setFlag('docked');
    this.setFlag(`docked:${stationId}`);
  }

  setFlag(name: string): void {
    if (this.flags.has(name)) return;
    this.flags.add(name);
    this.flagTime.set(name, this.time);
    // Command flags drive the script (see missions.ts runtime notes).
    const m = /^(destroy|depart|halt|resume):(.+)$/.exec(name);
    if (m) {
      const [, verb, tag] = m;
      if (verb === 'halt') this.halted.add(tag);
      else if (verb === 'resume') this.halted.delete(tag);
      else {
        const ships = this.shipsTagged(tag).filter((s) => s.alive);
        this.host.command?.(verb as 'destroy' | 'depart', ships);
      }
    }
    this.trigger((t) => t.on === 'flag' && t.flag === name);
  }

  /** Called by the host for every ship death. */
  onKill(victim: ShipEntity): void {
    const n = (this.kills.get(victim.faction) ?? 0) + 1;
    this.kills.set(victim.faction, n);
    this.trigger((t) => t.on === 'kills' && t.faction === victim.faction && n >= t.count);
  }

  update(dt: number): void {
    if (this.outcome !== 'running') return;
    this.time += dt;
    this.releaseSpawns();
    if (this.pendingPieces.length) this.releasePieces();

    // Escorts: refresh routes; flag arrival when every survivor is within 800 m.
    for (const e of this.escorts) {
      e.halted = this.halted.has(e.tag);
      if (!e.target) {
        const spec = this.mission.spawns.find((s) => s.tag === e.tag);
        if (spec?.routeTo) e.target = this.resolve({ at: 'tag', tag: spec.routeTo, offset: [0, 0, 0] });
      }
      const alive = e.ships.filter((s) => s.alive);
      if (e.target && alive.length && alive.every((s) => s.flight.position.distanceTo(e.target!) < 800)) this.setFlag(`${e.tag}-arrived`);
    }
    // Beacon dwell zones.
    for (const d of this.dwells) {
      if (d.progress >= 1) continue;
      if (this.host.playerPosition.distanceTo(d.position) <= d.radius) d.progress = Math.min(1, d.progress + dt / d.hold);
      if (d.progress >= 1) this.setFlag(`${d.tag}-held`);
    }

    // Chatter triggers that depend on continuous state.
    this.trigger((t) => {
      switch (t.on) {
        case 'time':
          return this.time >= t.at;
        case 'near':
          return this.ctx.distanceTo(t.tag) <= t.distance;
        case 'hull-low':
          return this.host.playerHull < 0.3;
        case 'jump':
          return this.host.jumps > this.lastJumps;
        default:
          return false;
      }
    });
    this.lastJumps = this.host.jumps;

    // Objectives (in order; optional ones in parallel).
    const obj = this.mission.objectives;
    for (let i = 0; i < obj.length; i++) {
      if (this.state[i] !== 'active') continue;
      const o = obj[i];
      if (o.failed?.(this.ctx)) {
        this.state[i] = 'failed';
        if (!o.optional) this.finish('failure');
        continue;
      }
      if (o.done(this.ctx)) {
        this.state[i] = 'done';
        if (o.setsFlag) this.setFlag(o.setsFlag);
        this.trigger((t) => t.on === 'objective-done' && t.objective === o.id);
        const next = obj.findIndex((x, j) => j > i && this.state[j] === 'locked' && !x.optional);
        if (next >= 0) {
          this.state[next] = 'active';
          this.trigger((t) => t.on === 'objective-active' && t.objective === obj[next].id);
        }
      }
    }
    if (!this.host.playerAlive) this.finish('failure');
    else if (this.mission.modifiers?.timeLimit && this.time > this.mission.modifiers.timeLimit) this.finish('failure');
    else if (obj.every((o, i) => o.optional || this.state[i] === 'done')) this.finish('success');
  }

  private finish(outcome: 'success' | 'failure'): void {
    if (this.outcome !== 'running') return;
    this.outcome = outcome;
    this.trigger((t) => t.on === outcome);
    if (outcome === 'success') for (const id of this.mission.codex) this.host.unlockCodex(id);
  }

  private trigger(pred: (t: ChatterTrigger) => boolean): void {
    for (const beat of this.mission.chatter) {
      if (this.fired.has(beat.id) || !pred(beat.trigger)) continue;
      this.fired.add(beat.id);
      this.host.playChatter(beat);
    }
  }

  /** Set pieces whose anchor can't resolve yet (e.g. a tag spawned later) retry every frame. */
  private releasePieces(): void {
    for (let k = this.pendingPieces.length - 1; k >= 0; k--) {
      const sp = this.pendingPieces[k];
      const gate = sp.params?.whenFlag;
      if (typeof gate === 'string' && !this.flags.has(gate)) continue;
      const pos = this.resolve(sp.place);
      if (!pos) continue;
      this.pendingPieces.splice(k, 1);
      const handle = this.host.spawnSetPiece(sp, pos);
      this.pieces.push({ ...handle, tag: handle.tag, position: handle.position, radius: handle.radius, spec: sp });
      const hold = sp.params?.hold;
      if (sp.kind === 'beacon' && typeof hold === 'number') {
        const r = sp.params?.radius;
        this.dwells.push({ tag: sp.tag, position: handle.position, radius: typeof r === 'number' ? r : 300, hold, progress: this.restoredDwells.get(sp.tag) ?? 0 });
      }
    }
  }

  private releaseSpawns(): void {
    for (let k = this.pendingSpawns.length - 1; k >= 0; k--) {
      const s = this.pendingSpawns[k];
      if (s.whenFlag && !this.flags.has(s.whenFlag)) continue;
      // With a flag, the delay counts from when the flag was set.
      const t0 = s.whenFlag ? (this.flagTime.get(s.whenFlag) ?? 0) : 0;
      if ((s.delay ?? 0) > this.time - t0) continue;
      const base = this.resolve(s.place);
      if (!base) continue;
      this.pendingSpawns.splice(k, 1);
      const index = this.mission.spawns.indexOf(s);
      this.released.add(index);
      for (let i = 0; i < s.count; i++) {
        // Loose wedge so groups don't spawn inside each other.
        const pos = base.clone().add(new Vector3((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 60, (i % 3) * 12, -Math.ceil(i / 2) * 45));
        const ship = this.host.spawnShip(s, i, pos);
        this.tagged.push({ tag: tagFor(s, i), ship, spawn: index, member: i });
      }
      if (s.role === 'escort' && s.tag) {
        this.escorts.push({ tag: s.tag, ships: this.shipsTagged(s.tag), target: null, halted: false });
      }
    }
  }

  /** Progress as plain JSON (see RunnerSnapshot). */
  snapshot(): RunnerSnapshot {
    const v = (x: { x: number; y: number; z: number } | undefined): V3 => (x ? [x.x, x.y, x.z] : [0, 0, 0]);
    return {
      time: this.time,
      flags: [...this.flags].map((f) => [f, this.flagTime.get(f) ?? 0]),
      state: [...this.state],
      fired: [...this.fired],
      kills: [...this.kills],
      released: [...this.released],
      ships: this.tagged.map((t) => ({
        spawn: t.spawn,
        member: t.member,
        alive: t.ship.alive,
        pos: v(t.ship.flight.position),
        vel: v((t.ship.flight as { velocity?: Vector3 }).velocity),
        hull: t.ship.hullMax > 0 ? t.ship.hull / t.ship.hullMax : 1,
      })),
      dwells: this.dwells.map((d) => [d.tag, d.progress]),
    };
  }

  /**
   * Resume from a snapshot. Call instead of a fresh start, BEFORE `begin()`:
   * flags come back silently (no chatter, no script commands), released
   * groups respawn where they were (survivors only, at their hull), pending
   * spawns keep their timers, dwell rings keep their progress.
   * Invalid snapshot data throws before any state changes or host calls.
   * Exceptions from host callbacks are not rolled back.
   */
  restore(snap: unknown): void {
    validateRunnerSnapshot(snap, this.mission);
    this.time = snap.time;
    for (const [f, t] of snap.flags) {
      this.flags.add(f);
      this.flagTime.set(f, t);
    }
    for (const f of this.flags) {
      const m = /^halt:(.+)$/.exec(f);
      if (m && !this.flags.has(`resume:${m[1]}`)) this.halted.add(m[1]);
    }
    if (snap.state.length === this.state.length) for (let i = 0; i < this.state.length; i++) this.state[i] = snap.state[i];
    for (const id of snap.fired) this.fired.add(id);
    for (const [f, n] of snap.kills) this.kills.set(f as FactionId, n);
    for (const [tag, p] of snap.dwells) this.restoredDwells.set(tag, p);
    for (const index of snap.released) {
      const spec = this.mission.spawns[index];
      if (!spec) continue;
      const k = this.pendingSpawns.indexOf(spec);
      if (k >= 0) this.pendingSpawns.splice(k, 1);
      this.released.add(index);
      for (const m of snap.ships) {
        if (m.spawn !== index || !m.alive) continue;
        const ship = this.host.spawnShip(spec, m.member, new Vector3(...m.pos));
        (ship.flight as { velocity?: Vector3 }).velocity?.set(...m.vel);
        ship.hull = Math.max(1, ship.hullMax * m.hull);
        this.tagged.push({ tag: tagFor(spec, m.member), ship, spawn: index, member: m.member });
      }
      if (spec.role === 'escort' && spec.tag) this.escorts.push({ tag: spec.tag, ships: this.shipsTagged(spec.tag), target: null, halted: false });
    }
  }

  resolve(p: Placement): Vector3 | null {
    const off = new Vector3(...p.offset);
    if (p.at === 'player') return off.add(this.host.playerPosition);
    if (p.at === 'point') return off.add(new Vector3(...p.point));
    if (p.at === 'gate') {
      const g = this.host.gatePosition(p.gateIndex ?? 0);
      return g ? off.add(g) : null;
    }
    const ship = this.tagged.find((t) => matches(t.tag, p.tag));
    if (ship) return off.add(ship.ship.flight.position);
    const piece = this.pieces.find((x) => matches(x.tag, p.tag));
    return piece ? off.add(piece.position) : null;
  }

  shipsTagged(tag: string): ShipEntity[] {
    return this.tagged.filter((t) => matches(t.tag, tag)).map((t) => t.ship);
  }

  tagOf(ship: ShipEntity): string | undefined {
    return this.tagged.find((t) => t.ship === ship)?.tag;
  }
}

function tagFor(s: SpawnSpec, i: number): string {
  return s.tag ? (s.count > 1 ? `${s.tag}-${i + 1}` : s.tag) : `${s.blueprint}-${i + 1}`;
}

/** 'convoy' matches 'convoy', 'convoy-1', 'convoy-2' … */
function matches(tag: string, query: string): boolean {
  return tag === query || tag.startsWith(query + '-');
}
