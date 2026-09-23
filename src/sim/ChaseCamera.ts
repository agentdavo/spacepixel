import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { FlightModel } from './FlightModel';

/**
 * Milestone 5 — cinematic chase camera.
 *
 * The ship responds instantly; the camera is allowed to lag, because that lag
 * is what makes the flying *read* on screen (the ship swings across frame
 * when you turn, the horizon tilts late on a roll, the world stretches when
 * the burners light). Aim is never affected: reticles are projected from the
 * ship's real nose, not the camera.
 *
 * - Position: critically damped spring toward an offset in the ship frame.
 * - Orientation: separately damped look-direction and up-vector, so rolls
 *   "swing" the horizon a beat after the ship.
 * - Velocity zoom: camera pulls back and FOV widens with speed.
 * - Afterburner: fast FOV punch-out + low-amplitude shake.
 *
 * Integration uses the closed-form critically damped spring, stable at any dt.
 */
export interface ChaseTuning {
  offset: Vector3; // ship-frame camera offset (behind = -Z)
  lookAhead: number; // m ahead of the ship to aim at
  posSmooth: number; // s — spring smooth time (~time to settle)
  lookSmooth: number;
  upSmooth: number;
  baseFov: number;
  speedFov: number; // extra FOV at max boost speed
  boostFov: number; // extra FOV punch while boosting
  speedPullback: number; // extra metres of distance at max boost speed
  shake: number; // metres of shake at full boost
}

export const DEFAULT_CHASE: ChaseTuning = {
  offset: new Vector3(0, 5.2, -26),
  lookAhead: 90,
  posSmooth: 0.16,
  lookSmooth: 0.09,
  upSmooth: 0.28,
  baseFov: 58,
  speedFov: 10,
  boostFov: 12,
  speedPullback: 5,
  shake: 0.12,
};

const _desired = new Vector3();
const _look = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _m = new Vector3();
const _basis = new Matrix4();
const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();

/** Critically damped spring on a Vector3 (Game Programming Gems 4, "SmoothDamp"). */
class Spring3 {
  readonly value = new Vector3();
  readonly vel = new Vector3();

  snap(v: Vector3): void {
    this.value.copy(v);
    this.vel.set(0, 0, 0);
  }

  update(target: Vector3, smoothTime: number, dt: number): Vector3 {
    const omega = (2 * Math.LN2) / Math.max(smoothTime, 1e-4) / 1.678; // half-life → natural freq (crit. damped)
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    _m.subVectors(this.value, target);
    const tempX = (this.vel.x + omega * _m.x) * dt;
    const tempY = (this.vel.y + omega * _m.y) * dt;
    const tempZ = (this.vel.z + omega * _m.z) * dt;
    this.vel.set((this.vel.x - omega * tempX) * exp, (this.vel.y - omega * tempY) * exp, (this.vel.z - omega * tempZ) * exp);
    this.value.set(target.x + (_m.x + tempX) * exp, target.y + (_m.y + tempY) * exp, target.z + (_m.z + tempZ) * exp);
    return this.value;
  }
}

export class ChaseCamera {
  readonly tuning: ChaseTuning;
  /** Universe-space eye position (float64). Feed to WorldSpace.eye. */
  readonly eye = new Vector3();
  readonly orientation = new Quaternion();

  private pos = new Spring3();
  private look = new Spring3(); // look direction (unit-ish vector)
  private upS = new Spring3();
  private boostPunch = 0;
  private fov: number;
  private shakeT = 0;

  constructor(
    readonly camera: PerspectiveCamera,
    tuning: Partial<ChaseTuning> = {},
  ) {
    this.tuning = { ...DEFAULT_CHASE, ...tuning };
    this.fov = this.tuning.baseFov;
  }

  /** Place the camera at rest behind the ship (no spring transient). */
  snap(ship: FlightModel): void {
    this.desired(ship, _desired);
    this.pos.snap(_desired);
    this.look.snap(ship.forward(_fwd));
    this.upS.snap(ship.up(_up));
    this.eye.copy(_desired);
  }

  private desired(ship: FlightModel, out: Vector3): Vector3 {
    const t = this.tuning;
    const speedK = Math.min(1, ship.speed / ship.spec.boostSpeed);
    out.copy(t.offset);
    out.z -= t.speedPullback * speedK;
    return out.applyQuaternion(ship.orientation).add(ship.position);
  }

  update(ship: FlightModel, dt: number): void {
    const t = this.tuning;

    // Position spring (universe space). Feed-forward the ship's velocity so
    // cruising at 400 m/s costs no lag; only rotation and acceleration do —
    // the camera slides out on a turn and falls back when the burners light.
    this.pos.value.addScaledVector(ship.velocity, dt);
    this.desired(ship, _desired);
    this.pos.update(_desired, t.posSmooth, dt);
    this.eye.copy(this.pos.value);

    // Look direction + up springs.
    ship.forward(_fwd);
    _look.copy(ship.position).addScaledVector(_fwd, t.lookAhead).sub(this.eye).normalize();
    const lookDir = this.look.update(_look, t.lookSmooth, dt);
    const upDir = this.upS.update(ship.up(_up), t.upSmooth, dt);

    // Shake while boosting (deterministic pseudo-noise; tiny amplitude).
    this.shakeT += dt;
    const boostK = ship.boosting ? 1 : 0;
    this.boostPunch += (boostK - this.boostPunch) * (1 - Math.exp(-(boostK ? 9 : 3) * dt));
    const amp = t.shake * this.boostPunch;
    if (amp > 1e-4) {
      const st = this.shakeT;
      _m.set(Math.sin(st * 37.1) * Math.sin(st * 13.3), Math.sin(st * 41.7 + 1.3) * Math.sin(st * 11.9), 0)
        .multiplyScalar(amp)
        .applyQuaternion(ship.orientation);
      this.eye.add(_m);
    }

    // Orientation from damped look + up. Cameras look down -Z.
    _bz.copy(lookDir).normalize().negate();
    _bx.crossVectors(upDir, _bz).normalize();
    _by.crossVectors(_bz, _bx);
    this.orientation.setFromRotationMatrix(_basis.makeBasis(_bx, _by, _bz));
    this.camera.quaternion.copy(this.orientation);

    // FOV: speed zoom + boost punch.
    const speedK = Math.min(1, ship.speed / ship.spec.boostSpeed);
    const targetFov = t.baseFov + t.speedFov * speedK + t.boostFov * this.boostPunch;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = MathUtils.clamp(this.fov, 20, 110);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Current (smoothed) chase FOV in degrees. */
  get fovValue(): number {
    return this.fov;
  }

  /** 0..1 afterburner visual intensity (drives post FX). */
  get boostAmount(): number {
    return this.boostPunch;
  }
}
