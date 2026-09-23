import { Box3, Vector3 } from 'three';
import type { ShipEntity } from '../Fleet';
import type { Proxy } from '../Collision';
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

/**
 * Capital ships with collision proxies (published each frame by the flight
 * scene's HullCollisions): avoidance steers around these capsules instead
 * of the single fitted hull capsule — the same shapes the ships bounce off.
 */
export const hostObstacles = new WeakMap<ShipEntity, Obstacle[]>();

const _ax = new Vector3();
const _ay = new Vector3();

/**
 * Collision proxies (world-placed) → avoidance capsules: a sphere or
 * capsule as is, a box or cylinder as a capsule along its long axis
 * (radius covering the cross-section), a ring as a chain of capsules round
 * its circumference. `reuse` (the previous result for the same proxies) is
 * updated in place.
 */
export function proxyObstacles(proxies: readonly Proxy[], reuse?: Obstacle[]): Obstacle[] {
  const out = reuse ?? [];
  let n = 0;
  const next = (): Obstacle => (out[n] ??= { a: new Vector3(), b: new Vector3(), radius: 0 }, out[n++]);
  for (const px of proxies) {
    const w = px.world;
    switch (w.kind) {
      case 'sphere': {
        const o = next();
        o.a.copy(w.c);
        o.b.copy(w.c);
        o.radius = w.r;
        break;
      }
      case 'capsule': {
        const o = next();
        o.a.copy(w.a);
        o.b.copy(w.b);
        o.radius = w.r;
        break;
      }
      case 'box': {
        const h = w.half;
        const o = next();
        // Long axis and the cross-section it leaves.
        const ax = h.x >= h.y && h.x >= h.z ? 0 : h.y >= h.z ? 1 : 2;
        const long = ax === 0 ? h.x : ax === 1 ? h.y : h.z;
        const r = ax === 0 ? Math.hypot(h.y, h.z) : ax === 1 ? Math.hypot(h.x, h.z) : Math.hypot(h.x, h.y);
        _ax.set(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0).applyQuaternion(w.q);
        const k = Math.max(0, long - r * 0.5);
        o.a.copy(w.c).addScaledVector(_ax, -k);
        o.b.copy(w.c).addScaledVector(_ax, k);
        o.radius = r;
        break;
      }
      case 'cyl': {
        const o = next();
        _ax.set(0, 0, 1).applyQuaternion(w.q);
        const k = Math.max(0, w.halfLen - w.r * 0.5);
        o.a.copy(w.c).addScaledVector(_ax, -k);
        o.b.copy(w.c).addScaledVector(_ax, k);
        o.radius = w.halfLen > w.r ? w.r : Math.hypot(w.r, w.halfLen * 0.5);
        break;
      }
      case 'ring': {
        const segs = Math.max(8, Math.min(24, Math.round((w.R * 2 * Math.PI) / Math.max(w.r * 6, 60))));
        for (let i = 0; i < segs; i++) {
          const o = next();
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = ((i + 1) / segs) * Math.PI * 2;
          o.a.copy(w.c).add(_ay.set(Math.cos(a0) * w.R, Math.sin(a0) * w.R, 0).applyQuaternion(w.q));
          o.b.copy(w.c).add(_ay.set(Math.cos(a1) * w.R, Math.sin(a1) * w.R, 0).applyQuaternion(w.q));
          o.radius = w.r;
        }
        break;
      }
    }
  }
  out.length = n;
  return out;
}
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
      const list = hostObstacles.get(o);
      if (list) {
        u = 0;
        for (let k = 0; k < list.length; k++) {
          const ob = list[k];
          if (!nearObstacle(me, ob, speed)) continue;
          u = Math.max(u, capsuleThreat(me, ob.a, ob.b, ob.radius, o.flight.velocity, out));
        }
      } else {
        const cap = capitalCapsule(o);
        u = capsuleThreat(me, cap.a, cap.b, cap.radius, o.flight.velocity, out);
      }
    } else {
      u = sphereThreat(me, o, out);
    }
    if (u > urgency) urgency = u;
  }
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    if (!nearObstacle(me, ob, speed)) continue;
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

/** Cheap cull: can `me` reach this capsule within the look-ahead (≤ 7 s, plus the avoidance margin)? */
function nearObstacle(me: ShipEntity, ob: Obstacle, speed: number): boolean {
  const half = ob.a.distanceTo(ob.b) / 2;
  const reach = half + ob.radius + me.radius + 60 + speed * 7.25;
  const mx = (ob.a.x + ob.b.x) / 2 - me.flight.position.x;
  const my = (ob.a.y + ob.b.y) / 2 - me.flight.position.y;
  const mz = (ob.a.z + ob.b.z) / 2 - me.flight.position.z;
  return mx * mx + my * my + mz * mz < reach * reach;
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
