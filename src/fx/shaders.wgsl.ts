import { wgslFn } from 'three/tsl';
import type { ShaderNode } from '@/render/tsl';

/**
 * Hexagonal cell lookup for the shield-hit ripple (hand-written WGSL: the
 * two-lattice nearest-centre trick is branchy and awkward to express in TSL).
 *
 * Returns vec4(edge, centre.x, centre.y, 0):
 *   edge    hex distance from the cell centre (0 at centre, 0.5 on the border)
 *   centre  cell centre in the input's coordinate space
 */
export const fxHex: ShaderNode = wgslFn(/* wgsl */ `
fn fxHex(p: vec2<f32>) -> vec4<f32> {
  let s = vec2<f32>(1.0, 1.7320508);
  let hC = floor(vec4<f32>(p, p - vec2<f32>(0.5, 1.0)) / vec4<f32>(s, s)) + vec4<f32>(0.5);
  let h = vec4<f32>(p - hC.xy * s, p - (hC.zw + vec2<f32>(0.5)) * s);
  let useA = dot(h.xy, h.xy) < dot(h.zw, h.zw);
  let local = select(h.zw, h.xy, useA);
  let cell = select((hC.zw + vec2<f32>(0.5)) * s, hC.xy * s, useA);
  let q = abs(local);
  let e = max(dot(q, vec2<f32>(0.5, 0.8660254)), q.x);
  return vec4<f32>(e, cell, 0.0);
}
`);
