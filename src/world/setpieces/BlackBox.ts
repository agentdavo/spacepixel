import { Group, Mesh, Quaternion, Vector3 } from 'three';
import type { Blueprint } from '@/assets/Blueprint';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num, str } from './types';
import { LightPoints, LIGHT_PULSE, LIGHT_STROBE } from './LightPoints';
import { mulberry, seedOf } from './util';

function blackboxBlueprint(color: string): Blueprint {
  return {
    id: 'setpiece-blackbox',
    name: 'Data Core',
    designation: 'FLIGHT RECORDER',
    faction: 'concord',
    shipClass: 'interceptor',
    scale: 1,
    ramp: 'classic',
    engines: [],
    parts: [
      { name: 'core', paint: 'accent', group: 1, shape: { kind: 'loft', stations: [{ z: -1.2, w: 1.0, h: 1.0, c: 0.26 }, { z: 1.2, w: 1.0, h: 1.0, c: 0.26 }] } },
      { name: 'cap-a', paint: 'dark', pos: [0, 0, 1.25], shape: { kind: 'box', w: 1.14, h: 1.14, d: 0.3, c: 0.3 } },
      { name: 'cap-b', paint: 'dark', pos: [0, 0, -1.25], shape: { kind: 'box', w: 1.14, h: 1.14, d: 0.3, c: 0.3 } },
      { name: 'band', paint: 'primary', shape: { kind: 'box', w: 1.04, h: 1.04, d: 0.22, c: 0.27 }, repeat: { count: 2, step: [0, 0, 1.1] }, pos: [0, 0, -0.55] },
      { name: 'window', paint: 'glass', emissive: 1.2, color: color, pos: [0, 0.5, 0], shape: { kind: 'box', w: 0.44, h: 0.06, d: 1.3, c: 0.02 } },
      { name: 'window-b', paint: 'glass', emissive: 1.2, color: color, pos: [0, -0.5, 0], shape: { kind: 'box', w: 0.44, h: 0.06, d: 1.3, c: 0.02 } },
      { name: 'handle', paint: 'metal', pos: [0.56, 0, 0], shape: { kind: 'rib', radius: 0.28, thickness: 0.05, depth: 0.08, arc: 180, start: -90, segments: 8 }, rot: [0, 90, 0] },
      { name: 'antenna', paint: 'metal', pos: [0, 0, 1.75], shape: { kind: 'cylinder', rFront: 0.02, rBack: 0.04, length: 0.7, segments: 6 } },
    ],
  };
}

/**
 * A flight-recorder data core (~3 m): hi-vis orange armour, glowing data
 * windows, tumbling slowly, with a strobing beacon that reads from kilometres
 * away (screen-size clamped). Recovered — and hidden — when the player
 * passes within 60 m.
 *
 * Params: `color` (data glow, default '#6fe6ff'), `range` (m, default 60).
 * Flag: `${tag}-recovered`.
 */
export class BlackBox implements SetPiece {
  readonly kind: SetPieceKind = 'blackbox';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  recovered = false;
  private readonly model: ShipModel;
  private readonly beacon: LightPoints;
  private readonly axis: Vector3;
  private readonly rate: number;
  private readonly q0 = new Quaternion();
  private readonly qs = new Quaternion();
  private popT = -1;

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:blackbox:${tag}`;
    this.radius = num(params, 'range', 60);
    const color = str(params, 'color', '#6fe6ff');
    const r = mulberry(seedOf(tag));
    this.axis = new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    this.rate = 0.25 + r() * 0.2;
    this.q0.setFromAxisAngle(new Vector3(r(), r(), r()).normalize(), r() * 6);

    this.model = buildShip(blackboxBlueprint(color));
    this.group.add(this.model.root);
    this.beacon = new LightPoints(
      [
        { pos: new Vector3(0, 0, 2.1), color: '#ff9a3a', size: 0.9, mode: LIGHT_STROBE, rate: 1.1, duty: 0.1, gain: 4 },
        { pos: new Vector3(0, 0, 0), color, size: 1.7, mode: LIGHT_PULSE, rate: 0.5, gain: 0.6 },
      ],
      { minPixels: 3.5, glint: 1.2 },
    );
    this.model.root.add(this.beacon.mesh);
  }

  update(ctx: SetPieceFrame): void {
    this.beacon.update(ctx.time);
    if (this.recovered) {
      // A brief pop of the beacon as it's taken aboard, then gone.
      if (this.popT >= 0) {
        this.popT += ctx.dt;
        this.beacon.intensity.value = Math.max(0, 3 * (1 - this.popT / 0.35));
        if (this.popT > 0.35) {
          this.group.visible = false;
          this.popT = -1;
        }
      }
      return;
    }
    this.qs.setFromAxisAngle(this.axis, ctx.time * this.rate);
    this.model.root.quaternion.copy(this.q0).multiply(this.qs);
    if (ctx.playerPos.distanceTo(this.position) < this.radius) {
      this.recovered = true;
      this.popT = 0;
      this.model.root.visible = false;
      this.group.add(this.beacon.mesh);
      ctx.setFlag(`${this.tag}-recovered`);
    }
  }

  dispose(): void {
    this.beacon.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
