import { Vector3 } from 'three';
import type { ShipEntity } from '../Fleet';
import { matchVelocity } from './Pilot';
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
 * Slot for wingman `i` (0-based, leader excluded) in the leader's body frame,
 * spacing in metres. Body frame: right = −X, up = +Y, forward = +Z.
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

/** World position of a brain's slot on its leader. */
export function slotWorld(b: Brain, leader: ShipEntity, out: Vector3): Vector3 {
  return out.copy(b.slot).applyQuaternion(leader.flight.orientation).add(leader.flight.position);
}

/**
 * Hold formation on `leader`. Writes pitch/yaw/roll/throttle. Returns the
 * slot error (metres).
 */
export function flyFormation(s: ShipEntity, b: Brain, leader: ShipEntity, dt: number, escape: Vector3 | null, urgency: number): number {
  const lf = leader.flight;
  const f = s.flight;
  slotWorld(b, leader, _slot);

  // Slot velocity = leader velocity + ω × r (the slot swings when the leader turns).
  _omega.set(-lf.bodyRates.x, lf.bodyRates.y, lf.bodyRates.z).applyQuaternion(lf.orientation);
  _err.subVectors(_slot, lf.position);
  _vSlot.crossVectors(_omega, _err).add(lf.velocity);

  _err.subVectors(_slot, f.position);
  const d = _err.length();
  // Closing speed toward the slot: linear near it, braking-limited further out.
  const corr = Math.min(0.9 * d, Math.sqrt(2 * 22 * d), 160);
  _des.copy(_vSlot);
  if (d > 1e-3) _des.addScaledVector(_err, corr / d);

  // Never turn around to reach a slot we overshot — slow down and let it come back.
  lf.forward(_fwd);
  const leadSpeed = lf.speed;
  const along = _des.dot(_fwd);
  const minAlong = Math.max(35, leadSpeed * 0.45);
  if (along < minAlong) _des.addScaledVector(_fwd, minAlong - along);

  if (escape && urgency > 0) {
    const sp = _des.length();
    _des.normalize().lerp(escape, Math.min(1, urgency * 1.6)).normalize().multiplyScalar(sp);
  }

  // Close in: match the leader's roll so the formation banks as one.
  const up = d < 150 ? lf.up(_up) : null;
  matchVelocity(s.controls, f, _des, up, b.pilot, dt, b.gains, d > 60);
  return d;
}

/** Set formation geometry for a wing (slot index = array order). */
export function setFormation(wing: readonly ShipEntity[], kind: FormationKind, spacing = 40): void {
  for (let i = 0; i < wing.length; i++) {
    const b = brainOf(wing[i]);
    b.formation = kind;
    b.spacing = spacing;
    b.slotIndex = i;
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
    b.nextThink = 0;
    switch (order) {
      case 'formUp':
        s.target = null;
        s.controls.fire = false;
        setManeuver(b, 'form');
        break;
      case 'attackMyTarget':
        s.target = leader.target && leader.target.alive && leader.target.faction !== s.faction ? leader.target : null;
        break;
      case 'breakAndAttack': {
        // Fan out from the formation: each ship peels away along its slot side.
        _err.copy(b.slot).applyQuaternion(leader.flight.orientation);
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
    if (!o.alive || o.faction === leader.faction || isCapital(o)) continue;
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
