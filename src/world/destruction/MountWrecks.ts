import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Vector3, type BufferAttribute, type Mesh } from 'three';
import type { ShipEntity } from '@/sim/Fleet';
import type { Subsystem } from '@/sim/Damage';
import { meshFrames } from './HullSplit';

/** How a mount looks dead (Damage.Subsystem.wreck). */
export type MountWreckStyle = 'droop' | 'blown';

/**
 * Wrecked mounts on the merged hull mesh — for the mounts the turret rigs
 * don't own (src/sim/TurretRig.ts poses rigged turrets itself: lances,
 * launchers and rigid turrets land here):
 *
 *   droop   the gun house is knocked askew on its ring and the barrels sag
 *           to the deck (vertices rotated in place)
 *   blown   the gun house and barrels are cut out of the hull and returned as
 *           their own geometry, centred on the mount, to tumble away; the
 *           triangles left behind collapse to the barbette
 *
 * Which triangles are the mount: the ink regions (Part paint regions) found
 * within the mount's radius that don't carry on beyond it — the housing and
 * the barrels, not the plating they sit on (mirrored twins, which share a
 * region, are told apart by side). The region reaching furthest along the
 * socket's +Z is the barrels. `restore` puts a repaired ship back.
 */
interface Backup {
  pos: Float32Array;
  nrm: Float32Array | null;
}

interface Pick {
  mesh: Mesh;
  /** Mesh-local → root-local, and back. */
  toRoot: Matrix4;
  fromRoot: Matrix4;
  tris: number[];
  barrels: Set<number>;
}

const _o = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _v = new Vector3();
const _c = new Vector3();
const _m = new Matrix4();
const _r = new Matrix4();
const _t = new Matrix4();
const _nm = new Matrix3();

export class MountWrecks {
  private backups = new Map<number, Map<Mesh, Backup>>();

