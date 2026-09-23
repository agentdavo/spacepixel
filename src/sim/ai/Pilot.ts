import { Quaternion, Vector3 } from 'three';
import type { ControlState } from '@/core/Input';
import type { FlightModel } from '../FlightModel';

/**
 * Milestone 13/14 — low-level piloting.
 *
 * Everything here turns an intent ("point the nose there", "go this fast")
 * into the SAME ControlState the player's stick and throttle produce. The AI
 * never touches position, velocity or orientation: it flies the FlightModel
 * exactly like a human, so whatever the player can do, the AI can do, and
 * vice versa.
 *
 * Frames: ships face +Z, up +Y, so in the body frame right = −X.
 *   pitch +  = nose up     (rotation about body −X)   rate = bodyRates.x
 *   yaw   +  = nose right  (rotation about body −Y)   rate = −bodyRates.y
 *   roll  +  = roll right  (rotation about body +Z)   rate = bodyRates.z
 *
 * All functions are allocation-free (module scratch vectors).
 */

/** Gun ballistics the AI leads for. The weapons system (M10) should match these. */
export const GUN = {
  /** Bolt muzzle speed, m/s. */
  boltSpeed: 1600,
  /** Effective range; the AI holds fire beyond this. */
  range: 1500,
  /** Bolts inherit the firing ship's velocity (bolt v = ship v + nose × boltSpeed). */
  inheritVelocity: true,
};

/** Per-ship steering memory (lives inside the brain). */
export interface PilotState {
  /** Last commanded world direction, for line-of-sight-rate feed-forward. */
  prevDir: Vector3;
  hasPrev: boolean;
  /** Low-passed feed-forward body rates (rad/s): pitch-up, yaw-right. */
  ffPitch: number;
  ffYaw: number;
}

export function createPilotState(): PilotState {
  return { prevDir: new Vector3(0, 0, 1), hasPrev: false, ffPitch: 0, ffYaw: 0 };
}

export interface SteerGains {
  /** Angle → rate gain (1/s). */
  kp: number;
  /** Rate-error damping using flight.bodyRates (lag compensation). */
  kd: number;
  /** 0..1 — how much the pilot banks into turns (roll-to-turn). */
  bank: number;
  /** 0..1 — scales the commanded stick deflection (rookies don't max-perform). */
  authority: number;
}

export const DEFAULT_GAINS: SteerGains = { kp: 5.5, kd: 0.35, bank: 1, authority: 1 };

const _inv = new Quaternion();
const _l = new Vector3();
const _w = new Vector3();
const _v = new Vector3();
const _r = new Vector3();

const clamp1 = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Point the nose along a world-space unit direction.
 *
 * PD on the body-frame angle error, with the desired direction's own angular
 * rate fed forward (so tracking a crossing target has no steady-state lag).
 * Beyond ~10° off the nose the pilot rolls the target into the lift plane
 * and pulls, fighter style, instead of flat-yawing; near the nose it fine-aims
 * with pitch + yaw and (optionally) rolls to match `up` — the leader's up
 * vector in formation, for example.
 *
 * Writes pitch / yaw / roll only. Returns the off-bore angle (radians).
 */
export function steerToward(
  c: ControlState,
  f: FlightModel,
  dir: Vector3,
  up: Vector3 | null,
  ps: PilotState,
  dt: number,
  g: SteerGains = DEFAULT_GAINS,
): number {
  const s = f.spec;
  _inv.copy(f.orientation).invert();
  _l.copy(dir).applyQuaternion(_inv);
  const lx = _l.x;
  const ly = _l.y;
  const lz = _l.z;
  const side = Math.hypot(lx, ly);
  const angle = Math.atan2(side, lz);

  // Axis-angle error split into pitch (up +) and yaw (right +).
  let pitchErr: number;
  let yawErr: number;
  if (side > 1e-6) {
    pitchErr = (ly / side) * angle;
    yawErr = (-lx / side) * angle;
  } else {
    pitchErr = lz < 0 ? angle : 0; // dead astern: loop up
    yawErr = 0;
  }

  // Feed-forward: angular velocity of the commanded direction, in body axes.
  let ffP = 0;
  let ffY = 0;
  if (ps.hasPrev && dt > 0 && ps.prevDir.dot(dir) > 0.985) {
    _w.crossVectors(ps.prevDir, dir).divideScalar(dt).applyQuaternion(_inv);
    ffP = clamp(-_w.x, -1.5, 1.5);
    ffY = clamp(-_w.y, -1.5, 1.5);
  }
  const kf = dt > 0 ? 1 - Math.exp(-dt / 0.08) : 1;
  ps.ffPitch += (ffP - ps.ffPitch) * kf;
  ps.ffYaw += (ffY - ps.ffYaw) * kf;
  ps.prevDir.copy(dir);
  ps.hasPrev = true;

  // Roll-to-turn weight: 0 near the nose (fine aim), 1 for real turns.
  const bankW = g.bank * smoothstep(0.1, 0.45, angle);
  // At large angles don't push the nose down toward a target below — roll it
  // into the lift plane and pull, like a fighter pilot.
  if (bankW > 0 && pitchErr < 0) pitchErr *= 1 - bankW;

  const pRate = f.bodyRates.x;
  const yRate = -f.bodyRates.y;
  const rRate = f.bodyRates.z;

  const wantP = g.kp * pitchErr + ps.ffPitch * (1 - bankW);
  const wantY = g.kp * yawErr + ps.ffYaw * (1 - bankW);
  c.pitch = clamp1(((wantP + g.kd * (wantP - pRate)) / s.pitchRate) * g.authority);
  c.yaw = clamp1(((wantY + g.kd * (wantY - yRate)) / s.yawRate) * g.authority);

  // Roll: bank the target into the pull plane, or match the reference up.
  let rollErr = 0;
  if (side > 1e-6) rollErr += bankW * Math.atan2(-lx, ly);
  if (up && bankW < 1) {
    _v.copy(up).applyQuaternion(_inv);
    rollErr += (1 - bankW) * Math.atan2(-_v.x, _v.y);
  }
  rollErr = wrapPi(rollErr);
  const wantR = 4 * rollErr;
  c.roll = clamp1(((wantR + g.kd * (wantR - rRate)) / s.rollRate) * g.authority);
  return angle;
}

