import { Vector3 } from 'three';
import type { EconFaction, StationKind } from '../game/economy';
import type { StationSite } from './Universe';

/**
 * Station placement (docking & trade). Pure and deterministic: each system
 * gets its own PRNG stream derived from (seed, system id), so adding stations
 * never disturbs the main universe generator's sequence — the Reach, its
 * lanes and the campaign stay exactly as they were.
 *
 * Layout, in kilometres:
 *  - Orbital ports hang 7–12 km above a planet on the side facing the
 *    Lanterns, docking axis pointing straight up out of the gravity well; the
 *    landing corridor (a lit tether) drops from the hub to the atmosphere.
 *  - Gate stations sit 9–14 km inside a Lantern and 4–8 km to one side (the
 *    opposite side from the first Lantern's asteroid belt), bay facing the gate
 *    so traffic coming through flies straight down the corridor.
 *  - Refineries skim a gas giant when there is one to skim.
 */
export interface StationSystemInput {
  id: string;
  name: string;
  faction: EconFaction | 'contested' | 'unknown';
  planets: { name: string; position: Vector3; radius: number }[];
  gates: { position: Vector3; normal: Vector3 }[];
}

interface Plan {
  kind: StationKind;
  faction: EconFaction;
  name?: string;
  site: 'planet' | 'gate';
  index: number;
}

/** Hand-placed stations for the series bible's key systems. */
const KEY_STATIONS: Record<string, Plan[]> = {
  meridian: [
    { kind: 'orbital', faction: 'concord', name: 'Castellan Highport', site: 'planet', index: 0 },
    { kind: 'refinery', faction: 'concord', name: 'Tey Refinery', site: 'planet', index: 0 },
    { kind: 'bastion', faction: 'concord', name: 'Meridian Lantern Watch', site: 'gate', index: 0 },
  ],
  anchorage: [
    { kind: 'bastion', faction: 'concord', name: 'Anchorage Fleet Yards', site: 'gate', index: 0 },
    { kind: 'salvage', faction: 'concord', name: 'Graveyard Breakers', site: 'gate', index: 1 },
    { kind: 'orbital', faction: 'concord', site: 'planet', index: 0 },
  ],
  tessaly: [
    { kind: 'refinery', faction: 'choir', name: 'Ebon-Field Refinery', site: 'planet', index: 0 },
    { kind: 'bastion', faction: 'choir', name: 'Treaty Line Watch', site: 'gate', index: 0 },
  ],
  hesper: [
    { kind: 'orbital', faction: 'choir', name: 'The Spire Highport', site: 'planet', index: 0 },
    { kind: 'freeport', faction: 'choir', name: 'Foundry-Garden Exchange', site: 'gate', index: 0 },
  ],
  rustwake: [
    { kind: 'freeport', faction: 'rustwake', name: 'The Moot-Hold', site: 'gate', index: 0 },
    { kind: 'salvage', faction: 'rustwake', name: 'Scrapjack Breakers', site: 'gate', index: 1 },
    { kind: 'refinery', faction: 'rustwake', name: 'Ember Skimworks', site: 'planet', index: 0 },
  ],
  null: [{ kind: 'bastion', faction: 'concord', name: 'Null Picket', site: 'gate', index: 0 }],
};

