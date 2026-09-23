import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Part, Station } from '@/assets/Blueprint';
import { partMatrix, repeatMatrix, type ShipModel } from '@/assets/ShipBuilder';
import { makeProxy, type Proxy, type ProxyShape } from './Collision';

/**
 * Collision proxies from a built model's blueprint: one cheap shape per
 * structural part (box → box, loft segment → box or cylinder, lathe
 * segment → Z-cylinder, torus / rib → ring, dome / turret → sphere, wing
 * → box), in metres in the model frame. Parts on a joint ride that joint
 * (a station's spinning ring and its spokes). Surface details are skipped:
 * glass / glow paint (windows, lights, signs), greebles, and anything whose
 * second-largest dimension is under `minThin` metres (stripes, rods, deck
 * markings) — they sit on hulls that already have proxies.
 */
export interface ProxyOptions {
  minThin?: number;
}

const MIRROR = new Matrix4().makeScale(-1, 1, 1);
const _pos = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();

function secondLargest(a: number, b: number, c: number): number {
  const s = [a, b, c].sort((x, y) => x - y);
  return s[1];
}

/** Local shapes (unscaled, in the part's own frame) for one part. */
function partShapes(p: Part): { shape: ProxyShape; dims: [number, number, number] }[] {
  const sh = p.shape;
  const O = () => new Vector3();
  const Q = () => new Quaternion();
  switch (sh.kind) {
    case 'box':
      return [{ shape: { kind: 'box', c: O(), q: Q(), half: new Vector3(sh.w / 2, sh.h / 2, sh.d / 2) }, dims: [sh.w, sh.h, sh.d] }];
    case 'loft': {
      const st: Station[] = [...sh.stations].sort((a, b) => a.z - b.z);
      const out: { shape: ProxyShape; dims: [number, number, number] }[] = [];
      for (let i = 0; i < st.length - 1; i++) {
        const a = st[i];
        const b = st[i + 1];
        const dz = b.z - a.z;
        if (dz < 1e-4) continue;
        const w = Math.max(a.w, a.wb ?? a.w, b.w, b.wb ?? b.w);
        const h = Math.max(a.h, b.h);
        const c = Math.max(a.c ?? 0, b.c ?? 0);
        const ctr = new Vector3(((a.x ?? 0) + (b.x ?? 0)) / 2, ((a.y ?? 0) + (b.y ?? 0)) / 2, (a.z + b.z) / 2);
        if (c > 0.22 * Math.min(w, h) && Math.abs(w - h) < 0.3 * Math.max(w, h)) {
          // Heavily chamfered, roughly square section (octagonal armour): a cylinder hugs it better.
          const inner = Math.min(w, h) / 2;
          const outer = Math.hypot(w / 2, h / 2 - c);
          out.push({ shape: { kind: 'cyl', c: ctr, q: Q(), r: (inner + outer) / 2, halfLen: dz / 2 }, dims: [w, h, dz] });
        } else out.push({ shape: { kind: 'box', c: ctr, q: Q(), half: new Vector3(w / 2, h / 2, dz / 2) }, dims: [w, h, dz] });
      }
      return out;
    }
    case 'lathe': {
      const out: { shape: ProxyShape; dims: [number, number, number] }[] = [];
      const pr = sh.profile;
      for (let i = 0; i < pr.length - 1; i++) {
        const [r0, z0] = pr[i];
        const [r1, z1] = pr[i + 1];
        const len = Math.abs(z1 - z0);
        if (len < 1e-4) continue;
        // Split long cones so a taper doesn't become a fat drum.
        const n = Math.min(4, Math.max(1, Math.ceil(Math.abs(r1 - r0) / (0.35 * Math.max(r0, r1, 1e-3)))));
        for (let k = 0; k < n; k++) {
          const ta = k / n;
          const tb = (k + 1) / n;
          const za = z0 + (z1 - z0) * ta;
          const zb = z0 + (z1 - z0) * tb;
          const r = Math.max(r0 + (r1 - r0) * ta, r0 + (r1 - r0) * tb);
          out.push({ shape: { kind: 'cyl', c: new Vector3(0, 0, (za + zb) / 2), q: Q(), r, halfLen: Math.abs(zb - za) / 2 }, dims: [2 * r, 2 * r, Math.abs(zb - za)] });
        }
      }
      return out;
    }
    case 'cylinder': {
      const r = Math.max(sh.rFront, sh.rBack);
      return [{ shape: { kind: 'cyl', c: O(), q: Q(), r, halfLen: sh.length / 2 }, dims: [2 * r, 2 * r, sh.length] }];
    }
    case 'dome': {
      const k = sh.scale ? Math.max(...sh.scale) : 1;
      const r = sh.radius * k;
      return [{ shape: { kind: 'sphere', c: O(), r }, dims: [2 * r, 2 * r, 2 * r] }];
    }
    case 'torus':
      return [{ shape: { kind: 'ring', c: O(), q: Q(), R: sh.radius, r: sh.tube }, dims: [2 * sh.radius, 2 * sh.radius, 2 * sh.tube] }];
    case 'rib': {
      const r = Math.max(sh.thickness, sh.depth) / 2;
      return [{ shape: { kind: 'ring', c: O(), q: Q(), R: sh.radius, r }, dims: [2 * sh.radius, 2 * sh.radius, 2 * r] }];
    }
    case 'wing': {
      const chord = Math.max(sh.root, sh.sweep + sh.tip);
      return [{ shape: { kind: 'box', c: new Vector3(sh.span / 2, 0, -chord / 2), q: Q(), half: new Vector3(sh.span / 2, sh.thickness / 2, chord / 2) }, dims: [sh.span, sh.thickness, chord] }];
    }
    case 'turret': {
      const r = Math.max(sh.radius, sh.height) * 1.1;
      return [{ shape: { kind: 'sphere', c: new Vector3(0, sh.height / 2, 0), r }, dims: [2 * r, 2 * r, 2 * r] }];
    }
    case 'greeble':
      return [];
  }
}

