import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import {
  Fn,
  attribute,
  cross,
  float,
  floor,
  mix,
  positionGeometry,
  smoothstep,
  uniform,
  varyingProperty,
  vec3,
  mx_noise_float,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { CelMaterial } from '@/render/materials/CelMaterial';
import type { RampName } from '@/render/materials/ToonRamp';

export interface RockClass {
  /** Icosahedron subdivision (0 = 20 tris, 1 = 80, 2 = 320, 3 = 1280). */
  detail: number;
  count: number;
  /** Radius range in metres; sampled with a power law biased to the small end. */
  size: [number, number];
  /** Number of distinct shapes (one draw call each). */
  variants: number;
}

export interface AsteroidFieldOptions {
  seed: number;
  /** Disc/torus radii in metres (field-local, XZ plane). */
  innerRadius: number;
  outerRadius: number;
  /** Vertical half-thickness (1σ-ish) in metres. */
  thickness: number;
  /** Clumps: a boulder + its rubble. `clumpShare` of rocks go to clumps. */
  clumps: number;
  clumpRadius: [number, number];
  clumpShare: number;
  classes: RockClass[];
  /** Paint: two rock tones mixed per instance, plus a darker blotch tone. */
  colors: [string, string, string];
  ramp: RampName;
  /** Global multiplier on tumble rate. */
  tumble: number;
}

export const FIELD_DEFAULT: AsteroidFieldOptions = {
  seed: 7,
  innerRadius: 1500,
  outerRadius: 9000,
  thickness: 700,
  clumps: 44,
  clumpRadius: [200, 700],
  clumpShare: 0.7,
  classes: [
    { detail: 0, count: 5000, size: [1.2, 5], variants: 2 },
    { detail: 1, count: 2500, size: [5, 16], variants: 2 },
    { detail: 2, count: 900, size: [16, 70], variants: 2 },
    { detail: 3, count: 70, size: [70, 400], variants: 2 },
  ],
  colors: ['#8a7a6c', '#6f6a78', '#4d4250'],
  ramp: 'dramatic',
  tumble: 1,
};

/** Seeded PRNG (mulberry32). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A chunky anime rock: sphere displaced by low-frequency lumps, then chiselled
 * by random half-space cuts (big flat facets read beautifully under a banded
 * ramp), plus a few shallow crater dents. Non-indexed with no normal
 * attribute → the material flat-shades from derivatives, and the ink crease
 * detector picks up the facet edges.
 */
export function rockGeometry(detail: number, rand: () => number): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');

  const lumps: { k: Vector3; a: number; ph: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const k = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(1.2 + rand() * 2.2);
    lumps.push({ k, a: (0.07 + rand() * 0.1) / (1 + i * 0.4), ph: rand() * 6.283 });
  }
  const cuts: { n: Vector3; d: number }[] = [];
  const nCuts = 5 + Math.floor(rand() * 5);
  // Finer meshes get shallower cuts: deep cuts on a dense mesh read as a crate.
  const cutMin = detail >= 3 ? 0.8 : 0.72;
  for (let i = 0; i < nCuts; i++) {
    cuts.push({ n: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), d: cutMin + rand() * (0.95 - cutMin) });
  }
  // Fine relief applied after the cuts so chiselled faces stay faceted, not planar.
  const relief: { k: Vector3; a: number; ph: number }[] = [];
  for (let i = 0; i < (detail >= 2 ? 6 : 0); i++) {
    const k = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(6 + rand() * 10);
    relief.push({ k, a: 0.012 + rand() * 0.02, ph: rand() * 6.283 });
  }
  const craters: { c: Vector3; r: number; depth: number }[] = [];
  for (let i = 0; i < (detail >= 2 ? 4 : 1); i++) {
    craters.push({
      c: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
      r: 0.25 + rand() * 0.3,
      depth: 0.06 + rand() * 0.08,
    });
  }

  const v = new Vector3();
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // Duplicated (non-indexed) vertices must land on the same displaced spot.
    const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
    let r = cache.get(key);
    if (r === undefined) {
      r = 1;
      for (const l of lumps) r += Math.sin(v.dot(l.k) * 3 + l.ph) * l.a;
      for (const c of craters) {
        const ang = Math.acos(Math.min(1, v.dot(c.c)));
        const x = ang / c.r;
        if (x < 1.25) r += x < 1 ? -c.depth * (1 - x * x) : c.depth * 0.6 * Math.sin((x - 1) * 12.5);
      }
      for (const c of cuts) {
        const dn = v.dot(c.n);
        if (dn > 0.05) r = Math.min(r, c.d / dn);
      }
      for (const l of relief) r += Math.sin(v.dot(l.k) + l.ph) * l.a;
      cache.set(key, r);
    }
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  return g;
}

