import { Group, Quaternion, Scene, Vector3 } from 'three';
import type { StarSystem, GateLink, MoonSite, PlanetSite } from '@/universe/Universe';
import { Backdrop } from './Backdrop';
import { Planet, planetClock, type PlanetKind } from './Planet';
import { moonPosition } from '@/universe/bodies';
import { ShatteredMoon } from './planets/Shattered';
import { RingDebris, ringColor, type RingTarget } from './planets/RingDebris';
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

/** A planet, moon or landmark as the HUD / star map see it (universe space, live). */
export interface BodyInstance {
  name: string;
  kind: PlanetKind;
  description: string;
  landmark?: string;
  /** Universe-space centre (moons: updated every frame). */
  position: Vector3;
  radius: number;
  /** Moons: the planet they circle. */
  parent?: BodyInstance;
  site: PlanetSite | MoonSite;
}

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
  /** Every planet, moon and landmark (nav markers, star map survey). */
  readonly bodies: BodyInstance[] = [];
  private moons: { body: BodyInstance; group: Group; moon: MoonSite; parent: Vector3 }[] = [];
  private shattered: ShatteredMoon[] = [];
  /** Ring chunks you can fly through (nearest ringed planet). */
  readonly ringDebris: RingDebris;
  private rings: RingTarget[] = [];

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
      const kind = p.preset.kind ?? 'gas';
      const group = kind === 'shattered' ? this.addShattered(p) : this.addPlanet(p);
      group.position.copy(p.position).add(SYSTEM_OFFSET);
      group.rotation.set(...p.tilt);
      this.masses.push({ position: group.position, radius: p.preset.radius });
      this.group.add(group);
      const body: BodyInstance = { name: p.preset.name, kind, description: p.description ?? '', landmark: p.landmark, position: group.position, radius: p.preset.radius, site: p };
      this.bodies.push(body);
      for (const m of p.moons ?? []) {
        const mk = m.preset.kind ?? 'rocky';
        const mg = mk === 'shattered' ? this.addShattered(m) : new Planet(m.preset, { segments: 64 }).group;
        const pos = moonPosition(group.position, m, 0);
        mg.position.copy(pos);
        mg.rotation.set(0.2, m.node, 0.1);
        this.group.add(mg);
        const mb: BodyInstance = { name: m.preset.name, kind: mk, description: m.description, landmark: m.landmark, position: mg.position, radius: m.preset.radius, parent: body, site: m };
        this.bodies.push(mb);
        this.moons.push({ body: mb, group: mg, moon: m, parent: group.position });
        this.masses.push({ position: mg.position, radius: m.preset.radius });
      }
    }
    this.ringDebris = new RingDebris([...system.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 3));
    this.group.add(this.ringDebris.mesh);

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

  private addPlanet(p: PlanetSite): Group {
    const planet = new Planet(p.preset);
    const rp = p.preset.ring;
    if (rp) {
      planet.group.rotation.set(...p.tilt);
      planet.group.updateMatrixWorld(true);
      this.rings.push({
        center: planet.group.position,
        normal: planet.ringNormal(new Vector3()),
        inner: p.preset.radius * rp.inner,
        outer: p.preset.radius * rp.outer,
        bands: rp.bands,
        color: ringColor(rp.bands),
      });
    }
    return planet.group;
  }

  private addShattered(p: PlanetSite | MoonSite): Group {
    const s = new ShatteredMoon(p.preset);
    this.shattered.push(s);
    return s.group;
  }

  /** `eye` (universe) drives the fly-through ring chunks; omit it to keep them hidden. */
  update(time: number, eye?: Vector3): void {
    this.field.update(time);
    for (const st of this.stations) st.update(time);
    planetClock.value = time;
    for (const m of this.moons) moonPosition(m.parent, m.moon, time, m.group.position);
    for (const s of this.shattered) s.update(time);
    if (eye) this.ringDebris.update(eye, this.rings);
  }

  /** Ring plane of a ringed planet (universe space). */
  ringFrame(b: BodyInstance): RingTarget | undefined {
    return this.rings.find((r) => r.center === b.position);
  }

  /** Nearest body surface to `p` (metres above the surface) — nav / HUD. */
  nearestBody(p: Vector3): { body: BodyInstance; altitude: number } | null {
    let best: BodyInstance | null = null;
    let bd = Infinity;
    for (const b of this.bodies) {
      const d = b.position.distanceTo(p) - b.radius;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best ? { body: best, altitude: bd } : null;
  }

  gateTo(id: string): GateInstance | undefined {
    return this.gates.find((g) => g.link.to === id);
  }

  dispose(): void {
    for (const st of this.stations) st.dispose();
    this.ringDebris.dispose();
    this.group.removeFromParent();
    this.scene.remove(this.backdrop.group);
    this.group.traverse((o) => {
      const m = o as { geometry?: { dispose(): void } };
      m.geometry?.dispose();
    });
  }
}
