import { Box3, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { ShipEntity } from './Fleet';

/** Large hull contact, independent of renderer/audio and of the fighter solver.
 * Six longitudinal envelopes are built ONCE from the static hull triangles.
 * Runtime uses sphere culling and 15-axis swept box SAT, never mesh pair tests.
 * Envelopes fill concavities; articulated appendages and stations are not solved
 * here. Sweeps use the current orientation (translation CCD, not rotation CCD).
 */
const SLICES = 6;
const RESTITUTION = 0.04;
const SKIN = 0.02;
/** Homogeneous effective density, tonnes/m³ (mostly empty spacecraft). This is
 * an explicit approximation, NOT ShipStats.mass, which is a handling multiplier. */
export const HULL_DENSITY = 0.001;
/** Specific crushing energy scale. Equal hulls at 100 m/s closing lose ~25%
 * hull each before kinetic/shield/armour multipliers. Glances use normal speed. */
export const CRUSH_SPEED = 100;

interface HullShape {
  boxes: { centre: Vector3; half: Vector3 }[];
  mass: number;
  inertia: Vector3;
  radius: number;
}
interface HullBody {
  ship: ShipEntity;
  shape: HullShape;
  axes: Vector3[];
  centres: Vector3[];
}
export interface CapitalContact {
  a: ShipEntity;
  b: ShipEntity;
  point: Vector3;
  /** Out of b, toward a. */
  normal: Vector3;
  closing: number;
  impulse: number;
  energy: number;
  damageA: number;
  damageB: number;
}
export type CapitalDamage = (s: ShipEntity, amount: number, point: Vector3, normal: Vector3, other: ShipEntity) => void;

const shapes = new WeakMap<BufferGeometry, HullShape>();

/** Triangle clipping to slab planes preserves long triangles crossing a slab
 * even when no vertex lies inside it. Called only when a geometry is first seen. */
function buildShape(g: BufferGeometry): HullShape {
  const cached = shapes.get(g);
  if (cached) return cached;
  g.computeBoundingBox();
  const bound = g.boundingBox!;
  const p = g.getAttribute('position');
  const index = g.getIndex();
  const count = index ? index.count : p.count;
  const boxes: HullShape['boxes'] = [];
  const verts = [new Vector3(), new Vector3(), new Vector3()];
  const cut = new Vector3();
  let volume = 0;
  const inertia = new Vector3();
  for (let k = 0; k < SLICES; k++) {
    const z0 = bound.min.z + (bound.max.z - bound.min.z) * k / SLICES;
    const z1 = bound.min.z + (bound.max.z - bound.min.z) * (k + 1) / SLICES;
    const slab = new Box3();
    for (let i = 0; i < count; i += 3) {
      for (let j = 0; j < 3; j++) verts[j].fromBufferAttribute(p, index ? index.getX(i + j) : i + j);
      for (let j = 0; j < 3; j++) {
        const a = verts[j], b = verts[(j + 1) % 3];
        if (a.z >= z0 && a.z <= z1) slab.expandByPoint(a);
        for (const z of [z0, z1]) {
          if ((a.z < z && b.z > z) || (a.z > z && b.z < z)) slab.expandByPoint(cut.lerpVectors(a, b, (z - a.z) / (b.z - a.z)));
        }
      }
    }
    if (slab.isEmpty()) continue;
    const centre = slab.getCenter(new Vector3());
    const half = slab.getSize(new Vector3()).multiplyScalar(0.5).max(new Vector3(0.01, 0.01, 0.01));
    const v = 8 * half.x * half.y * half.z;
    volume += v;
    // Box inertia + parallel axis theorem about the flight model's origin.
    inertia.x += v * ((half.y ** 2 + half.z ** 2) / 3 + centre.y ** 2 + centre.z ** 2);
    inertia.y += v * ((half.x ** 2 + half.z ** 2) / 3 + centre.x ** 2 + centre.z ** 2);
    inertia.z += v * ((half.x ** 2 + half.y ** 2) / 3 + centre.x ** 2 + centre.y ** 2);
    boxes.push({ centre, half });
  }
  const radius = new Vector3(Math.max(Math.abs(bound.min.x), Math.abs(bound.max.x)), Math.max(Math.abs(bound.min.y), Math.abs(bound.max.y)), Math.max(Math.abs(bound.min.z), Math.abs(bound.max.z))).length();
  const shape = { boxes, mass: Math.max(1, volume * HULL_DENSITY), inertia: inertia.multiplyScalar(HULL_DENSITY).max(new Vector3(1, 1, 1)), radius };
  shapes.set(g, shape);
  return shape;
}

function place(b: HullBody): void {
  const f = b.ship.flight;
  b.axes[0].set(1, 0, 0).applyQuaternion(f.orientation);
  b.axes[1].set(0, 1, 0).applyQuaternion(f.orientation);
  b.axes[2].set(0, 0, 1).applyQuaternion(f.orientation);
  for (let i = 0; i < b.centres.length; i++) b.centres[i].copy(b.shape.boxes[i].centre).applyQuaternion(f.orientation).add(f.position);
}

const delta = new Vector3(), travel = new Vector3(), axis = new Vector3();
const testNormal = new Vector3(), bestNormal = new Vector3();
const pointA = new Vector3(), pointB = new Vector3();
const tmp = new Vector3(), tmp2 = new Vector3(), invQ = new Quaternion();

function projected(half: Vector3, axes: Vector3[], n: Vector3): number {
  return half.x * Math.abs(axes[0].dot(n)) + half.y * Math.abs(axes[1].dot(n)) + half.z * Math.abs(axes[2].dot(n));
}

/** SAT interval intersection for moving OBBs, at fixed orientations. Return
 * first time 0..1 and initial penetration. Normal is stable even at zero range. */
function sweep(a: HullBody, ai: number, b: HullBody, bi: number, dt: number): { t: number; depth: number } | null {
  travel.subVectors(a.ship.flight.velocity, b.ship.flight.velocity).multiplyScalar(dt);
  delta.subVectors(a.centres[ai], b.centres[bi]).sub(travel);
  let enter = 0, exit = 1, depth = Infinity;
  let initial = true;
  for (let k = 0; k < 15; k++) {
    if (k < 3) axis.copy(a.axes[k]);
    else if (k < 6) axis.copy(b.axes[k - 3]);
    else axis.crossVectors(a.axes[Math.floor((k - 6) / 3)], b.axes[(k - 6) % 3]);
    const len = axis.length();
    if (len < 1e-8) continue;
    axis.divideScalar(len);
    const r = projected(a.shape.boxes[ai].half, a.axes, axis) + projected(b.shape.boxes[bi].half, b.axes, axis);
    const d = delta.dot(axis), v = travel.dot(axis);
    const overlap = r - Math.abs(d);
    if (overlap < 0) initial = false;
    if (overlap < depth) {
      depth = overlap;
      testNormal.copy(axis).multiplyScalar(d < 0 ? -1 : 1);
    }
    if (Math.abs(v) < 1e-10) {
      if (overlap < 0) return null;
      continue;
    }
    let lo = (-r - d) / v, hi = (r - d) / v;
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo > enter) {
      enter = lo;
      bestNormal.copy(axis).multiplyScalar(d + lo * v < 0 ? -1 : 1);
    }
    exit = Math.min(exit, hi);
    if (enter > exit || exit < 0 || enter > 1) return null;
  }
  if (initial) bestNormal.copy(testNormal);
  return { t: enter, depth: initial ? Math.max(0, depth) : 0 };
}

