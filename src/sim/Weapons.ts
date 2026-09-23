import { Vector3 } from 'three';
import type { Fleet, ShipEntity } from './Fleet';
import type { FactionId } from '@/assets/Blueprint';

/**
 * Milestone 10 — weapons simulation (no rendering here).
 *
 * Bolts: fixed pool of projectiles in flat Float64Arrays (universe space).
 * Each step they move and are tested as swept segments against every living
 * enemy ship's bounding sphere — exact enough at 1600 m/s, no tunnelling.
 *
 * Beams: continuous rays with a lifetime and damage-per-second, hit-tested
 * against spheres each step (capital lances, the Kestrel's charged cannon).
 *
 * Results are pushed to `events` for FX, HUD and cameras to consume and
 * clear each frame. One array, read by whoever cares — no callbacks.
 */
export const BOLT_CAPACITY = 4096;

export interface WeaponEvent {
  kind: 'hit' | 'shield' | 'kill' | 'fire' | 'beam-hit';
  position: Vector3;
  /** Surface normal at impact (points out of the ship). */
  normal: Vector3;
  velocity: Vector3;
  ship: ShipEntity | null;
  shooter: ShipEntity | null;
}

export interface Beam {
  active: boolean;
  owner: ShipEntity;
  socket: string | null;
  origin: Vector3; // universe, updated each step from the owner
  dir: Vector3;
  length: number;
  width: number;
  life: number;
  maxLife: number;
  dps: number;
  faction: FactionId;
  /** Where the beam currently terminates (hit point or full length). */
  end: Vector3;
}

export interface GunSpec {
  rate: number; // shots/s (alternating between sockets)
  speed: number; // m/s muzzle velocity (added to ship velocity)
  life: number; // s
  damage: number;
}

export const LASER: GunSpec = { rate: 12, speed: 1600, life: 1.15, damage: 6 };

const EVENT_POOL = 256;
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _c = new Vector3();
const _f = new Vector3();

export class Weapons {
  // Bolt pool (structure of arrays).
  readonly px = new Float64Array(BOLT_CAPACITY);
  readonly py = new Float64Array(BOLT_CAPACITY);
  readonly pz = new Float64Array(BOLT_CAPACITY);
  readonly vx = new Float32Array(BOLT_CAPACITY);
  readonly vy = new Float32Array(BOLT_CAPACITY);
  readonly vz = new Float32Array(BOLT_CAPACITY);
  readonly life = new Float32Array(BOLT_CAPACITY);
  readonly damage = new Float32Array(BOLT_CAPACITY);
  readonly faction = new Uint8Array(BOLT_CAPACITY); // index into FACTION_INDEX
  readonly owner = new Int32Array(BOLT_CAPACITY);
  private head = 0;

  readonly beams: Beam[] = [];
  readonly events: WeaponEvent[] = [];
  private eventPool: WeaponEvent[] = [];
  private cooldown = new Map<number, number>();
  private gunSide = new Map<number, number>();

  constructor(private fleet: Fleet) {
    for (let i = 0; i < EVENT_POOL; i++) {
      this.eventPool.push({ kind: 'hit', position: new Vector3(), normal: new Vector3(), velocity: new Vector3(), ship: null, shooter: null });
    }
  }

  private emit(kind: WeaponEvent['kind'], pos: Vector3, normal: Vector3, vel: Vector3, ship: ShipEntity | null, shooter: ShipEntity | null): void {
    if (this.events.length >= EVENT_POOL) return;
    const e = this.eventPool[this.events.length];
    e.kind = kind;
    e.position.copy(pos);
    e.normal.copy(normal);
    e.velocity.copy(vel);
    e.ship = ship;
    e.shooter = shooter;
    this.events.push(e);
  }

  /** Universe position of a named socket on a ship. */
  socketPosition(s: ShipEntity, socket: string, out: Vector3): Vector3 {
    const o = s.model.sockets.get(socket);
    if (!o) return out.copy(s.flight.position);
    return out.copy(o.position).applyQuaternion(s.flight.orientation).add(s.flight.position);
  }

  /** Fire the ship's guns if its controls say so and it's off cooldown. */
  private fireGuns(s: ShipEntity, dt: number, gun: GunSpec): void {
    const cd = (this.cooldown.get(s.id) ?? 0) - dt;
    if (!s.controls.fire || cd > 0) {
      this.cooldown.set(s.id, Math.max(cd, 0));
      return;
    }
    const sockets = ['gun', 'gun.L'].filter((n) => s.model.sockets.has(n));
    const side = (this.gunSide.get(s.id) ?? 0) + 1;
    this.gunSide.set(s.id, side);
    const name = sockets.length ? sockets[side % sockets.length] : null;
    if (name) this.socketPosition(s, name, _a);
    else _a.copy(s.flight.position);
    s.flight.forward(_f);
    _d.copy(_f).multiplyScalar(gun.speed).add(s.flight.velocity);
    this.spawnBolt(_a, _d, gun.life, gun.damage, s);
    this.emit('fire', _a, _f, _d, null, s);
    this.cooldown.set(s.id, cd + 1 / gun.rate);
  }

