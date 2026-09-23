import { Quaternion, Vector3 } from 'three';
import { hostile, type ShipEntity } from '../Fleet';
import { matchVelocity, type SteerGains } from './Pilot';
import { brainOf, isCapital, setManeuver, type Brain, type FormationKind, type Order } from './state';

/**
 * Milestone 13 — wingmen and squadron command.
 *
 * Formation flying is velocity matching with a position correction: the
 * wingman flies the leader's velocity (plus the velocity its slot has because
 * the leader is turning), bent toward the slot with a braking profile so it
 * arrives smoothly instead of overshooting. It is flown through the same
 * Pilot primitives — nose along the desired velocity, throttle to its size.
 */

/**
 * Slot for wingman `i` (0-based, leader excluded) in the formation frame,
 * spacing in metres. Axes like a ship body: right = −X, up = +Y, forward = +Z.
 */
export function formationSlot(kind: FormationKind, i: number, spacing: number, out: Vector3): Vector3 {
  // Build in (right, up, fwd) then convert to body (−right, up, fwd).
  let right = 0;
  let upO = 0;
  let fwd = 0;
  switch (kind) {
    case 'fingerFour': {
      // Leader, #2 off the left wing, element lead #3 right, #4 outside #3.
      // Wider formations (5+) repeat the pattern further back.
      const row = Math.floor(i / 3);
      const k = i % 3;
      right = k === 0 ? -1 : k === 1 ? 1 : 2;
      fwd = k === 2 ? -1.6 : -0.8;
      fwd -= row * 1.8;
      upO = k === 1 ? 0.1 : 0;
      break;
    }
    case 'echelonRight':
      right = i + 1;
      fwd = -(i + 1) * 0.8;
      break;
    case 'echelonLeft':
      right = -(i + 1);
      fwd = -(i + 1) * 0.8;
      break;
    case 'lineAbreast': {
      const k = Math.floor(i / 2) + 1;
      right = i % 2 === 0 ? -k : k;
      break;
    }
  }
  return out.set(-right * spacing, upO * spacing, fwd * spacing);
}

const _slot = new Vector3();
const _omega = new Vector3();
const _vSlot = new Vector3();
const _err = new Vector3();
const _des = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();
const _ff = new Vector3();
const _fu = new Vector3();
const _left = new Vector3();
const _prevUp = new Vector3();
const _rq = new Quaternion();
const _gains: SteerGains = { kp: 5, kd: 0.35, bank: 1, authority: 1 };

/**
 * Roll the brain's formation frame toward the leader's up: low-passed and
 * rate-limited so the slot never swings faster than ~30 m/s (an outer slot
 * 150 m out follows a leader's aileron roll slowly; a close one briskly).
 */
function trackFormationUp(b: Brain, leader: ShipEntity, dt: number): void {
  const lf = leader.flight;
  lf.up(_up);
  if (!b.formUpInit) {
    b.formUp.copy(_up);
    b.formUpInit = true;
    return;
  }
  if (dt <= 0) return;
  lf.forward(_ff);
  // Signed angle about the leader's forward axis from formUp to its up.
  _fu.copy(b.formUp).addScaledVector(_ff, -b.formUp.dot(_ff));
  if (_fu.lengthSq() < 1e-6) {
    b.formUp.copy(_up);
    return;
  }
  _fu.normalize();
  const ang = Math.atan2(_left.crossVectors(_fu, _up).dot(_ff), _fu.dot(_up));
  const maxRate = Math.min(0.6, Math.max(0.12, 30 / Math.max(1, b.slot.length())));
  let step = ang * (1 - Math.exp(-dt / 0.8));
  const lim = maxRate * dt;
  step = step > lim ? lim : step < -lim ? -lim : step;
  b.formUp.copy(_fu).applyQuaternion(_rq.setFromAxisAngle(_ff, step));
}

/**
 * World position of a brain's slot: leader position + slot offset in the
 * formation frame (leader heading, roll-smoothed up). Optionally writes the
 * frame's up vector to `upOut`.
 */
export function slotWorld(b: Brain, leader: ShipEntity, out: Vector3, upOut?: Vector3): Vector3 {
  const lf = leader.flight;
  lf.forward(_ff);
  _fu.copy(b.formUpInit ? b.formUp : lf.up(_fu)).addScaledVector(_ff, -_fu.dot(_ff));
  if (_fu.lengthSq() < 1e-6) lf.up(_fu);
  _fu.normalize();
  _left.crossVectors(_fu, _ff); // up × fwd = body +X (left)
  if (upOut) upOut.copy(_fu);
  return out.copy(lf.position).addScaledVector(_left, b.slot.x).addScaledVector(_fu, b.slot.y).addScaledVector(_ff, b.slot.z);
}

/**
 * Hold formation on `leader`. Writes pitch/yaw/roll/throttle. Returns the
 * slot error (metres).
 */
