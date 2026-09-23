import { PerspectiveCamera, Scene } from 'three';
import type { GameScene } from '../GameScene';
import { Backdrop } from '../Backdrop';

/** Placeholder — replaced by the owning milestone. */
export class SpatialTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 16 / 9, 0.5, 1_200_000);
  private backdrop = new Backdrop();
  constructor() {
    this.scene.add(this.backdrop.group);
  }
  update(): void {
    this.backdrop.follow(this.camera);
  }
  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
