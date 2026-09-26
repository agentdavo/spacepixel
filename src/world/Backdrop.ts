import {
  BackSide,
  Group,
  Mesh,
  SphereGeometry,
  Sprite,
  Vector3,
  AdditiveBlending,
  Color,
  type Camera,
} from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import type { ShaderNode as Node } from '@/render/tsl';
import {
  Fn,
  positionLocal,
  normalize,
  vec2,
  vec3,
  float,
  floor,
  fract,
  length,
  dot,
  exp,
  abs,
  max,
  pow,
  mix,
  step,
  smoothstep,
  saturate,
  texture,
  uniform,
  uv,
  time,
  sin,
  mx_fractal_noise_float,
  mx_cell_noise_float,
} from 'three/tsl';
import { buildPalette, type ColorStop } from '@/render/materials/PaletteRamp';
import { inkMRT, noInkMRT } from '@/render/materials/InkChannels';

export interface BackdropPreset {
  name: string;
  nebula: ColorStop[];
  wisp: string;
  bandNormal: Vector3;
  seed: number;
  starTint: string;
}

export const BACKDROPS: Record<string, BackdropPreset> = {
  meridian: {
    name: 'Meridian Prime',
    nebula: [
      { at: 0.0, color: '#03021a' },
      { at: 0.42, color: '#0a0930' },
      { at: 0.56, color: '#171448' },
      { at: 0.67, color: '#2f1a5e' },
      { at: 0.77, color: '#5a2170' },
      { at: 0.86, color: '#a33a7f' },
      { at: 0.94, color: '#f08aa0' },
    ],
    wisp: '#1f7d9c',
    bandNormal: new Vector3(0.25, 0.9, 0.35).normalize(),
    seed: 3.7,
    starTint: '#cfe3ff',
  },
  hesper: {
    name: 'Hesper Deep',
    nebula: [
      { at: 0.0, color: '#0a0208' },
      { at: 0.4, color: '#240819' },
      { at: 0.56, color: '#4f0f2c' },
      { at: 0.7, color: '#8f1f3a' },
      { at: 0.82, color: '#e0503f' },
      { at: 0.92, color: '#ffd07a' },
    ],
    wisp: '#7a3cff',
    bandNormal: new Vector3(-0.4, 0.8, -0.2).normalize(),
    seed: 11.2,
    starTint: '#ffe0d0',
  },
};

const SKY_RADIUS = 400_000;

/**
 * The painted sky. A camera-locked dome with a posterised fBm nebula (the
 * flat colour "cel" layers of a background painter), a galactic band, two
 * layers of procedural stars and a handful of anime cross-sparkle hero stars.
 * Writes ink weight 0 so it's never outlined, but real depth so the ink pass
 * sees a crisp silhouette behind every hull.
 */
export class Backdrop {
  readonly group = new Group();
  private sparkles: Sprite[] = [];

