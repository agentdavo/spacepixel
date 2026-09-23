import type { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { postFx } from '@/render/post/PostFx';
import type { SetPieceKind, SetPieceSpec } from '@/game/campaign/types';

/**
 * Per-frame facts a set piece needs. All positions are UNIVERSE positions
 * (float64); the render camera sits at the origin (see WorldSpace).
 *
 * Call `update` after the host scene has written its own postFx values for
 * the frame (boost/jump/flash): set pieces add to them, they don't own them.
 */
export interface SetPieceFrame {
  dt: number;
  time: number;
  /** Universe position of the render eye (WorldSpace.eye). */
  eye: Vector3;
  playerPos: Vector3;
  playerVel: Vector3;
  flags: Set<string>;
  setFlag(f: string): void;
  postFx: typeof postFx;
  camera: PerspectiveCamera;
  scene: Scene;
}

export interface SetPiece {
  readonly tag: string;
  readonly kind: SetPieceKind;
  /** Universe-positioned; the host parents it under WorldSpace.root. */
  readonly group: Group;
  /** Universe centre (float64). */
  readonly position: Vector3;
  /** Interaction radius, metres. */
  readonly radius: number;
  update(ctx: SetPieceFrame): void;
  /** Remove from the scene graph, free GPU resources and withdraw every postFx contribution. */
  dispose(): void;
  /** Test/scripting hook: jump a scripted timeline to `t` seconds (pilgrimage, bastion attack). */
  debugSeek?(t: number): void;
}

export type SetPieceParams = NonNullable<SetPieceSpec['params']>;

export function num(p: SetPieceParams | undefined, key: string, def: number): number {
  const v = p?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def;
}

export function str(p: SetPieceParams | undefined, key: string, def: string): string {
  const v = p?.[key];
  return typeof v === 'string' ? v : def;
}

export function bool(p: SetPieceParams | undefined, key: string, def: boolean): boolean {
  const v = p?.[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return def;
}
