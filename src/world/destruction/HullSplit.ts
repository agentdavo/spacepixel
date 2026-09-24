import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Vector3, type Mesh } from 'three';
import type { ShipModel } from '@/assets/ShipBuilder';

/**
 * Geometry surgery on a built ship (presentation only): cut a hull into the
 * pieces a kill path leaves (a ragged tear, not a clean slice), and pull a
 * mount's triangles out of the merged hull (gun houses, barrels).
 *
 * ShipBuilder emits non-indexed geometry with position / normal / uv /
 * color / surface (x = ink region, y = emissive, z = gloss, w = shade), one
 * merged mesh for the static hull and one per joint. Every model is built
 * per ship, so a ship's geometry is its own to edit.
 */
const _inv = new Matrix4();
const _nm = new Matrix3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export interface MeshFrame {
  mesh: Mesh;
  /** Mesh-local → ship-root-local. */
  toRoot: Matrix4;
}

/** Every hull mesh with its current transform into the ship root's frame. */
export function meshFrames(model: ShipModel): MeshFrame[] {
  model.root.updateMatrixWorld(true);
  _inv.copy(model.root.matrixWorld).invert();
  return model.meshes.map((mesh) => ({ mesh, toRoot: new Matrix4().multiplyMatrices(_inv, mesh.matrixWorld) }));
}

/** Deterministic ragged offset (m) of the tear line at (x, y): zig-zag plating, not a laser cut. */
export function tearOffset(x: number, y: number, amp: number, seed: number): number {
  const k = 6 / Math.max(amp, 1e-3);
  return amp * (0.55 * Math.sin(x * k * 0.11 + seed) * Math.cos(y * k * 0.13 - seed * 0.7) + 0.45 * Math.sign(Math.sin(x * k * 0.37 + y * k * 0.29 + seed * 1.3)));
}

export interface HullPiece {
  /** Ship-root-local geometry of the piece (lights out: emissive zeroed). */
  geometry: BufferGeometry;
  /** Root-local points along the torn edge (fire, glowing craters), up to 24. */
  edge: Vector3[];
}

/**
 * The triangles of a hull whose (ragged) centroid z falls in [z0, z1), as one
 * root-local geometry; finite bounds are tear lines (`amp`: raggedness, m).
 * `dark` zeroes the emissive and dulls the paint (a dead hull's lights are out).
 */
export function splitHull(model: ShipModel, z0: number, z1: number, amp: number, seed: number, dark = true): HullPiece {
  const out: Record<string, number[]> = { position: [], normal: [], uv: [], color: [], surface: [] };
  const edge: Vector3[] = [];
  const edgeBand = amp * 1.6;
  const tears = [z0, z1].filter(Number.isFinite);
  let edgeSeen = 0;
  for (const { mesh, toRoot } of meshFrames(model)) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) continue;
    _nm.getNormalMatrix(toRoot);
    const nrm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const col = g.getAttribute('color');
    const srf = g.getAttribute('surface');
    for (let t = 0; t + 2 < pos.count; t += 3) {
      _a.fromBufferAttribute(pos, t).applyMatrix4(toRoot);
      _b.fromBufferAttribute(pos, t + 1).applyMatrix4(toRoot);
      _c.fromBufferAttribute(pos, t + 2).applyMatrix4(toRoot);
      const cx = (_a.x + _b.x + _c.x) / 3;
      const cy = (_a.y + _b.y + _c.y) / 3;
      const cz = (_a.z + _b.z + _c.z) / 3;
      const z = cz + tearOffset(cx, cy, amp, seed);
      if (z < z0 || z >= z1) continue;
      for (const tz of tears) {
        if (Math.abs(z - tz) < edgeBand && edgeSeen++ % 5 === 0 && edge.length < 24) edge.push(new Vector3(cx, cy, cz));
      }
      for (const v of [_a, _b, _c]) out.position.push(v.x, v.y, v.z);
      for (let k = 0; k < 3; k++) {
        if (nrm) {
          // (_c is free again: the positions are already pushed)
          const n = _c.fromBufferAttribute(nrm, t + k).applyMatrix3(_nm).normalize();
          out.normal.push(n.x, n.y, n.z);
        }
        if (uv) out.uv.push(uv.getX(t + k), uv.getY(t + k));
        // A dead hull: the paint goes dull (no power, no running lights, soot everywhere).
        const dim = dark ? 0.55 : 1;
        if (col) out.color.push(col.getX(t + k) * dim, col.getY(t + k) * dim, col.getZ(t + k) * dim);
        if (srf) out.surface.push(srf.getX(t + k), dark ? 0 : srf.getY(t + k), srf.getZ(t + k), srf.getW(t + k));
      }
    }
  }
  return { geometry: build(out), edge };
}

function build(out: Record<string, number[]>): BufferGeometry {
  const g = new BufferGeometry();
  const n = out.position.length / 3;
  g.setAttribute('position', new Float32BufferAttribute(out.position, 3));
  if (out.normal.length === n * 3) g.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
  else g.computeVertexNormals();
  g.setAttribute('uv', new Float32BufferAttribute(out.uv.length === n * 2 ? out.uv : new Array(n * 2).fill(0), 2));
  g.setAttribute('color', new Float32BufferAttribute(out.color.length === n * 3 ? out.color : new Array(n * 3).fill(0.4), 3));
  g.setAttribute('surface', new Float32BufferAttribute(out.surface.length === n * 4 ? out.surface : new Array(n * 4).fill(0), 4));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * Split off one side of a fighter (a wing shearing off on a kill): triangles
 * with root-local x beyond `x0` (sign picks the side). Returns the wing piece.
 */
export function splitSide(model: ShipModel, x0: number, seed: number): BufferGeometry {
  const out: Record<string, number[]> = { position: [], normal: [], uv: [], color: [], surface: [] };
  const side = Math.sign(x0) || 1;
  for (const { mesh, toRoot } of meshFrames(model)) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) continue;
    _nm.getNormalMatrix(toRoot);
    const nrm = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const srf = g.getAttribute('surface');
    for (let t = 0; t + 2 < pos.count; t += 3) {
      _a.fromBufferAttribute(pos, t).applyMatrix4(toRoot);
      _b.fromBufferAttribute(pos, t + 1).applyMatrix4(toRoot);
      _c.fromBufferAttribute(pos, t + 2).applyMatrix4(toRoot);
      const cx = (_a.x + _b.x + _c.x) / 3;
      const cz = (_a.z + _b.z + _c.z) / 3;
      if ((cx + tearOffset(cz, 0, Math.abs(x0) * 0.15, seed)) * side < Math.abs(x0)) continue;
      out.position.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
      for (let k = 0; k < 3; k++) {
        if (nrm) {
          const n = _a.fromBufferAttribute(nrm, t + k).applyMatrix3(_nm).normalize();
          out.normal.push(n.x, n.y, n.z);
        }
        out.uv.push(0, 0);
        if (col) out.color.push(col.getX(t + k), col.getY(t + k), col.getZ(t + k));
        if (srf) out.surface.push(srf.getX(t + k), 0, srf.getZ(t + k), srf.getW(t + k));
      }
    }
  }
  return build(out);
}
