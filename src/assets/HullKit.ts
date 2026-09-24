import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  MathUtils,
  Matrix4,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape, Station } from './Blueprint';

/**
 * Hull kit: the primitive vocabulary of the procedural ship pipeline. Every
 * function returns NON-INDEXED geometry with position / normal / uv so parts
 * can be freely merged. Hard-surface parts are flat shaded (faceted cel
 * highlights); round parts use creased normals.
 *
 * Convention: ships face +Z, up is +Y.
 */

const SECTION_POINTS = 8;

function sectionPoints(s: Station): [number, number][] {
  const w = Math.max(s.w, 0);
  const wb = Math.max(s.wb ?? s.w, 0);
  const h = Math.max(s.h, 0);
  const c = Math.min(s.c ?? 0, w / 2, wb / 2, h / 2);
  const x = s.x ?? 0;
  const y = s.y ?? 0;
  // Counter-clockwise viewed from +Z, starting bottom-right.
  return [
    [wb / 2 - c, -h / 2],
    [wb / 2, -h / 2 + c],
    [w / 2, h / 2 - c],
    [w / 2 - c, h / 2],
    [-w / 2 + c, h / 2],
    [-w / 2, h / 2 - c],
    [-wb / 2, -h / 2 + c],
    [-wb / 2 + c, -h / 2],
  ].map(([px, py]) => [px + x, py + y] as [number, number]);
}

class TriBuilder {
  pos: number[] = [];
  uv: number[] = [];

  tri(a: Vector3, b: Vector3, c: Vector3, ua: [number, number], ub: [number, number], uc: [number, number]) {
    // Skip degenerate triangles (collapsed chamfers / pointed tips).
    const ab = new Vector3().subVectors(b, a);
    const ac = new Vector3().subVectors(c, a);
    if (ab.cross(ac).lengthSq() < 1e-12) return;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.uv.push(...ua, ...ub, ...uc);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/** Loft a chain of chamfered sections along +Z. The core hull primitive. */
export function loft(stations: Station[], capStart = true, capEnd = true): BufferGeometry {
  const st = [...stations].sort((a, b) => a.z - b.z);
  const rings = st.map((s) => sectionPoints(s).map(([x, y]) => new Vector3(x, y, s.z)));
  const tb = new TriBuilder();
  const n = SECTION_POINTS;

  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    const v0 = r / (rings.length - 1);
    const v1 = (r + 1) / (rings.length - 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const u0 = i / n;
      const u1 = (i + 1) / n;
      tb.tri(A[i], A[j], B[j], [u0, v0], [u1, v0], [u1, v1]);
      tb.tri(A[i], B[j], B[i], [u0, v0], [u1, v1], [u0, v1]);
    }
  }

  const fan = (ring: Vector3[], reverse: boolean) => {
    const c = ring.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(ring.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (reverse) tb.tri(c, ring[j], ring[i], [0.5, 0.5], [0, 0], [1, 0]);
      else tb.tri(c, ring[i], ring[j], [0.5, 0.5], [0, 0], [1, 0]);
    }
  };
  if (capStart) fan(rings[0], true);
  if (capEnd) fan(rings[rings.length - 1], false);

  return tb.build();
}

/**
 * Trapezoidal wing, built as a loft along the span and rotated so that the
 * span runs along +X and the chord runs back along -Z from the leading edge.
 */
export function wing(
  root: number,
  tip: number,
  span: number,
  sweep: number,
  thickness: number,
  tipThickness = thickness * 0.6,
  bevel = 0.8,
): BufferGeometry {
  const g = loft([
    { z: 0, w: root, h: thickness, x: root / 2, c: (thickness / 2) * bevel },
    { z: span, w: tip, h: tipThickness, x: sweep + tip / 2, c: (tipThickness / 2) * bevel },
  ]);
  g.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
  return g;
}

function creased(g: BufferGeometry, angleDeg = 35): BufferGeometry {
  return toCreasedNormals(g, (angleDeg * Math.PI) / 180);
}

/** Cylinder along Z: front (+Z) radius, back (-Z) radius. */
export function cylinder(rFront: number, rBack: number, length: number, segments = 10, open = false): BufferGeometry {
  const g = new CylinderGeometry(rFront, rBack, length, segments, 1, open);
  g.rotateX(Math.PI / 2); // +Y (top, rFront) → +Z
  return creased(g, 40);
}

export function dome(radius: number, segments = 14, hemisphere = false): BufferGeometry {
  const g = new SphereGeometry(radius, segments, Math.max(6, Math.round(segments * 0.6)), 0, Math.PI * 2, 0, hemisphere ? Math.PI / 2 : Math.PI);
  return creased(g, 60);
}

export function torus(radius: number, tube: number, segments = 32, tubeSegments = 8): BufferGeometry {
  const g = new TorusGeometry(radius, tube, tubeSegments, segments);
  return creased(g, 50);
}

export function box(w: number, h: number, d: number, c = 0): BufferGeometry {
  return loft([
    { z: -d / 2, w, h, c },
    { z: d / 2, w, h, c },
  ]);
}

/** Surface of revolution around +Z. `profile` = [radius, z] points; closed profiles give solid shells. */
export function lathe(profile: [number, number][], segments = 12, phase = 0, crease = 40): BufferGeometry {
  const tb = new TriBuilder();
  const rings = profile.map(([r, z]) => {
    const ring: Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = phase + (i / segments) * Math.PI * 2;
      ring.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    return ring;
  });
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      tb.tri(A[i], A[j], B[j], [i / segments, r], [j / segments, r], [j / segments, r + 1]);
      tb.tri(A[i], B[j], B[i], [i / segments, r], [j / segments, r + 1], [i / segments, r + 1]);
    }
  }
  return creased(tb.build(), crease);
}

