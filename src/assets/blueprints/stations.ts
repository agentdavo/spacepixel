import type { Blueprint, FactionId, Part, Vec3 } from '../Blueprint';
import { rng } from '../HullKit';
import type { StationKind } from '@/game/economy';

/**
 * Station designs (docking & trade), modelled 1:100 like the capital ships:
 * one unit = 100 m, so a station is 1–2 km end to end and its docking bay
 * mouth is 150 × 100 m — a Kestrel (18 m) disappears into it.
 *
 * Every station shares a spine: a faceted hub along +Z, the docking bay at
 * the +Z end (lit mouth frame and slope lights), and a rotating habitat ring
 * on the `spin` channel turning about the docking axis — like the old
 * orbital stations, the bay sits on the axis so the ring never matters to a
 * pilot. The kind adds the character: Ebon tanks and a skimmer boom for a
 * Lantern refinery, a gantry cradling a salvaged hull for a breakers' yard,
 * armour and turrets for a bastion, patchwork habs for a free port, and a
 * counter-rotating second ring plus tether anchor for an orbital port.
 */
export const BAY_Z = 6.05; // bay mouth plane (units)
export const BAY_DEPTH = 1.1; // how far a ship slides inside (units)

const SPIN = { id: 'spin', pivot: [0, 0, -1.5] as Vec3, axis: [0, 0, 1] as Vec3, range: [0, 360] as [number, number], channel: 'spin', mirror: false };
const SPIN2 = { id: 'spin2', pivot: [0, 0, -3.6] as Vec3, axis: [0, 0, 1] as Vec3, range: [360, 0] as [number, number], channel: 'spin', mirror: false };

function spine(): Part[] {
  return [
    {
      name: 'hub',
      paint: 'primary',
      group: 1,
      shape: {
        kind: 'lathe',
        profile: [
          [0, -5.2],
          [0.9, -5.0],
          [1.3, -4.3],
          [1.3, 2.6],
          [1.75, 3.1],
          [1.75, 4.7],
          [0, 4.7],
        ],
        segments: 10,
      },
    },
    { name: 'hub-band', paint: 'accent', pos: [0, 0, -2.2], repeat: { count: 2, step: [0, 0, 3.4] }, shape: { kind: 'rib', radius: 1.31, thickness: 0.1, depth: 0.32, arc: 360, segments: 20 } },
    { name: 'hub-collar', paint: 'secondary', pos: [0, 0, 3.9], shape: { kind: 'rib', radius: 1.8, thickness: 0.16, depth: 0.5, arc: 360, segments: 20, c: 0.04 } },
    // Docking bay: armoured block, dark mouth, lit frame.
    { name: 'bay-block', paint: 'secondary', pos: [0, 0, 5.35], shape: { kind: 'box', w: 2.7, h: 2.0, d: 1.4, c: 0.3 } },
    { name: 'bay-hood', paint: 'primary', pos: [0, 0.98, 5.5], shape: { kind: 'box', w: 2.2, h: 0.14, d: 1.2, c: 0.05 } },
    { name: 'bay-mouth', paint: 'dark', pos: [0, 0, BAY_Z - 0.04], shape: { kind: 'box', w: 1.5, h: 1.0, d: 0.1, c: 0.12 } },
    { name: 'bay-deck-light', paint: 'glass', emissive: 0.9, pos: [0, -0.42, BAY_Z - 0.02], shape: { kind: 'box', w: 1.3, h: 0.04, d: 0.06 } },
    { name: 'bay-frame', paint: 'glow', emissive: 0.9, pos: [0, 0.56, BAY_Z], repeat: { count: 2, step: [0, -1.12, 0] }, shape: { kind: 'box', w: 1.62, h: 0.06, d: 0.08 } },
    { name: 'bay-frame-side', paint: 'glow', emissive: 0.9, mirror: true, pos: [0.81, 0, BAY_Z], shape: { kind: 'box', w: 0.06, h: 1.1, d: 0.08 } },
    // Slope lights (VASI) either side of the mouth.
    { name: 'vasi', paint: 'glow', emissive: 1.6, mirror: true, pos: [1.15, 0.5, BAY_Z - 0.05], repeat: { count: 4, step: [0, -0.33, 0] }, shape: { kind: 'box', w: 0.18, h: 0.08, d: 0.08 } },
    { name: 'bay-stripe', paint: 'accent', mirror: true, pos: [1.2, 0, 5.35], repeat: { count: 3, step: [0, 0, -0.35] }, shape: { kind: 'box', w: 0.32, h: 1.9, d: 0.1 } },
    { name: 'aft-cap', paint: 'metal', pos: [0, 0, -5.35], shape: { kind: 'rib', radius: 0.95, thickness: 0.14, depth: 0.3, arc: 360, segments: 16 } },
  ];
}