/**
 * A cel-shaded asteroid field for parallax and scale reference.
 *
 * Rocks are drawn with custom GPU instancing (one draw call per size class ×
 * shape variant): per-instance position/scale, base orientation, tumble axis
 * + rate and stretch. The tumble is evaluated in the vertex shader from a
 * single time uniform, so every rock spins with zero per-frame CPU cost and
 * zero buffer uploads. Normals come from screen derivatives (flat facets).
 *
 * `group` is universe-positioned: parent it under `WorldSpace.root` and set
 * `group.position` to the field centre (universe metres). Instance positions
 * are field-local (≤ ~10 km), which keeps float32 precision at millimetres.
 *
 * `bodies` exposes the rocks as field-local [x, y, z, radius] for gameplay
 * (collision / avoidance / radar).
 */
export class AsteroidField {
  readonly group = new Group();
  readonly material: CelMaterial;
  readonly meshes: Mesh[] = [];
  /** Field-local bounding spheres, packed [x, y, z, r] per rock. */
  readonly bodies: Float32Array;
  readonly opts: AsteroidFieldOptions;
  /** Clump centres (field-local), their rubble radius and the radius of the boulder at the core. */
  readonly clumps: { centre: Vector3; radius: number; boulder: number }[] = [];
  private readonly uTime: Node = uniform(0);

