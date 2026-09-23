import { Matrix4, Vector3, type Mesh, type Object3D } from 'three';

/**
 * Coarse voxel occupancy of a capital hull (rest pose, ship-local metres),
 * so bolts, beams and torpedoes hit the plating where it really is instead of
 * a bounding sphere: a 3 km Cathedral's batteries sit a kilometre outside any
 * sphere that fits its nave. Built once per blueprint by rasterising every
 * hull triangle into ~72 cells along the longest axis; queried with a 3D DDA
 * (Amanatides–Woo) walk, a few dozen cell steps per segment.
 */
export interface HullGrid {
  minX: number;
  minY: number;
  minZ: number;
  cell: number;
  nx: number;
  ny: number;
  nz: number;
  occ: Uint8Array;
  /** Hull bounding box (ship-local). */
  box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
}

const CELLS = 72;
const cache = new Map<string, HullGrid>();
const _m = new Matrix4();
const _inv = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _p = new Vector3();

/** Grid for a built ship (cached by blueprint id). */
export function hullGridFor(key: string, root: Object3D, meshes: readonly Mesh[]): HullGrid {
  let g = cache.get(key);
  if (!g) {
    g = buildHullGrid(root, meshes);
    cache.set(key, g);
  }
  return g;
}

export function buildHullGrid(root: Object3D, meshes: readonly Mesh[]): HullGrid {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  // Pass 1: bounds.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const tris: Float32Array[] = [];
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(_m);
      arr[i * 3] = _p.x;
      arr[i * 3 + 1] = _p.y;
      arr[i * 3 + 2] = _p.z;
      if (_p.x < minX) minX = _p.x;
      if (_p.y < minY) minY = _p.y;
      if (_p.z < minZ) minZ = _p.z;
      if (_p.x > maxX) maxX = _p.x;
      if (_p.y > maxY) maxY = _p.y;
      if (_p.z > maxZ) maxZ = _p.z;
    }
    tris.push(arr); // non-indexed (ShipBuilder emits non-indexed geometry)
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);
  const cell = ext / CELLS;
  const g: HullGrid = {
    minX: minX - cell,
    minY: minY - cell,
    minZ: minZ - cell,
    cell,
    nx: Math.ceil((maxX - minX) / cell) + 3,
    ny: Math.ceil((maxY - minY) / cell) + 3,
    nz: Math.ceil((maxZ - minZ) / cell) + 3,
    occ: new Uint8Array(0),
    box: { minX, minY, minZ, maxX, maxY, maxZ },
  };
  g.occ = new Uint8Array(g.nx * g.ny * g.nz);
  // Pass 2: rasterise triangles by barycentric sampling at half-cell spacing.
  const step = cell * 0.5;
  for (const arr of tris) {
    for (let t = 0; t + 8 < arr.length; t += 9) {
      _a.set(arr[t], arr[t + 1], arr[t + 2]);
      _b.set(arr[t + 3], arr[t + 4], arr[t + 5]);
      _c.set(arr[t + 6], arr[t + 7], arr[t + 8]);
      const n = Math.min(64, Math.max(1, Math.ceil(Math.max(_a.distanceTo(_b), _a.distanceTo(_c), _b.distanceTo(_c)) / step)));
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          const x = _a.x + (_b.x - _a.x) * u + (_c.x - _a.x) * v;
          const y = _a.y + (_b.y - _a.y) * u + (_c.y - _a.y) * v;
          const z = _a.z + (_b.z - _a.z) * u + (_c.z - _a.z) * v;
          mark(g, x, y, z);
        }
      }
    }
  }
  return g;
}

function mark(g: HullGrid, x: number, y: number, z: number): void {
  const i = Math.floor((x - g.minX) / g.cell);
  const j = Math.floor((y - g.minY) / g.cell);
  const k = Math.floor((z - g.minZ) / g.cell);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return;
  g.occ[i + g.nx * (j + g.ny * k)] = 1;
}