function ring(radius: number, tube: number, spokes: number, z: number, joint: string, paint: Part['paint'] = 'primary'): Part[] {
  return [
    { name: 'ring', paint, articulation: joint, pos: [0, 0, z], shape: { kind: 'torus', radius, tube, segments: 40, tubeSegments: 6 } },
    {
      name: 'ring-band',
      paint: 'secondary',
      articulation: joint,
      pos: [0, 0, z],
      shape: { kind: 'rib', radius: radius - tube * 0.2, thickness: tube * 0.25, depth: tube * 2.3, arc: 360, segments: 40 },
    },
    {
      name: 'spoke',
      paint: 'metal',
      articulation: joint,
      pos: [0, (radius + 1.25) / 2, z],
      repeat: { count: spokes, rot: [0, 0, 360 / spokes] },
      shape: { kind: 'box', w: 0.3, h: radius - 1.3, d: 0.4, c: 0.06 },
    },
    {
      name: 'ring-windows',
      paint: 'glass',
      emissive: 0.8,
      articulation: joint,
      pos: [0, radius + tube * 0.93, z],
      repeat: { count: 30, rot: [0, 0, 12] },
      shape: { kind: 'box', w: 0.32, h: 0.05, d: 0.26 },
    },
  ];
}

function refinery(r: () => number): Part[] {
  const tanks = 5 + Math.floor(r() * 3);
  return [
    ...ring(5 + r() * 0.8, 0.4, 3, -1.5, 'spin'),
    {
      name: 'ebon-tank',
      paint: 'dark',
      pos: [0, 2.35, -3.4],
      scale: [1, 1, 1.45],
      repeat: { count: tanks, rot: [0, 0, 360 / tanks] },
      shape: { kind: 'dome', radius: 0.95, segments: 12 },
    },
    // Black-light seals: the dark gets darker and the edges glow violet.
    {
      name: 'ebon-seal',
      paint: 'glow',
      color: '#b56bff',
      emissive: 1.3,
      pos: [0, 2.35, -3.4],
      repeat: { count: tanks, rot: [0, 0, 360 / tanks] },
      shape: { kind: 'rib', radius: 0.98, thickness: 0.06, depth: 0.14, arc: 360, segments: 16 },
    },
    { name: 'boom', paint: 'metal', pos: [0, 0, -8.6], shape: { kind: 'box', w: 0.34, h: 0.34, d: 6.8, c: 0.08 } },
    { name: 'boom-strut', paint: 'secondary', mirror: true, pos: [0.4, 0, -7.4], rot: [0, 0, 45], shape: { kind: 'box', w: 0.14, h: 0.9, d: 3.4 } },
    {
      name: 'skimmer',
      paint: 'secondary',
      shape: {
        kind: 'lathe',
        profile: [
          [0.25, -12.8],
          [2.3, -13.6],
          [2.5, -13.3],
          [0.55, -12.0],
        ],
        segments: 12,
      },
    },
    { name: 'skimmer-lip', paint: 'glow', color: '#b56bff', emissive: 1.5, pos: [0, 0, -13.5], shape: { kind: 'rib', radius: 2.42, thickness: 0.06, depth: 0.12, arc: 360, segments: 24 } },
    { name: 'refinery-greeble', paint: 'metal', trim: 'dark', pos: [0, 1.3, 0.2], rot: [0, 0, 0], shape: { kind: 'greeble', w: 1.4, d: 4.0, count: 22, seed: Math.floor(r() * 99), size: [0.08, 0.3], height: [0.05, 0.2] } },
  ];
}

