import { Matrix4, Quaternion, Vector3, type Group } from 'three';
import type { ControlState } from '@/core/Input';
import type { FactionId, Livery } from '@/assets/Blueprint';
import type { ShipModel } from '@/assets/ShipBuilder';
import { assets } from '@/assets/AssetLibrary';
import { FlightModel } from './FlightModel';
import { createCombat, damageShip, stepCombat, type CombatState } from './Combat';
import type { DamageType } from './Loadouts';
import type { HitResult, Subsystem } from './Damage';
import { DEFAULT_WORLD_SEED, Rng } from './Rng';

/**
 * Every ship in a battle — player, wingmen, bandits — is a ShipEntity driven
 * by the same FlightModel through the same ControlState. The only difference
 * between the player and an AI is who writes `controls` each frame.
 *
 * Plain data + arrays; no component system. Systems (AI, weapons, damage)
 * are functions that walk `fleet.ships`.
 */
/**
 * Who a ship fights for. Usually its faction; missions can override it
 * (renegade Directorate ships, allied Zenith defectors, neutral escorts that
 * only turn when shot). `faction` stays the livery / kill-count identity.
 */
export type Team = FactionId | 'renegade' | 'neutral';

/** The one hostility rule, used by AI, weapons, turrets and the HUD. */
export function hostile(a: { team: Team }, b: { team: Team }): boolean {
  return a.team !== b.team && a.team !== 'neutral' && b.team !== 'neutral';
}

export interface ShipEntity {
  id: number;
  name: string;
  faction: FactionId;
  team: Team;
  flight: FlightModel;
  model: ShipModel;
  /** Written each frame by player input or an AI brain, read by flight + weapons. */
  controls: ControlState;
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  alive: boolean;
  /** Current target (for AI, weapons lock, cameras). */
  target: ShipEntity | null;
  /** Collision / targeting radius, metres. */
  radius: number;
  isPlayer: boolean;
  /** Free slot for AI state (owned by src/sim/ai). */
  brain: unknown;
  /** Seconds since last damage (shield regen delay, hit flashes). */
  sinceHit: number;
  /** Smoothed wing-sweep 0..1 (variable geometry). */
  sweep: number;
  /** Story characters: damage can't take hull below 15% (the script decides). */
  plotArmour: boolean;
  /** Stats, loadout, damage state (shield facings, subsystems, zones) — src/sim/Combat.ts. */
  combat: CombatState;
  /** This ship's own dice (forked from the world root by id): capital fire control, brain seed. */
  rng: Rng;
}

/** Consequences of a hit that FX / audio / HUD care about (emitted through `Fleet.onEvent`). */
export type HitEventKind = 'kill' | 'subsystem' | 'shield-down';

/**
 * Anything that can be shot down (heavy torpedoes). Registered by the
 * missile system so gunfire and point defence can test against it.
 */
export interface Shootables {
  /** Swept test of a hostile bolt; applies damage and returns true on a hit. */
  shoot(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, team: Team, damage: number): boolean;
  /** Nearest live shootable hostile to `team` within `range` of `from`, or −1. Writes its position/velocity. */
  nearestThreat(from: Vector3, team: Team, range: number, pos: Vector3, vel: Vector3): number;
}

export function emptyControls(): ControlState {
  return {
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttleDelta: 0,
    throttleSet: null,
    afterburner: false,
    flightAssistToggle: false,
    fire: false,
  };
}

const _m = new Matrix4();
const _o = new Vector3();
const _up = new Vector3(0, 1, 0);

export class Fleet {
  readonly ships: ShipEntity[] = [];
  private nextId = 1;
  /** Hit consequences (kills, subsystems destroyed, shield facings down) — the weapons system listens. */
  onEvent: ((kind: HitEventKind, ship: ShipEntity, point: Vector3, normal: Vector3, shooter: ShipEntity | null, sub: Subsystem | null, facing: number) => void) | null = null;
  /** Shoot-down-able ordnance (set by Missiles). */
  ordnance: Shootables | null = null;

  /** The world's root PRNG; every system and entity forks its own stream from it (Rng.ts). */
  readonly rng: Rng;

  constructor(
    private root: Group,
    seed = DEFAULT_WORLD_SEED,
  ) {
    this.rng = new Rng(seed);
  }

  /** Next entity id (replays record it so a resync after a berth allocates the same ids). */
  get nextEntityId(): number {
    return this.nextId;
  }
  set nextEntityId(v: number) {
    this.nextId = v;
  }