/** Support face point nearest the opposing centre. Ties use the face centre,
 * avoiding an arbitrary corner torque in a symmetric bow-to-bow collision. */
function facePoint(body: HullBody, i: number, n: Vector3, toward: Vector3, out: Vector3): void {
  out.copy(body.centres[i]);
  tmp.subVectors(toward, out);
  const h = body.shape.boxes[i].half;
  for (let k = 0; k < 3; k++) {
    const d = body.axes[k].dot(n), half = h.getComponent(k);
    const s = Math.abs(d) > 1e-7 ? Math.sign(d) * half : Math.max(-half, Math.min(half, tmp.dot(body.axes[k])));
    out.addScaledVector(body.axes[k], s);
  }
}

function inverseInertia(b: HullBody, v: Vector3, out: Vector3): Vector3 {
  return out.copy(v).applyQuaternion(invQ.copy(b.ship.flight.orientation).invert()).divide(b.shape.inertia).applyQuaternion(b.ship.flight.orientation);
}
function omega(b: HullBody, out: Vector3): Vector3 {
  const r = b.ship.flight.bodyRates;
  // FlightModel stores pitch command rate, whose physical X sign is reversed.
  return out.set(-r.x, r.y, r.z).applyQuaternion(b.ship.flight.orientation);
}
const ra = new Vector3(), rb = new Vector3(), va = new Vector3(), vb = new Vector3();
const torque = new Vector3(), angular = new Vector3(), normal = new Vector3(), contact = new Vector3();

