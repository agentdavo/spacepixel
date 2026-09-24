import { AdditiveBlending, Color, DoubleSide, Group, Mesh, Quaternion, RingGeometry, SphereGeometry, Vector2, Vector3, type Camera, type PerspectiveCamera } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  positionLocal,
  positionWorld,
  normalWorld,
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
  mx_noise_float,
  step,
  mix,
  min,
} from 'three/tsl';
import { buildPalette, type ColorStop } from '@/render/materials/PaletteRamp';
import { inkMRT, noInkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';
import type { ShaderNode } from '@/render/tsl';
import { planetSurface, type SurfaceOptions } from './planets/PlanetMaterial';
import { discRadiusPx, planetLodFor, type PlanetLod } from './planets/lod';

/**
 * Painted body types. `gas` / `ice-giant` read `bands` as latitude bands;
 * every other kind reads `bands` as a height ramp (0 = lowest, 1 = peaks).
 */
export type PlanetKind = 'gas' | 'ice-giant' | 'rocky' | 'desert' | 'ocean' | 'ice' | 'volcanic' | 'burning' | 'lantern' | 'shattered';

export interface PlanetPreset {
  name: string;
  radius: number;
  bands: ColorStop[];
  bandScale: number;
  turbulence: number;
  atmosphere: string;
  ring?: { inner: number; outer: number; bands: ColorStop[]; tilt: number };
  /** Body type (default `gas`, the original banded giant). */
  kind?: PlanetKind;
  /** Noise domain offset, so two worlds of a kind never match. */
  seed?: number;
  /** Ocean worlds: height where the sea ends (0..1). */
  seaLevel?: number;
  /** 0..1 night-side city lights (inhabited worlds, from station data). */
  lights?: number;
  lightColor?: string;
  /** 0..1 cloud cover (terrestrial kinds). */
  clouds?: number;
  /** Emissive colour: lava seas / cracks, black-light veins. */
  glow?: string;
  /** A great storm: latitude −1..1, longitude radians, angular size (≈ radians). */
  storm?: { lat: number; lon: number; size: number; color: string };
  /** Polar caps from |latitude| (0..1; omit for none). */
  caps?: number;
  /** No atmosphere shell or rim band. */
  airless?: boolean;
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

/** Shared planet clock (seconds): cloud decks drift on it. Set by the system view. */
export const planetClock: ShaderNode = uniform(0);
let inkSerial = 0;
const _q = new Quaternion();
const _c = new Vector3();
const _e = new Vector3();
const _px = new Vector2();

const LOD_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('planetlod') === '0';

/**
 * A painted body: the surface shader (`planets/PlanetMaterial.ts` — banded
 * giants, terrestrial height-ramp worlds, lava, black-light veins, clouds,
 * storms, night-side cities), a stepped atmospheric limb glow, and an
 * optional ring system that receives the planet's shadow and casts its own
 * back onto the body, both analytically.
 */
export class Planet {
  readonly group = new Group();
  readonly preset: PlanetPreset;
  readonly body: Mesh;
  /** The ring mesh (RingGeometry in its local XY plane), if any. */
  readonly ring: Mesh | null = null;
  /** Current surface detail level (0 full … 2 far impostor) and the disc radius it was picked at (px). */
  lod: PlanetLod = 0;
  pixelRadius = Infinity;
  /** Force a detail level (the renderer re-picks it every frame unless `?planetlod=0`). */
  readonly setLod: (lod: PlanetLod) => void;

  constructor(preset: PlanetPreset = PLANETS.castellan, opts: { segments?: number } = {}) {
    this.preset = preset;
    this.group.name = `planet:${preset.name}`;
    const R = preset.radius;
    const seg = opts.segments ?? 128;
    const inkId = 9001 + (inkSerial++ % 64) * 3;

    // Ring frame (render space), shared by the ring's and the body's shadow tests.
    const planetCenter: ShaderNode = uniform(new Vector3());
    const ringNormal: ShaderNode = uniform(new Vector3(0, 1, 0));
    const rp = preset.ring;
    const ringTex = rp ? buildPalette(rp.bands, 1024) : null;

    // ── body (LOD: full / mid / far impostor, picked per frame from the disc's size) ──
    const surface: SurfaceOptions = {
      time: planetClock,
      inkId,
      ring: rp && ringTex ? { center: planetCenter, normal: ringNormal, inner: R * rp.inner, outer: R * rp.outer, palette: ringTex } : undefined,
    };
    const fullGeo = new SphereGeometry(R, seg, seg / 2);
    let farGeo: SphereGeometry | null = null;
    const mats: (MeshBasicNodeMaterial | undefined)[] = [];
    const matFor = (lod: PlanetLod) => (mats[lod] ??= planetSurface(preset, { ...surface, lod }));
    const body = new Mesh(fullGeo, matFor(0));
    this.body = body;
    this.group.add(body);
    this.setLod = (lod: PlanetLod) => {
      if (lod === this.lod) return;
      this.lod = lod;
      body.material = matFor(lod);
      body.geometry = lod === 2 ? (farGeo ??= new SphereGeometry(R, 40, 20)) : fullGeo;
    };
    // Measured where it is drawn (every scene, every camera); the swap shows from the next frame.
    const lodCheck = (renderer: { getDrawingBufferSize?: (v: Vector2) => Vector2 }, camera: Camera) => {
      if (LOD_OFF || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
      const cam = camera as PerspectiveCamera;
      body.getWorldPosition(_c);
      cam.getWorldPosition(_e);
      const h = renderer.getDrawingBufferSize ? renderer.getDrawingBufferSize(_px).y : 720;
      const px = discRadiusPx(R, _c.distanceTo(_e), cam.getEffectiveFOV(), h);
      this.pixelRadius = px;
      this.setLod(planetLodFor(px, this.lod));
    };
    body.onBeforeRender = (renderer, _scene, camera) => lodCheck(renderer as never, camera);

    // ── atmosphere limb ──────────────────────────────────────────────
    if (!preset.airless) {
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
      const shell = new Mesh(new SphereGeometry(R * 1.018, Math.round(seg * 0.75), Math.round(seg * 0.375)), atmo);
      shell.renderOrder = 5;
      this.group.add(shell);
    }

    // ── ring ─────────────────────────────────────────────────────────
    if (rp && ringTex) {
      const inner = R * rp.inner;
      const outer = R * rp.outer;
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
        const inShadow = t.greaterThan(0.0).and(d2.lessThan(planetRadius.mul(planetRadius)));
        // Sunlit face at full key light; the far face glows through (forward
        // scatter) a step darker — painted, never black. Planet shadow on top.
        const V = normalize(cameraPosition.sub(P));
        const sameSide = dot(ringNormal, LightRig.keyDirection).mul(dot(ringNormal, V)).greaterThan(0.0);
        const light = mix(LightRig.shadowTint, LightRig.keyColor, select(sameSide, float(1.0), float(0.55)));
        const lit: ShaderNode = select(inShadow, vec3(LightRig.shadowTint).mul(0.35), light);
        const col: ShaderNode = pow(ringSample.rgb, vec3(2.2)).mul(float(1).add(detail)).mul(lit);
        return min(col, vec3(0.97));
      })();

      const ringMat = new MeshBasicNodeMaterial();
      ringMat.colorNode = ringPaint;
      ringMat.side = DoubleSide;
      ringMat.mrtNode = inkMRT(0.6, inkId + 1, 0.2);
      // Up close the painted sheet dissolves in blotches (the chunks of
      // RingDebris take over), so flying the ring plane never meets a floor.
      const grain = mx_noise_float(positionLocal.xy.mul(1 / 420)).mul(0.5).add(0.5);
      const fade = smoothstep(900, 7000, length(positionWorld));
      ringMat.opacityNode = ringSample.a.mul(step(float(1).sub(fade), grain));
      ringMat.alphaTest = 0.5;

      const ring = new Mesh(new RingGeometry(inner, outer, 256, 1), ringMat);
      ring.rotation.x = -Math.PI / 2 + rp.tilt;
      this.ring = ring;
      body.onBeforeRender = (renderer, _scene, camera) => {
        this.group.getWorldPosition(planetCenter.value);
        ringNormal.value.set(0, 0, 1).applyQuaternion(ring.getWorldQuaternion(_q));
        lodCheck(renderer as never, camera);
      };
      ring.onBeforeRender = () => {
        this.group.getWorldPosition(planetCenter.value);
        ringNormal.value.set(0, 0, 1).applyQuaternion(ring.getWorldQuaternion(_q));
      };
      this.group.add(ring);
    }
  }

  /** Unit ring-plane normal in universe axes (after the group's tilt). */
  ringNormal(out: Vector3): Vector3 {
    if (!this.ring) return out.set(0, 1, 0);
    this.ring.updateWorldMatrix(true, false);
    return out.set(0, 0, 1).applyQuaternion(this.ring.getWorldQuaternion(_q));
  }
}
