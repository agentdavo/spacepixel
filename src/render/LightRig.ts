import { Color, Vector3 } from 'three';
import { uniform } from 'three/tsl';
import type { ShaderNode } from './tsl';

/**
 * The global cel lighting rig. OVA space scenes are lit like a stage: one hard
 * key "sun", a coloured ambient that paints the shadow side, and a stark rim
 * light (usually the nebula or a nearby planet) that carves silhouettes out of
 * the dark. Every CelMaterial reads these shared uniforms, so a whole star
 * system can be re-lit by swapping a single preset.
 */
export interface LightPreset {
  name: string;
  keyDirection: Vector3; // direction the light travels *from* (towards the light)
  keyColor: Color;
  keyIntensity: number;
  shadowTint: Color; // colour of the shadow band (anime shadows are never grey)
  rimDirection: Vector3;
  rimColor: Color;
  rimIntensity: number;
  specColor: Color;
}

export const LIGHT_PRESETS: Record<string, LightPreset> = {
  // Home system: warm yellow-white sun, violet shadows, cyan nebula rim.
  meridian: {
    name: 'Meridian Prime',
    keyDirection: new Vector3(0.55, 0.62, 0.35).normalize(),
    keyColor: new Color('#fff4de'),
    keyIntensity: 1.0,
    shadowTint: new Color('#4a3f7a'),
    rimDirection: new Vector3(-0.6, 0.15, -0.8).normalize(),
    rimColor: new Color('#7fe8ff'),
    rimIntensity: 0.9,
    specColor: new Color('#ffffff'),
  },
  // Choir-held space: red dwarf key, deep maroon shadows, magenta rim.
  hesper: {
    name: 'Hesper Deep',
    keyDirection: new Vector3(-0.4, 0.5, 0.6).normalize(),
    keyColor: new Color('#ffc9a8'),
    keyIntensity: 0.95,
    shadowTint: new Color('#3b1e3f'),
    rimDirection: new Vector3(0.7, -0.1, -0.7).normalize(),
    rimColor: new Color('#ff5fd2'),
    rimIntensity: 1.0,
    specColor: new Color('#ffe6f4'),
  },
};

class LightRigImpl {
  readonly keyDirection: ShaderNode = uniform(new Vector3(0, 1, 0));
  readonly keyColor: ShaderNode = uniform(new Color());
  readonly shadowTint: ShaderNode = uniform(new Color());
  readonly rimDirection: ShaderNode = uniform(new Vector3(0, 0, -1));
  readonly rimColor: ShaderNode = uniform(new Color());
  readonly specColor: ShaderNode = uniform(new Color());
  current: LightPreset = LIGHT_PRESETS.meridian;

  constructor() {
    this.apply(LIGHT_PRESETS.meridian);
  }

  apply(p: LightPreset): void {
    this.current = p;
    this.keyDirection.value.copy(p.keyDirection).normalize();
    this.keyColor.value.copy(p.keyColor).multiplyScalar(p.keyIntensity);
    this.shadowTint.value.copy(p.shadowTint);
    this.rimDirection.value.copy(p.rimDirection).normalize();
    this.rimColor.value.copy(p.rimColor).multiplyScalar(p.rimIntensity);
    this.specColor.value.copy(p.specColor);
  }
}

export const LightRig = new LightRigImpl();
