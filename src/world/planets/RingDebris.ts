import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { CelMaterial } from '@/render/materials/CelMaterial';
import type { ColorStop } from '@/render/materials/PaletteRamp';
import { rockGeometry } from '../AsteroidField';

/**
 * Ring particles you can fly through. A planetary ring is a painted disc
 * from afar; up close (inside the annulus, within a few km of its plane) this
 * wraps a cube of ice/rock chunks around the eye so the ring becomes a place:
 * boulders the size of frigates slide past, thinning out with height above
 * the plane and vanishing in the ring's gaps (read from the same palette the
 * disc paints with).
 *
 * One InstancedMesh, positioned at the eye in universe space each frame;
 * chunk offsets wrap in float64 on the CPU (a few hundred matrices), so the
 * GPU only sees small eye-relative numbers.
 */
export interface RingTarget {
  /** Universe-space planet centre (live). */
  center: Vector3;
  /** Unit plane normal. */
  normal: Vector3;
  inner: number;
  outer: number;
  bands: ColorStop[];
  color: string;
}

const COUNT = 1200;
const CUBE = 6000;
const HALF_THICK = 700;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coverage of a ring palette at 0..1 across the annulus (hard steps, like the disc). */
export function ringCoverage(bands: ColorStop[], u: number): number {
  if (u < 0 || u > 1) return 0;
  let a = bands[0]?.alpha ?? 1;
  for (const b of bands) if (b.at <= u) a = b.alpha ?? 1;
  return a;
}

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _d = new Vector3();

export class RingDebris {
  readonly mesh: InstancedMesh;
  private seeds = new Float32Array(COUNT * 3);
  private sizes = new Float32Array(COUNT);
  private rots: Quaternion[] = [];
  private material: CelMaterial;
  /** 0..1: how deep in the ring the eye is (HUD / audio can read it). */
  density = 0;

  constructor(seed = 1) {
    const rand = mulberry(seed * 131 + 7);
    const geo = rockGeometry(1, rand);
    geo.computeVertexNormals();
    this.material = new CelMaterial({ color: '#c8b8a0', ramp: 'classic', rimWidth: 0.82, gloss: 0.1, inkWeight: 1, inkId: 9500, haze: 0.8 });
    this.mesh = new InstancedMesh(geo, this.material, COUNT);
    this.mesh.name = 'ring-debris';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < COUNT; i++) {
      this.seeds[i * 3] = rand() * CUBE;
      this.seeds[i * 3 + 1] = rand() * CUBE;
      this.seeds[i * 3 + 2] = rand() * CUBE;
      // Power law: gravel to 90 m bergs.
      this.sizes[i] = 3 + Math.pow(rand(), 3.2) * 90;
      this.rots.push(new Quaternion().setFromAxisAngle(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * 6.28));
    }
  }

  /** Place the chunks around `eye` for the nearest ring (or hide). */
  update(eye: Vector3, rings: readonly RingTarget[]): void {
    let best: RingTarget | null = null;
    let bestH = Infinity;
    for (const r of rings) {
      _d.subVectors(eye, r.center);
      const h = _d.dot(r.normal);
      const rr = Math.sqrt(Math.max(0, _d.lengthSq() - h * h));
      if (rr < r.inner - 4000 || rr > r.outer + 4000) continue;
      if (Math.abs(h) < bestH) {
        bestH = Math.abs(h);
        best = r;
      }
    }
    if (!best || bestH > CUBE * 0.5 + HALF_THICK) {
      this.mesh.visible = false;
      this.density = 0;
      return;
    }
    const r = best;
    this.material.baseColor.value.set(r.color);
    this.mesh.visible = true;
    this.mesh.position.copy(eye);
    const ox = ((eye.x % CUBE) + CUBE) % CUBE;
    const oy = ((eye.y % CUBE) + CUBE) % CUBE;
    const oz = ((eye.z % CUBE) + CUBE) % CUBE;
    let shown = 0;
    for (let i = 0; i < COUNT; i++) {
      // Wrapped offset from the eye, in [-CUBE/2, CUBE/2).
      let x = this.seeds[i * 3] - ox;
      let y = this.seeds[i * 3 + 1] - oy;
      let z = this.seeds[i * 3 + 2] - oz;
      x = x - Math.floor(x / CUBE + 0.5) * CUBE;
      y = y - Math.floor(y / CUBE + 0.5) * CUBE;
      z = z - Math.floor(z / CUBE + 0.5) * CUBE;
      _p.set(x, y, z);
      // Ring coordinates of this chunk (universe).
      _d.copy(eye).add(_p).sub(r.center);
      const h = _d.dot(r.normal);
      const rr = Math.sqrt(Math.max(0, _d.lengthSq() - h * h));
      const u = (rr - r.inner) / (r.outer - r.inner);
      const cover = ringCoverage(r.bands, u);
      const thick = HALF_THICK * (0.6 + 0.4 * Math.sin(i * 12.9898));
      const k = cover * Math.max(0, 1 - Math.abs(h) / thick);
      // Soft fade at the cube edge so wrap-around never pops.
      const edge = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) / (CUBE * 0.5);
      const fade = Math.min(1, Math.max(0, (1 - edge) * 5));
      const s = this.sizes[i] * Math.min(1, k * 2.5) * fade;
      if (s > 0.2) shown++;
      _s.setScalar(Math.max(1e-3, s));
      this.mesh.setMatrixAt(i, _m.compose(_p, this.rots[i], _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.density = shown / COUNT;
    if (!shown) this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export function ringColor(bands: ColorStop[]): string {
  const c = bands.find((b) => (b.alpha ?? 1) > 0)?.color ?? '#c8b8a0';
  return '#' + new Color(c).getHexString();
}