/** Chamfered arch in the XY plane, swept CCW from `start` through `arc` degrees. */
export function rib(radius: number, thickness: number, depth: number, arc = 180, start = 0, segments = 12, c = 0): BufferGeometry {
  // Section coords: x → Z (depth), y → radial offset. (ẑ × r̂ = tangent, so loft winding holds.)
  const sec = sectionPoints({ z: 0, w: depth, h: thickness, c });
  const n = sec.length;
  const rings: Vector3[][] = [];
  for (let k = 0; k <= segments; k++) {
    const a = MathUtils.degToRad(start + (arc * k) / segments);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    rings.push(sec.map(([px, py]) => new Vector3(ca * (radius + py), sa * (radius + py), px)));
  }
  const tb = new TriBuilder();
  for (let r = 0; r < segments; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tb.tri(A[i], A[j], B[j], [i / n, r], [j / n, r], [j / n, r + 1]);
      tb.tri(A[i], B[j], B[i], [i / n, r], [j / n, r + 1], [i / n, r + 1]);
    }
  }
  if (arc < 360) {
    const fan = (ring: Vector3[], reverse: boolean) => {
      const ctr = ring.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(ring.length);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (reverse) tb.tri(ctr, ring[j], ring[i], [0.5, 0.5], [0, 0], [1, 0]);
        else tb.tri(ctr, ring[i], ring[j], [0.5, 0.5], [0, 0], [1, 0]);
      }
    };
    fan(rings[0], true);
    fan(rings[segments], false);
  }
  return tb.build();
}

/** A tiny deterministic PRNG (mulberry32) so greebles are stable between builds. */
export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function merge(list: BufferGeometry[]): BufferGeometry | undefined {
  const clean = list.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(out.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
    }
    return out;
  });
  if (!clean.length) return undefined;
  return mergeGeometries(clean, false) ?? undefined;
}

/**
 * A turret split for articulation: the traversing `mount` (base ring +
 * housing, part paint) and the elevating `guns` (a mantlet in part paint,
 * barrels + muzzle rings as trim). `pivot` is the trunnion the guns elevate
 * about; `tips` the barrel muzzles at rest. Turret frame: stands on y = 0,
 * barrels along +Z.
 */
export interface TurretSplit {
  mount: ShapeParts;
  guns: ShapeParts;
  pivot: Vector3;
  tips: Vector3[];
}

export function turretSplit(
  radius: number,
  height: number,
  barrels = 2,
  barrelLength = radius * 2.2,
  barrelRadius = radius * 0.11,
  housing?: [number, number, number],
): TurretSplit {
  const baseH = height * 0.35;
  const base = lathe(
    [
      [0, 0],
      [radius, 0],
      [radius * 0.94, baseH],
      [0, baseH],
    ],
    8,
    Math.PI / 8,
    20,
  );
  base.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2)); // Z-axis lathe → stand on Y.
  const [hw, hh, hd] = housing ?? [radius * 1.5, height - baseH, radius * 1.7];
  const c = Math.min(hw, hh) * 0.28;
  const house = loft([
    { z: -hd / 2, w: hw, h: hh, c },
    { z: hd * 0.2, w: hw, h: hh, c },
    { z: hd / 2, w: hw * 0.82, h: hh * 0.62, y: -hh * 0.12, c: c * 0.7 },
  ]);
  house.translate(0, baseH + hh / 2, -hd * 0.08);
  const trims: BufferGeometry[] = [];
  const tips: Vector3[] = [];
  const spacing = Math.min(hw * 0.8 / Math.max(barrels - 1, 1), barrelRadius * 3.2);
  const by = baseH + hh * 0.42;
  for (let i = 0; i < barrels; i++) {
    const x = (i - (barrels - 1) / 2) * spacing;
    const b = cylinder(barrelRadius * 0.85, barrelRadius, barrelLength, 8);
    b.translate(x, by, hd * 0.35 + barrelLength / 2);
    const muzzle = cylinder(barrelRadius * 1.25, barrelRadius * 1.25, barrelLength * 0.12, 8);
    muzzle.translate(x, by, hd * 0.35 + barrelLength * 0.94);
    trims.push(b, muzzle);
    tips.push(new Vector3(x, by, hd * 0.35 + barrelLength));
  }
  // Mantlet: the gun shield the barrels leave the housing through (it elevates with them).
  const mw = (barrels - 1) * spacing + barrelRadius * 4;
  const mh = Math.min(hh * 0.7, barrelRadius * 3.4);
  const mantlet = box(Math.min(mw, hw * 0.9), mh, hd * 0.24, Math.min(mw, mh) * 0.2);
  mantlet.translate(0, by, hd * 0.34);
  return {
    mount: { main: merge([base, house])! },
    guns: { main: mantlet, trim: merge(trims) },
    pivot: new Vector3(0, by, hd * 0.2),
    tips,
  };
}

