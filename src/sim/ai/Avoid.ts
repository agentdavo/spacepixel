import { Box3, Vector3 } from 'three';
import type { ShipEntity } from '../Fleet';
import { isCapital } from './state';

/**
 * Collision avoidance: the last layer before steering. Given where the
 * pilot WANTS to point, bend that toward an escape direction when a
 * collision is coming. Fighters are spheres (closest point of approach on
 * relative motion); capital ships and static hazards are capsules sampled
 * along the predicted path, with a look-ahead long enough for the flight
 * model's wide, drifting turns (lateral thrust ~70 m/s² → ~500 m turn
 * radius at cruise).
 */

/** A world-space capsule hazard (a === b for a sphere). */
export interface Obstacle {
  a: Vector3;
  b: Vector3;
  radius: number;
}

interface CapitalHull {
  la: Vector3; // local capsule end points
  lb: Vector3;
  radius: number;
  world: Obstacle;
}

const hulls = new WeakMap<ShipEntity, CapitalHull>();
const _box = new Box3();

/** Capsule fitted to a capital ship's hull (cached; world ends updated per call). */
export function capitalCapsule(s: ShipEntity): Obstacle {
  let h = hulls.get(s);
  if (!h) {
    const g = s.model.hull.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    _box.copy(g.boundingBox!);
    const cx = (_box.min.x + _box.max.x) / 2;
    const cy = (_box.min.y + _box.max.y) / 2;
    const r = Math.max(_box.max.x - _box.min.x, _box.max.y - _box.min.y) / 2;
    let z0 = _box.min.z + r;
    let z1 = _box.max.z - r;
    if (z0 > z1) z0 = z1 = (_box.min.z + _box.max.z) / 2;
    h = {
      la: new Vector3(cx, cy, z0),
      lb: new Vector3(cx, cy, z1),
      radius: r,
      world: { a: new Vector3(), b: new Vector3(), radius: r },
    };
    hulls.set(s, h);
  }
  const q = s.flight.orientation;
  h.world.a.copy(h.la).applyQuaternion(q).add(s.flight.position);
  h.world.b.copy(h.lb).applyQuaternion(q).add(s.flight.position);
  return h.world;
}

const _r = new Vector3();
const _u = new Vector3();
const _m = new Vector3();
const _p = new Vector3();
const _c = new Vector3();
const _n = new Vector3();
const _vh = new Vector3();
const _e = new Vector3();
const _s = new Vector3();
const _ab = new Vector3();
const ZERO = new Vector3();
const SAMPLES = [0, 0.4, 0.9, 1.5, 2.2, 3.0, 4.0, 5.0, 6.0, 7.0];

/** Closest point on segment ab to p. */
export function closestOnSegment(a: Vector3, b: Vector3, p: Vector3, out: Vector3): Vector3 {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-9 ? Math.min(1, Math.max(0, _s.subVectors(p, a).dot(_ab) / l2)) : 0;
  return out.copy(a).addScaledVector(_ab, t);
}

/**
 * Escape steering for `me`. Writes a unit escape direction to `out` and
 * returns urgency 0..1 (0 = nothing to avoid).
 */
export function avoidance(me: ShipEntity, ships: readonly ShipEntity[], obstacles: readonly Obstacle[], out: Vector3): number {
  out.set(0, 0, 0);
  let urgency = 0;
  const f = me.flight;
  const speed = f.speed;
  if (speed > 1) _vh.copy(f.velocity).divideScalar(speed);
  else f.forward(_vh);

  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (o === me || !o.alive) continue;
    let u: number;
    if (isCapital(o)) {
      const cap = capitalCapsule(o);
      u = capsuleThreat(me, cap.a, cap.b, cap.radius, o.flight.velocity, out);
    } else {
      u = sphereThreat(me, o, out);
    }
    if (u > urgency) urgency = u;
  }
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    const u = capsuleThreat(me, ob.a, ob.b, ob.radius, ZERO, out);
    if (u > urgency) urgency = u;
  }
  if (urgency > 0) {
    const l = out.length();
    if (l > 1e-6) out.divideScalar(l);
    else f.up(out);
  }
  return urgency;
}

function sphereThreat(me: ShipEntity, o: ShipEntity, acc: Vector3): number {
  const H = 2.5;
  _r.subVectors(o.flight.position, me.flight.position);
  _u.subVectors(me.flight.velocity, o.flight.velocity);
  const closing = _u.length();
  const R = me.radius + o.radius + 14 + closing * 0.04;
  const d = _r.length();
  if (d > R + closing * H) return 0;
  if (d < R) {
    // Already inside the bubble: straight out.
    const u = 1;
    if (d > 1e-3) acc.addScaledVector(_r, -u / d);
    return u;
  }
  const rv = _r.dot(_u);
  if (rv <= 0) return 0; // separating
  const t = Math.min(H, rv / (closing * closing));
  _m.copy(_r).addScaledVector(_u, -t); // (o − me) at closest approach
  const ml = _m.length();
  if (ml >= R) return 0;
  const u = (1 - t / H) * Math.min(1, (R - ml) / R + 0.35);
  if (ml > 1e-3) acc.addScaledVector(_m, -u / ml);
  else acc.addScaledVector(me.flight.up(_n), u); // dead-on: pull up and over
  return u;
}

function capsuleThreat(me: ShipEntity, a: Vector3, b: Vector3, radius: number, vel: Vector3, acc: Vector3): number {
  const f = me.flight;
  _u.subVectors(f.velocity, vel);
  const speed = _u.length();
  const Rm = radius + me.radius + 60 + speed * 0.25;
  // Look ahead far enough to turn away: turn radius ~ v² / a_lat, plus margin.
  const H = Math.min(7, Math.max(2, ((speed * speed) / 120 + 350) / Math.max(speed, 1)));
  for (let i = 0; i < SAMPLES.length; i++) {
    const t = SAMPLES[i];
    if (t > H) break;
    _p.copy(f.position).addScaledVector(_u, t);
    closestOnSegment(a, b, _p, _c);
    _n.subVectors(_p, _c);
    const d = _n.length();
    if (d >= Rm) continue;
    const u = t === 0 ? 1 : Math.min(1, (1 - t / H) * 1.3);
    if (d > 1e-3) _n.divideScalar(d);
    else f.up(_n);
    // Prefer skimming past (tangent) over turning back (normal).
    _e.copy(_n).addScaledVector(_vh, -_n.dot(_vh));
    if (_e.lengthSq() < 0.04) _e.copy(f.up(_m)).addScaledVector(_vh, -_m.dot(_vh));
    _e.normalize().addScaledVector(_n, 0.4).normalize();
    acc.addScaledVector(_e, u);
    return u;
  }
  return 0;
}
