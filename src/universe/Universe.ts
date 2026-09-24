import { Color, Vector3 } from 'three';
import type { FactionId } from '@/assets/Blueprint';
import type { BackdropPreset } from '@/world/Backdrop';
import type { LightPreset } from '@/render/LightRig';
import type { PlanetPreset } from '@/world/Planet';
import type { ColorStop } from '@/render/materials/PaletteRamp';
import type { EconFaction, StationKind } from '@/game/economy';

/**
 * Milestone 15 — universe data.
 *
 * The Meridian Reach is a graph of star systems joined by Lantern gates.
 * Everything a system needs to be *built* (sky palette, lighting, planets,
 * gate positions, garrison) is plain data produced by a seeded generator, so
 * the same seed always yields the same Reach — and a save file only needs
 * the seed plus deltas.
 *
 * Units: sector-map positions in light-years (2D); in-system positions in
 * metres (float64, universe space — see WorldSpace).
 */
export interface GateLink {
  to: string;
  /** Gate position inside this system (metres). */
  position: Vector3;
  /** Unit normal of the gate plane (fly through along ±normal). */
  normal: Vector3;
}

export interface PlanetSite {
  preset: PlanetPreset;
  position: Vector3;
  tilt: [number, number, number];
  /** One line of survey flavour (star map, HUD nav). Filled by `universe/bodies.ts`. */
  description?: string;
  /** Landmark tag ('shattered moon', 'Lantern-lit world', 'burning world', …) for the nav list. */
  landmark?: string;
  /** Bodies added by the survey pass (never moves an original planet or its stations). */
  added?: boolean;
  moons?: MoonSite[];
}

/**
 * A moon on a slow circular orbit around its planet (see `moonPosition`).
 * Orbits sit outside rings and station altitudes, inside 45% of the planet's
 * distance from the system origin, so they never sweep through the Lanterns.
 */
export interface MoonSite {
  preset: PlanetPreset;
  description: string;
  landmark?: string;
  /** Orbit radius, metres (centre to centre). */
  orbit: number;
  /** Seconds per orbit. */
  period: number;
  phase: number;
  /** Orbit plane: inclination and ascending-node angle, radians. */
  incline: number;
  node: number;
}

/**
 * A dockable station (docking & trade). Generated deterministically from the
 * seed by `universe/stations.ts`; the model is built by `world/Station.ts`.
 * The docking bay sits on the station's +axis end; ships approach flying
 * along −axis down a corridor that extends out along +axis.
 */
export interface StationSite {
  id: string;
  name: string;
  kind: StationKind;
  faction: EconFaction;
  /** System-local position (metres, before SYSTEM_OFFSET). */
  position: Vector3;
  /** Unit vector out of the docking bay, along the approach corridor. */
  axis: Vector3;
  /** Unit vector ⟂ axis (station roll). */
  up: Vector3;
  /** Orbital ports: index of the planet under the landing corridor. */
  planet?: number;
  /** Model variation seed. */
  seed: number;
  /** 0..1 danger of the system (economy hazard premium); see `systemRisk`. */
  risk?: number;
}

export interface StarSystem {
  id: string;
  name: string;
  faction: FactionId | 'contested' | 'unknown';
  /** Sector map position, light-years. */
  map: { x: number; y: number };
  starColor: Color;
  starClass: string;
  light: LightPreset;
  backdrop: BackdropPreset;
  planets: PlanetSite[];
  gates: GateLink[];
  /** Dockable stations (1–3 per generated system; none in off-map locations). */
  stations: StationSite[];
  /** 0..1 — how dangerous (drives garrison size / encounter density). */
  threat: number;
  /** Hand-authored flavour for key systems only. */
  blurb?: string;
}

export interface Universe {
  seed: number;
  systems: Map<string, StarSystem>;
  start: string;
}

/** Breadth-first route between systems (gate hops). */
export function route(u: Universe, from: string, to: string): string[] {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const g of u.systems.get(cur)!.gates) {
      if (prev.has(g.to)) continue;
      prev.set(g.to, cur);
      if (g.to === to) {
        const path = [to];
        let p = cur;
        while (p !== from) {
          path.push(p);
          p = prev.get(p)!;
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(g.to);
    }
  }
  return [];
}

export type { ColorStop };