function applyImpulse(b: HullBody, r: Vector3, n: Vector3, j: number): void {
  b.ship.flight.velocity.addScaledVector(n, j / b.shape.mass);
  inverseInertia(b, torque.crossVectors(r, n).multiplyScalar(j), angular);
  angular.applyQuaternion(invQ.copy(b.ship.flight.orientation).invert());
  b.ship.flight.bodyRates.add(tmp.set(-angular.x, angular.y, angular.z));
}

export class CapitalCollisions {
  readonly events: CapitalContact[] = [];
  /** Diagnostics from the last step; geometry construction is not included. */
  pairTests = 0;
  boxTests = 0;
  private bodies = new WeakMap<ShipEntity, HullBody>();

  bodyFor(s: ShipEntity): HullBody {
    let b = this.bodies.get(s);
    if (!b) {
      const shape = buildShape(s.model.hull.geometry);
      b = { ship: s, shape, axes: [new Vector3(), new Vector3(), new Vector3()], centres: shape.boxes.map(() => new Vector3()) };
      this.bodies.set(s, b);
    }
    place(b);
    return b;
  }

  /** Called after flight, exactly once per fixed simulation tick. No cooldown,
   * previous-pose or launch cache participates in the physics: replay restore
   * has the same result. Initially overlapping hulls depenetrate without a
   * velocity kick or impact damage; docking-owned bodies are excluded by skip. */
  step(ships: readonly ShipEntity[], dt: number, damage: CapitalDamage, skip: (s: ShipEntity) => boolean = () => false): void {
    this.events.length = 0;
    this.pairTests = this.boxTests = 0;
    if (dt <= 0) return;
    const active = ships.filter(s => s.alive && s.radius > 60 && !skip(s)).sort((a, b) => a.id - b.id).map(s => this.bodyFor(s));
    // Broad spheres include each body's translation over this tick. Stable ID
    // order makes insertion order irrelevant. Typical fleets have few capitals.
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (!a.ship.alive || !b.ship.alive) continue;
      this.pairTests++;
      const reach = a.shape.radius + b.shape.radius + dt * (a.ship.flight.speed + b.ship.flight.speed);
      if (a.ship.flight.position.distanceToSquared(b.ship.flight.position) > reach * reach) continue;
      this.resolve(a, b, dt, damage);
    }
  }

  private resolve(a: HullBody, b: HullBody, dt: number, damage: CapitalDamage): void {
    let first = 2, depth = 0, ia = -1;
    const manifold: { i: number; j: number; t: number; depth: number; normal: Vector3 }[] = [];
    place(a); place(b);
    for (let i = 0; i < a.centres.length; i++) for (let j = 0; j < b.centres.length; j++) {
      this.boxTests++;
      const hit = sweep(a, i, b, j, dt);
      if (!hit) continue;
      manifold.push({ i, j, ...hit, normal: bestNormal.clone() });
      if (hit.t > first || (hit.t === first && hit.depth <= depth && ia >= 0)) continue;
      first = hit.t; depth = hit.depth; ia = i;
      normal.copy(bestNormal);
    }
    if (ia < 0) return;
    const fa = a.ship.flight, fb = b.ship.flight;
    const remain = (1 - first) * dt;
    fa.position.addScaledVector(fa.velocity, -remain);
    fb.position.addScaledVector(fb.velocity, -remain);
    place(a); place(b);
    // Simultaneous slab contacts share one impulse at the manifold centroid.
    // Picking the first slab alone invents stern torque for a flat broadside.
    contact.set(0, 0, 0);
    let count = 0;
    for (const m of manifold) {
      if (Math.abs(m.t - first) > 1e-8 || m.normal.dot(normal) < 0.99 || m.depth < depth - SKIN) continue;
      facePoint(a, m.i, tmp2.copy(normal).negate(), b.centres[m.j], pointA);
      facePoint(b, m.j, normal, a.centres[m.i], pointB);
      contact.add(pointA).add(pointB); count += 2;
    }
    contact.divideScalar(count);
    ra.subVectors(contact, fa.position); rb.subVectors(contact, fb.position);
    va.crossVectors(omega(a, tmp2), ra).add(fa.velocity);
    vb.crossVectors(omega(b, tmp2), rb).add(fb.velocity);
    const closing = Math.max(0, -va.sub(vb).dot(normal));
    const imA = 1 / a.shape.mass, imB = 1 / b.shape.mass;
    inverseInertia(a, torque.crossVectors(ra, normal), angular);
    let effective = imA + imB + tmp2.crossVectors(angular, ra).dot(normal);
    inverseInertia(b, torque.crossVectors(rb, normal), angular);
    effective += tmp2.crossVectors(angular, rb).dot(normal);
    // Suppress restitution and damage on existing overlap (spawn / berth / save).
    // A split positional correction never becomes kinetic energy.
    const overlap = first === 0 && depth > SKIN;
    const restitution = overlap || closing <= 8 ? 0 : RESTITUTION;
    const impulse = closing * (1 + restitution) / effective;
    applyImpulse(a, ra, normal, impulse);
    applyImpulse(b, rb, normal, -impulse);
    const correction = depth + SKIN;
    fa.position.addScaledVector(normal, correction * imA / (imA + imB));
    fb.position.addScaledVector(normal, -correction * imB / (imA + imB));
    fa.position.addScaledVector(fa.velocity, remain);
    fb.position.addScaledVector(fb.velocity, remain);
    // Dissipated normal kinetic energy, with a free low-speed docking nudge.
    // No hidden cooldown: rested hulls can only charge again after a new >8m/s impact.
    const energy = !overlap && closing > 8 ? 0.5 * (closing * closing - 64) * (1 - restitution * restitution) / effective : 0;
    const damageA = energy / (a.shape.mass * CRUSH_SPEED ** 2) * a.ship.hullMax;
    const damageB = energy / (b.shape.mass * CRUSH_SPEED ** 2) * b.ship.hullMax;
    const e: CapitalContact = { a: a.ship, b: b.ship, point: contact.clone(), normal: normal.clone(), closing, impulse, energy, damageA, damageB };
    this.events.push(e);
    // Damage routing reads the end-of-tick ship pose. Carry the impact's local
    // lever arm along with that pose so a fast sweep still damages its bow/stern.
    if (damageA > 0) damage(a.ship, damageA, pointA.copy(fa.position).add(ra), e.normal, b.ship);
    if (damageB > 0) damage(b.ship, damageB, pointB.copy(fb.position).add(rb), tmp2.copy(e.normal).negate(), a.ship);
  }
}
