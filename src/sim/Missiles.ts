import { Vector3 } from 'three';
import type { Fleet, ShipEntity, Shootables, Team } from './Fleet';
import { MISSILES, type MissileSpec } from './Loadouts';
import type { Subsystem } from './Damage';
import type { Rng } from './Rng';
import { createRayHit, missileOf, raycastShip, segmentSphere, selectedSubsystem, subsystemPosition } from './Combat';

export type { MissileSpec } from './Loadouts';

/**
 * Milestone 11 — guided missiles: micro-missile swarms (the "Itano Circus"),
 * heavy torpedoes and Rustwake harpoons (specs in Loadouts.ts).
 *
 * A salvo kicks missiles off the rails in a fan, each with its own spiral
 * "personality" (phase, frequency, amplitude) that decays as the seeker
 * settles in. Guidance is true proportional navigation with an acceleration
 * cap, so they curve dramatically and still hit crossing targets. Proximity
 * fuse on fighters; on capitals the warhead goes off where the missile meets
 * the shield shell or the plating, and a selected subsystem is homed on.
 * Torpedoes and micro-missiles have hit points: gunfire and point defence
 * can shoot them down (a torpedo takes a burst, a micro-missile one hit —
 * PD thins a swarm, it can't stop one). Harpoons tether a fighter (half thrust) for a few seconds.
 * Plain arrays, fixed pool.
 *
 * Lock-on: a target held inside the lock cone and range accumulates lock;
 * once full, the salvo is guided. `lockProgress` drives the HUD boxes. Lock
 * time and range follow the missile type and the target's signature.
 */
export const MISSILE_CAPACITY = 512;

/** The classic swarm (default spec). */
export const MICRO_MISSILE: MissileSpec = MISSILES.micro;

/**
 * AI pilots hold their ordnance longer than the reload: after a salvo the
 * next one waits `reload + min + rand·spread` seconds. Tuned with the 4v4
 * seed sweep in `npm run ai-sim` (swarms decide fighter fights fast).
 */
export const AI_MISSILE_HOLD = { min: 6, spread: 8 };

export interface MissileEvent {
  kind: 'launch' | 'detonate' | 'expire';
  position: Vector3;
  velocity: Vector3;
  index: number;
  target: ShipEntity | null;
  shooter: ShipEntity | null;
  spec: MissileSpec;
  /** Shot down before reaching its target. */
  intercepted: boolean;
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
const _aim = new Vector3();
const _seg = new Vector3();
const _hit = createRayHit();

export class Missiles implements Shootables {
  readonly pos: Vector3[] = [];
  readonly vel: Vector3[] = [];
  readonly age = new Float32Array(MISSILE_CAPACITY);
  readonly alive = new Uint8Array(MISSILE_CAPACITY);
  readonly hp = new Float32Array(MISSILE_CAPACITY);
  readonly target: (ShipEntity | null)[] = new Array(MISSILE_CAPACITY).fill(null);
  readonly owner: (ShipEntity | null)[] = new Array(MISSILE_CAPACITY).fill(null);
  readonly spec: MissileSpec[] = new Array(MISSILE_CAPACITY).fill(MICRO_MISSILE);
  /** Subsystem the missile homes on (capital targets), if any. */
  readonly aimSub: (Subsystem | null)[] = new Array(MISSILE_CAPACITY).fill(null);
  private phase = new Float32Array(MISSILE_CAPACITY);
  private freq = new Float32Array(MISSILE_CAPACITY);
  private head = 0;
  private queue: { t: number; shooter: ShipEntity; target: ShipEntity; k: number; spec: MissileSpec; sub: Subsystem | null }[] = [];
  /** Live missiles with hit points (torpedoes). */
  private shootable: number[] = [];
  /** Shot down during the weapons step; their blast is reported on the next missile step. */
  private dying: number[] = [];
  readonly events: MissileEvent[] = [];
  private eventPool: MissileEvent[] = [];
  private time = 0;
  /** The world's 'missiles' stream (src/sim/Rng.ts). */
  readonly rng: Rng;
  /** AI launch control: lock progress per ship id. */
  private aiLock = new Map<number, LockState>();