/** Throttle to hold a speed (m/s). Lights the afterburner above max cruise if allowed. */
export function setSpeed(c: ControlState, f: FlightModel, speed: number, allowBoost = true): void {
  const s = f.spec;
  c.throttleDelta = 0;
  const boost = allowBoost && speed > s.maxSpeed * 1.03 && !f.boostLocked && (f.boosting || f.boostGauge > 0.25);
  c.afterburner = boost;
  c.throttleSet = boost ? 1 : clamp(speed / s.maxSpeed, 0, 1);
}

/**
 * Fly to a world point, arriving at `arriveSpeed` (0 = stop there). Uses a
 * braking profile so the ship decelerates in time instead of overshooting.
 * Returns the distance to the point.
 */
export function flyToPoint(
  c: ControlState,
  f: FlightModel,
  point: Vector3,
  arriveSpeed: number,
  ps: PilotState,
  dt: number,
  g: SteerGains = DEFAULT_GAINS,
): number {
  _r.subVectors(point, f.position);
  const d = _r.length();
  if (d < 1e-3) {
    setSpeed(c, f, arriveSpeed, false);
    return 0;
  }
  _r.divideScalar(d);
  steerToward(c, f, _r, null, ps, dt, g);
  // v² = v_arrive² + 2·a·d with a gentle braking budget (retro thrust is lateralAccel).
  const brake = f.spec.lateralAccel * 0.6;
  const vMax = Math.sqrt(arriveSpeed * arriveSpeed + 2 * brake * d);
  // Don't run away from the point while the nose is still coming round.
  const align = Math.max(0.25, f.forward(_v).dot(_r));
  setSpeed(c, f, Math.min(vMax, f.spec.boostSpeed) * align, d > 1500);
  return d;
}

/**
 * Match a world velocity (formation keeping, escorting). With flight assist
 * the ship flies where it points, so: nose along the velocity, throttle to
 * its magnitude. Returns the off-bore angle.
 */
export function matchVelocity(
  c: ControlState,
  f: FlightModel,
  vel: Vector3,
  up: Vector3 | null,
  ps: PilotState,
  dt: number,
  g: SteerGains = DEFAULT_GAINS,
  allowBoost = true,
): number {
  const sp = vel.length();
  if (sp < 1) {
    setSpeed(c, f, 0, false);
    return 0;
  }
  _v.copy(vel).divideScalar(sp);
  const a = steerToward(c, f, _v, up, ps, dt, g);
  setSpeed(c, f, sp, allowBoost);
  return a;
}

/**
 * Time for a bolt of speed `v` to meet a target at relative position `r`
 * moving at relative velocity `u` (shooter frame). −1 if it can't.
 */
export function interceptTime(r: Vector3, u: Vector3, v: number): number {
  const a = u.dot(u) - v * v;
  const b = 2 * r.dot(u);
  const c = r.dot(r);
  if (Math.abs(a) < 1e-6) return b < 0 ? -c / b : -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : -1;
}

/**
 * Lead-pursuit aim point: where to point the nose so a bolt fired now meets
 * the target. `targetAcc` (optional) adds a second-order correction for a
 * turning target. Writes the world aim point to `out`, returns time of flight
 * (or −1 when there is no solution — `out` is then the target position).
 */
export function leadPoint(
  shooterPos: Vector3,
  shooterVel: Vector3,
  targetPos: Vector3,
  targetVel: Vector3,
  targetAcc: Vector3 | null,
  out: Vector3,
  boltSpeed = GUN.boltSpeed,
): number {
  _r.subVectors(targetPos, shooterPos);
  _v.copy(targetVel);
  if (GUN.inheritVelocity) _v.sub(shooterVel);
  let t = interceptTime(_r, _v, boltSpeed);
  if (t < 0) {
    out.copy(targetPos);
    return -1;
  }
  if (targetAcc) {
    // Two fixed-point refinements with the acceleration term.
    for (let i = 0; i < 2; i++) {
      _w.copy(_r).addScaledVector(_v, t).addScaledVector(targetAcc, 0.5 * t * t);
      t = _w.length() / boltSpeed;
    }
  }
  out.copy(shooterPos).add(_r).addScaledVector(_v, t);
  if (targetAcc) out.addScaledVector(targetAcc, 0.5 * t * t);
  return t;
}

/** Angle between the ship's nose and the direction to `point`. */
export function noseAngleTo(f: FlightModel, point: Vector3): number {
  _r.subVectors(point, f.position);
  const d = _r.length();
  if (d < 1e-6) return 0;
  f.forward(_v);
  return Math.acos(clamp(_v.dot(_r) / d, -1, 1));
}

/**
 * Trigger discipline: fire when the lead point sits inside a cone sized to the
 * target (plus `slack` radians of pilot sloppiness) and the target is in range.
 */
export function inFiringSolution(f: FlightModel, aimPoint: Vector3, dist: number, targetRadius: number, slack: number): boolean {
  if (dist > GUN.range) return false;
  const cone = Math.atan2(targetRadius * 1.1, Math.max(dist, 1)) + slack;
  return noseAngleTo(f, aimPoint) < cone;
}
