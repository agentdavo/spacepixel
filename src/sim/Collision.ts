import { Quaternion, Vector3 } from 'three';

/**
 * Cheap hull collisions: a bounding sphere per fighter against a handful of
 * proxy shapes per station / capital ship (spheres, capsules, Z-cylinders,
 * boxes, rings), generated from the blueprint parts (CollisionProxies.ts).
 *
 * Pure math + one small world. Proxies live in their host's frame (metres);
 * each frame the world moves them with the host (and with a spinning joint,
 * for parts on one), culls hosts by bounding sphere, then tests only nearby
 * ships: O(ships × nearby proxies). Fast movers are swept in sub-steps no
 * longer than their own radius, so a Kestrel at 3 km/s cruise can't tunnel
 * through a bulkhead between frames.
 *
 * Response: push out along the contact normal, bounce the closing speed
 * (restitution), scrape the tangential speed (friction). Damage and effects
 * are the caller's: the world reports contacts.
 */

export type ProxyShape =
  | { kind: 'sphere'; c: Vector3; r: number }
  | { kind: 'capsule'; a: Vector3; b: Vector3; r: number }
  /** Oriented box: centre, orientation, half extents. */
  | { kind: 'box'; c: Vector3; q: Quaternion; half: Vector3 }
  /** Finite cylinder along its local Z. */
  | { kind: 'cyl'; c: Vector3; q: Quaternion; r: number; halfLen: number }
  /** Ring (torus) about its local Z: major radius R, tube radius r. */
  | { kind: 'ring'; c: Vector3; q: Quaternion; R: number; r: number };

export interface Proxy {
  /** Shape in the host (or joint) frame. */
  local: ProxyShape;
  /** Same shape, world space (updated by `placeProxy`). */
  world: ProxyShape;
  /** Optional spin joint: rotation about `pivot` (host frame) by the joint's current quaternion. */
  joint?: { pivot: Vector3; q: Quaternion };
  /** Bounding sphere radius of the shape (for per-proxy culling). */
  bound: number;
  /** World-space bounding sphere centre. */
  centre: Vector3;
}

export interface Contact {
  /** Contact point on the hull surface (world). */
  point: Vector3;
  /** Unit normal out of the hull. */
  normal: Vector3;
  /** Penetration depth of the ship sphere (m). */
  depth: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _iq = new Quaternion();

// ── shapes ─────────────────────────────────────────────────────────────

export function cloneShape(s: ProxyShape): ProxyShape {
  switch (s.kind) {
    case 'sphere':
      return { kind: 'sphere', c: s.c.clone(), r: s.r };
    case 'capsule':
      return { kind: 'capsule', a: s.a.clone(), b: s.b.clone(), r: s.r };
    case 'box':
      return { kind: 'box', c: s.c.clone(), q: s.q.clone(), half: s.half.clone() };
    case 'cyl':
      return { kind: 'cyl', c: s.c.clone(), q: s.q.clone(), r: s.r, halfLen: s.halfLen };
    case 'ring':
      return { kind: 'ring', c: s.c.clone(), q: s.q.clone(), R: s.R, r: s.r };
  }
}

/** Radius of a sphere (about the shape's centre) that contains it. */
export function shapeBound(s: ProxyShape): number {
  switch (s.kind) {
    case 'sphere':
      return s.r;
    case 'capsule':
      return s.a.distanceTo(s.b) / 2 + s.r;
    case 'box':
      return s.half.length();
    case 'cyl':
      return Math.hypot(s.r, s.halfLen);
    case 'ring':
      return s.R + s.r;
  }
}

export function shapeCentre(s: ProxyShape, out: Vector3): Vector3 {
  return s.kind === 'capsule' ? out.addVectors(s.a, s.b).multiplyScalar(0.5) : out.copy(s.c);
}

export function makeProxy(local: ProxyShape, joint?: Proxy['joint']): Proxy {
  return { local, world: cloneShape(local), joint, bound: shapeBound(local), centre: new Vector3() };
}

/** Point p: host frame → world (optionally through a joint first). */
function xform(p: Vector3, out: Vector3, pos: Vector3, q: Quaternion, joint?: Proxy['joint']): Vector3 {
  out.copy(p);
  if (joint) out.sub(joint.pivot).applyQuaternion(joint.q).add(joint.pivot);
  return out.applyQuaternion(q).add(pos);
}

/** Move a proxy's world shape to the host pose (position + orientation). */
export function placeProxy(px: Proxy, pos: Vector3, q: Quaternion): void {
  const l = px.local;
  const w = px.world;
  const j = px.joint;
  switch (l.kind) {
    case 'sphere':
      xform(l.c, (w as typeof l).c, pos, q, j);
      break;
    case 'capsule':
      xform(l.a, (w as typeof l).a, pos, q, j);
      xform(l.b, (w as typeof l).b, pos, q, j);
      break;
    case 'box':
    case 'cyl':
    case 'ring': {
      const ww = w as typeof l;
      xform(l.c, ww.c, pos, q, j);
      if (j) ww.q.copy(q).multiply(j.q).multiply(l.q);
      else ww.q.copy(q).multiply(l.q);
      break;
    }
  }
  shapeCentre(w, px.centre);
}

/** Closest point on segment ab to p. */
export function closestOnSegment(a: Vector3, b: Vector3, p: Vector3, out: Vector3): Vector3 {
  _d.subVectors(b, a);
  const l2 = _d.lengthSq();
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, _c.subVectors(p, a).dot(_d) / l2)) : 0;
  return out.copy(a).addScaledVector(_d, t);
}

