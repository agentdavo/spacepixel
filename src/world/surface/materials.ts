import { BackSide, Color, DoubleSide, type DataTexture } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  attribute,
  cameraPosition,
  dot,
  float,
  floor,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { inkMRT, noInkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';

/**
 * Surface-scene materials (planetary ports), in the OVA background painter's
 * vocabulary: flat stepped paint, one hard terminator, never shaded smooth.
 * Linear depth goes to the G-buffer in km like everything else, so the ink
 * pass outlines ridges and towers at metre scale exactly as it does hulls;
 * aerial perspective comes from the post pass's depth fog (postFx.fog, set
 * by SurfaceWorld to the horizon colour), not from the space haze.
 */

/** Sky tones from a planet's atmosphere colour (sRGB hex in, linear Colors out). */
export function skyTones(atmosphere: string): { zenith: Color; horizon: Color; haze: Color; cloud: Color; cloudShade: Color } {
  const a = new Color(atmosphere);
  const hsl = { h: 0, s: 0, l: 0 };
  a.getHSL(hsl);
  const zenith = new Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.1), Math.max(0.18, hsl.l * 0.52));
  const horizon = new Color().setHSL(hsl.h, hsl.s * 0.55, Math.min(0.9, hsl.l * 0.55 + 0.42));
  const haze = horizon.clone().lerp(new Color('#ffffff'), 0.15);
  const cloud = new Color().setHSL(hsl.h, hsl.s * 0.25, 0.93);
  const cloudShade = new Color().setHSL((hsl.h + 0.62) % 1, Math.min(0.5, hsl.s * 0.5 + 0.12), 0.58);
  return { zenith, horizon, haze, cloud, cloudShade };
}

/**
 * Camera-locked sky dome: stepped bands from the horizon to the zenith, a
 * cel sun disc with a hard halo. Never inked, never fogged (G-buffer 0).
 */
export function skyMaterial(zenith: Color, horizon: Color): MeshBasicNodeMaterial {
  const zen: Node = uniform(zenith.clone());
  const hor: Node = uniform(horizon.clone());
  const m = new MeshBasicNodeMaterial();
  m.name = 'SurfaceSky';
  m.side = BackSide;
  m.depthWrite = false;
  m.colorNode = Fn(() => {
    const d: Node = normalize(positionLocal);
    const y: Node = max(d.y, 0);
    // Four painted bands, the horizon one widest.
    const k: Node = floor(pow(y, 0.55).mul(4.0).add(0.35)).div(4.0);
    const col: Node = mix(vec3(hor), vec3(zen), k).toVar();
    const sun: Node = dot(d, LightRig.keyDirection);
    col.addAssign(vec3(LightRig.keyColor).mul(smoothstep(0.9975, 0.9985, sun).mul(5.0)));
    col.addAssign(vec3(LightRig.keyColor).mul(step(0.985, sun).mul(0.22)));
    col.addAssign(vec3(hor).mul(smoothstep(0.8, 1.0, sun).mul(0.25)));
    return col;
  })();
  m.mrtNode = noInkMRT();
  return m;
}

/**
 * The ground: palette lookup by h01 (the planet's own hard-stepped ramp, so
 * the contour bands are the planet's), a hard cel terminator, cel glints on
 * water, emissive lava / veins.
 */