/** Transform a unit-frame shape by matrix m (rigid + scale) and a uniform model scale. */
function placeShape(shape: ProxyShape, m: Matrix4, scale: number): ProxyShape | null {
  m.decompose(_pos, _q, _s);
  const sx = Math.abs(_s.x);
  const sy = Math.abs(_s.y);
  const sz = Math.abs(_s.z);
  const smax = Math.max(sx, sy, sz);
  const at = (v: Vector3) => v.clone().applyMatrix4(m).multiplyScalar(scale);
  switch (shape.kind) {
    case 'sphere':
      return { kind: 'sphere', c: at(shape.c), r: shape.r * smax * scale };
    case 'capsule':
      return { kind: 'capsule', a: at(shape.a), b: at(shape.b), r: shape.r * smax * scale };
    case 'box':
      return { kind: 'box', c: at(shape.c), q: _q.clone().multiply(shape.q), half: new Vector3(shape.half.x * sx, shape.half.y * sy, shape.half.z * sz).multiplyScalar(scale) };
    case 'cyl':
      return { kind: 'cyl', c: at(shape.c), q: _q.clone().multiply(shape.q), r: shape.r * Math.max(sx, sy) * scale, halfLen: shape.halfLen * sz * scale };
    case 'ring':
      return { kind: 'ring', c: at(shape.c), q: _q.clone().multiply(shape.q), R: shape.R * Math.max(sx, sy) * scale, r: shape.r * smax * scale };
  }
}

export function proxiesFromModel(model: ShipModel, opts: ProxyOptions = {}): Proxy[] {
  const bp = model.blueprint;
  const scale = bp.scale ?? 1;
  const minThin = opts.minThin ?? 8;
  const out: Proxy[] = [];
  for (const part of bp.parts) {
    if (part.paint === 'glass' || part.paint === 'glow') continue;
    const shapes = partShapes(part);
    if (!shapes.length) continue;
    const jointId = part.articulation === undefined ? undefined : typeof part.articulation === 'string' ? part.articulation : part.articulation.id;
    const count = Math.max(1, Math.floor(part.repeat?.count ?? 1));
    const pm = partMatrix(part);
    for (let i = 0; i < count; i++) {
      const m = repeatMatrix(part, i).multiply(pm);
      m.decompose(_pos, _q, _s);
      const kx = Math.abs(_s.x) * scale;
      const ky = Math.abs(_s.y) * scale;
      const kz = Math.abs(_s.z) * scale;
      for (const { shape, dims } of shapes) {
        if (secondLargest(dims[0] * kx, dims[1] * ky, dims[2] * kz) < minThin) continue;
        const copies: [Matrix4, string | undefined][] = [[m, jointId]];
        if (part.mirror) {
          const twin = jointId ? (model.articulations.get(jointId)?.twin ?? jointId) : undefined;
          copies.push([_m.copy(MIRROR).multiply(m).clone(), twin]);
        }
        for (const [mm, jid] of copies) {
          const placed = placeShape(shape, mm, scale);
          if (!placed) continue;
          // Joint nodes sit at their pivot (metres, model frame; top-level joints only).
          const node = jid ? model.articulations.get(jid) : undefined;
          out.push(makeProxy(placed, node ? { pivot: node.node.position, q: node.node.quaternion } : undefined));
        }
      }
    }
  }
  return out;
}