/**
 * Signed distance from `p` to the shape's surface (negative inside), with
 * the outward normal and the closest surface point. Exact for sphere,
 * capsule, box, cylinder and ring.
 */
export function signedDistance(s: ProxyShape, p: Vector3, normal: Vector3, point: Vector3): number {
  switch (s.kind) {
    case 'sphere': {
      normal.subVectors(p, s.c);
      const d = normal.length();
      if (d > 1e-9) normal.divideScalar(d);
      else normal.set(0, 1, 0);
      point.copy(s.c).addScaledVector(normal, s.r);
      return d - s.r;
    }
    case 'capsule': {
      closestOnSegment(s.a, s.b, p, _a);
      normal.subVectors(p, _a);
      const d = normal.length();
      if (d > 1e-9) normal.divideScalar(d);
      else normal.set(0, 1, 0);
      point.copy(_a).addScaledVector(normal, s.r);
      return d - s.r;
    }
    case 'box': {
      _iq.copy(s.q).invert();
      _p.subVectors(p, s.c).applyQuaternion(_iq); // box-local
      const h = s.half;
      const qx = Math.abs(_p.x) - h.x;
      const qy = Math.abs(_p.y) - h.y;
      const qz = Math.abs(_p.z) - h.z;
      let d: number;
      if (qx > 0 || qy > 0 || qz > 0) {
        // Outside: clamp to the box.
        _a.set(Math.max(-h.x, Math.min(h.x, _p.x)), Math.max(-h.y, Math.min(h.y, _p.y)), Math.max(-h.z, Math.min(h.z, _p.z)));
        _b.subVectors(_p, _a);
        d = _b.length();
        _b.divideScalar(d);
      } else {
        // Inside: out through the nearest face.
        if (qx >= qy && qx >= qz) {
          d = qx;
          _b.set(Math.sign(_p.x) || 1, 0, 0);
          _a.set(_b.x * h.x, _p.y, _p.z);
        } else if (qy >= qz) {
          d = qy;
          _b.set(0, Math.sign(_p.y) || 1, 0);
          _a.set(_p.x, _b.y * h.y, _p.z);
        } else {
          d = qz;
          _b.set(0, 0, Math.sign(_p.z) || 1);
          _a.set(_p.x, _p.y, _b.z * h.z);
        }
      }
      normal.copy(_b).applyQuaternion(s.q);
      point.copy(_a).applyQuaternion(s.q).add(s.c);
      return d;
    }
    case 'cyl': {
      _iq.copy(s.q).invert();
      _p.subVectors(p, s.c).applyQuaternion(_iq);
      const rho = Math.hypot(_p.x, _p.y);
      const dr = rho - s.r;
      const dz = Math.abs(_p.z) - s.halfLen;
      const rx = rho > 1e-9 ? _p.x / rho : 1;
      const ry = rho > 1e-9 ? _p.y / rho : 0;
      const sz = Math.sign(_p.z) || 1;
      let d: number;
      if (dr > 0 && dz > 0) {
        // Past the rim edge.
        _a.set(rx * s.r, ry * s.r, sz * s.halfLen);
        _b.subVectors(_p, _a);
        d = _b.length();
        _b.divideScalar(d);
      } else if (dr > dz) {
        // Side (outside if dr > 0, else the nearer-to-side interior case).
        d = dr;
        _b.set(rx, ry, 0);
        _a.set(rx * s.r, ry * s.r, Math.max(-s.halfLen, Math.min(s.halfLen, _p.z)));
      } else {
        d = dz;
        _b.set(0, 0, sz);
        const k = rho > s.r ? s.r / rho : 1;
        _a.set(_p.x * k, _p.y * k, sz * s.halfLen);
      }
      normal.copy(_b).applyQuaternion(s.q);
      point.copy(_a).applyQuaternion(s.q).add(s.c);
      return d;
    }
    case 'ring': {
      _iq.copy(s.q).invert();
      _p.subVectors(p, s.c).applyQuaternion(_iq);
      const rho = Math.hypot(_p.x, _p.y);
      // Nearest point on the ring's centre circle.
      if (rho > 1e-9) _a.set((_p.x / rho) * s.R, (_p.y / rho) * s.R, 0);
      else _a.set(s.R, 0, 0);
      _b.subVectors(_p, _a);
      const d = _b.length();
      if (d > 1e-9) _b.divideScalar(d);
      else _b.set(0, 0, 1);
      normal.copy(_b).applyQuaternion(s.q);
      point.copy(_b).multiplyScalar(s.r).add(_a).applyQuaternion(s.q).add(s.c);
      return d - s.r;
    }
  }
}