function salvage(r: () => number, faction: FactionId): Part[] {
  const prize: FactionId = faction === 'choir' ? 'concord' : r() < 0.5 ? 'choir' : 'concord';
  const parts: Part[] = [
    // A broken ring: the yard never finished it (or took the rest for scrap).
    { name: 'ring', paint: 'primary', articulation: 'spin', pos: [0, 0, -1.5], shape: { kind: 'rib', radius: 5.4, thickness: 0.7, depth: 0.9, arc: 285, start: 30, segments: 30, c: 0.15 } },
    { name: 'ring-spoke', paint: 'metal', articulation: 'spin', pos: [0, 3.35, -1.5], repeat: { count: 3, rot: [0, 0, 120] }, shape: { kind: 'box', w: 0.3, h: 4.1, d: 0.4 } },
    {
      name: 'ring-windows',
      paint: 'glass',
      emissive: 0.8,
      articulation: 'spin',
      pos: [0, 5.76, -1.5],
      repeat: { count: 22, rot: [0, 0, 12] },
      shape: { kind: 'box', w: 0.32, h: 0.05, d: 0.26 },
    },
    // Gantry cradle aft of the hub.
    { name: 'longeron', paint: 'metal', mirror: true, pos: [2.2, 1.5, -8.4], repeat: { count: 2, step: [0, -3.0, 0] }, shape: { kind: 'box', w: 0.26, h: 0.26, d: 7.2 } },
    { name: 'frame', paint: 'accent', pos: [0, 1.5, -5.4], repeat: { count: 4, step: [0, 0, -2.0] }, shape: { kind: 'box', w: 4.7, h: 0.22, d: 0.22 } },
    { name: 'frame-low', paint: 'metal', pos: [0, -1.5, -5.4], repeat: { count: 4, step: [0, 0, -2.0] }, shape: { kind: 'box', w: 4.7, h: 0.22, d: 0.22 } },
    { name: 'upright', paint: 'metal', mirror: true, pos: [2.2, 0, -5.4], repeat: { count: 4, step: [0, 0, -2.0] }, shape: { kind: 'box', w: 0.22, h: 3.2, d: 0.22 } },
    // The prize: half a warship, still in its old paint.
    {
      name: 'wreck',
      paint: 'primary',
      livery: prize,
      pos: [0.2, -0.1, -8.4],
      rot: [4, 8, 14],
      shape: {
        kind: 'loft',
        stations: [
          { z: -2.6, w: 1.5, wb: 1.2, h: 1.1, c: 0.3 },
          { z: 0.8, w: 1.9, wb: 1.4, h: 1.35, c: 0.35 },
          { z: 2.6, w: 0.9, wb: 0.5, h: 0.6, y: -0.15, c: 0.2 },
        ],
      },
    },
    { name: 'wreck-band', paint: 'accent', livery: prize, pos: [0.2, -0.1, -8.4], rot: [4, 8, 14], shape: { kind: 'box', w: 1.96, h: 1.4, d: 0.25, c: 0.35 } },
    { name: 'breach', paint: 'glow', emissive: 1.2, color: '#ffae4f', pos: [0.15, -0.1, -11.0], rot: [4, 8, 14], shape: { kind: 'box', w: 1.2, h: 0.9, d: 0.05 } },
    { name: 'crane', paint: 'accent', mirror: true, pos: [1.6, 1.6, -6.6], rot: [0, 20, 35], shape: { kind: 'box', w: 0.16, h: 0.16, d: 3.2 } },
    { name: 'crane-2', paint: 'accent', pos: [-1.0, -1.7, -9.8], rot: [0, -25, -30], shape: { kind: 'box', w: 0.16, h: 0.16, d: 2.6 } },
    { name: 'floods', paint: 'glow', emissive: 1.6, mirror: true, pos: [2.2, 1.7, -5.4], repeat: { count: 4, step: [0, 0, -2.0] }, shape: { kind: 'box', w: 0.14, h: 0.14, d: 0.14 } },
    { name: 'scrap-greeble', paint: 'metal', trim: 'dark', pos: [0, 1.3, -1.0], shape: { kind: 'greeble', w: 1.6, d: 5.0, count: 26, seed: Math.floor(r() * 99), size: [0.1, 0.4], height: [0.05, 0.25] } },
  ];
  return parts;
}