  constructor(private fleet: Fleet) {
    this.rng = fleet.rng.fork('missiles');
    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      this.pos.push(new Vector3());
      this.vel.push(new Vector3());
    }
    for (let i = 0; i < 160; i++) {
      this.eventPool.push({ kind: 'launch', position: new Vector3(), velocity: new Vector3(), index: 0, target: null, shooter: null, spec: MICRO_MISSILE, intercepted: false });
    }
    fleet.ordnance = this;
  }

  private rand(): number {
    return this.rng.next();
  }

  private emit(kind: MissileEvent['kind'], i: number, intercepted = false): void {
    if (this.events.length >= this.eventPool.length) return;
    const e = this.eventPool[this.events.length];
    e.kind = kind;
    e.index = i;
    e.position.copy(this.pos[i]);
    e.velocity.copy(this.vel[i]);
    e.target = this.target[i];
    e.shooter = this.owner[i];
    e.spec = this.spec[i];
    e.intercepted = intercepted;
    this.events.push(e);
  }

  /**
   * Queue a staggered salvo from `shooter` at `target`. Without a spec, fires
   * the shooter's selected missile type and respects its reload. Returns
   * false when nothing was launched.
   */
  salvo(shooter: ShipEntity, target: ShipEntity, spec?: MissileSpec): boolean {
    const s = spec ?? missileOf(shooter) ?? (shooter.combat.loadout.missiles.length ? null : MICRO_MISSILE);
    if (!s) return false;
    if (!spec) {
      if (shooter.combat.missileReload > 0) return false;
      shooter.combat.missileReload = s.reload;
    }
    const sub = selectedSubsystem(shooter, target);
    for (let k = 0; k < s.salvo; k++) this.queue.push({ t: this.time + k * s.stagger, shooter, target, k, spec: s, sub });
    return true;
  }

  /** Drop every missile in flight and every queued launch (cutscene cuts). */
  clear(): void {
    this.alive.fill(0);
    this.queue.length = 0;
    this.shootable.length = 0;
    this.dying.length = 0;
  }

  private launch(shooter: ShipEntity, target: ShipEntity, k: number, spec: MissileSpec, sub: Subsystem | null): void {
    const i = this.head;
    this.head = (this.head + 1) % MISSILE_CAPACITY;
    if (this.alive[i]) this.kill(i);
    const f = shooter.flight;
    const rails = spec.salvo === 1 ? ['torpedo', 'rail', 'rockets'] : ['rail', 'rail.L', 'pod', 'pod.L'];
    const railName = rails.filter((n) => shooter.model.sockets.has(n))[k % 2] ?? rails.find((n) => shooter.model.sockets.has(n));
    const rail = railName ? shooter.model.sockets.get(railName) : undefined;
    this.pos[i].copy(rail ? rail.position : _r.set(0, -1, 0)).applyQuaternion(f.orientation).add(f.position);
    // Fan out: sideways + down/up kick with some randomness, then boost forward.
    f.forward(_fwd);
    _side.set(k % 2 ? 1 : -1, 0, 0).applyQuaternion(f.orientation);
    _up.set(0, 1, 0).applyQuaternion(f.orientation);
    this.vel[i]
      .copy(f.velocity)
      .addScaledVector(_side, spec.eject * (0.6 + this.rand() * 0.8))
      .addScaledVector(_up, spec.eject * (this.rand() * 1.4 - 0.7) - (spec.salvo === 1 ? spec.eject : 0))
      .addScaledVector(_fwd, 40);
    this.age[i] = 0;
    this.alive[i] = 1;
    this.hp[i] = spec.hp;
    this.spec[i] = spec;
    this.aimSub[i] = sub;
    this.target[i] = target;
    this.owner[i] = shooter;
    this.phase[i] = this.rand() * Math.PI * 2;
    this.freq[i] = 5 + this.rand() * 6;
    if (spec.hp > 0) this.shootable.push(i);
    this.emit('launch', i);
  }

  private kill(i: number): void {
    this.alive[i] = 0;
    if (this.hp[i] > 0) {
      const k = this.shootable.indexOf(i);
      if (k >= 0) this.shootable.splice(k, 1);
    }
  }

