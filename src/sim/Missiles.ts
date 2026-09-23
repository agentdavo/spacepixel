import { Vector3 } from 'three';
import type { Fleet, ShipEntity } from './Fleet';

/**
 * Milestone 11 — guided micro-missile swarms (the "Itano Circus").
 *
 * A salvo kicks a dozen micro-missiles off the rails in a fan, each with its
 * own spiral "personality" (phase, frequency, amplitude) that decays as the
 * seeker settles in. Guidance is true proportional navigation (N≈4) with an
 * acceleration cap, so they curve dramatically and still hit crossing
 * targets. Proximity fuse at a few metres. Plain arrays, fixed pool.
 *
 * Lock-on: a target held inside the lock cone and range accumulates lock;
 * once full, the salvo is guided. `lockProgress` drives the HUD boxes.
 */
export const MISSILE_CAPACITY = 512;

export interface MissileSpec {
  salvo: number;
  stagger: number; // s between launches in a salvo
  eject: number; // m/s sideways kick off the rail
  boost: number; // m/s² forward acceleration
  maxSpeed: number;
  maxAccel: number; // m/s² turn authority
  navN: number;
  life: number;
  fuse: number; // m
  damage: number;
  spiral: number; // m/s² peak wobble accel
}

export const MICRO_MISSILE: MissileSpec = {
  salvo: 12,
  stagger: 0.045,
  eject: 55,
  boost: 420,
  maxSpeed: 950,
  maxAccel: 320,
  navN: 4,
  life: 7,
  fuse: 6,
  damage: 22,
  spiral: 260,
};

export interface MissileEvent {
  kind: 'launch' | 'detonate' | 'expire';
  position: Vector3;
  velocity: Vector3;
  index: number;
  target: ShipEntity | null;
  shooter: ShipEntity | null;
}

export interface LockState {
  target: ShipEntity | null;
  progress: number; // 0..1
  locked: boolean;
}

const _r = new Vector3();
const _v = new Vector3();
const _los = new Vector3();
const _omega = new Vector3();
const _acc = new Vector3();
const _side = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();

export class Missiles {
  readonly pos: Vector3[] = [];
  readonly vel: Vector3[] = [];
  readonly age = new Float32Array(MISSILE_CAPACITY);
  readonly alive = new Uint8Array(MISSILE_CAPACITY);
  readonly target: (ShipEntity | null)[] = new Array(MISSILE_CAPACITY).fill(null);
  readonly owner: (ShipEntity | null)[] = new Array(MISSILE_CAPACITY).fill(null);
  private phase = new Float32Array(MISSILE_CAPACITY);
  private freq = new Float32Array(MISSILE_CAPACITY);
  private head = 0;
  private queue: { t: number; shooter: ShipEntity; target: ShipEntity; k: number; spec: MissileSpec }[] = [];
  readonly events: MissileEvent[] = [];
  private eventPool: MissileEvent[] = [];
  private time = 0;
  private rng = 12345;

