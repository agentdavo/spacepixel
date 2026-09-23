import { MaterialBlending, type Object3D } from 'three';
import { BlendMode, type Renderer } from 'three/webgpu';

const MATERIAL_BLEND = new BlendMode(MaterialBlending);

/**
 * Blended effects (additive dust, alpha haze, plumes) use `noInkMRT()`, which writes
 * vec4(0) into `gbuf` and `ink`. three's WebGPU backend only blends MRT
 * attachments whose blend mode is set on the *active* MRT node — by default
 * just `output` — so every other attachment is overwritten, not added to. A
 * dust streak then stamps depth = 0 onto the G-buffer and the ink pass traces
 * it as a silhouette (black dashes across any hull behind it).
 *
 * Opting `gbuf`/`ink` into material blending fixes it: opaque materials still
 * have no blend state (they overwrite as before); blended ones write alpha 0
 * there, so both additive and alpha blending leave the G-buffer untouched.
 * Pipelines capture the blend state when created, so this runs from the
 * object's onBeforeRender — before its pipeline is built.
 *
 * TODO(lead): the proper home is `sceneMRT()` in InkChannels.ts
 * (`.setBlendMode('gbuf', …)` / `'ink'`), which would also fix GlowMaterial.
 */
export function useBlendedMRT(object: Object3D): void {
  object.onBeforeRender = (renderer) => {
    const mrt = (renderer as unknown as Renderer).getMRT();
    if (mrt && mrt.blendModes.gbuf === undefined) {
      mrt.setBlendMode('gbuf', MATERIAL_BLEND);
      mrt.setBlendMode('ink', MATERIAL_BLEND);
    }
  };
}