  /** Wreck a mount. `blown` returns the cut-out geometry (root-local axes, centred on the mount) or null. */
  wreck(ship: ShipEntity, sub: Subsystem, style: MountWreckStyle, seed: number): { geometry: BufferGeometry; origin: Vector3; up: Vector3 } | null {
    const model = ship.model;
    const socket = model.sockets.get(sub.id);
    const frames = meshFrames(model);
    // Socket frame in root-local space (falls back to the subsystem point, +Y up).
    if (socket) {
      // (meshFrames just refreshed the world matrices.)
      _m.copy(model.root.matrixWorld).invert().multiply(socket.matrixWorld);
      _o.setFromMatrixPosition(_m);
      _m.extractBasis(_x, _y, _z);
      _x.normalize();
      _y.normalize();
      _z.normalize();
    } else {
      _o.set(sub.x, sub.y, sub.z);
      _x.set(1, 0, 0);
      _y.set(0, 1, 0);
      _z.set(0, 0, 1);
    }
    const R = Math.max(2, sub.radius * 0.8);
    const picks = this.pick(ship, frames, R);
    if (!picks.length) return null;
    const rnd = mulberry(seed);
    if (style === 'droop') {
      // Skewed on the ring (yaw ± 8–20°, a list of 3–6°), barrels sagging 18–30°.
      const yaw = (rnd() < 0.5 ? -1 : 1) * (0.14 + rnd() * 0.21);
      const list = (rnd() - 0.5) * 0.2;
      const sag = 0.32 + rnd() * 0.2;
      for (const p of picks) {
        const bk = this.backup(ship.id, p.mesh);
        const pos = p.mesh.geometry.getAttribute('position') as BufferAttribute;
        const nrm = p.mesh.geometry.getAttribute('normal') as BufferAttribute | undefined;
        // Barrel pivot: where the barrels leave the house (their rearmost point along +Z), at their height.
        let minF = Infinity;
        let hSum = 0;
        let hN = 0;
        for (const t of p.barrels) {
          for (let k = 0; k < 3; k++) {
            _v.fromBufferAttribute(pos, t + k).applyMatrix4(p.toRoot).sub(_o);
            minF = Math.min(minF, _v.dot(_z));
            hSum += _v.dot(_y);
            hN++;
          }
        }
        const pivot = _c.copy(_o).addScaledVector(_z, Number.isFinite(minF) ? minF : 0).addScaledVector(_y, hN ? hSum / hN : 0);
        // Root-local transforms: barrels = house ∘ sag-about-trunnion; house = yaw about the ring ∘ list.
        const house = new Matrix4().makeTranslation(_o.x, _o.y, _o.z).multiply(_r.makeRotationAxis(_y, yaw)).multiply(_t.makeRotationAxis(_z, list)).multiply(new Matrix4().makeTranslation(-_o.x, -_o.y, -_o.z));
        const barrel = house.clone().multiply(new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(_r.makeRotationAxis(_x, sag)).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
        const houseL = new Matrix4().multiplyMatrices(p.fromRoot, house).multiply(p.toRoot);
        const barrelL = new Matrix4().multiplyMatrices(p.fromRoot, barrel).multiply(p.toRoot);
        for (const t of p.tris) {
          const M = p.barrels.has(t) ? barrelL : houseL;
          _nm.getNormalMatrix(M);
          for (let k = 0; k < 3; k++) {
            _v.fromArray(bk.pos, (t + k) * 3).applyMatrix4(M);
            pos.setXYZ(t + k, _v.x, _v.y, _v.z);
            if (nrm && bk.nrm) {
              _v.fromArray(bk.nrm, (t + k) * 3).applyMatrix3(_nm).normalize();
              nrm.setXYZ(t + k, _v.x, _v.y, _v.z);
            }
          }
        }
        pos.needsUpdate = true;
        if (nrm) nrm.needsUpdate = true;
      }
      return null;
    }
    // Blown: copy the mount out (root-local, centred on it), collapse it in the hull.
    const out: Record<string, number[]> = { position: [], normal: [], color: [], surface: [] };
    for (const p of picks) {
      this.backup(ship.id, p.mesh);
      const g = p.mesh.geometry;
      const pos = g.getAttribute('position') as BufferAttribute;
      const nrm = g.getAttribute('normal') as BufferAttribute | undefined;
      const col = g.getAttribute('color');
      const srf = g.getAttribute('surface');
      _nm.getNormalMatrix(p.toRoot);
      const home = _c.copy(_o).applyMatrix4(p.fromRoot);
      for (const t of p.tris) {
        for (let k = 0; k < 3; k++) {
          _v.fromBufferAttribute(pos, t + k).applyMatrix4(p.toRoot).sub(_o);
          out.position.push(_v.x, _v.y, _v.z);
          if (nrm) {
            _v.fromBufferAttribute(nrm, t + k).applyMatrix3(_nm).normalize();
            out.normal.push(_v.x, _v.y, _v.z);
          }
          out.color.push(col ? col.getX(t + k) * 0.8 : 0.3, col ? col.getY(t + k) * 0.8 : 0.3, col ? col.getZ(t + k) * 0.8 : 0.3);
          out.surface.push(srf ? srf.getX(t + k) : 1, 0, srf ? srf.getZ(t + k) : 0.4, srf ? srf.getW(t + k) : 0);
          pos.setXYZ(t + k, home.x, home.y, home.z);
        }
      }
      pos.needsUpdate = true;
    }
    const g = new BufferGeometry();
    const n = out.position.length / 3;
    g.setAttribute('position', new Float32BufferAttribute(out.position, 3));
    if (out.normal.length === n * 3) g.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
    else g.computeVertexNormals();
    g.setAttribute('uv', new Float32BufferAttribute(new Array(n * 2).fill(0), 2));
    g.setAttribute('color', new Float32BufferAttribute(out.color, 3));
    g.setAttribute('surface', new Float32BufferAttribute(out.surface, 4));
    g.computeBoundingSphere();
    return { geometry: g, origin: _o.clone(), up: _y.clone() };
  }

  /** Put a repaired ship's mounts back. */
  restore(ship: ShipEntity): void {
    const m = this.backups.get(ship.id);
    if (!m) return;
    for (const [mesh, bk] of m) {
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
      (pos.array as Float32Array).set(bk.pos);
      pos.needsUpdate = true;
      const nrm = mesh.geometry.getAttribute('normal') as BufferAttribute | undefined;
      if (nrm && bk.nrm) {
        (nrm.array as Float32Array).set(bk.nrm);
        nrm.needsUpdate = true;
      }
    }
    this.backups.delete(ship.id);
  }

  /** A ship's model was rebuilt (or it left): forget its backups. */
  forget(shipId: number): void {
    this.backups.delete(shipId);
  }

  private backup(id: number, mesh: Mesh): Backup {
    let m = this.backups.get(id);
    if (!m) this.backups.set(id, (m = new Map()));
    let b = m.get(mesh);
    if (!b) {
      const pos = mesh.geometry.getAttribute('position');
      const nrm = mesh.geometry.getAttribute('normal');
      b = { pos: new Float32Array(pos.array as Float32Array), nrm: nrm ? new Float32Array(nrm.array as Float32Array) : null };
      m.set(mesh, b);
    }
    return b;
  }

  /** The mount's triangles per mesh: compact regions near the socket (see the class note). */
  private pick(ship: ShipEntity, frames: ReturnType<typeof meshFrames>, R0: number): Pick[] {
    // Big mounts (triple-gun main batteries) outgrow the routing radius: widen until something compact turns up.
    for (const k of [1, 1.7, 2.6, 4, 6]) {
      const out = this.pickAt(ship, frames, R0 * k, false);
      if (out.length) return out;
    }
    // Shared paint regions: everything inside the mount's radius, on and above its ring.
    return this.pickAt(ship, frames, R0 * 0.9, true);
  }

  private pickAt(ship: ShipEntity, frames: ReturnType<typeof meshFrames>, R: number, loose: boolean): Pick[] {
    const out: Pick[] = [];
    const side = Math.abs(_o.x) > R * 0.5 ? Math.sign(_o.x) : 0;
    for (const { mesh, toRoot } of frames) {
      const g = mesh.geometry;
      const pos = g.getAttribute('position');
      const srf = g.getAttribute('surface');
      if (!pos || !srf) continue;
      // Positions may already be wrecked: read the pristine copy when there is one.
      const bk = this.backups.get(ship.id)?.get(mesh);
      const near = new Map<number, number[]>();
      // A region is the mount's only if every one of its triangles (on this side) is inside R,
      // and it sits on the mount (its middle within 0.6 R: not a neighbour's barbette).
      const far = new Set<number>();
      const mid = new Map<number, Vector3>();
      for (let t = 0; t + 2 < pos.count; t += 3) {
        let dMax = 0;
        _c.set(0, 0, 0);
        for (let k = 0; k < 3; k++) {
          if (bk) _v.fromArray(bk.pos, (t + k) * 3);
          else _v.fromBufferAttribute(pos, t + k);
          _v.applyMatrix4(toRoot);
          _c.add(_v);
          dMax = Math.max(dMax, _v.distanceTo(_o));
        }
        _c.multiplyScalar(1 / 3);
        if (side !== 0 && Math.sign(_c.x) !== side) continue;
        const region = srf.getX(t);
        if (loose) {
          if (dMax <= R && _v.copy(_c).sub(_o).dot(_y) > -R * 0.05) {
            let a = near.get(region);
            if (!a) near.set(region, (a = []));
            a.push(t);
          }
          continue;
        }
        if (dMax > R) {
          far.add(region);
          continue;
        }
        let a = near.get(region);
        if (!a) near.set(region, (a = []));
        a.push(t);
        let m = mid.get(region);
        if (!m) mid.set(region, (m = new Vector3()));
        m.add(_c);
      }
      let tris: number[] = [];
      const regions: [number, number[]][] = [];
      for (const [region, ts] of near) {
        if (far.has(region)) continue;
        const m = mid.get(region);
        if (m && m.divideScalar(ts.length).distanceTo(_o) > R * 0.6) continue;
        regions.push([region, ts]);
        tris = tris.concat(ts);
      }
      if (!tris.length) continue;
      // Barrels: the region reaching furthest along the socket's +Z.
      const barrels = new Set<number>();
      if (regions.length > 1) {
        let best = -Infinity;
        let bi = -1;
        regions.forEach(([, ts], i) => {
          let f = 0;
          for (const t of ts) f += _c.fromBufferAttribute(pos, t).applyMatrix4(toRoot).sub(_o).dot(_z);
          f /= ts.length;
          if (f > best) {
            best = f;
            bi = i;
          }
        });
        for (const t of regions[bi][1]) barrels.add(t);
      }
      out.push({ mesh, toRoot, fromRoot: toRoot.clone().invert(), tris, barrels });
    }
    return out;
  }
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

