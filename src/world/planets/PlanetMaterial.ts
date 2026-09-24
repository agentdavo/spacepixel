import { Color, Vector3, type DataTexture } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  atan,
  cameraPosition,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  mx_fractal_noise_vec3,
  mx_worley_noise_vec2,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  select,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { buildPalette } from '@/render/materials/PaletteRamp';
import { getRamp } from '@/render/materials/ToonRamp';
import { inkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';
import type { ShaderNode as Node } from '@/render/tsl';
import type { PlanetPreset } from '../Planet';

/**
 * The painted-planet surface: one shader for every body kind, in the OVA
 * background-painter's vocabulary.
 *
 *  - Gas / ice giants: posterised latitude bands bent by fBm turbulence, and
 *    an optional great storm (an oval of stepped swirl rings, inked edge).
 *  - Terrestrial kinds: an fBm height field quantised through a hard-stepped
 *    palette (contour bands), Worley craters with lit rims, polar caps,
 *    two-tone cloud decks drifting on their own clock.
 *  - Volcanic / burning: ridged-noise lava cracks (and lava seas) that glow
 *    — dimly by day, hot on the night side.
 *  - Lantern-lit: Worley cell edges as black-light veins.
 *
 * Lighting is the cel rule: one hard terminator (the `dramatic` ramp),
 * shadow in the system's shadow tint, a thin warm terminator line, a cel
 * atmosphere band on the lit limb, analytic ring shadow, and night-side city
 * lights (emissive, so they bloom) on inhabited worlds.
 */
export interface RingShadow {
  /** Render-space ring centre (planet centre) and plane normal, updated per frame. */
  center: Node;
  normal: Node;
  /** Metres. */
  inner: number;
  outer: number;
  palette: DataTexture;
}

export interface SurfaceOptions {
  /** Shared clock uniform (seconds) — clouds drift on it. */
  time: Node;
  ring?: RingShadow;
  inkId: number;
  /**
   * Detail level (Planet picks it from the disc's size on screen):
   *   0 full — the painting as authored (big on screen);
   *   1 mid  — one or two fewer octaves everywhere (≲ 1/3 of the screen);
   *   2 far  — the impostor: two-octave height or bands, no Worley craters
   *            or veins, clouds and city lights as flat tints (a few dozen px).
   */
  lod?: PlanetLod;
}

import type { PlanetLod } from './lod';
export type { PlanetLod } from './lod';

/** fBm octaves per detail level: [full, mid, far] (0 = skip the layer). */
export const PLANET_OCTAVES = {
  giantTurb: [4, 3, 2],
  height: [5, 3, 2],
  dunes: [3, 2, 0],
  lava: [3, 2, 1],
  veinWarp: [3, 2, 0],
  clouds: [4, 2, 0],
  cities: [3, 2, 0],
} as const;

const GIANTS = new Set(['gas', 'ice-giant']);
const CRATERED = new Set(['rocky', 'ice', 'shattered']);

export function planetSurface(p: PlanetPreset, o: SurfaceOptions): MeshBasicNodeMaterial {
  const kind = p.kind ?? 'gas';
  const seed = p.seed ?? 0;
  const lod = o.lod ?? 0;
  const oct = (k: keyof typeof PLANET_OCTAVES): number => PLANET_OCTAVES[k][lod];
  const giant = GIANTS.has(kind);
  const palette = buildPalette(p.bands, 512, giant);
  const ramp = getRamp('dramatic');
  const atmo: Node = uniform(new Color(p.atmosphere));
  const glow: Node = uniform(new Color(p.glow ?? '#000000'));
  const lightsCol: Node = uniform(new Color(p.lightColor ?? '#ffd08a'));
  const off = vec3(seed * 0.731 + 3.1, seed * 0.217 + 1.7, seed * 0.593 + 5.3);
  const off2 = vec3(seed * 0.389 + 11.3, seed * 0.911 + 2.9, seed * 0.157 + 7.7);

  const mat = new MeshBasicNodeMaterial();
  mat.name = `planet:${p.name}:lod${lod}`;
  mat.colorNode = Fn(() => {
    const P = normalize(positionLocal).toVar();
    let paint: Node;
    let land: Node = float(1);
    let lava: Node = float(0);
    let veins: Node = float(0);
    let cloud: Node = float(0);

    if (giant) {
      const turb = mx_fractal_noise_float(P.mul(vec3(2.2, 7.0, 2.2)).add(off), oct('giantTurb'), 2.0, 0.5);
      const bandU = P.y.mul(p.bandScale).add(turb.mul(p.turbulence)).add(0.5);
      paint = pow(texture(palette, vec2(bandU, 0.5)).rgb, vec3(2.2)).toVar();
      if (p.storm) {
        const st = stormFrame(p.storm);
        // Oval (wide in longitude), stepped swirl rings, inked rim.
        const q = P.sub(st.dir);
        const d = length(vec3(dot(q, st.t1), dot(q, st.t2).mul(1.9), dot(q, st.dir))).div(p.storm.size);
        const ang = atan(dot(q, st.t2), dot(q, st.t1));
        const swirl = fract(d.mul(2.6).add(ang.mul(0.16)).add(turb.mul(0.5)));
        const sc: Node = uniform(new Color(p.storm.color));
        const inside = float(1).sub(smoothstep(0.92, 0.97, d));
        const storm = mix(vec3(sc), vec3(sc).mul(0.72), step(0.5, swirl));
        paint.assign(mix(paint, storm, inside));
        const rim = smoothstep(0.9, 0.95, d).mul(float(1).sub(smoothstep(1.02, 1.1, d)));
        paint.mulAssign(float(1).sub(rim.mul(0.35)));
      }
    } else {
      // Height: low continents + detail, contrast by `turbulence`.
      const f = p.bandScale;
      const h0 = mx_fractal_noise_float(P.mul(f).add(off), oct('height'), 2.0, 0.5);
      const h = saturate(h0.mul(0.9 * p.turbulence).add(0.5)).toVar();
      if (kind === 'desert' && oct('dunes') > 0) {
        // Dune seas: wind-combed streaks along the latitude lines, not blotches.
        const streak = mx_fractal_noise_float(P.mul(vec3(f * 1.2, f * 9, f * 1.2)).add(off2), oct('dunes'), 2.0, 0.5);
        h.assign(saturate(h.mul(0.75).add(streak.mul(0.22)).add(0.12)));
      }
      if (CRATERED.has(kind) && lod < 2) {
        const w = mx_worley_noise_vec2(P.mul(f * 3.2).add(off2), 0.9);
        const f1 = sqrt(w.x);
        const floor = float(1).sub(smoothstep(0.24, 0.28, f1));
        const rim = smoothstep(0.27, 0.3, f1).mul(float(1).sub(smoothstep(0.31, 0.36, f1)));
        const k = kind === 'desert' ? 0.4 : 1;
        h.assign(h.sub(floor.mul(0.07 * k)).add(rim.mul(0.07 * k)));
      }
      paint = pow(texture(palette, vec2(saturate(h), 0.5)).rgb, vec3(2.2)).toVar();
      if (p.seaLevel !== undefined) land = step(p.seaLevel, h);
      if (p.caps !== undefined) {
        const cap = smoothstep(p.caps, p.caps + 0.015, abs(P.y).add(h.sub(0.5).mul(0.22)));
        paint.assign(mix(paint, vec3(0.9, 0.95, 1.0), cap));
        land = land.mul(float(1).sub(cap));
      }
      if (kind === 'volcanic' || kind === 'burning') {
        const r = float(1).sub(abs(mx_fractal_noise_float(P.mul(f * 2.4).add(off2), oct('lava'), 2.0, 0.5)));
        const cracks = smoothstep(kind === 'burning' ? 0.9 : 0.92, kind === 'burning' ? 0.93 : 0.95, r);
        const seas = kind === 'burning' ? float(1).sub(smoothstep(0.35, 0.37, h)) : float(0);
        lava = max(cracks, seas);
        paint.assign(mix(paint, vec3(glow).mul(0.55), lava));
      }
      if (kind === 'lantern') {
        if (lod < 2) {
          // Domain-warped cell edges: veins that wander like cracks in lacquer.
          const q = P.mul(f * 2.2).add(off2);
          const warp = mx_fractal_noise_vec3(q.mul(0.8), oct('veinWarp'), 2.0, 0.5).mul(0.55);
          const w = mx_worley_noise_vec2(q.add(warp), 1.0);
          const edge = sqrt(w.y).sub(sqrt(w.x));
          veins = float(1).sub(smoothstep(0.012, 0.035, edge));
        } else veins = float(0.12); // far: the veins' average glow, as a tint
        paint.assign(mix(paint, vec3(glow).mul(0.6), veins));
      }
      if (p.clouds && oct('clouds') === 0) {
        // Far: the deck's average cover as a flat veil (keeps the disc's tone).
        cloud = float(Math.min(0.6, p.clouds * 0.45));
      } else if (p.clouds) {
        const t = o.time.mul(0.004);
        const c = mx_fractal_noise_float(P.mul(vec3(2.4, 5.2, 2.4)).add(off2).add(vec3(t, 0, t.mul(0.6))), oct('clouds'), 2.0, 0.5).mul(0.5).add(0.5);
        const thr = 1 - p.clouds * 0.55;
        cloud = smoothstep(thr, thr + 0.02, c).mul(0.85).add(smoothstep(thr + 0.08, thr + 0.1, c).mul(0.15));
        if (p.storm && kind === 'ocean') {
          const st = stormFrame(p.storm);
          const q = P.sub(st.dir);
          const d = length(q).div(p.storm.size);
          const ang = atan(dot(q, st.t2), dot(q, st.t1));
          const arms = step(0.45, fract(ang.div(Math.PI * 2).mul(2).add(d.mul(1.6))));
          const disc = float(1).sub(smoothstep(0.9, 1.0, d));
          const eye = smoothstep(0.1, 0.15, d);
          cloud = max(cloud, disc.mul(arms.mul(0.7).add(0.3)).mul(eye));
        }
        const smoke = kind === 'burning';
        paint.assign(mix(paint, smoke ? vec3(0.16, 0.12, 0.11) : vec3(0.93, 0.95, 1.0), cloud));
      }
    }

    // ── light ──────────────────────────────────────────────────────────
    const N = normalize(normalWorld);
    const L = LightRig.keyDirection;
    const V = normalize(cameraPosition.sub(positionWorld));
    const ndl = dot(N, L);
    const lit = texture(ramp, vec2(ndl.mul(0.5).add(0.5), 0.5)).r;
    const lightColor = mix(LightRig.shadowTint.mul(0.62), LightRig.keyColor, lit);
    const col = paint.mul(lightColor).toVar();

    if (o.ring) {
      // Ray from the surface toward the key light, against the ring plane.
      const r = o.ring;
      const Pw = positionWorld;
      const denom = dot(L, r.normal);
      const safe = select(abs(denom).lessThan(1e-3), float(1e-3), denom);
      const t = dot(r.center.sub(Pw), r.normal).div(safe);
      const hit = Pw.add(L.mul(t));
      const u = length(hit.sub(r.center)).sub(r.inner).div(r.outer - r.inner);
      const a = texture(r.palette, vec2(saturate(u), 0.5)).a.mul(step(0.0, t)).mul(step(0.0, u)).mul(step(u, 1.0));
      col.mulAssign(float(1).sub(a.mul(lit).mul(0.62)));
    }

    if (!p.airless) {
      // Cel atmosphere: a hard band on the lit limb + a warm terminator line.
      const fres = float(1).sub(saturate(dot(N, V)));
      const band = smoothstep(0.66, 0.69, fres).mul(smoothstep(-0.2, 0.25, ndl));
      col.assign(mix(col, vec3(atmo).mul(0.95), band.mul(0.45)));
      const term = smoothstep(-0.07, -0.02, ndl).mul(float(1).sub(smoothstep(0.02, 0.07, ndl)));
      col.addAssign(vec3(atmo).mul(term).mul(0.14));
    }
    col.assign(min(col, vec3(0.97)));

    // ── emissive (night side reads hottest) ────────────────────────────
    const night = float(1).sub(smoothstep(-0.14, 0.06, ndl));
    if (p.lights && oct('cities') > 0) {
      const clusters = smoothstep(0.08, 0.3, mx_fractal_noise_float(P.mul(5.5).add(off2), oct('cities'), 2.0, 0.5));
      const dots = step(0.7, mx_cell_noise_float(P.mul(70).add(off)));
      const cities = clusters.mul(dots.add(clusters.mul(0.25))).mul(land).mul(float(1).sub(cloud.mul(0.8)));
      col.addAssign(vec3(lightsCol).mul(cities).mul(night).mul(2.4 * p.lights));
    } else if (p.lights) {
      // Far: the night side's average city glow.
      col.addAssign(vec3(lightsCol).mul(land).mul(night).mul(0.18 * p.lights));
    }
    if (kind === 'volcanic' || kind === 'burning') col.addAssign(vec3(glow).mul(lava).mul(night.mul(1.5).add(kind === 'burning' ? 0.45 : 0.2)));
    if (kind === 'lantern') col.addAssign(vec3(glow).mul(veins).mul(night.mul(2.2).add(0.6)));
    return col;
  })();
  mat.mrtNode = inkMRT(0.85, o.inkId, 0.2);
  return mat;
}

function stormFrame(s: NonNullable<PlanetPreset['storm']>): { dir: Node; t1: Node; t2: Node } {
  const y = Math.max(-0.95, Math.min(0.95, s.lat));
  const r = Math.sqrt(1 - y * y);
  const d = new Vector3(r * Math.cos(s.lon), y, r * Math.sin(s.lon)).normalize();
  const t1 = new Vector3().crossVectors(new Vector3(0, 1, 0), d).normalize();
  const t2 = new Vector3().crossVectors(d, t1).normalize();
  return { dir: vec3(d.x, d.y, d.z), t1: vec3(t1.x, t1.y, t1.z), t2: vec3(t2.x, t2.y, t2.z) };
}