  constructor(private fleet: Fleet) {
    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      this.pos.push(new Vector3());
      this.vel.push(new Vector3());
    }
    for (let i = 0; i < 128; i++) {
      this.eventPool.push({ kind: 'launch', position: new Vector3(), velocity: new Vector3(), index: 0, target: null, shooter: null });
    }
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng - 1) / 2147483646;
  }

  private emit(kind: MissileEvent['kind'], i: number): void {
    if (this.events.length >= this.eventPool.length) return;
    const e = this.eventPool[this.events.length];
    e.kind = kind;
    e.index = i;
    e.position.copy(this.pos[i]);
    e.velocity.copy(this.vel[i]);
    e.target = this.target[i];
    e.shooter = this.owner[i];
    this.events.push(e);
  }

  /** Queue a staggered salvo from `shooter` at `target`. */
  salvo(shooter: ShipEntity, target: ShipEntity, spec: MissileSpec = MICRO_MISSILE): void {
    for (let k = 0; k < spec.salvo; k++) this.queue.push({ t: this.time + k * spec.stagger, shooter, target, k, spec });
  }

  private launch(shooter: ShipEntity, target: ShipEntity, k: number, spec: MissileSpec): void {
    const i = this.head;
    this.head = (this.head + 1) % MISSILE_CAPACITY;
    const f = shooter.flight;
    const rails = ['rail', 'rail.L'];
    const rail = shooter.model.sockets.get(rails[k % 2]);
    this.pos[i].copy(rail ? rail.position : _r.set(0, -1, 0)).applyQuaternion(f.orientation).add(f.position);
    // Fan out: sideways + down/up kick with some randomness, then boost forward.
    f.forward(_fwd);
    _side.set(k % 2 ? 1 : -1, 0, 0).applyQuaternion(f.orientation);
    _up.set(0, 1, 0).applyQuaternion(f.orientation);
    this.vel[i]
      .copy(f.velocity)
      .addScaledVector(_side, spec.eject * (0.6 + this.rand() * 0.8))
      .addScaledVector(_up, spec.eject * (this.rand() * 1.4 - 0.7))
      .addScaledVector(_fwd, 40);
    this.age[i] = 0;
    this.alive[i] = 1;
    this.target[i] = target;
    this.owner[i] = shooter;
    this.phase[i] = this.rand() * Math.PI * 2;
    this.freq[i] = 5 + this.rand() * 6;
    this.emit('launch', i);
  }

  step(dt: number, spec: MissileSpec = MICRO_MISSILE): void {
    this.events.length = 0;
    this.time += dt;
    for (let q = this.queue.length - 1; q >= 0; q--) {
      const job = this.queue[q];
      if (this.time >= job.t) {
        if (job.shooter.alive) this.launch(job.shooter, job.target, job.k, job.spec);
        this.queue.splice(q, 1);
      }
    }

    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      if (!this.alive[i]) continue;
      const p = this.pos[i];
      const v = this.vel[i];
      this.age[i] += dt;
      const age = this.age[i];
      const tgt = this.target[i];

      if (age > spec.life) {
        this.emit('expire', i);
        this.alive[i] = 0;
        continue;
      }

      _acc.set(0, 0, 0);
      const speed = v.length();
      _fwd.copy(v).divideScalar(speed || 1);

      if (tgt && tgt.alive && age > 0.18) {
        // Proportional navigation: a = N · Vc · (Ω × LOS)
        _r.subVectors(tgt.flight.position, p);
        _v.subVectors(tgt.flight.velocity, v);
        const dist2 = _r.lengthSq();
        const dist = Math.sqrt(dist2);
        if (dist < spec.fuse) {
          this.fleet.damage(tgt, spec.damage);
          this.emit('detonate', i);
          this.alive[i] = 0;
          continue;
        }
        _los.copy(_r).divideScalar(dist);
        _omega.crossVectors(_r, _v).divideScalar(dist2);
        const closing = -_v.dot(_los);
        _acc.crossVectors(_omega, _los).multiplyScalar(-spec.navN * Math.max(closing, 150));
        // Terminal bias straight at the target keeps short-range shots honest.
        _acc.addScaledVector(_los, 60);
      }

      // Itano spiral: sideways wobble that decays as the seeker settles.
      const wob = spec.spiral * Math.exp(-age * 1.1);
      if (wob > 1) {
        _side.set(0, 1, 0);
        if (Math.abs(_fwd.y) > 0.9) _side.set(1, 0, 0);
        _side.cross(_fwd).normalize();
        _up.crossVectors(_fwd, _side);
        const a = this.phase[i] + age * this.freq[i];
        _acc.addScaledVector(_side, Math.cos(a) * wob).addScaledVector(_up, Math.sin(a) * wob);
      }

      // Remove along-velocity component, cap lateral authority, then add boost.
      _acc.addScaledVector(_fwd, -_acc.dot(_fwd));
      const lat = _acc.length();
      if (lat > spec.maxAccel) _acc.multiplyScalar(spec.maxAccel / lat);
      if (speed < spec.maxSpeed) _acc.addScaledVector(_fwd, spec.boost);

      v.addScaledVector(_acc, dt);
      p.addScaledVector(v, dt);
    }
  }

  /** Lock-on accumulation for a shooter: cone + range, decays when lost. */
  static updateLock(lock: LockState, shooter: ShipEntity, dt: number, coneDeg = 14, range = 3200, lockTime = 1.1): void {
    const t = lock.target;
    if (!t || !t.alive) {
      lock.progress = 0;
      lock.locked = false;
      return;
    }
    _r.subVectors(t.flight.position, shooter.flight.position);
    const dist = _r.length();
    shooter.flight.forward(_fwd);
    const cos = _r.dot(_fwd) / Math.max(dist, 1e-3);
    const inCone = cos > Math.cos((coneDeg * Math.PI) / 180) && dist < range;
    lock.progress = Math.min(1, Math.max(0, lock.progress + (inCone ? dt / lockTime : -dt / (lockTime * 0.5))));
    if (lock.progress >= 1) lock.locked = true;
    else if (lock.progress <= 0.3) lock.locked = false;
  }
}