/** Composite gun turret on y = 0 facing +Z (one rigid piece). Returns hull + barrels (trim). */
export function turret(
  radius: number,
  height: number,
  barrels = 2,
  barrelLength = radius * 2.2,
  barrelRadius = radius * 0.11,
  housing?: [number, number, number],
): ShapeParts {
  const t = turretSplit(radius, height, barrels, barrelLength, barrelRadius, housing);
  return { main: merge([t.mount.main, t.guns.main])!, trim: t.guns.trim };
}

/** Seeded scatter of boxes over a w × d patch (XZ plane, standing on y = 0). */
export function greeble(
  w: number,
  d: number,
  count: number,
  seed = 1,
  size: [number, number] = [0.1, 0.4],
  height: [number, number] = [0.03, 0.12],
): ShapeParts {
  const r = rng(seed);
  const main: BufferGeometry[] = [];
  const trim: BufferGeometry[] = [];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  for (let i = 0; i < count; i++) {
    let bw = lerp(size[0], size[1], r());
    let bd = lerp(size[0], size[1], r());
    const shape = r();
    if (shape < 0.2) bd *= 3; // long conduit
    else if (shape < 0.3) bw *= 2.5; // wide block
    bw = Math.min(bw, w);
    bd = Math.min(bd, d);
    const bh = lerp(height[0], height[1], r());
    // Snap to a coarse grid so the scatter reads as machinery, not noise.
    const grid = size[0] * 0.5;
    const x = Math.round(lerp(-w / 2 + bw / 2, w / 2 - bw / 2, r()) / grid) * grid;
    const z = Math.round(lerp(-d / 2 + bd / 2, d / 2 - bd / 2, r()) / grid) * grid;
    const g = box(bw, bh, bd, Math.min(bw, bh) * 0.15);
    g.translate(x, bh / 2, z);
    (r() < 0.22 ? trim : main).push(g);
  }
  return { main: merge(main) ?? box(0.001, 0.001, 0.001), trim: merge(trim) };
}

/** A shape can produce a secondary "trim" geometry painted with `Part.trim`. */
export interface ShapeParts {
  main: BufferGeometry;
  trim?: BufferGeometry;
}

export function buildShapeParts(shape: Shape): ShapeParts {
  switch (shape.kind) {
    case 'turret':
      return turret(shape.radius, shape.height, shape.barrels, shape.barrelLength, shape.barrelRadius, shape.housing);
    case 'greeble':
      return greeble(shape.w, shape.d, shape.count, shape.seed, shape.size, shape.height);
    default:
      return { main: buildShape(shape) };
  }
}

export function buildShape(shape: Shape): BufferGeometry {
  switch (shape.kind) {
    case 'loft':
      return loft(shape.stations, shape.capStart ?? true, shape.capEnd ?? true);
    case 'wing':
      return wing(shape.root, shape.tip, shape.span, shape.sweep, shape.thickness, shape.tipThickness, shape.bevel);
    case 'cylinder':
      return cylinder(shape.rFront, shape.rBack, shape.length, shape.segments, shape.open);
    case 'dome': {
      const g = dome(shape.radius, shape.segments, shape.hemisphere);
      if (shape.scale) g.scale(...shape.scale);
      return g;
    }
    case 'box':
      return box(shape.w, shape.h, shape.d, shape.c);
    case 'torus':
      return torus(shape.radius, shape.tube, shape.segments, shape.tubeSegments);
    case 'lathe':
      return lathe(shape.profile, shape.segments, shape.phase);
    case 'rib':
      return rib(shape.radius, shape.thickness, shape.depth, shape.arc, shape.start, shape.segments, shape.c);
    case 'turret':
    case 'greeble': {
      const p = buildShapeParts(shape);
      return p.trim ? merge([p.main, p.trim])! : p.main;
    }
  }
}

/** Reverse triangle winding in-place (needed after mirroring). */
export function flipWinding(g: BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) {
    const attr = g.getAttribute(name);
    const size = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < size; k++) {
        const i1 = (t + 1) * size + k;
        const i2 = (t + 2) * size + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
}