  spawnBolt(pos: Vector3, vel: Vector3, life: number, damage: number, owner: ShipEntity): void {
    const i = this.head;
    this.head = (this.head + 1) % BOLT_CAPACITY;
    this.px[i] = pos.x;
    this.py[i] = pos.y;
    this.pz[i] = pos.z;
    this.vx[i] = vel.x;
    this.vy[i] = vel.y;
    this.vz[i] = vel.z;
    this.life[i] = life;
    this.damage[i] = damage;
    this.faction[i] = FACTION_INDEX[owner.faction];
    this.owner[i] = owner.id;
  }

  fireBeam(owner: ShipEntity, socket: string | null, length: number, width: number, duration: number, dps: number): Beam {
    let b = this.beams.find((x) => !x.active);
    if (!b) {
      b = { active: false, owner, socket, origin: new Vector3(), dir: new Vector3(), length, width, life: 0, maxLife: duration, dps, faction: owner.faction, end: new Vector3() };
      this.beams.push(b);
    }
    Object.assign(b, { active: true, owner, socket, length, width, life: duration, maxLife: duration, dps, faction: owner.faction });
    return b;
  }

  step(dt: number): void {
    this.events.length = 0;
    const ships = this.fleet.ships;

    for (const s of ships) if (s.alive) this.fireGuns(s, dt, LASER);

    // ── bolts ────────────────────────────────────────────────────────
    for (let i = 0; i < BOLT_CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      _a.set(this.px[i], this.py[i], this.pz[i]);
      _d.set(this.vx[i] * dt, this.vy[i] * dt, this.vz[i] * dt);
      const f = this.faction[i];
      let hitT = 2;
      let hitShip: ShipEntity | null = null;
      for (const s of ships) {
        if (!s.alive || FACTION_INDEX[s.faction] === f || s.id === this.owner[i]) continue;
        const t = segmentSphere(_a, _d, s.flight.position, s.radius);
        if (t < hitT) {
          hitT = t;
          hitShip = s;
        }
      }
      if (hitShip) {
        _b.copy(_a).addScaledVector(_d, hitT);
        _c.subVectors(_b, hitShip.flight.position).normalize();
        _f.set(this.vx[i], this.vy[i], this.vz[i]);
        const shielded = hitShip.shield > 0;
        const shooter = ships.find((x) => x.id === this.owner[i]) ?? null;
        const killed = this.fleet.damage(hitShip, this.damage[i]);
        this.emit(shielded ? 'shield' : 'hit', _b, _c, _f, hitShip, shooter);
        if (killed) this.emit('kill', hitShip.flight.position, _c, hitShip.flight.velocity, hitShip, shooter);
        this.life[i] = 0;
        continue;
      }
      this.px[i] += _d.x;
      this.py[i] += _d.y;
      this.pz[i] += _d.z;
    }

    // ── beams ────────────────────────────────────────────────────────
    for (const b of this.beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0 || !b.owner.alive) {
        b.active = false;
        continue;
      }
      if (b.socket) this.socketPosition(b.owner, b.socket, b.origin);
      else b.origin.copy(b.owner.flight.position);
      b.owner.flight.forward(b.dir);
      _d.copy(b.dir).multiplyScalar(b.length);
      let hitT = 1;
      let hitShip: ShipEntity | null = null;
      for (const s of ships) {
        if (!s.alive || s.faction === b.faction) continue;
        const t = segmentSphere(b.origin, _d, s.flight.position, s.radius + b.width * 0.5);
        if (t < hitT) {
          hitT = t;
          hitShip = s;
        }
      }
      b.end.copy(b.origin).addScaledVector(_d, Math.min(hitT, 1));
      if (hitShip) {
        _c.subVectors(b.end, hitShip.flight.position).normalize();
        const killed = this.fleet.damage(hitShip, b.dps * dt);
        this.emit('beam-hit', b.end, _c, hitShip.flight.velocity, hitShip, b.owner);
        if (killed) this.emit('kill', hitShip.flight.position, _c, hitShip.flight.velocity, hitShip, b.owner);
      }
    }
  }
}

export const FACTION_INDEX: Record<FactionId, number> = { concord: 0, choir: 1, rustwake: 2 };

/**
 * Earliest t in [0,1] where segment p + t·d enters the sphere, or 2 if none.
 * (Starting inside counts as t = 0.)
 */
export function segmentSphere(p: Vector3, d: Vector3, c: Vector3, r: number): number {
  const mx = p.x - c.x;
  const my = p.y - c.y;
  const mz = p.z - c.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc <= 0) return 0;
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const bb = mx * d.x + my * d.y + mz * d.z;
  if (bb > 0 || a < 1e-12) return 2;
  const disc = bb * bb - a * cc;
  if (disc < 0) return 2;
  const t = (-bb - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : 2;
}
