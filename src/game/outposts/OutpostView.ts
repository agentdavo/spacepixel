import { Color, Group, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import { stationBlueprint } from '@/assets/blueprints/stations';
import { cylinder, box } from '@/assets/HullKit';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { LightPoints, LIGHT_FLICKER, LIGHT_PULSE, LIGHT_STEADY, LIGHT_STROBE, type LightSpec } from '@/world/setpieces/LightPoints';
import { ownHullMaterial } from '@/world/setpieces/util';
import { StationView } from '@/world/Station';
import type { StarSystemView } from '@/world/StarSystemView';
import type { EconFaction } from '@/game/economy';
import type { StationSite } from '@/universe/Universe';

/**
 * What an outpost looks like at each restoration stage (outposts.ts), built
 * in the current system's view when the pilot is in the outpost's system.
 *
 *   0  the hulk: the same station hull, weathered to bone, dark, tumbling
 *      slowly on a skew axis; embers in a breach; the claim beacon strobing
 *   1  sealed: the tumble stopped and squared to its Lantern; running lights
 *      on; windows glowing on the hub
 *   2+ a real StationView pushed into the view's station list — the ring
 *      spins, the bay lights and curtain come on, and the Docking system
 *      berths you there exactly as at any station (and it collides) —
 *      still weathered; then overlays per stage:
 *   3  market deck: warm window strips on the hub, a lit freight apron
 *   4  annex: the guild's banner lights on the spire and ring
 *   5  guns: turret barbettes on the ring rim, red tracking lights
 *   damaged: fire in the hub (flickering embers) until patched
 *
 * Frames are built from an explicit basis — never Object3D.lookAt with
 * universe positions (floating origin).
 */
export interface OutpostLook {
  id: string;
  name: string;
  faction: EconFaction;
  /** Guild banner colour. */
  color: string;
  /** Universe position, bay axis (toward the Lantern). */
  center: Vector3;
  axis: Vector3;
  stage: number;
  damaged: boolean;
  seed: number;
}

const _m = new Matrix4();
const _x = new Vector3();

export class OutpostView {
  readonly group = new Group();
  /** Stage ≥ 2: the dockable station (in `view.stations`). */
  station: StationView | null = null;
  private hulk: ShipModel | null = null;
  private lights: LightPoints[] = [];
  private mats: Material[] = [];
  private geos: BufferGeometry[] = [];
  private base = new Quaternion();
  private spin = new Quaternion();
  private spinAxis = new Vector3(0.35, 0.8, 0.45).normalize();

  constructor(
    readonly look: OutpostLook,
    private view: StarSystemView,
  ) {
    this.group.name = `outpost:${look.id}`;
    const up = new Vector3(0, 1, 0).addScaledVector(look.axis, -look.axis.y).normalize();
    _x.crossVectors(up, look.axis).normalize();
    this.base.setFromRotationMatrix(_m.makeBasis(_x, up, look.axis));
    const glow = new Color(look.color);

    if (look.stage < 2) {
      // The hulk: a station hull aged to bone, not yet anybody's station.
      const model = buildShip(stationBlueprint('salvage', look.faction, look.seed));
      this.hulk = model;
      this.mats.push(ownHullMaterial(model.meshes, { ramp: 'dramatic', rimWidth: 0.6, haze: 0.6, inkId: 7700, weather: 1, weatherScale: 1 / 160 }));
      model.setChannel('spin', (look.seed % 97) / 97);
      this.group.position.copy(look.center);
      this.group.quaternion.copy(this.base);
      this.group.add(model.root);
      const r = model.radius;
      const hub = hubPoints(model);
      const specs: LightSpec[] = [];
      // The claim beacon: your guild's colour, strobing off the bow.
      specs.push({ pos: new Vector3(0, r * 0.35, r * 0.55), color: glow, size: 26, mode: LIGHT_STROBE, rate: 0.5, duty: 0.12, gain: 3 });
      specs.push({ pos: new Vector3(0, r * 0.35, r * 0.55), color: '#ffffff', size: 10, mode: LIGHT_STEADY, gain: 1.4 });
      if (look.stage === 0) {
        for (let i = 0; i < 8; i++) specs.push({ pos: hub[i % hub.length].clone().multiplyScalar(0.9), color: i % 2 ? '#ffb45a' : '#ff7a3a', size: 8 + (i % 3) * 5, mode: LIGHT_FLICKER, rate: 1.2 + i * 0.3, phase: i / 8, gain: 1.1 });
      } else {
        // Sealed: running lights down both flanks, windows on the hub.
        for (let i = 0; i < hub.length; i++) {
          const p = hub[i];
          specs.push({ pos: p.clone().setX(p.x + (i % 2 ? 1 : -1) * r * 0.06), color: i % 2 ? '#7dffb2' : '#ff5f7a', size: 9, mode: LIGHT_STEADY, gain: 1.8 });
          specs.push({ pos: p.clone().multiplyScalar(0.92), color: '#ffd89a', size: 14, mode: LIGHT_PULSE, rate: 0.15, phase: i / hub.length, gain: 1.2 });
        }
      }
      this.addLights(specs, this.group);
    } else {
      // Restored: a real station at the site; Docking and collisions find it in view.stations.
      const site: StationSite = {
        id: look.id,
        name: look.name,
        kind: 'salvage',
        faction: look.faction,
        position: new Vector3(),
        axis: look.axis.clone(),
        up,
        seed: look.seed,
        risk: 0,
      };
      // StationView adds its offset to the site position: hand it the universe centre directly.
      const st = new StationView(site, look.center);
      this.station = st;
      if (look.stage < 4) this.mats.push(ownHullMaterial(st.model.meshes, { ramp: 'dramatic', rimWidth: 0.5, haze: 0.5, inkId: 7700, weather: look.stage === 2 ? 0.85 : 0.45, weatherScale: 1 / 160 }));
      view.stations.push(st);
      view.group.add(st.group);
      const r = st.radius;
      const hub = hubPoints(st.model);
      const specs: LightSpec[] = [];
      if (look.stage >= 3) {
        // Market deck: warm window strips, the freight apron lit below the bay.
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          specs.push({ pos: new Vector3(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, r * 0.05), color: '#ffd89a', size: 12, mode: LIGHT_STEADY, gain: 1.5 });
        }
        for (let k = 0; k < 6; k++) specs.push({ pos: new Vector3((k - 2.5) * 40, -r * 0.18, r * 0.3), color: '#ffc46b', size: 10, mode: LIGHT_PULSE, rate: 0.3, phase: k / 6, gain: 1.4 });
      }
      if (look.stage >= 4) {
        // The annex: the guild's banner on the spire and round the ring.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          specs.push({ pos: new Vector3(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, -r * 0.05), color: glow, size: 22, mode: LIGHT_PULSE, rate: 0.35, phase: i / 8, gain: 2.4 });
        }
        specs.push({ pos: new Vector3(0, 0, -r * 0.62), color: glow, size: 60, mode: LIGHT_PULSE, rate: 0.2, gain: 2.6 });
        specs.push({ pos: new Vector3(0, 0, -r * 0.62), color: '#ffffff', size: 18, mode: LIGHT_STROBE, rate: 0.4, duty: 0.08, gain: 3 });
      }
      if (look.stage >= 5) {
        // Guns on the rim.
        const gunMat = new CelMaterial({ color: '#6c737e', ramp: 'classic', gloss: 0.4, inkId: 7710 });
        const barMat = new CelMaterial({ color: '#26252e', ramp: 'classic', gloss: 0.3, inkId: 7711 });
        this.mats.push(gunMat, barMat);
        const baseGeo = cylinder(26, 32, 30, 8);
        const barGeo = box(8, 8, 90);
        this.geos.push(baseGeo, barGeo);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.26;
          const t = new Group();
          t.position.set(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, 0);
          const b = new Mesh(baseGeo, gunMat);
          const barrel = new Mesh(barGeo, barMat);
          barrel.position.set(0, 0, 55);
          t.add(b, barrel);
          st.group.add(t);
          specs.push({ pos: t.position.clone().setZ(40), color: '#ff5f7a', size: 9, mode: LIGHT_STROBE, rate: 1.1, phase: i / 6, duty: 0.3, gain: 2.4 });
        }
      }
      if (look.damaged) {
        for (let i = 0; i < 10; i++) specs.push({ pos: hub[i % hub.length].clone().multiplyScalar(0.85 + (i % 3) * 0.05), color: i % 2 ? '#ff7a3a' : '#ffd23a', size: 14 + (i % 4) * 6, mode: LIGHT_FLICKER, rate: 1.5 + i * 0.2, phase: i / 10, gain: 1.6 });
      }
      if (specs.length) this.addLights(specs, st.group);
    }
    view.group.add(this.group);
  }

  private addLights(specs: LightSpec[], parent: Group): void {
    const l = new LightPoints(specs, { minPixels: 1.6, glint: 0.7 });
    parent.add(l.mesh);
    this.lights.push(l);
  }

  /** Universe centre (for markers). */
  get center(): Vector3 {
    return this.look.center;
  }

  update(time: number): void {
    if (this.hulk && this.look.stage === 0) {
      this.spin.setFromAxisAngle(this.spinAxis, time * 0.004);
      this.group.quaternion.copy(this.base).multiply(this.spin);
    }
    for (const l of this.lights) l.update(time);
  }

  /** `viewGone`: the system view was already disposed (with its stations, ours among them). */
  dispose(viewGone = false): void {
    for (const l of this.lights) l.dispose();
    this.lights.length = 0;
    this.group.removeFromParent();
    if (this.station && !viewGone) {
      const i = this.view.stations.indexOf(this.station);
      if (i >= 0) this.view.stations.splice(i, 1);
      this.station.group.removeFromParent();
      this.station.dispose();
      this.station = null;
    }
    this.hulk?.root.traverse((o) => (o as Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}

/** Points on the hull surface (model frame): vertices sampled evenly from the hull meshes. */
function hubPoints(model: ShipModel, n = 18): Vector3[] {
  const out: Vector3[] = [];
  model.root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(model.root.matrixWorld).invert();
  const meshes = model.meshes.filter((m) => m.geometry.getAttribute('position'));
  let total = 0;
  for (const m of meshes) total += m.geometry.getAttribute('position').count;
  if (!total) return [new Vector3()];
  const step = Math.max(1, Math.floor(total / n));
  let k = Math.floor(step / 2);
  let base = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    while (k < base + pos.count && out.length < n) {
      const v = new Vector3().fromBufferAttribute(pos, k - base).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      out.push(v);
      k += step;
    }
    base += pos.count;
  }
  return out.length ? out : [new Vector3()];
}
