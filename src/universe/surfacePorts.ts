import type { Vector3 } from 'three';
import type { PlanetKind } from '../world/Planet';
import type { EconFaction } from '../game/economy';
import type { StationSite, SurfacePortSite, SurfaceTerrain } from './Universe';

/**
 * Planetary ports: every orbital port's landing tether comes down to a city.
 *
 * Pure and deterministic, on its own PRNG stream per system (seed, id), run
 * after station placement and the survey pass (it needs the planet's kind),
 * so nothing that existed before moves: stations, lanes, bodies, traffic and
 * contract boards are untouched. Only inhabited worlds — a planet with an
 * orbital port over it — get a surface port, one per orbital port.
 *
 * Position: on the planet's surface straight under the tether (system-local
 * metres); axis = the local vertical (the orbital port's docking axis).
 */
export interface SurfacePortInput {
  id: string;
  name: string;
  planets: { preset: { name: string; kind?: PlanetKind; radius: number }; position: Vector3 }[];
  stations: readonly StationSite[];
}

/** Hand-named ports for the series bible's worlds. */
const KEY_PORTS: Record<string, { name: string; description: string }> = {
  meridian: {
    name: 'Castellan Low City',
    description: 'Aerostat city riding the upper bands of Castellan. The Counting House keeps its ledgers where the air is thick enough to breathe.',
  },
  anchorage: {
    name: 'Anchorage Shelf Yards',
    description: 'Fleet housing and slipways on the continental shelf. Every Kestrel pilot learned to land here, in the rain.',
  },
  hesper: {
    name: 'The Spire',
    description: 'The Hegemony’s tether-city on the Hesper shelf-sea. The towers sing up the cable at every change of watch.',
  },
};

const NAMES: Record<SurfaceTerrain, string[]> = {
  ocean: ['{p} Shelf City', '{p} Seawall', '{p} Deepharbour', 'Tidegate'],
  desert: ['{p} Dust Landing', '{p} Mesa Port', '{p} Glassfield', 'Saltpan'],
  rocky: ['{p} Downport', '{p} Terrace', '{p} Hold', 'Quarry Landing'],
  ice: ['{p} Icefield', '{p} Rime Port', '{p} Coldharbour'],
  volcanic: ['{p} Ashport', '{p} Basalt Landing'],
  cloud: ['{p} Cloudport', '{p} Low City', '{p} Aerostat'],
  lantern: ['{p} Veinport', 'Low Lamp'],
};

const FLAVOUR: Record<SurfaceTerrain, string[]> = {
  ocean: [
    'Domed terraces on the shelf, sea-walls and kelp-farms; the pads are washed down every tide.',
    'An archipelago city strung along the tether foot. Ferries, rain, fish counted by the gram.',
  ],
  desert: [
    'A walled landing on a salt pan, cooling towers and glassed runways. Water sells by the litre.',
    'Mesa-top port above the dunes; the city lives in the shade of its own towers.',
  ],
  rocky: [
    'Terraced port cut into a valley floor, foundries stepping up the slopes toward the pads.',
    'Quarry town grown into a city round the tether foot. The strip-mines are its skyline.',
  ],
  ice: [
    'Heated domes on the ice sheet, pads cleared by hand every watch. Everyone wears two coats.',
    'A crawler-town frozen in place round the tether foot, lit like a ledger all night.',
  ],
  volcanic: ['Basalt-walled port on a cooled flow; the lava lights the underside of the clouds.'],
  cloud: ['A floating city on lift-cells in the upper bands, pads cantilevered over nothing.'],
  lantern: ['A pilgrim town on veined black rock; the ground glows violet after dark.'],
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Ground under a port on a planet of `kind`. */
export function terrainFor(kind: PlanetKind | undefined): SurfaceTerrain {
  switch (kind ?? 'rocky') {
    case 'gas':
    case 'ice-giant':
      return 'cloud';
    case 'ocean':
      return 'ocean';
    case 'desert':
      return 'desert';
    case 'ice':
      return 'ice';
    case 'volcanic':
    case 'burning':
      return 'volcanic';
    case 'lantern':
      return 'lantern';
    default:
      return 'rocky';
  }
}

export function surfacePorts(seed: number, sys: SurfacePortInput): SurfacePortSite[] {
  const rnd = mulberry32(hashStr(`${seed}:surface:${sys.id}`));
  const out: SurfacePortSite[] = [];
  const used = new Set<string>();
  for (const st of sys.stations) {
    if (st.kind !== 'orbital' || st.planet === undefined) continue;
    const pl = sys.planets[st.planet];
    if (!pl) continue;
    const terrain = terrainFor(pl.preset.kind);
    const key = out.length === 0 ? KEY_PORTS[sys.id] : undefined;
    let name = key?.name ?? '';
    for (let tries = 0; !name || used.has(name); tries++) {
      const pool = NAMES[terrain];
      name = pool[Math.floor(rnd() * pool.length)].replace('{p}', pl.preset.name) + (tries > 3 ? ` ${tries}` : '');
    }
    used.add(name);
    const flav = FLAVOUR[terrain];
    const description = key?.description ?? flav[Math.floor(rnd() * flav.length)];
    const axis = st.axis.clone().normalize();
    out.push({
      id: `${sys.id}-surface-${out.length}`,
      name,
      kind: 'surface',
      faction: st.faction as EconFaction,
      position: axis.clone().multiplyScalar(pl.preset.radius).add(pl.position),
      axis,
      up: st.up.clone(),
      planet: st.planet,
      seed: Math.floor(rnd() * 1e6),
      risk: st.risk,
      orbital: st.id,
      terrain,
      description,
      heading: rnd() * Math.PI * 2,
    });
  }
  return out;
}

/** Find a surface port anywhere (by id). */
export function findSurfacePort(systems: Iterable<{ id: string; surfacePorts?: SurfacePortSite[] }>, id: string): { port: SurfacePortSite; system: string } | null {
  for (const s of systems) {
    const port = s.surfacePorts?.find((p) => p.id === id);
    if (port) return { port, system: s.id };
  }
  return null;
}