const _n = new Vector3();
const _pt = new Vector3();

/** Deepest contact of a sphere (centre p, radius r) against a set of proxies; null if clear. */
export function sphereContact(p: Vector3, r: number, proxies: readonly Proxy[], out: Contact): Contact | null {
  let best = 0;
  for (let i = 0; i < proxies.length; i++) {
    const px = proxies[i];
    const reach = px.bound + r;
    if (px.centre.distanceToSquared(p) > reach * reach) continue;
    const d = signedDistance(px.world, p, _n, _pt);
    const depth = r - d;
    if (depth > best) {
      best = depth;
      out.normal.copy(_n);
      out.point.copy(_pt);
      out.depth = depth;
    }
  }
  return best > 0 ? out : null;
}

export interface Bounce {
  /** Closing speed along the normal at impact (m/s, ≥ 0). */
  impact: number;
  /** Tangential (scrape) speed after the bounce. */
  slide: number;
}

/**
 * Resolve one contact on a body: push `pos` out by the depth, bounce the
 * relative normal velocity with restitution `e`, and bleed the tangential
 * velocity by `friction` (a fraction per impact, scaled by how hard it hit).
 * `hostVel` is the hull's velocity at the contact. Returns the impact speed.
 */
export function resolveContact(pos: Vector3, vel: Vector3, hostVel: Vector3, c: Contact, e = 0.35, friction = 0.25, out: Bounce = { impact: 0, slide: 0 }): Bounce {
  pos.addScaledVector(c.normal, c.depth + 0.05);
  _a.subVectors(vel, hostVel); // relative velocity
  const vn = _a.dot(c.normal);
  out.impact = 0;
  if (vn < 0) {
    out.impact = -vn;
    _b.copy(c.normal).multiplyScalar(vn); // normal part
    _c.subVectors(_a, _b); // tangential part
    const vt = _c.length();
    // Coulomb-ish: friction removes up to friction × impact from the slide.
    const drop = vt > 1e-6 ? Math.min(vt, friction * -vn + vt * 0.02) / vt : 0;
    _c.multiplyScalar(1 - drop);
    _a.copy(_c).addScaledVector(c.normal, -vn * e);
    vel.copy(_a).add(hostVel);
  }
  out.slide = _c.subVectors(vel, hostVel).addScaledVector(c.normal, -_c.dot(c.normal)).length();
  return out;
}

