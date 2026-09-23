import { Group, Mesh, Vector3 } from 'three';
import type { Blueprint } from '@/assets/Blueprint';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num, str } from './types';
import { LightPoints, LIGHT_PULSE, LIGHT_STROBE, type LightSpec } from './LightPoints';
import { seedOf } from './util';

function beaconBlueprint(light: string): Blueprint {
  return {
    id: 'setpiece-beacon',
    name: 'Nav Buoy',
    designation: 'SURVEY BEACON',
    faction: 'concord',
    shipClass: 'interceptor',
    scale: 1,
    ramp: 'classic',
    engines: [],
    parts: [
      // Mast along +Y (loft along Z rotated up).
      { name: 'mast', paint: 'primary', rot: [-90, 0, 0], shape: { kind: 'loft', stations: [{ z: -6, w: 1.4, h: 1.4, c: 0.35 }, { z: 5, w: 0.8, h: 0.8, c: 0.2 }] } },
      { name: 'base', paint: 'secondary', pos: [0, -6.4, 0], shape: { kind: 'box', w: 3.2, h: 1.2, d: 3.2, c: 0.5 } },
      { name: 'band', paint: 'accent', pos: [0, -2, 0], shape: { kind: 'box', w: 1.36, h: 0.5, d: 1.36, c: 0.33 } },
      { name: 'band2', paint: 'accent', pos: [0, 2.5, 0], shape: { kind: 'box', w: 1.02, h: 0.4, d: 1.02, c: 0.25 } },
      { name: 'vane', paint: 'dark', pos: [0, -3.8, 0], rot: [0, 0, 0], shape: { kind: 'wing', root: 2.4, tip: 1.6, span: 4.2, sweep: 0.4, thickness: 0.08, bevel: 0 }, repeat: { count: 3, rot: [0, 120, 0] } },
      { name: 'vane-frame', paint: 'metal', pos: [0, -3.7, 0], shape: { kind: 'box', w: 8.6, h: 0.12, d: 0.12 }, repeat: { count: 3, rot: [0, 60, 0] } },
      { name: 'dish', paint: 'metal', pos: [0, 3.6, 0.7], rot: [-60, 0, 0], shape: { kind: 'lathe', profile: [[0.05, -0.2], [0.9, 0.1], [1.2, 0.35]], segments: 14 } },
      { name: 'lamp', paint: 'glass', emissive: 1.4, color: light, pos: [0, 5.4, 0], shape: { kind: 'dome', radius: 0.5, segments: 12 } },
      { name: 'lamp-cage', paint: 'metal', pos: [0, 5.4, 0], rot: [0, 45, 0], shape: { kind: 'rib', radius: 0.62, thickness: 0.06, depth: 0.08, arc: 360, segments: 12 }, repeat: { count: 2, rot: [0, 90, 0] } },
    ],
  };
}

/**
 * Nav point / survey buoy (~13 m): a slowly turning mast with solar vanes,
 * a dish and a pulsing lamp that stays readable at range (screen-size
 * clamped), with a ring of small strobes. The HUD draws `label`.
 *
 * Params: `label` (string), `color` (lamp, default '#ffd23a'),
 * `radius` (interaction radius m, default 200).
 */
export class Beacon implements SetPiece {
  readonly kind: SetPieceKind = 'beacon';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  readonly label: string;
  private readonly model: ShipModel;
  private readonly lights: LightPoints;
  private readonly spin: number;

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:beacon:${tag}`;
    this.radius = num(params, 'radius', 200);
    this.label = str(params, 'label', tag.toUpperCase());
    const color = str(params, 'color', '#ffd23a');
    this.spin = 0.08 + (seedOf(tag) % 100) / 1000;
    this.model = buildShip(beaconBlueprint(color));
    this.group.add(this.model.root);
    const lights: LightSpec[] = [{ pos: new Vector3(0, 5.4, 0), color, size: 2.2, mode: LIGHT_PULSE, rate: 0.6, gain: 3 }];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      lights.push({ pos: new Vector3(Math.cos(a) * 4.3, -3.7, Math.sin(a) * 4.3), color: '#ff5a3a', size: 0.35, mode: LIGHT_STROBE, rate: 0.9, phase: i / 3, duty: 0.12, gain: 3 });
    }
    this.lights = new LightPoints(lights, { minPixels: 2.2, glint: 1 });
    this.model.root.add(this.lights.mesh);
  }

  update(ctx: SetPieceFrame): void {
    this.lights.update(ctx.time);
    this.model.root.rotation.set(0.08, ctx.time * this.spin, 0.05);
  }

  dispose(): void {
    this.lights.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
