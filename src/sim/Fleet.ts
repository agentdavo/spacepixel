import { Matrix4, Quaternion, Vector3, type Group } from 'three';
import type { ControlState } from '@/core/Input';
import type { FactionId, Livery } from '@/assets/Blueprint';
import type { ShipModel } from '@/assets/ShipBuilder';
import { assets } from '@/assets/AssetLibrary';
import { FlightModel, KESTREL_SPEC, type FlightSpec } from './FlightModel';

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

const SPECS: Record<string, FlightSpec> = {
  'vf27-kestrel': KESTREL_SPEC,
  'choir-cantor': { ...KESTREL_SPEC, maxSpeed: 235, boostSpeed: 440, pitchRate: 2.3, yawRate: 1.4, rollRate: 4.0 },
};

/** Capital ships: slow, stately, barely turn. */
const CAPITAL_SPEC: FlightSpec = {
  ...KESTREL_SPEC,
  maxSpeed: 45,
  boostSpeed: 60,
  mainAccel: 6,
  boostAccel: 8,
  lateralAccel: 4,
  pitchRate: 0.05,
  yawRate: 0.05,
  rollRate: 0.05,
};

const _m = new Matrix4();
const _o = new Vector3();
const _up = new Vector3(0, 1, 0);

export class Fleet {
  readonly ships: ShipEntity[] = [];
  private nextId = 1;

  constructor(private root: Group) {}

  spawn(blueprintId: string, faction: FactionId, position: Vector3, facing: Vector3, opts: Partial<ShipEntity> = {}, livery?: Partial<Livery>): ShipEntity {
    const model = assets.ship(blueprintId, livery);
    this.root.add(model.root);
    const flight = new FlightModel(SPECS[blueprintId] ?? (model.radius > 200 ? CAPITAL_SPEC : KESTREL_SPEC));
    flight.position.copy(position);
    flight.orientation.setFromRotationMatrix(_m.lookAt(facing, _o.set(0, 0, 0), _up));
    flight.velocity.copy(facing).normalize().multiplyScalar(flight.spec.maxSpeed * 0.6);
    const isCapital = model.radius > 200;
    const hullMax = isCapital ? 20000 : 100;
    const shieldMax = isCapital ? 8000 : 60;
    const e: ShipEntity = {
      id: this.nextId++,
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
      s.flight.step(s.controls, dt);
      s.sinceHit += dt;
      if (s.sinceHit > 3 && s.shield < s.shieldMax) s.shield = Math.min(s.shieldMax, s.shield + s.shieldMax * 0.15 * dt);
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

  /** Apply damage; shields absorb first. Returns true if this killed the ship. */
  damage(s: ShipEntity, amount: number): boolean {
    if (!s.alive) return false;
    s.sinceHit = 0;
    const absorbed = Math.min(s.shield, amount);
    s.shield -= absorbed;
    s.hull -= amount - absorbed;
    if (s.plotArmour) s.hull = Math.max(s.hull, s.hullMax * 0.15);
    if (s.hull <= 0) {
      s.alive = false;
      s.model.root.visible = false;
      return true;
    }
    return false;
  }
}

export function faceAlong(q: Quaternion, dir: Vector3): Quaternion {
  return q.setFromRotationMatrix(_m.lookAt(dir, _o.set(0, 0, 0), _up));
}