  spawn(blueprintId: string, faction: FactionId, position: Vector3, facing: Vector3, opts: Partial<ShipEntity> = {}, livery?: Partial<Livery>): ShipEntity {
    const model = assets.ship(blueprintId, livery);
    this.root.add(model.root);
    const combat = createCombat(blueprintId, model, faction);
    const flight = new FlightModel({ ...combat.baseSpec }); // own copy: damage scales it
    flight.position.copy(position);
    flight.orientation.setFromRotationMatrix(_m.lookAt(facing, _o.set(0, 0, 0), _up));
    flight.velocity.copy(facing).normalize().multiplyScalar(flight.spec.maxSpeed * 0.6);
    const isCapital = model.radius > 200; // flight / AI / collision class (corvettes fly like big fighters)
    const hullMax = combat.stats.hull;
    const shieldMax = combat.stats.shield;
    const id = this.nextId++;
    const e: ShipEntity = {
      id,
      name: `${model.blueprint.name}-${this.nextId}`,
      faction,
      team: faction,
      flight,
      model,
      controls: emptyControls(),
      hull: hullMax,
      hullMax,
      shield: shieldMax,
      shieldMax,
      alive: true,
      target: null,
      radius: model.radius * (isCapital ? 0.35 : 0.6),
      isPlayer: false,
      brain: null,
      sinceHit: 99,
      sweep: 0.3,
      plotArmour: false,
      combat,
      rng: this.rng.fork(id),
      ...opts,
    };
    this.ships.push(e);
    return e;
  }

  private clock = 0;

  /** Step flight for all living ships and copy sim state to visuals. */
  step(dt: number): void {
    this.clock += dt;
    for (const s of this.ships) {
      if (!s.alive) continue;
      // Variable geometry follows the flight: wings sweep back with speed
      // (fully swept in cruise), radars turn. No-ops on ships without joints.
      if (s.model.articulations.size) {
        const f = s.flight;
        const sweep = f.cruise === 'on' ? 1 : Math.min(1, Math.max(0, (f.speed - 140) / 320));
        s.sweep += (sweep - s.sweep) * (1 - Math.exp(-2.5 * dt));
        s.model.setWingSweep(s.sweep);
        s.model.setChannel('radar', (this.clock * 0.15) % 1);
      }
      stepCombat(s, dt);
      s.flight.step(s.controls, dt);
      s.sinceHit += dt;
      s.model.root.position.copy(s.flight.position);
      s.model.root.quaternion.copy(s.flight.orientation);
      s.model.setThrottle(s.flight.boosting ? 1.55 : 0.25 + s.flight.throttle * 0.9);
    }
  }

  enemiesOf(s: ShipEntity): ShipEntity[] {
    return this.ships.filter((o) => o.alive && hostile(o, s));
  }

  alliesOf(s: ShipEntity): ShipEntity[] {
    return this.ships.filter((o) => o.alive && o.team === s.team && o !== s);
  }

  /** Untargeted damage (legacy / collisions); shields absorb first. Returns true if this killed the ship. */
  damage(s: ShipEntity, amount: number, type: DamageType = 'laser'): boolean {
    const r = this.hit(s, amount, type, null, null, null);
    return r.killed;
  }

  /**
   * Located damage: `point` (universe) picks the shield facing, subsystem or
   * zone (see Damage.ts). Emits kill / subsystem / shield-down through
   * `onEvent`. The result is shared scratch — read it immediately.
   */
  hit(s: ShipEntity, amount: number, type: DamageType, point: Vector3 | null, normal: Vector3 | null, shooter: ShipEntity | null): HitResult & { killed: boolean } {
    const r = damageShip(s, amount, type, point);
    const ev = this.onEvent;
    if (ev) {
      const p = point ?? s.flight.position;
      const n = normal ?? _n.set(0, 1, 0);
      if (r.facingCollapsed) ev('shield-down', s, p, n, shooter, null, r.facing);
      if (r.subsystemDestroyed && r.subsystem) ev('subsystem', s, p, n, shooter, r.subsystem, r.facing);
      if (r.killed) ev('kill', s, s.flight.position, n, shooter, null, -1);
    }
    return r;
  }
}

const _n = new Vector3();

export function faceAlong(q: Quaternion, dir: Vector3): Quaternion {
  return q.setFromRotationMatrix(_m.lookAt(dir, _o.set(0, 0, 0), _up));
}
