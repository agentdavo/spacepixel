import { wgslFn } from 'three/tsl';
import type { ShaderNode } from '@/render/tsl';

const fn = (code: string, includes: ShaderNode[] = []): ShaderNode => wgslFn(code, includes);

/**
 * Milestone 3 — hand-written WGSL ink-line edge detector.
 *
 * Reads the G-buffer written by every material (see InkChannels.ts) with
 * integer `textureLoad`s (no filtering, no sampler) and combines three line
 * sources, each tuned for a different job:
 *
 *  1. SILHOUETTES — Laplacian of *inverse* linear depth. 1/z is linear in
 *     screen space for any plane, so flat hull plating produces exactly zero
 *     response at any viewing angle; only true depth discontinuities and
 *     folds fire. Only the near side of a jump is inked. Normalised by the local inverse depth so a 12 m fighter and
 *     a 3 km dreadnought get identical line weight. Sampled at a wider radius
 *     so outer contours read heavier than interior detail (as in hand-inked
 *     cels).
 *  2. CREASES — normal discontinuities between neighbours (hard edges on
 *     hull panels, wing roots).
 *  3. REGIONS — hashed per-part region ids; a line appears where paint /
 *     part ids change, giving mechanical panel lining with zero geometry.
 *
 * "Line boil": the sampling radius wobbles with low-frequency noise that
 * re-seeds on a stepped clock (animation "on twos"), recreating the subtle
 * shimmer of hand-traced cels.
 *
 * Output: vec4(finalEdge, silhouette, crease, region) — the last three feed
 * the debug view.
 */

const inkHash21 = fn(/* wgsl */ `
fn inkHash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + vec3<f32>(33.33));
  return fract((p3.x + p3.y) * p3.z);
}
`);

const inkValueNoise = fn(
  /* wgsl */ `
fn inkValueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
  let a = inkHash21(i);
  let b = inkHash21(i + vec2<f32>(1.0, 0.0));
  let c = inkHash21(i + vec2<f32>(0.0, 1.0));
  let d = inkHash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`,
  [inkHash21],
);

/** Load a G-buffer texel → (unpacked view normal, inverse depth). Sky/empty → 1/z = 0. */
const inkLoadG = fn(/* wgsl */ `
fn inkLoadG(tex: texture_2d<f32>, p: vec2<i32>, dims: vec2<i32>) -> vec4<f32> {
  let q = clamp(p, vec2<i32>(0), dims - vec2<i32>(1));
  let g = textureLoad(tex, q, 0);
  let invZ = select(0.0, 1.0 / g.a, g.a > 0.0);
  let n = g.rgb * 2.0 - vec3<f32>(1.0);
  return vec4<f32>(n * inverseSqrt(max(dot(n, n), 1e-6)), invZ);
}
`);

const inkLoadI = fn(/* wgsl */ `
fn inkLoadI(tex: texture_2d<f32>, p: vec2<i32>, dims: vec2<i32>) -> vec2<f32> {
  let q = clamp(p, vec2<i32>(0), dims - vec2<i32>(1));
  return textureLoad(tex, q, 0).rg;
}
`);

/** Evaluate one symmetric sampling axis. Returns (silhouette, crease, region). */
const inkAxis = fn(
  /* wgsl */ `
fn inkAxis(
  gbuf: texture_2d<f32>, ink: texture_2d<f32>, dims: vec2<i32>,
  px: vec2<f32>, dir: vec2<f32>, rSil: f32, rCrease: f32,
  C: vec4<f32>, CI: vec2<f32>, params: vec4<f32>
) -> vec3<f32> {
  // --- silhouette: Laplacian of inverse depth along this axis ---
  let pa = vec2<i32>(floor(px + dir * rSil));
  let pb = vec2<i32>(floor(px - dir * rSil));
  let A = inkLoadG(gbuf, pa, dims);
  let B = inkLoadG(gbuf, pb, dims);
  let IA = inkLoadI(ink, pa, dims);
  let IB = inkLoadI(ink, pb, dims);
  let lap = abs(A.w + B.w - 2.0 * C.w) / max(max(C.w, max(A.w, B.w)), 1e-7);
  // Ink only the NEAR side of a depth jump (larger 1/z): contours sit inside
  // the silhouette, so thin distant craft never grow detached halo lines.
  let nearSide = step(max(A.w, B.w) * 0.98, C.w);
  let wSil = max(CI.x, max(IA.x, IB.x)) * nearSide;
  let sil = smoothstep(params.y, params.y * 2.5, lap) * wSil;

  // --- creases + regions at the tighter radius ---
  let qa = vec2<i32>(floor(px + dir * rCrease));
  let qb = vec2<i32>(floor(px - dir * rCrease));
  let A2 = inkLoadG(gbuf, qa, dims);
  let B2 = inkLoadG(gbuf, qb, dims);
  let IA2 = inkLoadI(ink, qa, dims);
  let IB2 = inkLoadI(ink, qb, dims);
  // Interior lines only where *all* samples are inked surfaces.
  let wIn = min(CI.x, min(IA2.x, IB2.x));
  let bend = max(1.0 - dot(C.xyz, A2.xyz), 1.0 - dot(C.xyz, B2.xyz));
  let crease = smoothstep(params.z, params.z * 1.8, bend) * wIn;
  let idDelta = max(abs(CI.y - IA2.y), abs(CI.y - IB2.y));
  let region = step(params.w, idDelta) * wIn;

  return vec3<f32>(sil, crease, region);
}
`,
  [inkLoadG, inkLoadI],
);

export const inkEdgeWGSL = fn(
  /* wgsl */ `
fn inkEdge(
  gbuf: texture_2d<f32>,
  ink: texture_2d<f32>,
  uv: vec2<f32>,
  params: vec4<f32>,
  params2: vec4<f32>
) -> vec4<f32> {
  // params : x = line radius (px), y = silhouette threshold,
  //          z = crease threshold, w = region-id threshold
  // params2: x = silhouette radius multiplier, y = boil amount,
  //          z = boil seed (stepped time), w = boil frequency (px)
  let dims = vec2<i32>(textureDimensions(gbuf));
  let px = uv * vec2<f32>(dims);

  let seed = params2.z;
  let wob = inkValueNoise(px / params2.w + vec2<f32>(seed * 17.13, seed * 5.71)) - 0.5;
  let r = max(params.x * (1.0 + wob * params2.y), 0.75);
  let rSil = r * params2.x;

  let center = vec2<i32>(floor(px));
  let C = inkLoadG(gbuf, center, dims);
  let CI = inkLoadI(ink, center, dims);

  let e0 = inkAxis(gbuf, ink, dims, px, vec2<f32>(1.0, 0.0), rSil, r, C, CI, params);
  let e1 = inkAxis(gbuf, ink, dims, px, vec2<f32>(0.0, 1.0), rSil, r, C, CI, params);
  let e2 = inkAxis(gbuf, ink, dims, px, vec2<f32>(0.7071, 0.7071), rSil, r, C, CI, params);
  let e3 = inkAxis(gbuf, ink, dims, px, vec2<f32>(0.7071, -0.7071), rSil, r, C, CI, params);
  let e = max(max(e0, e1), max(e2, e3));

  let edge = clamp(max(e.x, max(e.y, e.z)), 0.0, 1.0);
  return vec4<f32>(edge, e.x, e.y, e.z);
}
`,
  [inkValueNoise, inkLoadG, inkLoadI, inkAxis],
);
