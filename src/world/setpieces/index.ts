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
import { KessenCameo, kessenCameosEnabled } from './KessenCameo';

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
      // Accepted EP10/19 cameos default on; explicit 0 keeps an A/B debug path.
      // The replay boot query preserves the toggle; off allocates no assets.
      return new KessenCameo(spec.tag, anchor, p, kessenCameosEnabled(typeof window === 'undefined' ? '' : window.location.search));
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
