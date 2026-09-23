import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
