import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three';
import { CelMaterial } from '@/render/materials/CelMaterial';

/**
 * Hard debris you can see tumble (presentation only):
 *
 * - **Chunks**: one InstancedMesh of faceted plate shards, cel-shaded with
 *   the hull ramp and ink-outlined like every hull, thrown out of every big
 *   blast. Up to CHUNKS live; the oldest is recycled.
 * - **Rigid pieces**: whole meshes cut off a ship — a turret's gun house
 *   blown off its ring, a fighter's sheared wing — tumbling away on their
 *   own momentum, then gone in a last pop (`onEnd`).
 *
 * Everything lives in render space under `group` (added to the scene, not
 * the world root): positions are kept in universe metres (float64) and
 * written relative to the eye each frame, so a 3 km wreck field far from
 * the system origin never jitters.
 */
const CHUNKS = 384;
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _ax = new Vector3();

interface Chunk {
  pos: Vector3;
  vel: Vector3;
  rot: Quaternion;
  spin: Vector3;
  size: number;
  life: number;
  age: number;
}

export interface RigidPiece {
  mesh: Mesh;
  /** Universe position of the piece's pivot, velocity, orientation, angular velocity (world, rad/s). */
  pos: Vector3;
  vel: Vector3;
  rot: Quaternion;
  spin: Vector3;
  life: number;
  age: number;
  /** Called once when it expires (a last pop), with its universe position. */
  onEnd: ((at: Vector3, piece: RigidPiece) => void) | null;
  /** Owned geometry (disposed at the end). */
  owned: boolean;
  /** Seconds between smoke / fire puffs it trails (0 = none), for the FX owner to read. */
  smoke: number;
  smokeT: number;
}

/** A faceted plate shard: an irregular wedge, flat-shaded (non-indexed). */
function shardGeometry(): BufferGeometry {
  const v = [
    [-0.5, -0.12, -0.6],
    [0.55, -0.1, -0.4],
    [0.35, -0.14, 0.62],
    [-0.45, -0.08, 0.35],
    [-0.3, 0.16, -0.25],
    [0.3, 0.12, -0.1],
    [0.1, 0.2, 0.3],
  ];
  const f = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [0, 4, 1],
    [1, 4, 5],
    [1, 5, 2],
    [2, 5, 6],
    [2, 6, 3],
    [3, 6, 4],
    [3, 4, 0],
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const srf: number[] = [];
  f.forEach((tri, i) => {
    for (const k of tri) pos.push(...v[k]);
    // Two cel tones (burnt plating / bare metal) and a region per face so the facets ink.
    const c = i % 3 === 0 ? [0.42, 0.4, 0.44] : [0.26, 0.24, 0.27];
    for (let k = 0; k < 3; k++) {
      col.push(...c);
      srf.push(1 + i, 0, 0.5, 0);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('surface', new Float32BufferAttribute(srf, 4));
  g.setAttribute('uv', new Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}

export class DebrisField {
  readonly group = new Group();
  private chunks: Chunk[] = [];
  private head = 0;
  private mesh: InstancedMesh;
  readonly rigid: RigidPiece[] = [];
  private seed = 0x5eed;

  constructor() {
    this.group.name = 'debris-field';
    const mat: Material = new CelMaterial({ vertexPaint: true, ramp: 'classic', inkId: 3100, rimWidth: 0.55, gloss: 0.4 });
    this.mesh = new InstancedMesh(shardGeometry(), mat, CHUNKS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  /** Visual-only dice (never feeds the sim). */
  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** Throw `count` shards of ~`size` m out of `pos` at up to `speed` m/s (plus `vel`). */
  burst(pos: Vector3, vel: Vector3, count: number, size: number, speed: number, dir: Vector3 | null = null, spread = 1): void {
    for (let i = 0; i < count; i++) {
      let c = this.chunks[this.head];
      if (!c) {
        c = { pos: new Vector3(), vel: new Vector3(), rot: new Quaternion(), spin: new Vector3(), size: 1, life: 1, age: 0 };
        this.chunks[this.head] = c;
      }
      this.head = (this.head + 1) % CHUNKS;
      c.pos.copy(pos).add(_p.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(size * 2));
      _p.set(this.rand() * 2 - 1, this.rand() * 2 - 1, this.rand() * 2 - 1).normalize();
      if (dir) _p.lerp(dir, 1 - spread).normalize();
      c.vel.copy(vel).addScaledVector(_p, speed * (0.3 + this.rand() * 0.7));
      c.rot.setFromAxisAngle(_ax.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize(), this.rand() * 6.28);
      c.spin.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(6);
      c.size = size * (0.4 + this.rand() * 1.1);
      c.life = 5 + this.rand() * 6;
      c.age = 0;
    }
  }

  /**
   * A mesh cut off a ship tumbling away. `mesh`'s geometry must be centred on
   * the pivot (the caller offsets it). Returns the piece (the caller may set
   * `smoke` / `onEnd`).
   */
  addRigid(mesh: Mesh, pos: Vector3, rot: Quaternion, vel: Vector3, spin: Vector3, life: number, owned = true): RigidPiece {
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const p: RigidPiece = { mesh, pos: pos.clone(), vel: vel.clone(), rot: rot.clone(), spin: spin.clone(), life, age: 0, onEnd: null, owned, smoke: 0, smokeT: 0 };
    this.rigid.push(p);
    return p;
  }

  update(dt: number, eye: Vector3): void {
    let n = 0;
    for (const c of this.chunks) {
      if (!c || c.age >= c.life) continue;
      c.age += dt;
      c.pos.addScaledVector(c.vel, dt);
      const a = c.spin.length();
      if (a > 0) c.rot.premultiply(_q.setFromAxisAngle(_ax.copy(c.spin).divideScalar(a), a * dt));
      // Shrink out over the last second.
      const k = Math.min(1, (c.life - c.age) / 1);
      if (k <= 0) continue;
      _s.setScalar(c.size * k);
      this.mesh.setMatrixAt(n++, _m.compose(_p.subVectors(c.pos, eye), c.rot, _s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = n > 0;
    for (let i = this.rigid.length - 1; i >= 0; i--) {
      const p = this.rigid[i];
      p.age += dt;
      p.pos.addScaledVector(p.vel, dt);
      const a = p.spin.length();
      if (a > 0) p.rot.premultiply(_q.setFromAxisAngle(_ax.copy(p.spin).divideScalar(a), a * dt));
      p.mesh.position.subVectors(p.pos, eye);
      p.mesh.quaternion.copy(p.rot);
      const k = Math.min(1, (p.life - p.age) / 0.6);
      p.mesh.scale.setScalar(Math.max(0.001, k));
      if (p.age >= p.life) {
        p.onEnd?.(p.pos, p);
        this.group.remove(p.mesh);
        if (p.owned) p.mesh.geometry.dispose();
        this.rigid.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const c of this.chunks) if (c) c.age = c.life;
    for (const p of this.rigid) {
      this.group.remove(p.mesh);
      if (p.owned) p.mesh.geometry.dispose();
    }
    this.rigid.length = 0;
  }
}
