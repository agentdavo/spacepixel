import { abs, dot, floor, max, select, vec2, vec4 } from 'three/tsl';
import type { ShaderNode } from '@/render/tsl';

/**
 * Two-lattice nearest-centre hex lookup shared by shield shells and particles.
 * TSL builds the same formula for WebGPU and WebGL2; raw WGSL in WeaponVisuals
 * previously reached the GLSL parser during compatibility-mode shield draws.
 * Returns vec4(edge distance, cell centre xy, 0).
 */
export function fxHex({ p }: { p: ShaderNode }): ShaderNode {
  const s = vec2(1.0, 1.7320508);
  const hC = floor(vec4(p, p.sub(vec2(0.5, 1.0))).div(vec4(s, s))).add(0.5).toVar();
  const h = vec4(p.sub(hC.xy.mul(s)), p.sub(hC.zw.add(0.5).mul(s))).toVar();
  const useA = dot(h.xy, h.xy).lessThan(dot(h.zw, h.zw));
  const local = select(useA, h.xy, h.zw);
  const cell = select(useA, hC.xy.mul(s), hC.zw.add(0.5).mul(s));
  const q = abs(local);
  return vec4(max(dot(q, vec2(0.5, 0.8660254)), q.x), cell, 0.0);
}
