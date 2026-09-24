import type { PerspectiveCamera, Scene } from 'three';
import type { FrameContext } from '@/core/Engine';

/**
 * A bootable scene. Kept deliberately small: the engine calls update() once
 * per frame, then renders `scene` through `camera` with the ink pipeline.
 */
export interface GameScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  update(ctx: FrameContext): void;
  resize(width: number, height: number): void;
  /** Optional: cycle debug/cinematic camera shots (HUD key C). */
  cycleCamera?(): void;
  /** Optional: short label for the HUD corner. */
  cameraLabel?(): string;
  /** Optional: tear down DOM / listeners / stage objects when the host swaps scenes. */
  dispose?(): void;
  /** Optional: begin a mission (flight scenes). */
  startMission?(mission: import('@/game/Missions').MissionDef): void;
}