export function groundMaterial(palette: DataTexture, opts: { glow?: string; inkId: number; clock: Node; cloudSea?: boolean }): MeshBasicNodeMaterial {
  const glow: Node = uniform(new Color(opts.glow ?? '#000000'));
  const m = new MeshBasicNodeMaterial();
  m.name = 'SurfaceGround';
  m.colorNode = Fn(() => {
    const h01: Node = attribute('h01', 'float');
    const wet: Node = attribute('wet', 'float');
    const gl: Node = attribute('glow', 'float');
    const paint: Node = pow(texture(palette, vec2(h01, 0.5)).rgb, vec3(2.2));
    const N: Node = normalize(normalWorld);
    const L: Node = LightRig.keyDirection;
    const ndl: Node = dot(N, L);
    const lit: Node = smoothstep(0.1, 0.16, ndl);
    const light: Node = mix(vec3(LightRig.shadowTint).mul(0.85).add(0.12), vec3(LightRig.keyColor), lit);
    const col: Node = paint.mul(light).toVar();
    // Water: flat, with hard cel glints where the sun reflects.
    const V: Node = normalize(cameraPosition.sub(positionWorld));
    const R: Node = reflect(V.negate(), N);
    const ripple: Node = sin(positionLocal.x.mul(0.05).add(positionLocal.z.mul(0.031)).add(opts.clock.mul(1.3))).mul(0.5).add(0.5);
    const glint: Node = step(0.992, dot(R, L)).mul(step(0.35, ripple)).mul(step(0.02, wet));
    col.addAssign(vec3(LightRig.specColor).mul(glint.mul(1.6)));
    // Lava cracks / black-light veins: emissive (bloom picks them up).
    col.addAssign(vec3(glow).mul(gl.mul(2.2)));
    return col;
  })();
  // Light ink (ridges read, no panel lines on a single region), no space haze.
  m.mrtNode = inkMRT(opts.cloudSea ? 0 : 0.45, opts.inkId, 0);
  return m;
}

/**
 * Cloud deck seen from below (or from above on the way through): fBm
 * coverage cut hard (gaps show the sky), two painted tones — lit edges and a
 * cool shadow underside — and a silver line along every edge. Opaque, so the
 * depth fog melts the far deck into the horizon. Never inked.
 */
export function deckMaterial(cloud: Color, shade: Color, cover: number, seed: number): MeshBasicNodeMaterial {
  const c1: Node = uniform(cloud.clone());
  const c2: Node = uniform(shade.clone());
  const m = new MeshBasicNodeMaterial();
  m.name = 'CloudDeck';
  m.side = DoubleSide;
  m.colorNode = Fn(() => {
    const p: Node = positionLocal.xy.mul(1 / 5200).add(seed * 0.37);
    const n: Node = mx_fractal_noise_float(vec3(p, float(seed * 0.11)), 5, 2.0, 0.5);
    const cut: Node = float(0.5 - cover);
    If(n.lessThan(cut.mul(0.6)), () => {
      Discard();
    });
    const edge: Node = smoothstep(cut.mul(0.6), cut.mul(0.6).add(0.05), n);
    const dense: Node = step(cut.mul(0.6).add(0.14), n);
    const col: Node = mix(vec3(c1), vec3(c2), dense.mul(0.75));
    return mix(vec3(1.0, 1.0, 1.0).mul(1.08), col, edge);
  })();
  m.mrtNode = inkMRT(0, 0, 0);
  return m;
}

/** The entry veil: the planet's air, denser toward the planet (local −Y), camera-centred, BackSide. */
export function veilMaterial(color: Color): { mat: MeshBasicNodeMaterial; opacity: Node; color: Node } {
  const opacity: Node = uniform(0);
  const col: Node = uniform(color.clone());
  const m = new MeshBasicNodeMaterial();
  m.name = 'EntryVeil';
  m.side = BackSide;
  m.transparent = true;
  m.depthWrite = false;
  m.colorNode = Fn(() => {
    const d: Node = normalize(positionLocal);
    // Denser toward the planet (−up in the veil's frame), thinner overhead.
    const k: Node = smoothstep(-0.6, 0.9, d.y.negate());
    // Saturated toward the planet (the air band), deeper overhead.
    const c: Node = vec3(col);
    return mix(c.mul(0.45), c.mul(1.15), k);
  })();
  m.opacityNode = Fn(() => {
    const d: Node = normalize(positionLocal);
    return opacity.mul(mix(0.55, 1.0, smoothstep(-0.8, 0.6, d.y.negate())));
  })();
  m.mrtNode = noInkMRT();
  return { mat: m, opacity, color: col };
}