function bastion(r: () => number): Part[] {
  const tur = (pos: Vec3, rot: Vec3, id: string): Part => ({
    name: id,
    paint: 'primary',
    trim: 'metal',
    pos,
    rot,
    socket: { id, kind: 'turret' },
    shape: { kind: 'turret', radius: 0.45, height: 0.45, barrels: 2, barrelLength: 1.3, barrelRadius: 0.06 },
  });
  return [
    ...ring(6.3 + r() * 0.5, 0.5, 4, -1.5, 'spin'),
    {
      name: 'armour',
      paint: 'primary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -5.0, w: 3.6, h: 3.6, c: 1.1 },
          { z: -3.8, w: 4.4, h: 4.4, c: 1.35 },
          { z: 2.4, w: 4.4, h: 4.4, c: 1.35 },
          { z: 3.9, w: 3.0, h: 3.0, c: 0.9 },
        ],
      },
    },
    { name: 'armour-band', paint: 'accent', pos: [0, 0, 1.6], shape: { kind: 'box', w: 4.5, h: 4.5, d: 0.3, c: 1.38 } },
    { name: 'armour-band-2', paint: 'secondary', pos: [0, 0, -3.0], shape: { kind: 'box', w: 4.5, h: 4.5, d: 0.6, c: 1.38 } },
    tur([0, 2.2, 0.4], [0, 0, 0], 'top'),
    tur([0, -2.2, 0.4], [0, 0, 180], 'bottom'),
    tur([2.2, 0, 0.4], [0, 0, -90], 'right'),
    tur([-2.2, 0, 0.4], [0, 0, 90], 'left'),
    tur([0, 2.2, -2.2], [0, 180, 0], 'top-aft'),
    tur([0, -2.2, -2.2], [0, 180, 180], 'bottom-aft'),
    { name: 'mast', paint: 'metal', pos: [0, 3.2, -4.2], shape: { kind: 'box', w: 0.12, h: 2.6, d: 0.12 } },
    { name: 'mast-yard', paint: 'metal', pos: [0, 4.2, -4.2], shape: { kind: 'box', w: 1.6, h: 0.08, d: 0.08 } },
    { name: 'ring-armour', paint: 'secondary', articulation: 'spin', pos: [0, 0, -1.5], repeat: { count: 8, rot: [0, 0, 45] }, shape: { kind: 'box', w: 1.2, h: 0.2, d: 1.2, c: 0.05 } },
    { name: 'bastion-greeble', paint: 'metal', trim: 'dark', pos: [0, 2.2, -0.9], shape: { kind: 'greeble', w: 2.2, d: 2.6, count: 16, seed: Math.floor(r() * 99), size: [0.1, 0.35], height: [0.05, 0.2] } },
  ];
}

