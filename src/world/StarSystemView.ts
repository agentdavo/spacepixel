import { Group, Quaternion, Scene, Vector3 } from 'three';
import type { StarSystem, GateLink } from '@/universe/Universe';
import { Backdrop } from './Backdrop';
import { Planet } from './Planet';
import { LanternGate } from './LanternGate';
import { LightRig } from '@/render/LightRig';
import { AsteroidField } from './AsteroidField';
import { HazeClouds } from './HazeClouds';
import { StationView } from './Station';

/**
 * Builds a StarSystem's data into renderable objects: sky + light rig
 * (scene-level, camera-locked), planets and one Lantern per gate lane
 * (universe-positioned, under WorldSpace.root). Disposed wholesale on jump.
 *
 * `offset` shifts the whole system in universe space — we keep systems
 * thousands of km from the origin so float precision is always exercised.
 */
export const SYSTEM_OFFSET = new Vector3(2_400_000, 150_000, -1_100_000);

export interface GateInstance {
  link: GateLink;
  gate: LanternGate;
  /** Universe-space centre (offset applied). */
  center: Vector3;
}

const _z = new Vector3(0, 0, 1);

export class StarSystemView {
  readonly group = new Group();
  readonly backdrop: Backdrop;
  readonly gates: GateInstance[] = [];
  /** Massive bodies (planets) for supercruise: centre + radius, universe space. */
  readonly masses: { position: Vector3; radius: number }[] = [];
  /** Belt beside the first Lantern: parallax, cover and scale reference. */
  readonly field: AsteroidField;
  /** Dockable stations (docking & trade). */
  readonly stations: StationView[] = [];

  constructor(
    readonly system: StarSystem,
    private scene: Scene,
    worldRoot: Group,
  ) {
    this.group.name = `system:${system.id}`;
    LightRig.apply(system.light);
    this.backdrop = new Backdrop(system.backdrop);
    scene.add(this.backdrop.group);

    for (const p of system.planets) {
      const planet = new Planet(p.preset);
      planet.group.position.copy(p.position).add(SYSTEM_OFFSET);
      planet.group.rotation.set(...p.tilt);
      this.masses.push({ position: planet.group.position, radius: p.preset.radius });
      this.group.add(planet.group);
    }

    for (const link of system.gates) {
      const gate = new LanternGate(420);
      const center = link.position.clone().add(SYSTEM_OFFSET);
      gate.group.position.copy(center);
      gate.group.quaternion.copy(new Quaternion().setFromUnitVectors(_z, link.normal));
      this.group.add(gate.group);
      this.gates.push({ link, gate, center });
    }
    // A belt off to the side of the first lane, seeded per system. Rustwake
    // space is dense; elsewhere it's sparse rubble.
    const seed = [...system.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const dense = system.faction === 'rustwake';
    const k = dense ? 1 : 0.4;
    this.field = new AsteroidField({
      seed,
      innerRadius: 1200,
      outerRadius: dense ? 9000 : 6000,
      thickness: 600,
      clumps: dense ? 36 : 14,
      classes: [
        { detail: 0, count: Math.round(2600 * k), size: [1.2, 5], variants: 2 },
        { detail: 1, count: Math.round(1200 * k), size: [5, 16], variants: 2 },
        { detail: 2, count: Math.round(420 * k), size: [16, 70], variants: 2 },
        { detail: 3, count: dense ? 50 : 18, size: [70, 400], variants: 2 },
      ],
    });
    const g0 = this.gates[0];
    if (g0) {
      const side = new Vector3(0, 1, 0).cross(g0.link.normal).normalize();
      this.field.group.position.copy(g0.center).addScaledVector(g0.link.normal, -4500).addScaledVector(side, 7000);
    }
    const puffs = this.field.clumps.map((c) => c.centre.clone());
    const haze = new HazeClouds({ seed, centres: puffs, size: [500, 1500], opacity: dense ? 0.32 : 0.2, colors: ['#6a4f9a', '#2f7f9a'] });
    this.field.group.add(haze.group);
    this.group.add(this.field.group);
    for (const site of system.stations) {
      const pl = site.planet !== undefined ? system.planets[site.planet] : undefined;
      const st = new StationView(site, SYSTEM_OFFSET, pl && { center: pl.position.clone().add(SYSTEM_OFFSET), radius: pl.preset.radius });
      this.stations.push(st);
      this.group.add(st.group);
    }
    worldRoot.add(this.group);
  }

  update(time: number): void {
    this.field.update(time);
    for (const st of this.stations) st.update(time);
  }

  gateTo(id: string): GateInstance | undefined {
    return this.gates.find((g) => g.link.to === id);
  }

  dispose(): void {
    for (const st of this.stations) st.dispose();
    this.group.removeFromParent();
    this.scene.remove(this.backdrop.group);
    this.group.traverse((o) => {
      const m = o as { geometry?: { dispose(): void } };
      m.geometry?.dispose();
    });
  }
}
