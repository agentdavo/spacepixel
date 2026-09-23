import type { Vector3 } from 'three';
import type { SetPieceSpec } from '@/game/campaign/types';
import type { SetPiece } from './types';
import { Monolith } from './Monolith';
import { MegaGate } from './MegaGate';

export type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
export { Monolith, MegaGate };

/**
 * Build a narrative set piece from mission data. `anchor` is the universe
 * position the runtime resolved from `spec.place`. The caller parents
 * `piece.group` under `WorldSpace.root`, calls `update()` every frame (after
 * the scene has written its own postFx for the frame) and `dispose()` when
 * the mission ends.
 */
export function createSetPiece(spec: SetPieceSpec, anchor: Vector3): SetPiece {
  const p = spec.params;
  switch (spec.kind) {
    case 'monolith':
      return new Monolith(spec.tag, anchor, p);
    case 'megagate':
      return new MegaGate(spec.tag, anchor, p);
    default:
      throw new Error(`createSetPiece: kind "${spec.kind}" not implemented`);
  }
}