  /** Point of aim: the homed subsystem, else the target's centre. */
  private aimPoint(i: number, tgt: ShipEntity, out: Vector3): Vector3 {
    const sub = this.aimSub[i];
    if (sub && !sub.destroyed) return subsystemPosition(tgt, sub, out);
    return out.copy(tgt.flight.position);
  }

  step(dt: number): void {
    this.events.length = 0;
    this.time += dt;
    for (const i of this.dying) {
      this.emit('detonate', i, true);
      this.alive[i] = 0;
    }
    this.dying.length = 0;
    this.aiLaunches(dt);
    for (let q = this.queue.length - 1; q >= 0; q--) {
      const job = this.queue[q];
      if (this.time >= job.t) {
        if (job.shooter.alive) this.launch(job.shooter, job.target, job.k, job.spec, job.sub);
        this.queue.splice(q, 1);
      }
    }

    for (let i = 0; i < MISSILE_CAPACITY; i++) {
      if (!this.alive[i] || this.hp[i] < 0) continue;
      const spec = this.spec[i];
      const p = this.pos[i];
      const v = this.vel[i];
      this.age[i] += dt;
      const age = this.age[i];
      const tgt = this.target[i];

      if (age > spec.life) {
        this.emit('expire', i);
        this.kill(i);
        continue;
      }

      _acc.set(0, 0, 0);
      const speed = v.length();
      _fwd.copy(v).divideScalar(speed || 1);

      if (tgt && tgt.alive && age > 0.18) {
        this.aimPoint(i, tgt, _aim);
        // Proportional navigation: a = N · Vc · (Ω × LOS)
        _r.subVectors(_aim, p);
        _v.subVectors(tgt.flight.velocity, v);
        const dist2 = _r.lengthSq();
        const dist = Math.sqrt(dist2);
        if (this.fuze(i, tgt, dist, speed, dt)) continue;
        _los.copy(_r).divideScalar(dist);
        _omega.crossVectors(_r, _v).divideScalar(dist2);
        const closing = -_v.dot(_los);
        _acc.crossVectors(_omega, _los).multiplyScalar(spec.navN * Math.max(closing, 150));
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

  /** Warhead: proximity on fighters; on capitals, contact with the shield shell or plating. */
  private fuze(i: number, tgt: ShipEntity, dist: number, speed: number, dt: number): boolean {
    const spec = this.spec[i];
    const p = this.pos[i];
    let hit = false;
    let sub: Subsystem | null = null;
    if (tgt.combat.dmg.capital) {
      _seg.copy(this.vel[i]).divideScalar(speed || 1).multiplyScalar(speed * dt + spec.fuse);
      if (raycastShip(tgt, p, _seg, 0, _hit)) {
        p.copy(_hit.point);
        sub = _hit.sub;
        hit = true;
      }
    } else if (dist < spec.fuse + Math.max(0, tgt.radius - 10)) {
      // (Big non-capital hulls — gunships, corvettes — fuse on their skin, not their centre.)
      _hit.normal.subVectors(p, tgt.flight.position).normalize();
      // Homed on a mount with the bubble down: the warhead finds it.
      const aim = this.aimSub[i];
      if (aim && !aim.destroyed && tgt.shield <= 0) sub = aim;
      hit = true;
    }
    if (!hit) return false;
    const r = this.fleet.hit(tgt, spec.damage, spec.type, p, _hit.normal, this.owner[i], sub);
    // A burst on the plating (not on a standing shield) splashes the mounts around it — centred on the mount it struck.
    if (spec.blast && !r.shielded) {
      const struck = r.subsystem;
      this.fleet.blast(tgt, struck ? subsystemPosition(tgt, struck, _aim) : p, spec.blast, spec.damage, spec.type, this.owner[i], struck);
    }
    if (spec.tether && !tgt.combat.dmg.capital) tgt.combat.dmg.tether = spec.tether;
    this.emit('detonate', i);
    this.kill(i);
    return true;
  }

  /** AI ships with missiles lock and fire on their own (torpedoes only at capitals). */
  private aiLaunches(dt: number): void {
    for (const s of this.fleet.ships) {
      if (!s.alive || (s.isPlayer && (s.brain as { autopilot?: boolean } | null)?.autopilot !== true)) continue;
      const types = s.combat.loadout.missiles;
      const t = s.target;
      if (!types.length || !t || !t.alive || s.combat.dmg.capital) continue;
      // Torpedoes for capitals, the other type for fighters.
      const wantTorp = t.combat.dmg.capital;
      const idx = types.findIndex((m) => (MISSILES[m].id === 'torpedo') === wantTorp);
      if (idx < 0) continue;
      s.combat.missile = idx;
      let lock = this.aiLock.get(s.id);
      if (!lock) this.aiLock.set(s.id, (lock = { target: null, progress: 0, locked: false }));
      if (lock.target !== t) {
        lock.target = t;
        lock.progress = 0;
        lock.locked = false;
      }
      Missiles.updateLock(lock, s, dt);
      if (lock.locked && s.combat.missileReload <= 0 && this.salvo(s, t)) {
        // AI pilots hold their ordnance longer than the reload.
        s.combat.missileReload += AI_MISSILE_HOLD.min + this.rand() * AI_MISSILE_HOLD.spread;
        lock.progress = 0;
        lock.locked = false;
      }
    }
  }

  // ── Shootables (torpedoes, micro-missiles) ──────────────────────────────────────

  shoot(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, team: Team, damage: number): boolean {
    if (!this.shootable.length) return false;
    _r.set(ax, ay, az);
    _v.set(dx, dy, dz);
    for (let k = 0; k < this.shootable.length; k++) {
      const i = this.shootable[k];
      const o = this.owner[i];
      if (!this.alive[i] || (o && o.team === team)) continue;
      // Torpedoes are big; a micro-missile is a pencil (but PD flak is proximity-fused).
      if (segmentSphere(_r, _v, this.pos[i], this.spec[i].salvo > 1 ? 4 : 6) > 1) continue;
      this.hp[i] -= damage;
      if (this.hp[i] <= 0) {
        // Report the blast on the next missile step (this runs inside the weapons step).
        this.hp[i] = -1; // < 0 = dying: the flight loop skips it
        this.shootable.splice(k, 1);
        this.dying.push(i);
      }
      return true;
    }
    return false;
  }

  nearestThreat(from: Vector3, team: Team, range: number, pos: Vector3, vel: Vector3): number {
    let best = -1;
    let bd = range;
    for (const i of this.shootable) {
      const o = this.owner[i];
      if (!this.alive[i] || !o || o.team === team || o.team === 'neutral') continue;
      const d = this.pos[i].distanceTo(from);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      pos.copy(this.pos[best]);
      vel.copy(this.vel[best]);
    }
    return best;
  }

  /**
   * Lock-on accumulation for a shooter: cone + range, decays when lost.
   * Defaults come from the shooter's selected missile, the target's
   * signature (big ships lock faster, from further) and avionics damage.
   */
  static updateLock(lock: LockState, shooter: ShipEntity, dt: number, coneDeg?: number, range?: number, lockTime?: number): void {
    const t = lock.target;
    if (!t || !t.alive) {
      lock.progress = 0;
      lock.locked = false;
      return;
    }
    const spec = missileOf(shooter) ?? MICRO_MISSILE;
    const sig = Math.sqrt(Math.max(0.25, t.combat.stats.signature));
    coneDeg ??= spec.lockCone;
    range ??= spec.lockRange * Math.min(3, sig);
    lockTime ??= (spec.lockTime * shooter.combat.fx.lockMul) / Math.min(2, sig);
    _r.subVectors(t.flight.position, shooter.flight.position);
    const dist = _r.length();
    shooter.flight.forward(_fwd);
    const cos = _r.dot(_fwd) / Math.max(dist, 1e-3);
    // Big targets fill more of the cone.
    const cone = (coneDeg * Math.PI) / 180 + Math.atan2(t.radius, Math.max(dist, 1));
    const inCone = cos > Math.cos(cone) && dist < range;
    lock.progress = Math.min(1, Math.max(0, lock.progress + (inCone ? dt / lockTime : -dt / (lockTime * 0.5))));
    if (lock.progress >= 1) lock.locked = true;
    else if (lock.progress <= 0.3) lock.locked = false;
  }
}
