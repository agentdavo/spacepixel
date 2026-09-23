import { Vector3 } from 'three';
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
}

interface TaggedShip {
  tag: string;
  ship: ShipEntity;
}

export class CampaignRunner {
  readonly flags = new Set<string>();
  readonly state: ('locked' | 'active' | 'done' | 'failed')[];
  outcome: 'running' | 'success' | 'failure' = 'running';
  time = 0;

  private tagged: TaggedShip[] = [];
  private pieces: SetPieceHandle[] = [];
  private pendingSpawns: SpawnSpec[];
  private pendingPieces: SetPieceSpec[];
  private fired = new Set<string>();
  private kills = new Map<FactionId, number>();
  private lastJumps = 0;
  readonly ctx: CampaignContext;

  constructor(
    readonly mission: CampaignMission,
    private host: CampaignHost,
  ) {
    this.state = mission.objectives.map((o, i) => (i === 0 || (o.optional && !o.hidden) ? 'active' : 'locked'));
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

  /** Immediate spawns, then set pieces (which may be placed relative to them); start codex + chatter. */
  begin(): void {
    this.releaseSpawns();
    this.releasePieces();
    for (const id of this.mission.codexOnStart ?? []) this.host.unlockCodex(id);
    this.trigger((t) => t.on === 'start');
  }

  setFlag(name: string): void {
    if (this.flags.has(name)) return;
    this.flags.add(name);
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
        // Hidden optionals reveal once the objective before them completes.
        if (i + 1 < obj.length && obj[i + 1].optional && this.state[i + 1] === 'locked') this.state[i + 1] = 'active';
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
      const pos = this.resolve(sp.place);
      if (!pos) continue;
      this.pendingPieces.splice(k, 1);
      this.pieces.push(this.host.spawnSetPiece(sp, pos));
    }
  }

  private releaseSpawns(): void {
    for (let k = this.pendingSpawns.length - 1; k >= 0; k--) {
      const s = this.pendingSpawns[k];
      if ((s.delay ?? 0) > this.time) continue;
      if (s.whenFlag && !this.flags.has(s.whenFlag)) continue;
      const base = this.resolve(s.place);
      if (!base) continue;
      this.pendingSpawns.splice(k, 1);
      for (let i = 0; i < s.count; i++) {
        // Loose wedge so groups don't spawn inside each other.
        const pos = base.clone().add(new Vector3((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 60, (i % 3) * 12, -Math.ceil(i / 2) * 45));
        const ship = this.host.spawnShip(s, i, pos);
        const tag = s.tag ? (s.count > 1 ? `${s.tag}-${i + 1}` : s.tag) : `${s.blueprint}-${i + 1}`;
        this.tagged.push({ tag, ship });
      }
    }
  }

  resolve(p: Placement): Vector3 | null {
    const off = new Vector3(...p.offset);
    if (p.at === 'player') return off.add(this.host.playerPosition);
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

/** 'convoy' matches 'convoy', 'convoy-1', 'convoy-2' … */
function matches(tag: string, query: string): boolean {
  return tag === query || tag.startsWith(query + '-');
}
