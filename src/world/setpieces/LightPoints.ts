import {
  AdditiveBlending,
  Color,
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
  abs,
  cameraProjectionMatrix,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  modelViewMatrix,
  positionGeometry,
  screenSize,
  sin,
  smoothstep,
  step,
  uniform,
  varyingProperty,
  vec3,
  vec4,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from '../BlendedMRT';

export const LIGHT_STEADY = 0;
export const LIGHT_STROBE = 1;
/** Dying, irregular flicker (dead running lights). */
export const LIGHT_FLICKER = 2;
export const LIGHT_PULSE = 3;

export interface LightSpec {
  pos: Vector3;
  color: Color | string;
  /** World radius of the glow (metres). */
  size: number;
  mode?: number;
  /** Cycles per second. */
  rate?: number;
  /** 0..1 phase offset. */
  phase?: number;
  /** Strobe on-fraction. */
  duty?: number;
  /** Brightness multiplier (HDR). */
  gain?: number;
}

export interface LightPointOptions {
  /** Never smaller than this many pixels (radius) — lights read at any range. */
  minPixels?: number;
  /** Fade the lights out beyond this distance (metres). 0 = never. */
  fadeFar?: number;
  /** Cross-glint arms strength (anime sparkle). */
  glint?: number;
}

/**
 * Instanced additive glow points: running lights, strobes, beacons. One draw
 * call for any number of lights. Billboarded in view space from the object's
 * modelView matrix, so a LightPoints can ride on any moving/rotating parent.
 * Blink patterns are evaluated in the vertex shader from one time uniform
 * (no per-frame uploads). Never inked.
 */
export class LightPoints {
  readonly mesh: Mesh;
  readonly intensity: Node = uniform(1);
  readonly time: Node = uniform(0);
  private readonly gains: InstancedBufferAttribute;

  constructor(lights: LightSpec[], opts: LightPointOptions = {}) {
    const n = Math.max(1, lights.length);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const iPos = new Float32Array(n * 4);
    const iCol = new Float32Array(n * 4);
    const iMode = new Float32Array(n * 4);
    const c = new Color();
    let maxR = 1;
    lights.forEach((l, i) => {
      c.set(l.color);
      iPos.set([l.pos.x, l.pos.y, l.pos.z, l.size], i * 4);
      iCol.set([c.r, c.g, c.b, l.phase ?? 0], i * 4);
      iMode.set([l.mode ?? LIGHT_STEADY, l.rate ?? 1, l.duty ?? 0.12, l.gain ?? 1], i * 4);
      maxR = Math.max(maxR, l.pos.length() + l.size);
    });
    geo.setAttribute('iPos', new InstancedBufferAttribute(iPos, 4));
    geo.setAttribute('iCol', new InstancedBufferAttribute(iCol, 4));
    this.gains = new InstancedBufferAttribute(iMode, 4);
    geo.setAttribute('iMode', this.gains);
    geo.instanceCount = lights.length;
    geo.boundingSphere = new Sphere(new Vector3(), maxR);

    const minPx = float(opts.minPixels ?? 1.6);
    const fadeFar = opts.fadeFar ?? 0;
    const glint = float(opts.glint ?? 0.6);
    const vUV: Node = varyingProperty('vec2', 'vLpUV');
    const vCol: Node = varyingProperty('vec3', 'vLpCol');

    const mat = new MeshBasicNodeMaterial();
    mat.name = 'LightPoints';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;

    mat.vertexNode = Fn(() => {
      const p: Node = attribute('iPos', 'vec4');
      const col: Node = attribute('iCol', 'vec4');
      const md: Node = attribute('iMode', 'vec4');
      const view: Node = modelViewMatrix.mul(vec4(p.xyz, 1));
      const z: Node = max(view.z.negate(), 0.01);
      // World size of one pixel at this depth.
      const px: Node = z.mul(2).div((cameraProjectionMatrix as Node).element(1).element(1).mul(screenSize.y));
      const r: Node = max(p.w, px.mul(minPx));
      // Blink patterns.
      const t: Node = this.time.mul(md.y).add(col.w);
      const strobe = step(fract(t), md.z);
      const hsh = fract(sin(floor(t.mul(3.0)).mul(91.345).add(col.w.mul(311.7))).mul(43758.55));
      const flicker = step(0.55, hsh).mul(0.8).add(0.12).mul(sin(t.mul(17.0)).mul(0.15).add(0.85));
      const pulse = sin(t.mul(6.2832)).mul(0.5).add(0.5);
      const m = md.x;
      const b = float(1)
        .mul(step(abs(m.sub(0)), 0.5))
        .add(strobe.mul(step(abs(m.sub(1)), 0.5)))
        .add(flicker.mul(step(abs(m.sub(2)), 0.5)))
        .add(pulse.mul(step(abs(m.sub(3)), 0.5)));
      // Sub-pixel-size lights keep their energy: dimmer as they're clamped bigger.
      const energy = p.w.div(r).clamp(0.6, 1);
      // (Branch in JS: WGSL rejects a constant smoothstep with equal edges.)
      const far: Node = fadeFar > 0 ? float(1).sub(smoothstep(fadeFar * 0.6, fadeFar, z)) : float(1);
      vCol.assign(col.xyz.mul(b.mul(md.w).mul(energy).mul(far).mul(this.intensity)));
      vUV.assign(positionGeometry.xy);
      return cameraProjectionMatrix.mul(vec4(view.xy.add(positionGeometry.xy.mul(r)), view.z, 1));
    })();

    mat.colorNode = Fn(() => {
      const q: Node = vUV;
      const d = length(q);
      const core = exp(d.mul(d).mul(-18.0)).mul(2.5);
      const halo = exp(d.mul(-4.5)).mul(0.5);
      const ax = abs(q.x);
      const ay = abs(q.y);
      const arms = exp(ax.mul(-30.0))
        .mul(float(1).sub(ay).clamp(0, 1))
        .add(exp(ay.mul(-30.0)).mul(float(1).sub(ax).clamp(0, 1)))
        .mul(glint);
      const shape = core.add(halo).add(arms).mul(float(1).sub(smoothstep(0.85, 1.0, d)));
      // Hot white core inside the coloured sheath.
      return vec3(vCol).mul(shape).add(vec3(core.mul(0.35)).mul(length(vCol).min(2)));
    })();
    mat.mrtNode = noInkMRT();

    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'light-points';
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
    useBlendedMRT(this.mesh);
  }

  /** Change one light's brightness (e.g. a ship's lights die). Small upload. */
  setGain(i: number, gain: number): void {
    if (this.gains.getW(i) === gain) return;
    this.gains.setW(i, gain);
    this.gains.needsUpdate = true;
  }

  update(time: number): void {
    this.time.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