/** Hull damage for an impact: nothing for a nudge, then linear in closing speed. */
export function impactDamage(impact: number, threshold = 8, perMs = 0.5): number {
  return impact > threshold ? (impact - threshold) * perMs : 0;
}

// ── world ──────────────────────────────────────────────────────────────

export interface CollisionHost {
  /** Host pose (position is universe space, float64). */
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  proxies: Proxy[];
  /** Host-frame bounding sphere centre and radius (all proxies). */
  localCentre: Vector3;
  radius: number;
  /** World bounding centre (updated by `placeHost`). */
  centre: Vector3;
  /** Opaque owner (station view, ship entity) for the caller. */
  owner: unknown;
}

export function makeHost(owner: unknown, proxies: Proxy[], position: Vector3, quaternion: Quaternion, velocity: Vector3): CollisionHost {
  // Bounding sphere about the proxies' centroid.
  const centre = new Vector3();
  for (const px of proxies) centre.add(shapeCentre(px.local, _a));
  if (proxies.length) centre.divideScalar(proxies.length);
  let r = 0;
  for (const px of proxies) {
    shapeCentre(px.local, _a);
    // A proxy on a spinning joint sweeps a circle about its pivot.
    const far = px.joint ? px.joint.pivot.distanceTo(centre) + _a.distanceTo(px.joint.pivot) : _a.distanceTo(centre);
    r = Math.max(r, far + px.bound);
  }
  const h: CollisionHost = { position, quaternion, velocity, proxies, localCentre: centre, radius: r, centre: new Vector3(), owner };
  placeHost(h);
  return h;
}

/** Move every proxy of a host to its current pose. */
export function placeHost(h: CollisionHost): void {
  h.centre.copy(h.localCentre).applyQuaternion(h.quaternion).add(h.position);
  for (const px of h.proxies) placeProxy(px, h.position, h.quaternion);
}

/** A body the world pushes around (fighter). */
export interface Body {
  position: Vector3;
  velocity: Vector3;
  radius: number;
}

export interface HitEvent {
  body: Body;
  host: CollisionHost;
  point: Vector3;
  normal: Vector3;
  impact: number;
  slide: number;
}

const _prev = new Vector3();
const _probe = new Vector3();
const _contact: Contact = { point: new Vector3(), normal: new Vector3(), depth: 0 };
const _bounce: Bounce = { impact: 0, slide: 0 };

/**
 * Collide one body against hosts after it has moved by velocity × dt.
 * Sweeps back from the previous position in steps ≤ its radius, stops at
 * the first touching sample, resolves, and reports it. Returns the event
 * (reused object — copy what you keep) or null.
 */
export function collideBody(b: Body, hosts: readonly CollisionHost[], dt: number, ev: HitEvent): HitEvent | null {
  const travel = b.velocity.length() * dt;
  for (let k = 0; k < hosts.length; k++) {
    const h = hosts[k];
    const reach = h.radius + b.radius + travel;
    if (h.centre.distanceToSquared(b.position) > reach * reach) continue;
    _prev.copy(b.position).addScaledVector(b.velocity, -dt);
    const steps = Math.min(24, Math.max(1, Math.ceil(travel / Math.max(2, b.radius))));
    let hit: Contact | null = null;
    for (let i = 1; i <= steps && !hit; i++) {
      _probe.lerpVectors(_prev, b.position, i / steps);
      hit = sphereContact(_probe, b.radius, h.proxies, _contact);
    }
    if (!hit) continue;
    b.position.copy(_probe);
    resolveContact(b.position, b.velocity, h.velocity, hit, 0.35, 0.25, _bounce);
    ev.body = b;
    ev.host = h;
    ev.point.copy(hit.point);
    ev.normal.copy(hit.normal);
    ev.impact = _bounce.impact;
    ev.slide = _bounce.slide;
    return ev;
  }
  return null;
}
