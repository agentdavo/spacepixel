import {
  Color,
  DataTexture,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  RGBAFormat,
  Sphere,
  UnsignedByteType,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  If,
  Discard,
  abs,
  attribute,
  cameraPosition,
  cameraWorldMatrix,
  dot,
  exp,
  float,
  floor,
  length,
  mix,
  mod,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  smoothstep,
  step,
  texture,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { inkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';

/** Four puff silhouettes (one per channel): value-noise fBm eroding a radial falloff. */
export function bakePuffs(seed: number, N = 128): DataTexture {
  const G = 16;
  let s = (seed * 69069 + 7) | 0;
  const lattice = new Float32Array(G * G * 4);
  for (let i = 0; i < lattice.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    lattice[i] = (s >>> 0) / 4294967296;
  }
  const sm = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, ch: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = sm(x - xi);
    const fy = sm(y - yi);
    const at = (a: number, b: number) => lattice[((((b % G) + G) % G) * G + (((a % G) + G) % G)) * 4 + ch];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return top + (bot - top) * fy;
  };
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;
      const r = Math.hypot(u * 2 - 1, v * 2 - 1);
      for (let ch = 0; ch < 4; ch++) {
        let f = 0;
        let amp = 0.5;
        let freq = 2.5;
        for (let o = 0; o < 5; o++) {
          f += (noise(u * freq + ch * 3.1, v * freq + ch * 5.7, ch) - 0.5) * amp;
          amp *= 0.5;
          freq *= 2;
        }
        const d = Math.max(0, Math.min(1, 1 - r * 1.08 + f * 1.25));
        data[(y * N + x) * 4 + ch] = Math.round(d * 255);
      }
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface CloudCardOptions {
  seed: number;
  /** Packed [x, y, z, radius] per puff (mesh-local metres). */
  puffs: Float32Array;
  colors: [string, string];
  /** Shadow tone of the cel clouds. */
  shade: string;
  /** Wrap the puffs in a cube of this edge around the eye (camera-locked drifting layer). 0 = fixed. */
  wrap?: number;
  /** Cards dissolve between these multiples of their radius as the camera approaches. */
  near?: [number, number];
  /** Silver-lining colour painted along every silhouette. */
  lining?: string;
  /** Emissive colour of the densest cores (lit from within). */
  glow?: string;
}

/**
 * Opaque cel-painted cloud cards: camera-facing billboards whose silhouettes
 * are hard stepped cut-outs of a baked fBm puff (alpha-discard), painted in
 * two flat tones split along the key-light direction, like background cels.
 *
 * They are OPAQUE on purpose: they write depth into the G-buffer, so the
 * post-process depth fog (postFx.fog) fades them by true distance — near
 * cards stay readable inside a nebula, far ones melt into it. As the camera
 * gets close, a card erodes from its thin edges inward instead of fading.
 * Ink weight 0 (clouds are never outlined).
 */
export class CloudCards {
  readonly mesh: Mesh;
  /** 0..1 lightning illumination and its position (mesh-local). */
  readonly flash: Node = uniform(0);
  readonly flashPos: Node = uniform(new Vector3());
  readonly flashRadius: Node = uniform(3000);
  /** Eye position modulo the wrap size (wrap mode only). */
  readonly eyeMod: Node = uniform(new Vector3());
  /** Global erosion (0 = full clouds, 1 = gone). */
  readonly erode: Node = uniform(0);

  constructor(opts: CloudCardOptions) {
    const n = opts.puffs.length / 4;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    let s = (opts.seed * 48271 + 11) | 0;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
    const look = new Float32Array(n * 4);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      look.set([rand(), rand(), 0.7 + rand() * 0.3, rand() * 6.283], i * 4);
      const p = opts.puffs;
      maxR = Math.max(maxR, Math.hypot(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]) + p[i * 4 + 3]);
    }
    geo.setAttribute('puff', new InstancedBufferAttribute(opts.puffs, 4));
    geo.setAttribute('look', new InstancedBufferAttribute(look, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new Sphere(new Vector3(), opts.wrap ? opts.wrap : maxR);

    const tex = bakePuffs(opts.seed);
    const colA: Node = uniform(new Color(opts.colors[0]));
    const colB: Node = uniform(new Color(opts.colors[1]));
    const shade: Node = uniform(new Color(opts.shade));
    const lining: Node = uniform(new Color(opts.lining ?? '#c9b8ff'));
    const glow: Node = uniform(new Color(opts.glow ?? '#000000'));
    const [nearA, nearB] = opts.near ?? [0.35, 1.2];
    const wrap = opts.wrap ?? 0;

    const vUV: Node = varyingProperty('vec2', 'vCloudUV');
    const vMask: Node = varyingProperty('vec4', 'vCloudMask');
    const vLook: Node = varyingProperty('vec4', 'vCloudLook');
    const vCut: Node = varyingProperty('float', 'vCloudCut');
    const vLight: Node = varyingProperty('vec2', 'vCloudLight');
    const vFlash: Node = varyingProperty('float', 'vCloudFlash');

    const mat = new MeshBasicNodeMaterial();
    mat.name = 'CloudCards';
    mat.positionNode = Fn(() => {
      const p: Node = attribute('puff', 'vec4');
      const lk: Node = attribute('look', 'vec4');
      const inv: Node = modelWorldMatrixInverse;
      const right: Node = inv.mul(vec4((cameraWorldMatrix as Node).element(0).xyz, 0)).xyz.normalize();
      const up: Node = inv.mul(vec4((cameraWorldMatrix as Node).element(1).xyz, 0)).xyz.normalize();
      const c = lk.w.cos();
      const sn = lk.w.sin();
      const q: Node = positionGeometry.xy;
      const rx = q.x.mul(c).sub(q.y.mul(sn));
      const ry = q.x.mul(sn).add(q.y.mul(c));
      // Wrap mode: puffs tile space around the eye (mesh is placed at the eye).
      const centre: Node = wrap > 0 ? mod(p.xyz.sub(this.eyeMod).add(wrap / 2), vec3(wrap)).sub(wrap / 2) : p.xyz;
      const cw: Node = modelWorldMatrix.mul(vec4(centre, 1)).xyz;
      const d: Node = length(cw.sub(cameraPosition));
      // Erosion threshold: rises as the camera closes in (and at the wrap boundary).
      const near: Node = float(1).sub(smoothstep(p.w.mul(nearA), p.w.mul(nearB), d));
      const edge: Node = wrap > 0 ? smoothstep(wrap * 0.3, wrap * 0.5, d) : float(0);
      vCut.assign(near.max(edge).max(this.erode));
      vUV.assign(positionGeometry.xy.mul(0.5).add(0.5));
      vLook.assign(lk);
      const ch = floor(lk.x.mul(3.999));
      vMask.assign(step(abs(vec4(ch).sub(vec4(0, 1, 2, 3))), vec4(0.5)));
      // Key light projected into the card (rotated with the card's spin).
      const L: Node = LightRig.keyDirection;
      const lx: Node = dot(L, (cameraWorldMatrix as Node).element(0).xyz);
      const ly: Node = dot(L, (cameraWorldMatrix as Node).element(1).xyz);
      vLight.assign(vec2(lx.mul(c).add(ly.mul(sn)), ly.mul(c).sub(lx.mul(sn))).mul(0.055));
      vFlash.assign(this.flash.mul(exp(length(centre.sub(this.flashPos)).div(this.flashRadius).negate())));
      return centre.add(right.mul(rx.mul(p.w))).add(up.mul(ry.mul(p.w)));
    })();

    mat.colorNode = Fn(() => {
      const dens: Node = dot(texture(tex, vUV), vMask).mul(vLook.z);
      // Hard cut-out; erosion eats the thin edges first.
      const cut: Node = mix(0.08, 1.02, vCut);
      If(dens.lessThan(cut), () => {
        Discard();
      });
      // Two flat tones split along the light: sample toward the light.
      const toward: Node = dot(texture(tex, vUV.add(vLight)), vMask).mul(vLook.z);
      const lit: Node = step(toward, dens.sub(0.015));
      const core: Node = step(0.55, dens);
      const base: Node = mix(colA, colB, vLook.y.mul(vLook.y));
      const col: Node = mix(vec3(shade), vec3(base), lit.mul(0.75).add(0.25)).mul(mix(1.0, 0.82, core)).toVar();
      // Silver lining along the lit edge of the silhouette; cores glow from within.
      const edgeBand: Node = step(dens, cut.add(0.035)).mul(lit);
      col.assign(mix(col, vec3(lining), edgeBand.mul(0.5)));
      col.addAssign(vec3(glow).mul(step(0.78, dens)));
      return col.add(vec3(0.85, 0.75, 1.0).mul(vFlash.mul(step(0.25, dens)).mul(1.4)));
    })();
    mat.mrtNode = inkMRT(0, 0, 0.3);

    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'cloud-cards';
    this.mesh.frustumCulled = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as MeshBasicNodeMaterial;
    m.dispose();
  }
}
