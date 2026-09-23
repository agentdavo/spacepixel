import { mrt, output, vec4, float, normalView, positionView, packNormalToRGB, fract } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { MaterialBlending } from 'three';
import { BlendMode } from 'three/webgpu';

const MATERIAL_BLEND = new BlendMode(MaterialBlending);

/**
 * Multiple-render-target layout shared by every material and the ink pass.
 *
 *   output  rgba  lit cel colour (HDR)
 *   gbuf    rgb   view-space normal packed to 0..1
 *           a     linear view depth in kilometres (DEPTH_SCALE). Independent of
 *                 the reversed-Z hardware buffer. Half floats keep ~0.05%
 *                 relative precision at any magnitude, and km units keep a
 *                 gas giant 400 000 m away inside half-float range.
 *   ink     r     ink weight   (0 = never outlined, e.g. sky/glows; 1 = full)
 *           g     region id    (hashed; lines are drawn where ids change, which
 *                               gives hard-surface panel lining for free)
 *           b     haze factor  (how much aerial perspective applies)
 *
 * Materials override only the `ink` channel via `material.mrtNode`, the rest
 * is provided by the scene pass defaults below.
 */
export const DEPTH_SCALE = 0.001;

export function sceneMRT() {
  const m = mrt({
    output,
    gbuf: vec4(packNormalToRGB(normalView), positionView.z.negate().mul(DEPTH_SCALE)),
    ink: vec4(1.0, 0.0, 1.0, 1.0),
  });
  // three only blends MRT attachments that opt in. Without this, additive /
  // alpha effects (which write alpha 0 via noInkMRT) would OVERWRITE the
  // G-buffer with zeros and get traced as black ink. Opaque materials have no
  // blend state, so they still overwrite as intended.
  m.setBlendMode('gbuf', MATERIAL_BLEND);
  m.setBlendMode('ink', MATERIAL_BLEND);
  return m;
}

/** Hash an integer-ish id into a well-separated 0..1 code (golden ratio walk). */
export function hashInkId(id: Node | number): Node {
  const n = typeof id === 'number' ? float(id) : id;
  return fract(n.mul(0.6180339887).add(0.1234));
}

/** Material-level override of the ink channel. */
export function inkMRT(weight: Node | number, regionId: Node | number, haze: Node | number = 1) {
  const w = typeof weight === 'number' ? float(weight) : weight;
  const h = typeof haze === 'number' ? float(haze) : haze;
  return mrt({ ink: vec4(w, hashInkId(regionId), h, 1.0) });
}

/** For additive/transparent effects: contribute nothing to gbuf/ink. */
export function noInkMRT() {
  return mrt({ gbuf: vec4(0.0), ink: vec4(0.0) });
}
