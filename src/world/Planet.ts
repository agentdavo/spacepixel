import { AdditiveBlending, Color, Group, Mesh, RingGeometry, SphereGeometry, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  positionLocal,
  positionWorld,
  normalWorld,
  normalLocal,
  cameraPosition,
  normalize,
  vec2,
  vec3,
  float,
  dot,
  abs,
  pow,
  select,
  smoothstep,
  saturate,
  texture,
  uniform,
  length,
  mx_fractal_noise_float,
} from 'three/tsl';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { buildPalette, type ColorStop } from '@/render/materials/PaletteRamp';
import { noInkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';
import type { ShaderNode } from '@/render/tsl';

export interface PlanetPreset {
  name: string;
  radius: number;
  bands: ColorStop[];
  bandScale: number;
  turbulence: number;
  atmosphere: string;
  ring?: { inner: number; outer: number; bands: ColorStop[]; tilt: number };
}

export const PLANETS: Record<string, PlanetPreset> = {
  castellan: {
    name: 'Castellan',
    radius: 42_000,
    bandScale: 2.6,
    turbulence: 0.14,
    bands: [
      { at: 0.0, color: '#f3dfb4' },
      { at: 0.16, color: '#e2a877' },
      { at: 0.3, color: '#f7ecd2' },
      { at: 0.42, color: '#b86a55' },
      { at: 0.55, color: '#eac79a' },
      { at: 0.68, color: '#7d8fc4' },
      { at: 0.78, color: '#f0d8ae' },
      { at: 0.9, color: '#c98563' },
    ],
    atmosphere: '#9fdcff',
    ring: {
      inner: 1.45,
      outer: 2.35,
      tilt: 0.42,
      bands: [
        { at: 0.0, color: '#000000', alpha: 0 },
        { at: 0.05, color: '#c8b394' },
        { at: 0.22, color: '#8f7a66' },
        { at: 0.3, color: '#e9d8bb' },
        { at: 0.52, color: '#000000', alpha: 0 },
        { at: 0.58, color: '#b8a288' },
        { at: 0.8, color: '#dccab0' },
        { at: 0.95, color: '#000000', alpha: 0 },
      ],
    },
  },
};

/**
 * A cel-shaded gas giant: posterised latitude bands with fBm turbulence,
 * a hard dramatic terminator, a stepped atmospheric limb glow and an
 * optional ring system that receives the planet's shadow analytically.
 */
export class Planet {
  readonly group = new Group();
  readonly preset: PlanetPreset;

  constructor(preset: PlanetPreset = PLANETS.castellan) {
    this.preset = preset;
    this.group.name = `planet:${preset.name}`;
    const R = preset.radius;

    // ── body ──────────────────────────────────────────────────────────
    const bandTex = buildPalette(preset.bands, 512, true);
    const lat = normalLocal.y;
    const turb = mx_fractal_noise_float(positionLocal.div(R).mul(vec3(2.2, 7.0, 2.2)), 4, 2.0, 0.5);
    const bandU = lat.mul(preset.bandScale).add(turb.mul(preset.turbulence)).add(0.5);
    const paint = pow(texture(bandTex, vec2(bandU, 0.5)).rgb, vec3(2.2));

    const body = new Mesh(
      new SphereGeometry(R, 128, 64),
      new CelMaterial({
        paintNode: paint,
        ramp: 'dramatic',
        rimWidth: 0.78,
        gloss: 0,
        inkWeight: 0.85,
        inkId: 9001,
        haze: 0.2,
      }),
    );
    this.group.add(body);

    // ── atmosphere limb ──────────────────────────────────────────────
    const atmoColor: ShaderNode = uniform(new Color(preset.atmosphere));
    const atmo = new MeshBasicNodeMaterial();
    atmo.transparent = true;
    atmo.depthWrite = false;
    atmo.blending = AdditiveBlending;
    atmo.colorNode = Fn(() => {
      const N = normalize(normalWorld);
      const V = normalize(cameraPosition.sub(positionWorld));
      const fres = float(1).sub(abs(dot(N, V)));
      const lit = smoothstep(-0.25, 0.35, dot(N, LightRig.keyDirection));
      // Two posterised glow steps: a broad soft haze + a hot thin limb.
      const broad = smoothstep(0.55, 0.6, fres).mul(0.35);
      const limb = smoothstep(0.82, 0.86, fres).mul(0.9);
      return vec3(atmoColor).mul(broad.add(limb).mul(lit).mul(1.6));
    })();
    atmo.mrtNode = noInkMRT();
    const shell = new Mesh(new SphereGeometry(R * 1.018, 96, 48), atmo);
    shell.renderOrder = 5;
    this.group.add(shell);

    // ── ring ─────────────────────────────────────────────────────────
    if (preset.ring) {
      const rp = preset.ring;
      const inner = R * rp.inner;
      const outer = R * rp.outer;
      const ringTex = buildPalette(rp.bands, 1024);
      const planetCenter: ShaderNode = uniform(new Vector3());
      const planetRadius = float(R);

      const r01 = length(positionLocal.xy).sub(inner).div(outer - inner);
      const detail = mx_fractal_noise_float(vec3(r01.mul(60.0), 0, 0), 3, 2.0, 0.5).mul(0.08);
      const ringSample = texture(ringTex, vec2(saturate(r01.add(detail.mul(0.1))), 0.5));
      const ringPaint = Fn(() => {
        // Analytic planet shadow: does the ray P→light hit the sphere?
        const P = positionWorld;
        const toC = planetCenter.sub(P);
        const t = dot(toC, LightRig.keyDirection);
        const d2 = dot(toC, toC).sub(t.mul(t));
        const shadow = select(t.greaterThan(0.0).and(d2.lessThan(planetRadius.mul(planetRadius))), float(0.12), float(1.0));
        return pow(ringSample.rgb, vec3(2.2)).mul(float(1).add(detail)).mul(shadow);
      })();

      const ringMat = new CelMaterial({
        paintNode: ringPaint,
        ramp: 'dramatic',
        rimWidth: 2, // no rim on a flat ring
        gloss: 0,
        inkWeight: 0.6,
        inkId: 9100,
        haze: 0.2,
        doubleSided: true,
      });
      ringMat.opacityNode = ringSample.a.mul(1);
      ringMat.alphaTest = 0.5;

      const ring = new Mesh(new RingGeometry(inner, outer, 256, 1), ringMat);
      ring.rotation.x = -Math.PI / 2 + rp.tilt;
      ring.onBeforeRender = () => {
        planetCenter.value.copy(this.group.getWorldPosition(new Vector3()));
      };
      this.group.add(ring);
    }
  }
}
