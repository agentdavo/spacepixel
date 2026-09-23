import { Quaternion, Vector3 } from 'three';
import type { ControlState } from '@/core/Input';

/**
 * Milestone 4 — flight model.
 *
 * Arcade-Newtonian with flight assist, tuned so the ship RESPONDS ON THE
 * FRAME THE INPUT ARRIVES. Anything that lags (spring cameras, FOV kicks)
 * lives in the camera, never in the ship.
 *
 * - Rotation: body rates chase the commanded rate with a ~30 ms time constant
 *   (visibly moving on the first frame; no wind-up).
 * - Translation, flight assist ON: thrusters drive velocity toward
 *   forward × (throttle × maxSpeed), limited by per-axis thruster authority —
 *   so hard turns slide a little before the vector catches up (the OVA
 *   "drift" look) but the ship always goes where it points.
 * - Flight assist OFF: pure Newtonian. Main engine thrust only along the nose;
 *   flip around and burn to brake — Macross-style.
 * - Afterburner: raises speed cap and main thrust; drains a heat/fuel gauge
 *   with a lockout when exhausted.
 *
 * All state is float64 universe space (see WorldSpace).
 */
export interface FlightSpec {
  maxSpeed: number; // m/s at 100% throttle
  boostSpeed: number; // m/s with afterburner
  mainAccel: number; // m/s² forward thrust
  boostAccel: number; // m/s² forward thrust with afterburner
  lateralAccel: number; // m/s² thruster authority for FA corrections (side/up/retro)
  pitchRate: number; // rad/s
  yawRate: number;
  rollRate: number;
  rateResponse: number; // 1/s — body-rate convergence
  boostDrain: number; // gauge / s
  boostRegen: number; // gauge / s
  boostRelight: number; // gauge level to re-enable after lockout
  cruiseSpeed: number; // m/s — cruise drive for crossing a system
  cruiseAccel: number;
  cruiseSpool: number; // s before the drive engages
}

export const KESTREL_SPEC: FlightSpec = {
  maxSpeed: 220,
  boostSpeed: 460,
  mainAccel: 60,
  boostAccel: 150,
  lateralAccel: 70,
  pitchRate: 2.1,
  yawRate: 1.25,
  rollRate: 3.6,
  rateResponse: 32,
  boostDrain: 0.22,
  boostRegen: 0.1,
  boostRelight: 0.3,
  cruiseSpeed: 3000,
  cruiseAccel: 650,
  cruiseSpool: 1.4,
};

const _fwd = new Vector3();
const _desired = new Vector3();
const _dv = new Vector3();
const _local = new Vector3();
const _q = new Quaternion();
const _invQ = new Quaternion();

export class FlightModel {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  /** Body-frame angular velocity (x = pitch, y = yaw, z = roll), rad/s. */
  readonly bodyRates = new Vector3();

  throttle = 0.6; // 0..1
  flightAssist = true;
  boosting = false;
  boostGauge = 1; // 0..1
  boostLocked = false;
  /** Cruise drive: off → spooling → engaged. Firing or burner drops out. */
  cruise: 'off' | 'spool' | 'on' = 'off';
  cruiseT = 0;
  /**
   * Supercruise multiplier on cruise speed/acceleration, set by the scene
   * from the distance to the nearest massive body (Elite-style): crossing
   * 400 km of empty space takes seconds, and you slow naturally on approach.
   */
  cruiseScale = 1;
  /** Felt acceleration in body frame (m/s²), for camera shake / HUD g-meter. */
  readonly bodyAccel = new Vector3();

  constructor(public spec: FlightSpec = KESTREL_SPEC) {}

  get speed(): number {
    return this.velocity.length();
  }

  forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.orientation);
  }

  up(out = new Vector3()): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.orientation);
  }

  step(c: ControlState, dt: number): void {
    if (dt <= 0) return;
    const s = this.spec;

    // ── controls ─────────────────────────────────────────────────────
    if (c.flightAssistToggle) this.flightAssist = !this.flightAssist;
    if (c.throttleSet !== null) this.throttle = c.throttleSet;
    this.throttle = Math.min(1, Math.max(0, this.throttle + c.throttleDelta * 0.6 * dt));

    // Cruise drive.
    if (c.cruise) {
      this.cruise = this.cruise === 'off' ? 'spool' : 'off';
      this.cruiseT = 0;
    }
    if (this.cruise !== 'off' && (c.fire || c.afterburner || c.missile)) this.cruise = 'off';
    if (this.cruise === 'spool' && (this.cruiseT += dt) >= s.cruiseSpool) this.cruise = 'on';
    const cruising = this.cruise === 'on';

    const wantBoost = c.afterburner && !this.boostLocked;
    this.boosting = wantBoost && this.boostGauge > 0;
    if (this.boosting) {
      this.boostGauge = Math.max(0, this.boostGauge - s.boostDrain * dt);
      if (this.boostGauge === 0) this.boostLocked = true;
    } else {
      this.boostGauge = Math.min(1, this.boostGauge + s.boostRegen * dt);
      if (this.boostLocked && this.boostGauge >= s.boostRelight) this.boostLocked = false;
    }

    // ── rotation ─────────────────────────────────────────────────────
    const k = 1 - Math.exp(-s.rateResponse * dt);
    const turn = cruising ? 0.4 : 1; // big drive, lazy turns
    this.bodyRates.x += (c.pitch * s.pitchRate * turn - this.bodyRates.x) * k;
    this.bodyRates.y += (-c.yaw * s.yawRate * turn - this.bodyRates.y) * k;
    this.bodyRates.z += (c.roll * s.rollRate - this.bodyRates.z) * k;
    // Ship faces +Z: pitch-up is rotation about -X, roll-right about +Z.
    const wx = -this.bodyRates.x * dt;
    const wy = this.bodyRates.y * dt;
    const wz = this.bodyRates.z * dt;
    const angle = Math.hypot(wx, wy, wz);
    if (angle > 1e-9) {
      _q.setFromAxisAngle(_local.set(wx / angle, wy / angle, wz / angle), angle);
      this.orientation.multiply(_q).normalize(); // body-frame rotation
    }

    // ── translation ──────────────────────────────────────────────────
    this.forward(_fwd);
    const accelBefore = _dv.copy(this.velocity);
    if (this.flightAssist || cruising) {
      const target = cruising ? s.cruiseSpeed * this.cruiseScale : this.boosting ? s.boostSpeed : this.throttle * s.maxSpeed;
      _desired.copy(_fwd).multiplyScalar(target).sub(this.velocity); // velocity error, world
      // Split into body axes and clamp each by thruster authority.
      _invQ.copy(this.orientation).invert();
      _local.copy(_desired).applyQuaternion(_invQ);
      const fwdCap = (cruising ? s.cruiseAccel * this.cruiseScale : this.boosting ? s.boostAccel : s.mainAccel) * dt;
      // Dropping out of cruise bleeds speed hard (retro-burn), not over minutes.
      const latCap = (this.speed > s.boostSpeed * 1.05 ? s.cruiseAccel * Math.max(1, this.cruiseScale) : s.lateralAccel) * dt;
      _local.x = clampAbs(_local.x, latCap);
      _local.y = clampAbs(_local.y, latCap);
      _local.z = _local.z > 0 ? Math.min(_local.z, fwdCap) : Math.max(_local.z, -latCap);
      _local.applyQuaternion(this.orientation);
      this.velocity.add(_local);
    } else {
      const thrust = this.boosting ? s.boostAccel : this.throttle * s.mainAccel;
      this.velocity.addScaledVector(_fwd, thrust * dt);
    }
    // Felt acceleration (body frame) for camera shake / g-meter.
    // Low-passed so the HUD g-meter reads like a gauge, not per-step noise.
    _local.subVectors(this.velocity, accelBefore).divideScalar(dt).applyQuaternion(_invQ.copy(this.orientation).invert());
    this.bodyAccel.lerp(_local, 1 - Math.exp(-8 * dt));

    this.position.addScaledVector(this.velocity, dt);
  }
}

function clampAbs(v: number, cap: number): number {
  return v > cap ? cap : v < -cap ? -cap : v;
}