export function flyFormation(s: ShipEntity, b: Brain, leader: ShipEntity, dt: number, escape: Vector3 | null, urgency: number): number {
  const lf = leader.flight;
  const f = s.flight;
  _prevUp.copy(b.formUpInit ? b.formUp : _prevUp.set(0, 0, 0));
  trackFormationUp(b, leader, dt);
  const frameUp = _up;
  slotWorld(b, leader, _slot, frameUp);

  // Slot velocity = leader velocity + ω × r, where ω is the leader's turn
  // rate minus its roll (the formation frame doesn't roll with it).
  _omega.set(-lf.bodyRates.x, lf.bodyRates.y, lf.bodyRates.z).applyQuaternion(lf.orientation);
  lf.forward(_fwd);
  _omega.addScaledVector(_fwd, -_omega.dot(_fwd));
  // …plus the formation frame's own (smoothed) roll.
  if (dt > 0 && _prevUp.lengthSq() > 0.5) _omega.addScaledVector(_fwd, _prevUp.cross(b.formUp).dot(_fwd) / dt);
  _err.subVectors(_slot, lf.position);
  _vSlot.crossVectors(_omega, _err).add(lf.velocity);

  _err.subVectors(_slot, f.position);
  const d = _err.length();
  // Closing speed toward the slot: linear near it, braking-limited further out.
  const corr = Math.min(0.6 * d, Math.sqrt(2 * 25 * d), 160);
  _des.copy(_vSlot);
  if (d > 1e-3) _des.addScaledVector(_err, corr / d);
  // Feed forward the leader's throttle / burner changes (felt forward accel).
  _des.addScaledVector(_fwd, lf.bodyAccel.z * 0.5);

  // Never turn around to reach a slot we overshot — slow down and let it come back.
  const along = _des.dot(_fwd);
  const minAlong = Math.max(35, lf.speed * 0.45);
  if (along < minAlong) _des.addScaledVector(_fwd, minAlong - along);

  if (escape && urgency > 0) {
    const sp = _des.length();
    _des.normalize().lerp(escape, Math.min(1, urgency * 1.6)).normalize().multiplyScalar(sp);
  }

  // Close in: small corrections with stick only (no roll-to-turn), wings level
  // with the formation frame so the flight banks as one.
  _gains.kp = b.gains.kp;
  _gains.kd = b.gains.kd;
  _gains.authority = b.gains.authority;
  _gains.bank = d < 120 ? 0 : b.gains.bank;
  matchVelocity(s.controls, f, _des, d < 150 ? frameUp : null, b.pilot, dt, _gains, true, 30);
  return d;
}

/** Set formation geometry for a wing (slot index = array order). */
export function setFormation(wing: readonly ShipEntity[], kind: FormationKind, spacing = 40): void {
  for (let i = 0; i < wing.length; i++) {
    const b = brainOf(wing[i]);
    b.formation = kind;
    b.spacing = spacing;
    b.slotIndex = i;
    b.formUpInit = false;
    formationSlot(kind, i, spacing, b.slot);
  }
}

/**
 * Squadron command. `wing` excludes the leader; its order in the array is
 * the slot order. Orders take effect on the wingman's next decision tick
 * (i.e. after its reaction time — they're pilots, not puppets).
 */
export function issueOrder(wing: readonly ShipEntity[], order: Order, leader: ShipEntity): void {
  leader.flight.forward(_fwd);
  leader.flight.up(_up);
  for (let i = 0; i < wing.length; i++) {
    const s = wing[i];
    if (s === leader || !s.alive || isCapital(s)) continue;
    const b = brainOf(s);
    b.order = order;
    b.leader = leader;
    b.slotIndex = i;
    formationSlot(b.formation, i, b.spacing, b.slot);
    b.formUpInit = false;
    b.nextThink = 0;
    switch (order) {
      case 'formUp':
        s.target = null;
        s.controls.fire = false;
        setManeuver(b, 'form');
        break;
      case 'attackMyTarget':
        s.target = leader.target && leader.target.alive && hostile(leader.target, s) ? leader.target : null;
        break;
      case 'breakAndAttack': {
        // Fan out from the formation: each ship peels away along its slot side.
        _err.subVectors(slotWorld(b, leader, _slot), leader.flight.position);
        if (_err.lengthSq() < 1) _err.copy(_up);
        _err.normalize();
        b.refDir.copy(_fwd).addScaledVector(_err, 0.9).addScaledVector(_up, i % 2 === 0 ? 0.35 : -0.35).normalize();
        setManeuver(b, 'scatter', 1.4 + 0.2 * i);
        break;
      }
      case 'engageAtWill':
      case 'coverMe':
        if (b.maneuver === 'form' || b.maneuver === 'patrol') setManeuver(b, 'patrol');
        break;
    }
  }
}

const _rel = new Vector3();

/**
 * The hostile most dangerous to `leader`: close, behind it, and pointed at
 * it (or explicitly targeting it). Used by `coverMe`.
 */
export function findChaser(leader: ShipEntity, ships: readonly ShipEntity[], range = 1800): ShipEntity | null {
  const lf = leader.flight;
  lf.forward(_fwd);
  let best: ShipEntity | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (!o.alive || !hostile(o, leader) || isCapital(o)) continue;
    _rel.subVectors(lf.position, o.flight.position); // o → leader
    const d = _rel.length();
    if (d > range || d < 1e-3) continue;
    _rel.divideScalar(d);
    const behind = _fwd.dot(_rel); // > 0: o is behind the leader
    const nose = o.flight.forward(_up).dot(_rel); // > 0: o points at the leader
    const onTail = behind > 0.2 && nose > 0.75;
    if (!onTail && o.target !== leader) continue;
    const score = d * (onTail ? 0.6 : 1) * (1.5 - nose * 0.5);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}