const SUFFIX: Record<StationKind, string[]> = {
  refinery: ['Lantern Refinery', 'Skimworks', 'Ebon Works'],
  salvage: ['Salvage Yard', 'Breakers', 'Boneyard'],
  bastion: ['Bastion', 'Picket Station', 'Watch'],
  freeport: ['Free Port', 'Exchange', 'Moot'],
  orbital: ['Highport', 'Orbital', 'Skyhook'],
  carrier: ['Carrier'],
  surface: ['Downport'],
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

function proceduralPlan(sys: StationSystemInput, rnd: () => number): Plan[] {
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const hasPlanet = sys.planets.length > 0;
  const bigPlanet = sys.planets.length > 1;
  let kinds: { kind: StationKind; faction: EconFaction }[];
  switch (sys.faction) {
    case 'concord': {
      const k = pick<StationKind>(['bastion', 'refinery']);
      kinds = [{ kind: 'orbital', faction: 'concord' }, { kind: k, faction: 'concord' }, { kind: 'salvage', faction: 'concord' }];
      break;
    }
    case 'choir': {
      const k = pick<StationKind>(['refinery', 'bastion']);
      kinds = [{ kind: 'orbital', faction: 'choir' }, { kind: k, faction: 'choir' }, { kind: k === 'refinery' ? 'bastion' : 'refinery', faction: 'choir' }];
      break;
    }
    case 'rustwake':
      kinds = [{ kind: 'freeport', faction: 'rustwake' }, { kind: 'salvage', faction: 'rustwake' }, { kind: 'refinery', faction: 'rustwake' }];
      break;
    case 'contested':
      kinds = [
        { kind: pick<StationKind>(['freeport', 'salvage']), faction: 'rustwake' },
        { kind: 'bastion', faction: rnd() < 0.5 ? 'concord' : 'choir' },
        { kind: 'orbital', faction: 'rustwake' },
      ];
      if (kinds[0].kind === 'salvage') kinds[2] = { kind: 'freeport', faction: 'rustwake' };
      break;
    default:
      kinds = sys.faction === 'unknown' ? [{ kind: 'bastion', faction: 'concord' }]
        : [{ kind: 'freeport', faction: sys.faction }, { kind: 'orbital', faction: sys.faction }];
  }
  if (!hasPlanet) kinds = kinds.filter((k) => k.kind !== 'orbital');
  const count = Math.min(kinds.length, 1 + Math.floor(rnd() * 3));
  let gateIdx = 0;
  return kinds.slice(0, count).map((k) => {
    const planetSite = hasPlanet && (k.kind === 'orbital' || (k.kind === 'refinery' && bigPlanet));
    return { ...k, site: planetSite ? 'planet' : 'gate', index: planetSite ? (k.kind === 'refinery' ? 1 : 0) : gateIdx++ };
  });
}

/**
 * Trade risk of a system, 0..1 (drives the economy's hazard premium).
 * Home space and quiet Rustwake lanes sit at their low threat; contested
 * lines and Hegemony space are dangerous for a Directorate pilot; the Null
 * Lantern and anything one lane from it (the Dead Zone's shadow) top out.
 */
export function systemRisk(threat: number, faction: StationSystemInput['faction'], nearNull = false): number {
  const r = faction === 'unknown' ? 1 : threat + (nearNull ? 0.3 : 0);
  return Math.round(Math.min(1, Math.max(0, r)) * 100) / 100;
}

const _up = new Vector3(0, 1, 0);

/** Any unit vector ⟂ `axis`, rolled by `roll` radians. */
function perpendicular(axis: Vector3, roll: number): Vector3 {
  const ref = Math.abs(axis.y) > 0.9 ? new Vector3(1, 0, 0) : _up;
  const a = new Vector3().crossVectors(ref, axis).normalize();
  const b = new Vector3().crossVectors(axis, a);
  return a.multiplyScalar(Math.sin(roll)).addScaledVector(b, Math.cos(roll)).normalize();
}

export function placeStations(seed: number, sys: StationSystemInput): StationSite[] {
  const rnd = mulberry32(hashStr(`${seed}:stations:${sys.id}`));
  const plan = KEY_STATIONS[sys.id]?.filter((p) => (p.site === 'planet' ? sys.planets.length > 0 : sys.gates.length > 0)) ?? proceduralPlan(sys, rnd);
  const out: StationSite[] = [];
  const usedNames = new Set<string>();
  plan.forEach((p, i) => {
    let position: Vector3;
    let axis: Vector3;
    let planet: number | undefined;
    if (p.site === 'planet' && sys.planets.length) {
      planet = p.index % sys.planets.length;
      const pl = sys.planets[planet];
      // Sunward of the planet as seen from the Lanterns, fanned out so two
      // stations on one world don't stack.
      const dir = pl.position.clone().negate().normalize();
      const fan = perpendicular(dir, rnd() * Math.PI * 2);
      const already = out.filter((o) => o.planet === planet).length;
      dir.addScaledVector(fan, already ? 0.35 + rnd() * 0.15 : (rnd() - 0.5) * 0.2).normalize();
      position = pl.position.clone().addScaledVector(dir, pl.radius + 7000 + rnd() * 5000);
      axis = dir.clone();
    } else {
      const g = sys.gates[p.index % sys.gates.length];
      const side = new Vector3().crossVectors(_up, g.normal);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      // Gate 0's belt lies at +side: stations there go the other way.
      const sgn = p.index % sys.gates.length === 0 ? -1 : rnd() < 0.5 ? -1 : 1;
      position = g.position
        .clone()
        .addScaledVector(g.normal, -(9000 + rnd() * 5000))
        .addScaledVector(side, sgn * (4000 + rnd() * 4000))
        .add(new Vector3(0, (rnd() - 0.5) * 2400, 0));
      axis = g.position.clone().sub(position).normalize();
    }
    // Keep stations at least 6 km apart: push directly away from any neighbour.
    for (let pass = 0; pass < 4; pass++) {
      for (const o of out) {
        const away = position.clone().sub(o.position);
        const d = away.length();
        if (d >= 6000) continue;
        if (d < 1) away.copy(perpendicular(axis, i * 2.1));
        position.addScaledVector(away.normalize(), 7000 - d);
      }
    }
    if (p.site === 'gate') axis = sys.gates[p.index % sys.gates.length].position.clone().sub(position).normalize();
    let name = p.name;
    if (!name) {
      const base = p.site === 'planet' && planet !== undefined ? sys.planets[planet].name : sys.name;
      const pool = SUFFIX[p.kind];
      name = `${base} ${pool[Math.floor(rnd() * pool.length)]}`;
      if (usedNames.has(name)) name = `${name} ${'II'}`;
    }
    usedNames.add(name);
    out.push({
      id: `${sys.id}-${p.kind}-${i}`,
      name,
      kind: p.kind,
      faction: p.faction,
      position,
      axis,
      up: perpendicular(axis, (rnd() - 0.5) * 0.6),
      planet,
      seed: Math.floor(rnd() * 1e6),
    });
  });
  return out;
}