function freeport(r: () => number): Part[] {
  const liveries: FactionId[] = ['rustwake', 'concord', 'choir', 'rustwake'];
  const parts: Part[] = [...ring(5.2 + r() * 0.8, 0.42, 3, -1.5, 'spin', 'secondary')];
  const n = 9 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const a = r() * 360;
    const z = -4.2 + r() * 6.2;
    const w = 0.8 + r() * 1.0;
    const h = 0.6 + r() * 0.7;
    const d = 0.8 + r() * 1.4;
    const rad = 1.3 + h / 2;
    const rot: Vec3 = [0, 0, a];
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    const pos: Vec3 = [-s * rad, c * rad, z];
    parts.push({ name: `hab-${i}`, paint: r() < 0.3 ? 'secondary' : 'primary', livery: liveries[Math.floor(r() * liveries.length)], pos, rot, shape: { kind: 'box', w, h, d, c: 0.1 } });
    parts.push({ name: `hab-lights-${i}`, paint: 'glass', emissive: 0.8, pos: [-s * (rad + h / 2 + 0.01), c * (rad + h / 2 + 0.01), z], rot, shape: { kind: 'box', w: w * 0.8, h: 0.04, d: 0.12 } });
  }
  // Moot signs: loud neon, every clan's colour.
  parts.push({ name: 'sign', paint: 'glow', color: '#ff5fb4', emissive: 1.6, pos: [0, 2.6, 2.0], shape: { kind: 'box', w: 1.8, h: 0.2, d: 0.06 } });
  parts.push({ name: 'sign-2', paint: 'glow', color: '#7dffb2', emissive: 1.6, pos: [0, 2.3, 2.0], shape: { kind: 'box', w: 1.2, h: 0.12, d: 0.06 } });
  parts.push({ name: 'sign-post', paint: 'metal', pos: [0, 2.0, 2.0], shape: { kind: 'box', w: 0.1, h: 1.4, d: 0.1 } });
  parts.push({ name: 'antenna', paint: 'metal', pos: [0, -2.4, -3.2], rot: [0, 0, 180], shape: { kind: 'box', w: 0.08, h: 2.4, d: 0.08 } });
  parts.push({ name: 'dish', paint: 'primary', pos: [0, -3.6, -3.2], rot: [90, 0, 0], shape: { kind: 'dome', radius: 0.55, segments: 10, hemisphere: true, scale: [1, 0.35, 1] } });
  return parts;
}

function orbital(r: () => number): Part[] {
  return [
    ...ring(6.0 + r() * 0.6, 0.45, 4, -1.5, 'spin'),
    ...ring(4.4, 0.34, 3, -3.6, 'spin2', 'secondary'),
    // Tether anchor: the landing corridor drops out of here to the atmosphere.
    {
      name: 'anchor',
      paint: 'metal',
      shape: {
        kind: 'lathe',
        profile: [
          [0.25, -8.5],
          [0.7, -7.4],
          [1.1, -5.6],
          [1.0, -5.0],
        ],
        segments: 10,
      },
    },
    { name: 'anchor-light', paint: 'glow', emissive: 1.5, pos: [0, 0, -7.6], shape: { kind: 'rib', radius: 0.66, thickness: 0.06, depth: 0.12, arc: 360, segments: 16 } },
    { name: 'vane', paint: 'dark', mirror: true, pos: [1.7, 0, 2.2], shape: { kind: 'wing', root: 1.6, tip: 1.3, span: 3.6, sweep: 0.2, thickness: 0.07, tipThickness: 0.06 } },
    { name: 'vane-edge', paint: 'accent', mirror: true, pos: [5.3, 0, 2.05], shape: { kind: 'box', w: 0.1, h: 0.1, d: 1.35 } },
    { name: 'port-greeble', paint: 'metal', trim: 'dark', pos: [0, 1.3, 0.5], shape: { kind: 'greeble', w: 1.4, d: 3.2, count: 18, seed: Math.floor(r() * 99), size: [0.08, 0.3], height: [0.05, 0.18] } },
  ];
}

const cache = new Map<string, Blueprint>();

/** A station design for a kind + faction; `seed` varies proportions and greebles. */
export function stationBlueprint(kind: Exclude<StationKind, 'carrier'>, faction: FactionId, seed: number): Blueprint {
  const key = `${kind}:${faction}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rng(seed + 1);
  const extra = kind === 'refinery' ? refinery(r) : kind === 'salvage' ? salvage(r, faction) : kind === 'bastion' ? bastion(r) : kind === 'freeport' ? freeport(r) : orbital(r);
  const bp: Blueprint = {
    id: `station-${key}`,
    name: 'Station',
    designation: kind.toUpperCase(),
    faction,
    shipClass: 'dreadnought',
    scale: 100,
    ramp: 'classic',
    parts: [...spine(), ...extra],
    engines: [],
    articulations: kind === 'orbital' ? [SPIN, SPIN2] : [SPIN],
    hardpoints: [{ id: 'bay', pos: [0, 0, BAY_Z], kind: 'hangar' }],
  };
  cache.set(key, bp);
  return bp;
}