  constructor(opts: Partial<AsteroidFieldOptions> = {}) {
    this.opts = { ...FIELD_DEFAULT, ...opts };
    const o = this.opts;
    this.group.name = 'asteroid-field';
    const rand = mulberry(o.seed * 7777 + 1);

    // ── layout ──────────────────────────────────────────────────────
    const clumps: { p: Vector3; r: number }[] = [];
    const discPoint = (out: Vector3) => {
      // Uniform over the annulus area, gaussian-ish thickness that thins at the rims.
      const rr = Math.sqrt(o.innerRadius ** 2 + rand() * (o.outerRadius ** 2 - o.innerRadius ** 2));
      const a = rand() * Math.PI * 2;
      const t = (rr - o.innerRadius) / (o.outerRadius - o.innerRadius);
      const h = o.thickness * (0.35 + 0.65 * Math.sin(Math.PI * t));
      const g = (rand() + rand() + rand() - 1.5) / 1.5;
      return out.set(Math.cos(a) * rr, g * h, Math.sin(a) * rr);
    };
    for (let i = 0; i < o.clumps; i++) {
      clumps.push({ p: discPoint(new Vector3()), r: o.clumpRadius[0] + rand() * (o.clumpRadius[1] - o.clumpRadius[0]) });
    }

    const total = o.classes.reduce((n, c) => n + c.count, 0);
    this.bodies = new Float32Array(total * 4);
    let body = 0;

    const mat = new CelMaterial({
      ramp: o.ramp,
      rimWidth: 0.86,
      gloss: 0,
      inkWeight: 1,
      haze: 1,
      paintNode: this.paintNode(),
      regionNode: varyingProperty('float', 'vRockId'),
    });
    mat.name = 'AsteroidCel';
    mat.positionNode = this.positionNode();
    this.material = mat;

    const tmp = new Vector3();
    const axis = new Vector3();
    const fieldBound = new Sphere(new Vector3(), o.outerRadius + o.thickness * 2 + 500);
    let rockId = 1;

    o.classes.forEach((cls, ci) => {
      const perVariant = Math.ceil(cls.count / cls.variants);
      let remaining = cls.count;
      for (let vi = 0; vi < cls.variants; vi++) {
        const n = Math.min(perVariant, remaining);
        remaining -= n;
        if (n <= 0) break;
        const base = rockGeometry(cls.detail, rand);
        const geo = new InstancedBufferGeometry();
        geo.setAttribute('position', base.getAttribute('position'));
        const iPos = new Float32Array(n * 4);
        const iRot = new Float32Array(n * 4);
        const iSpin = new Float32Array(n * 4);
        const iShape = new Float32Array(n * 4);

        for (let i = 0; i < n; i++) {
          // Power-law size: lots of gravel, few monsters.
          const u = rand();
          const size = cls.size[0] * Math.pow(cls.size[1] / cls.size[0], Math.pow(u, 2.2));
          const st = 0.7 + rand() * 0.6;
          const sy = 0.75 + rand() * 0.35;
          const sz = 1 / Math.sqrt(st);
          // Conservative bounding radius (lumps can push the unit rock to ~1.3).
          const bound = size * Math.max(st, sy, sz) * 1.3;
          // Big rocks seed the clumps; the rest mix clumped + scattered.
          if (ci === o.classes.length - 1 && i + vi * perVariant < clumps.length) {
            const c = clumps[i + vi * perVariant];
            tmp.copy(c.p);
            this.clumps.push({ centre: c.p.clone(), radius: c.r, boulder: bound });
          } else if (rand() < o.clumpShare) {
            const c = clumps[Math.floor(rand() * clumps.length)];
            const d = Math.pow(rand(), 0.7) * c.r;
            axis.set(rand() - 0.5, (rand() - 0.5) * 0.6, rand() - 0.5).normalize();
            tmp.copy(c.p).addScaledVector(axis, d);
          } else {
            discPoint(tmp);
          }
          iPos.set([tmp.x, tmp.y, tmp.z, size], i * 4);
          this.bodies.set([tmp.x, tmp.y, tmp.z, bound], body++ * 4);

          axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
          const ang = rand() * Math.PI;
          const s = Math.sin(ang);
          iRot.set([axis.x * s, axis.y * s, axis.z * s, Math.cos(ang)], i * 4);

          axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
          const rate = ((rand() * 0.5 + 0.1) / (1 + size / 15)) * (rand() < 0.5 ? -1 : 1) * o.tumble;
          iSpin.set([axis.x, axis.y, axis.z, rate], i * 4);

          iShape.set([st, sy, sz, rockId++], i * 4);
        }
        geo.setAttribute('iPos', new InstancedBufferAttribute(iPos, 4));
        geo.setAttribute('iRot', new InstancedBufferAttribute(iRot, 4));
        geo.setAttribute('iSpin', new InstancedBufferAttribute(iSpin, 4));
        geo.setAttribute('iShape', new InstancedBufferAttribute(iShape, 4));
        geo.instanceCount = n;
        geo.boundingSphere = fieldBound;

        const mesh = new Mesh(geo, mat);
        mesh.name = `rocks:d${cls.detail}v${vi}`;
        mesh.matrixAutoUpdate = true;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    });
  }

  private positionNode(): Node {
    const vLocal: Node = varyingProperty('vec3', 'vRockLocal');
    const vRockId: Node = varyingProperty('float', 'vRockId');
    const vRand: Node = varyingProperty('float', 'vRockRand');
    const t = this.uTime;
    return Fn(() => {
      const iPos: Node = attribute('iPos', 'vec4');
      const iRot: Node = attribute('iRot', 'vec4');
      const iSpin: Node = attribute('iSpin', 'vec4');
      const iShape: Node = attribute('iShape', 'vec4');

      const local = (positionGeometry as Node).mul(iShape.xyz);
      // Tumble: Rodrigues rotation about the spin axis.
      const k = iSpin.xyz;
      const ang = t.mul(iSpin.w);
      const c = ang.cos();
      const s = ang.sin();
      const spun = local
        .mul(c)
        .add(cross(k, local).mul(s))
        .add(k.mul(k.dot(local).mul(float(1).sub(c))));
      // Base orientation quaternion.
      const q = iRot.xyz;
      const tq = cross(q, spun).mul(2);
      const rotated = spun.add(tq.mul(iRot.w)).add(cross(q, tq));

      // Paint space: more blotches on bigger rocks so boulders don't read as scaled-up pebbles.
      vLocal.assign(local.mul(iPos.w.div(25).sqrt().add(1)));
      vRockId.assign(iShape.w);
      vRand.assign(iShape.w.mul(0.618034).fract());
      return rotated.mul(iPos.w).add(iPos.xyz);
    })();
  }

  private paintNode(): Node {
    const o = this.opts;
    const colA: Node = uniform(new Color(o.colors[0]));
    const colB: Node = uniform(new Color(o.colors[1]));
    const colC: Node = uniform(new Color(o.colors[2]));
    const vLocal: Node = varyingProperty('vec3', 'vRockLocal');
    const vRand: Node = varyingProperty('float', 'vRockRand');
    return Fn(() => {
      const base = mix(colA, colB, vRand);
      // Posterised blotches stuck to the rock (painted-cel texture, two tones).
      const n = mx_noise_float(vLocal.mul(1.6).add(vec3(vRand.mul(17.0))));
      const blotch = smoothstep(0.18, 0.22, n);
      const speck = floor(mx_noise_float(vLocal.mul(5.0)).add(0.72)).clamp(0, 1).mul(0.35);
      return mix(base, colC, blotch.mul(0.65).add(speck.mul(float(1).sub(blotch))));
    })();
  }

  /** Advance the tumble clock (seconds). Deterministic in screenshot mode. */
  update(time: number): void {
    this.uTime.value = time;
  }
}