export function occupied(g: HullGrid, i: number, j: number, k: number): boolean {
  if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return false;
  return g.occ[i + g.nx * (j + g.ny * k)] === 1;
}

export interface GridHit {
  /** Segment parameter 0..1 of the hit. */
  t: number;
  /** Local-space outward face normal (axis of the face crossed). */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * First occupied cell along the local-space segment o + t·d, t ∈ [0, 1].
 * Returns false on a miss.
 */
export function raycastGrid(g: HullGrid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, out: GridHit): boolean {
  // Clip to the grid box (slab test).
  const bx0 = g.minX;
  const by0 = g.minY;
  const bz0 = g.minZ;
  const bx1 = g.minX + g.nx * g.cell;
  const by1 = g.minY + g.ny * g.cell;
  const bz1 = g.minZ + g.nz * g.cell;
  let t0 = 0;
  let t1 = 1;
  let axis = -1;
  const slab = (o: number, d: number, lo: number, hi: number, ax: number): boolean => {
    if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > t0) {
      t0 = a;
      axis = ax;
    }
    if (b < t1) t1 = b;
    return t0 <= t1;
  };
  if (!slab(ox, dx, bx0, bx1, 0) || !slab(oy, dy, by0, by1, 1) || !slab(oz, dz, bz0, bz1, 2)) return false;

  const c = g.cell;
  // Entry point (nudged inside).
  const te = t0 + 1e-7;
  const x = ox + dx * te;
  const y = oy + dy * te;
  const z = oz + dz * te;
  let i = Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.minX) / c)));
  let j = Math.min(g.ny - 1, Math.max(0, Math.floor((y - g.minY) / c)));
  let k = Math.min(g.nz - 1, Math.max(0, Math.floor((z - g.minZ) / c)));
  const si = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sj = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const sk = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = si ? c / Math.abs(dx) : Infinity;
  const tdy = sj ? c / Math.abs(dy) : Infinity;
  const tdz = sk ? c / Math.abs(dz) : Infinity;
  let tmx = si ? (g.minX + (i + (si > 0 ? 1 : 0)) * c - ox) / dx : Infinity;
  let tmy = sj ? (g.minY + (j + (sj > 0 ? 1 : 0)) * c - oy) / dy : Infinity;
  let tmz = sk ? (g.minZ + (k + (sk > 0 ? 1 : 0)) * c - oz) / dz : Infinity;
  let t = t0;
  for (let n = 0; n < 512; n++) {
    if (g.occ[i + g.nx * (j + g.ny * k)] === 1) {
      out.t = t;
      out.nx = axis === 0 ? -si : 0;
      out.ny = axis === 1 ? -sj : 0;
      out.nz = axis === 2 ? -sk : 0;
      if (axis < 0) {
        // Started inside: face back along the ray.
        const l = Math.hypot(dx, dy, dz) || 1;
        out.nx = -dx / l;
        out.ny = -dy / l;
        out.nz = -dz / l;
      }
      return true;
    }
    if (tmx < tmy && tmx < tmz) {
      t = tmx;
      tmx += tdx;
      i += si;
      axis = 0;
      if (i < 0 || i >= g.nx) return false;
    } else if (tmy < tmz) {
      t = tmy;
      tmy += tdy;
      j += sj;
      axis = 1;
      if (j < 0 || j >= g.ny) return false;
    } else {
      t = tmz;
      tmz += tdz;
      k += sk;
      axis = 2;
      if (k < 0 || k >= g.nz) return false;
    }
    if (t > t1) return false;
  }
  return false;
}

/** Top surface of the hull at local (x, z): drop a ray from above. Falls back to the box top. */
export function surfaceTop(g: HullGrid, x: number, z: number, out: Vector3): Vector3 {
  const top = g.box.maxY + g.cell * 2;
  const h: GridHit = { t: 0, nx: 0, ny: 0, nz: 0 };
  const len = top - (g.box.minY - g.cell);
  if (raycastGrid(g, x, top, z, 0, -len, 0, h)) return out.set(x, top - len * h.t, z);
  return out.set(x, g.box.maxY, z);
}
