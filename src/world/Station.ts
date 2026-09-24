import { Color, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { StationSite } from '@/universe/Universe';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import { stationBlueprint, BAY_Z, BAY_DEPTH, BAY_BACK, BAY_W, BAY_H } from '@/assets/blueprints/stations';
import { makeProxy, type Proxy } from '@/sim/Collision';
import { proxiesFromModel } from '@/sim/CollisionProxies';
import { BayCurtain } from './BayCurtain';
import { cylinder } from '@/assets/HullKit';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { LightPoints, LIGHT_PULSE, LIGHT_STEADY, LIGHT_STROBE, type LightSpec } from './setpieces/LightPoints';
import { berthLights, stationBerths, type StationBerth } from './berths/sites';
import type { SurfacePortSite } from '@/universe/Universe';
import type { PlanetPreset } from './Planet';

/**
 * A dockable station in the world (docking & trade). Universe-positioned
 * under the StarSystemView group; the model comes from the station
 * blueprints (hull kit, cel + ink like every ship), plus:
 *
 *  - approach lights: a pair of buoy strings running 1.6 km out along the
 *    corridor, with a strobing "rabbit" that runs in toward the bay mouth;
 *  - running lights on the rotating ring (they ride the spin joint);
 *  - orbital ports: the landing-corridor tether dropping from the anchor to
 *    the atmosphere, climber lights pulsing down it;
 *  - clamp gantries and the mooring pylon for big hulls (world/berths): arms
 *    stowed until a hull comes alongside, walkway lights running out.
 *
 * Frame: the station faces +Z = `site.axis` (bay end), +Y = `site.up`.
 * Everything is built with an explicit basis — never Object3D.lookAt with
 * universe positions (floating origin).
 */
const SCALE = 100;
/** Universe metres from station centre to the bay mouth plane. */
export const BAY_OFFSET = BAY_Z * SCALE;
/** How deep inside the bay a docked ship parks (m). */
export const BAY_INSIDE = BAY_DEPTH * SCALE * 0.7;
/** Bay interior (m): half width, half height, depth from the mouth to the back wall. */
export const BAY_INTERIOR = { hw: (BAY_W / 2) * SCALE, hh: (BAY_H / 2) * SCALE, depth: (BAY_Z - BAY_BACK) * SCALE };

const _m = new Matrix4();
const _x = new Vector3();

export class StationView {
  readonly group = new Group();
  readonly model: ShipModel;
  /** Universe-space centre, bay mouth, and frame (constant: stations don't drift). */
  readonly center = new Vector3();
  readonly bay = new Vector3();
  readonly axis = new Vector3();
  readonly up = new Vector3();
  readonly quaternion = new Quaternion();
  readonly radius: number;
  private lights: LightPoints;
  private spinRate: number;
  /** The atmosphere curtain across the bay mouth (Docking drives its ripple). */
  readonly curtain: BayCurtain;
  private tether: { z: number; len: number } | null = null;
  private proxies: Proxy[] | null = null;
  /** Clamp gantries and mooring pylon (station frame, metres). */
  readonly berths: StationBerth[];
  /** Orbital ports: the planet under the tether and the surface port at its foot (set by StarSystemView). */
  surface: { port: SurfacePortSite; preset: PlanetPreset; planetCenter: Vector3; planetRadius: number } | null = null;
  /** Station-frame z of the tether's top (the anchor), metres. */
  readonly tetherTop = -850;

  constructor(
    readonly site: StationSite,
    offset: Vector3,
    planet?: { center: Vector3; radius: number },
  ) {
    this.group.name = `station:${site.id}`;
    this.center.copy(site.position).add(offset);
    this.axis.copy(site.axis).normalize();
    this.up.copy(site.up).addScaledVector(this.axis, -site.up.dot(this.axis)).normalize();
    _x.crossVectors(this.up, this.axis).normalize();
    this.quaternion.setFromRotationMatrix(_m.makeBasis(_x, this.up, this.axis));
    this.group.position.copy(this.center);
    this.group.quaternion.copy(this.quaternion);
    this.bay.copy(this.center).addScaledVector(this.axis, BAY_OFFSET);

    if (site.kind === 'carrier' || site.kind === 'surface') throw new Error('StationView: carriers dock at their own hangars; surface ports are reached by descent');
    this.model = buildShip(stationBlueprint(site.kind, site.faction, site.seed));
    this.group.add(this.model.root);
    this.radius = this.model.radius;
    this.spinRate = 1 / (70 + (site.seed % 40)); // rev/s: a minute or two per turn
    this.model.setChannel('spin', (site.seed % 97) / 97);
    this.berths = stationBerths(site.kind);
    for (const b of this.berths) if (b.channel) this.model.setChannel(b.channel, 0); // arms stowed

    const glow = new Color(site.faction === 'choir' ? '#ff5fd0' : site.faction === 'rustwake' ? '#ffb04f' : '#6fe6ff');
    const specs: LightSpec[] = [];
    // Corridor buoys: two strings framing the approach, 1.6 km out.
    const N = 16;
    for (let k = 1; k <= N; k++) {
      const z = BAY_OFFSET + 40 + k * 100;
      for (const sx of [-1, 1]) {
        specs.push({ pos: new Vector3(sx * 95, -30, z), color: sx < 0 ? '#ff5f7a' : '#7dffb2', size: 7, mode: LIGHT_STEADY, gain: 2 });
        // The rabbit: a strobe that runs in toward the bay, ~1 s a lap.
        specs.push({ pos: new Vector3(sx * 95, -30, z), color: '#ffffff', size: 16, mode: LIGHT_STROBE, rate: 0.9, phase: k / N, duty: 0.08, gain: 3 });
      }
      if (k % 4 === 0) specs.push({ pos: new Vector3(0, 70, z), color: glow, size: 5, mode: LIGHT_PULSE, rate: 0.5, phase: k / N, gain: 1.6 });
    }
    // Hazard strobes on the bay block corners.
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      specs.push({ pos: new Vector3(sx * 135, sy * 100, BAY_OFFSET - 10), color: '#ff9b3f', size: 9, mode: LIGHT_STROBE, rate: 0.8, phase: (sx + sy + 2) * 0.1, duty: 0.2, gain: 2.5 });
    // Tether (orbital ports): the planetary landing corridor.
    if (site.kind === 'orbital' && planet) {
      const alt = this.center.distanceTo(planet.center) - planet.radius;
      const len = Math.max(2000, alt + 1500);
      const tether = new Mesh(cylinder(9, 14, len, 6), new CelMaterial({ color: '#8d94a8', ramp: 'classic', gloss: 0.5, inkId: 7400 }));
      tether.position.set(0, 0, -850 - len / 2);
      this.group.add(tether);
      this.tether = { z: -850 - len / 2, len };
      for (let d = 0; d < len; d += 450) {
        specs.push({ pos: new Vector3(0, 0, -900 - d), color: glow, size: 14, mode: LIGHT_PULSE, rate: 0.4, phase: -d / 3000, gain: 1.8 });
        specs.push({ pos: new Vector3(0, 0, -900 - d), color: '#ffffff', size: 22, mode: LIGHT_STROBE, rate: 0.25, phase: -d / 6000, duty: 0.05, gain: 2.5 });
      }
    }
    specs.push(...berthLights(site.kind, glow.getStyle()));
    this.lights = new LightPoints(specs, { minPixels: 2, glint: 0.8 });
    this.group.add(this.lights.mesh);
    // The bay's atmosphere curtain, just inside the mouth.
    this.curtain = new BayCurtain(BAY_W * SCALE, BAY_H * SCALE, glow);
    this.curtain.mesh.position.set(0, 0, BAY_OFFSET - 4);
    this.group.add(this.curtain.mesh);

    // Ring running lights ride the spin joint.
    const spin = this.model.articulations.get('spin');
    const ringR = ringRadius(this.model) * SCALE;
    if (spin && ringR > 0) {
      const ring: LightSpec[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ring.push({ pos: new Vector3(Math.cos(a) * (ringR + 50), Math.sin(a) * (ringR + 50), 0), color: i % 3 === 0 ? '#ff5f7a' : glow, size: 7, mode: i % 3 === 0 ? LIGHT_STROBE : LIGHT_STEADY, rate: 0.6, phase: i / 12, duty: 0.15, gain: 1.6 });
      }
      const rl = new LightPoints(ring, { minPixels: 1.2 });
      spin.node.add(rl.mesh);
      this.ringLights = rl;
    }
  }

  private ringLights: LightPoints | null = null;

  update(time: number): void {
    this.model.setChannel('spin', (time * this.spinRate + (this.site.seed % 97) / 97) % 1);
    this.lights.update(time);
    this.ringLights?.update(time);
    this.curtain.update(time);
  }

  /** Collision proxies (station frame, metres): the blueprint's parts plus the landing tether. */
  collisionProxies(): Proxy[] {
    if (!this.proxies) {
      this.proxies = proxiesFromModel(this.model);
      if (this.tether) this.proxies.push(makeProxy({ kind: 'cyl', c: new Vector3(0, 0, this.tether.z), q: new Quaternion(), r: 16, halfLen: this.tether.len / 2 }));
    }
    return this.proxies;
  }

  dispose(): void {
    this.lights.dispose();
    this.ringLights?.dispose();
    this.curtain.dispose();
  }
}

/** Radius of the main habitat ring (blueprint units), read back from the design. */
function ringRadius(model: ShipModel): number {
  for (const p of model.blueprint.parts) {
    if (p.name !== 'ring') continue;
    if (p.shape.kind === 'torus' || p.shape.kind === 'rib') return p.shape.radius;
  }
  return 0;
}