  constructor(preset: BackdropPreset = BACKDROPS.meridian) {
    this.group.name = 'backdrop';
    const palette = buildPalette(preset.nebula, 512, false, 0.012);
    const bandN: Node = uniform(preset.bandNormal.clone());
    const wisp: Node = uniform(new Color(preset.wisp));
    const seed = float(preset.seed);
    const starTint: Node = uniform(new Color(preset.starTint));

    const skyMat = new MeshBasicNodeMaterial();
    skyMat.side = BackSide;
    skyMat.depthWrite = false;
    skyMat.name = 'Sky';

    skyMat.colorNode = Fn(() => {
      const d = normalize(positionLocal);

      // Galactic band.
      const bandDist = dot(d, bandN);
      const band = exp(bandDist.mul(bandDist).mul(-7.0));

      // Domain-warped fBm → density.
      const warp = mx_fractal_noise_float(d.mul(1.3).add(seed), 3, 2.0, 0.5);
      const n = mx_fractal_noise_float(d.mul(2.1).add(vec3(warp.mul(0.6))).add(seed.mul(2.0)), 5, 2.0, 0.55);
      const density = saturate(n.mul(0.6).add(0.36).add(band.mul(0.4)).sub(0.1));

      // Palette lookup (baked in gamma 2.2) — posterised painterly layers.
      const neb = pow(texture(palette, vec2(density, 0.5)).rgb, vec3(2.2)).toVar();

      // Teal wisps in the mid-density layers.
      const w = mx_fractal_noise_float(d.mul(4.2).add(seed.mul(3.1)), 4, 2.1, 0.5);
      const wispMask = smoothstep(0.3, 0.34, w).mul(smoothstep(0.45, 0.6, density)).mul(0.4);
      neb.assign(mix(neb, vec3(wisp), wispMask));

      // Stars: two procedural layers.
      const starLayer = (scale: number, threshold: number, radius: number, gain: number): Node => {
        const p = d.mul(scale);
        const cell = floor(p);
        const f = fract(p);
        const jitter = vec3(
          mx_cell_noise_float(cell),
          mx_cell_noise_float(cell.add(19.19)),
          mx_cell_noise_float(cell.add(47.7)),
        )
          .mul(0.7)
          .add(0.15);
        const dist = length(f.sub(jitter));
        const on = step(threshold, mx_cell_noise_float(cell.add(91.3)));
        const tw = sin(time.mul(mx_cell_noise_float(cell.add(5.1)).mul(3.0).add(1.0)).add(cell.x)).mul(0.25).add(0.75);
        return float(1).sub(smoothstep(0.0, radius, dist)).mul(on).mul(tw).mul(gain);
      };
      const stars = starLayer(160, 0.62, 0.16, 1.6).add(starLayer(55, 0.9, 0.09, 3.0)).add(band.mul(starLayer(320, 0.5, 0.2, 0.9)));

      return neb.add(vec3(starTint).mul(stars));
    })();
    skyMat.mrtNode = inkMRT(0, 0, 0);

    const sky = new Mesh(new SphereGeometry(SKY_RADIUS, 64, 32), skyMat);
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    // ?skydome=0 hides the painted dome (perf ablation: its fBm runs under every pixel).
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('skydome') === '0') sky.visible = false;
    this.group.add(sky);

    // Hero sparkle stars.
    const sparkleMat = new SpriteNodeMaterial();
    sparkleMat.transparent = true;
    sparkleMat.depthWrite = false;
    sparkleMat.blending = AdditiveBlending;
    sparkleMat.colorNode = Fn(() => {
      const c = uv().sub(0.5).mul(2.0);
      const ax = abs(c.x);
      const ay = abs(c.y);
      const arms = max(exp(ax.mul(-28.0)).mul(saturate(float(1).sub(ay))), exp(ay.mul(-28.0)).mul(saturate(float(1).sub(ax))));
      const core = exp(length(c).mul(-9.0));
      const diag = exp(abs(ax.sub(ay)).mul(-40.0)).mul(saturate(float(1).sub(length(c).mul(2.2)))).mul(0.4);
      return vec3(starTint).mul(arms.mul(1.6).add(core.mul(2.5)).add(diag));
    })();
    sparkleMat.mrtNode = noInkMRT();

    let s = preset.seed * 1000;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    for (let i = 0; i < 26; i++) {
      const sp = new Sprite(sparkleMat);
      const dir = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      sp.position.copy(dir).multiplyScalar(SKY_RADIUS * 0.9);
      const size = SKY_RADIUS * 0.9 * (0.012 + rand() * 0.02);
      sp.scale.setScalar(size);
      sp.renderOrder = -999;
      sp.frustumCulled = false;
      this.sparkles.push(sp);
      this.group.add(sp);
    }
  }

  /** Lock the dome to the camera so the sky is effectively at infinity. */
  follow(camera: Camera): void {
    this.group.position.copy(camera.position);
  }
}
