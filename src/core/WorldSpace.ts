import { Group, Vector3, type Camera, type Scene } from 'three';

/**
 * Camera-relative rendering (floating origin), designed in from day one.
 *
 * Universe positions live in JS numbers (float64) — enough for millimetres
 * at interplanetary range. The GPU only ever sees positions relative to the
 * eye: every universe-positioned object goes under `root`, the render camera
 * sits at the origin, and `root` is offset by −eye. three composes matrices
 * in float64 on the CPU, so the float32 matrices uploaded to the GPU contain
 * small, precise numbers near the camera — no jitter on a 3 km dreadnought
 * 100 000 km from the system origin.
 *
 * Rule: never put a universe-positioned object directly in the Scene. Things
 * that are camera-locked (sky dome, space dust, HUD geometry) go in the
 * Scene directly, in eye-relative coordinates.
 */
export class WorldSpace {
  readonly root = new Group();
  /** Universe position of the eye (float64). */
  readonly eye = new Vector3();

  constructor(scene: Scene) {
    this.root.name = 'world-root';
    scene.add(this.root);
  }

  /** Call once per frame after `eye` is final and before rendering. */
  sync(camera: Camera): void {
    this.root.position.copy(this.eye).negate();
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
  }

  /** Universe → eye-relative (render) coordinates. */
  toRender(universe: Vector3, out = new Vector3()): Vector3 {
    return out.subVectors(universe, this.eye);
  }
}
