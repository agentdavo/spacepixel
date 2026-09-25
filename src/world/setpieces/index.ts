import type { Vector3 } from 'three';
import type { SetPieceSpec } from '@/game/campaign/types';
import type { SetPiece } from './types';
import { Monolith } from './Monolith';
import { MegaGate } from './MegaGate';
import { Derelict } from './Derelict';
import { BlackBox } from './BlackBox';
import { Beacon } from './Beacon';
import { Wreckage } from './Wreckage';
import { Nebula } from './Nebula';
import { Bastion } from './Bastion';
import { Pilgrimage } from './Pilgrimage';
import { KessenCameo } from './KessenCameo';

export type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
export { Monolith, MegaGate, Derelict, BlackBox, Beacon, Wreckage, Nebula, Bastion, Pilgrimage };

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
    case 'kessen-cameo':
      // Preview-only until visual review; the replay boot query preserves this
      // presentation toggle. The disabled piece allocates no render assets.
      return new KessenCameo(spec.tag, anchor, p, typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('kessenCameos') === '1');
    case 'monolith':
      return new Monolith(spec.tag, anchor, p);
    case 'megagate':
      return new MegaGate(spec.tag, anchor, p);
    case 'derelict':
      return new Derelict(spec.tag, anchor, p);
    case 'blackbox':
      return new BlackBox(spec.tag, anchor, p);
    case 'beacon':
      return new Beacon(spec.tag, anchor, p);
    case 'wreckage':
      return new Wreckage(spec.tag, anchor, p);
    case 'nebula':
      return new Nebula(spec.tag, anchor, p);
    case 'bastion':
      return new Bastion(spec.tag, anchor, p);
    case 'pilgrimage':
      return new Pilgrimage(spec.tag, anchor, p);
    default: {
      const k: never = spec.kind;
      throw new Error(`createSetPiece: unknown kind "${String(k)}"`);
    }
  }
}
