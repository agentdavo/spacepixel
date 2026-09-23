import {
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraWorldMatrix,
  float,
  floor,
  mix,
  length,
  positionGeometry,
  smoothstep,
  uniform,
  varyingProperty,
  vec3,
  vec4,
  texture,
  dot,
  select,
  step,
  abs,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { bakePuffTexture } from './HazeClouds';

/**
 * Multiplane sky — Disney's multiplane camera, rebuilt for 6DOF and scaled
 * in the unit space actually comes in: the kilometre.
 *
 * Stratum i (1..N) lives i km from the eye: a few big painted cel cloud cards
 * wrapped in a cube of side 2·i km around the eye, faded so each stratum only
 * shows inside its own distance window. Because they're real 3D positions
 * (not screen planes) the parallax is exact under any rotation: fly forward
 * and the 1 km stratum streams past while the 16 km one barely drifts.
 *
 * Cost is deliberate: N × cardsPerLayer camera-facing quads (default 16 × 8 =
 * 128), repositioned on the CPU in float64 each frame (trivial), translucent
 * with ink weight 0. Distance fades and collapse-to-point keep overdraw to a
 * few screens. Everything fades out at supercruise speeds so layers never
 * strobe. Camera-locked: add `mesh` to the Scene (eye-relative coordinates).
 */
export interface MultiplaneOptions {
  layers: number; // strata, one per km
  cardsPerLayer: number;
  /** Card radius as a fraction of the stratum distance. */
  cardScale: number;
  opacity: number;
  seed: number;
}

export const MULTIPLANE_DEFAULT: MultiplaneOptions = { layers: 16, cardsPerLayer: 8, cardScale: 0.32, opacity: 0.16, seed: 11 };

const KM = 1000;

export class MultiplaneSky {
  readonly mesh: Mesh;
  readonly opts: MultiplaneOptions;
  private readonly count: number;
  private readonly seeds: Float64Array; // unit-cube positions per card
  private readonly layerOf: Uint8Array;
  private readonly cards: Float32Array; // eye-relative centre xyz + radius
  private readonly cardAttr: InstancedBufferAttribute;
  private readonly colA: Node = uniform(new Color('#5a4b8c'));
  private readonly colB: Node = uniform(new Color('#2f7f9a'));
  private readonly haze: Node = uniform(new Color('#1b1446'));
  private readonly master: Node = uniform(1);
  private readonly farD: Node;

  constructor(opts: Partial<MultiplaneOptions> = {}) {
    this.opts = { ...MULTIPLANE_DEFAULT, ...opts };
    const o = this.opts;
    this.count = o.layers * o.cardsPerLayer;
    this.farD = uniform(o.layers * KM);
    let s = (o.seed * 48271 + 7) | 0;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
    this.seeds = new Float64Array(this.count * 3);
    this.layerOf = new Uint8Array(this.count);
    this.cards = new Float32Array(this.count * 4);
    const look = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      const layer = 1 + Math.floor(i / o.cardsPerLayer);
      this.layerOf[i] = layer;
      this.seeds.set([rand(), rand(), rand()], i * 3);
      // look: variant, tint mix, density, layer distance (m)
      look.set([rand(), rand(), 0.55 + rand() * 0.45, layer * KM], i * 4);
    }

    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.cardAttr = new InstancedBufferAttribute(this.cards, 4);
    this.cardAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('card', this.cardAttr);
    geo.setAttribute('look', new InstancedBufferAttribute(look, 4));
    geo.instanceCount = this.count;
    geo.boundingSphere = new Sphere(new Vector3(), o.layers * KM * 2);

    const mat = new MeshBasicNodeMaterial();
    mat.name = 'MultiplaneSky';
    mat.transparent = true;
    mat.depthWrite = false;
    const puffTex = bakePuffTexture(o.seed + 101);
    const vUV: Node = varyingProperty('vec2', 'vMpUV');
    const vMask: Node = varyingProperty('vec4', 'vMpMask');
    const vLook: Node = varyingProperty('vec4', 'vMpLook');
    const vFade: Node = varyingProperty('float', 'vMpFade');
    const opacity: Node = uniform(o.opacity);

    mat.positionNode = Fn(() => {
      const c: Node = attribute('card', 'vec4');
      const lk: Node = attribute('look', 'vec4');
      const camWorld: Node = cameraWorldMatrix;
      const right: Node = camWorld.element(0).xyz;
      const up: Node = camWorld.element(1).xyz;
      const q = positionGeometry.xy;
      const d = length(c.xyz);
      const layerD: Node = lk.w;
      // Each stratum only exists in its own distance window around i km.
      const fade: Node = smoothstep(layerD.mul(0.3), layerD.mul(0.6), d).mul(float(1).sub(smoothstep(layerD.mul(0.85), layerD.mul(1.05), d)));
      vFade.assign(fade.mul(this.master));
      vUV.assign(q.mul(0.5).add(0.5));
      vLook.assign(lk);
      const ch = floor(lk.x.mul(3.999));
      vMask.assign(step(abs(vec4(ch).sub(vec4(0, 1, 2, 3))), vec4(0.5)));
      const visible: Node = fade.mul(this.master).greaterThan(0.002);
      const extent: Node = select(visible, c.w, float(0));
      return c.xyz.add(right.mul(q.x.mul(extent))).add(up.mul(q.y.mul(extent)));
    })();

    mat.colorNode = Fn(() => {
      const density = dot(texture(puffTex, vUV), vMask).mul(vLook.z);
      const level: Node = floor(smoothstep(0.05, 0.75, density).mul(3.0)); // 0..3 painted steps
      // Multiplane grading: near strata are dark silhouettes with a backlit
      // rim (the outermost step), far strata pale and sunk into the sky.
      const near: Node = float(1).sub(smoothstep(1000, this.farD, vLook.w));
      const lit = mix(this.colA, this.colB, vLook.y);
      const body = mix(mix(lit, this.haze, 0.5), this.haze.mul(0.3), near);
      const rim = lit.mul(mix(1.0, 1.6, near));
      const col = select(level.lessThan(1.5), rim, body);
      const alpha = level.greaterThan(0.5).select(mix(0.55, 1.0, level.div(3)), float(0));
      return vec4(vec3(col), alpha.mul(opacity).mul(near.mul(2.5).add(1)).mul(vFade));
    })();
    mat.mrtNode = noInkMRT();

    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'multiplane-sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Take colours from the system's sky so strata belong to it. */
  setPalette(a: string, b: string, haze: string): void {
    (this.colA.value as Color).set(a);
    (this.colB.value as Color).set(b);
    (this.haze.value as Color).set(haze);
  }

  /**
   * Re-wrap every card around the eye (float64) and write eye-relative
   * centres. `speed` in m/s: strata fade out above ~20 km/s (supercruise).
   */
  update(eye: Vector3, speed: number): void {
    const o = this.opts;
    this.master.value = 1 - Math.min(1, Math.max(0, (speed - 8000) / 12000));
    for (let i = 0; i < this.count; i++) {
      const S = this.layerOf[i] * KM * 2;
      const j = i * 3;
      const k = i * 4;
      this.cards[k] = wrap(this.seeds[j] * S - eye.x, S);
      this.cards[k + 1] = wrap(this.seeds[j + 1] * S - eye.y, S) * 0.5; // flattened: a galactic "floor" and "ceiling"
      this.cards[k + 2] = wrap(this.seeds[j + 2] * S - eye.z, S);
      this.cards[k + 3] = this.layerOf[i] * KM * o.cardScale;
    }
    this.cardAttr.needsUpdate = true;
  }
}

/** ((v mod S) + S) mod S − S/2, in float64. */
function wrap(v: number, S: number): number {
  const m = v - Math.floor(v / S) * S;
  return m - S / 2;
}
