import type { Blueprint, Part, Paint, Station, Vec3 } from '../Blueprint';
import { band, sideX, topAt } from './kit';
import { hollowBay } from './bays';

/** Upright cylinder (lofted along Z, stood on Y) — masts, barbettes, stacks. */
function post(name: string, paint: Paint, pos: Vec3, rBottom: number, rTop: number, height: number, segments = 8): Part {
  return {
    name,
    paint,
    pos: [pos[0], pos[1] + height / 2, pos[2]],
    rot: [-90, 0, 0],
    shape: { kind: 'cylinder', rFront: rTop, rBack: rBottom, length: height, segments },
  };
}

/** Engine bell: open cylinder facing aft. */
function bell(name: string, pos: Vec3, r: number, length: number, mirror = false): Part {
  return {
    name,
    paint: 'dark',
    mirror,
    pos,
    shape: { kind: 'cylinder', rFront: r * 0.84, rBack: r, length, segments: 12, open: true },
  };
}

/** Armour belt: plates following the hull side at height y. */
function belt(stations: Station[], zs: number[], y: number, h: number, d: number, paint: Paint = 'secondary'): Part[] {
  return zs.map((z) => ({
    name: 'belt',
    paint,
    mirror: true,
    pos: [sideX(stations, z, y) + 0.04, y, z] as Vec3,
    shape: { kind: 'box' as const, w: 0.12, h, d, c: 0.04 },
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// FFC LANTERN GUARD — gate picket corvette, ~165 m (modelled 1:10)
// ═════════════════════════════════════════════════════════════════════════

const LG_HULL: Station[] = [
  { z: -7.0, w: 2.4, wb: 2.0, h: 1.8, y: 0.0, c: 0.45 },
  { z: -2.0, w: 2.8, wb: 2.2, h: 2.1, y: 0.05, c: 0.55 },
  { z: 3.5, w: 2.5, wb: 1.7, h: 1.9, y: 0.0, c: 0.5 },
  { z: 6.5, w: 1.3, wb: 0.7, h: 1.1, y: -0.25, c: 0.3 },
  { z: 7.8, w: 0.3, wb: 0.2, h: 0.35, y: -0.4, c: 0.1 },
];
const lgTop = (z: number) => topAt(LG_HULL, z);

export const LANTERN_GUARD: Blueprint = {
  id: 'ffc-lantern-guard',
  name: 'Lantern Guard',
  designation: 'FFC-12',
  faction: 'concord',
  shipClass: 'corvette',
  scale: 10,
  ramp: 'classic',
  notes:
    'Gate picket. Sits beside a Lantern for months at a time listening for anything coming through, and is expected to die buying the fleet ninety seconds.',
  parts: [
    { name: 'hull', paint: 'primary', group: 1, shape: { kind: 'loft', stations: LG_HULL } },
    {
      name: 'keel',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.8, w: 1.6, wb: 1.0, h: 0.8, y: -1.0, c: 0.3 },
          { z: 4.5, w: 1.4, wb: 0.8, h: 0.8, y: -0.9, c: 0.28 },
          { z: 7.2, w: 0.3, wb: 0.2, h: 0.3, y: -0.6 },
        ],
      },
    },
    { name: 'bow-band', paint: 'accent', shape: band(LG_HULL, 5.0, 5.4, 0.02) },
    { name: 'aft-band', paint: 'secondary', shape: band(LG_HULL, -6.3, -5.7, 0.02) },
    ...belt(LG_HULL, [2.4, -0.2, -2.8], 0.1, 0.75, 2.4),
    // Superstructure.
    { name: 'deckhouse', paint: 'primary', pos: [0, 1.45, -0.9], shape: { kind: 'box', w: 1.7, h: 0.9, d: 3.4, c: 0.2 } },
    {
      name: 'bridge',
      paint: 'primary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -1.8, w: 1.3, h: 0.7, y: 2.25, c: 0.15 },
          { z: 0.3, w: 1.3, h: 0.7, y: 2.25, c: 0.15 },
          { z: 0.75, w: 1.1, h: 0.45, y: 2.15, c: 0.1 },
        ],
      },
    },
    { name: 'bridge-windows', paint: 'glass', emissive: 0.5, pos: [0, 2.36, -0.45], shape: { kind: 'box', w: 1.34, h: 0.12, d: 1.8 } },
    { name: 'bridge-wings', paint: 'secondary', pos: [0, 2.42, 0.05], shape: { kind: 'box', w: 2.6, h: 0.14, d: 0.5, c: 0.04 } },
    { name: 'deckhouse-stripe', paint: 'accent', pos: [0, 1.6, 0.81], shape: { kind: 'box', w: 1.72, h: 0.14, d: 0.04 } },
    {
      name: 'port-lights',
      paint: 'glass',
      emissive: 0.6,
      mirror: true,
      pos: [0.86, 1.55, 0.3],
      repeat: { count: 6, step: [0, 0, -0.5] },
      shape: { kind: 'box', w: 0.04, h: 0.12, d: 0.22 },
    },
    post('mast', 'metal', [0, 2.55, -1.0], 0.1, 0.05, 2.0, 6),
    { name: 'yardarm', paint: 'metal', pos: [0, 3.95, -1.0], shape: { kind: 'box', w: 1.4, h: 0.06, d: 0.08 } },
    { name: 'lantern', paint: 'glass', emissive: 0.8, pos: [0, 2.6, -1.2], shape: { kind: 'dome', radius: 0.26, segments: 10, hemisphere: true } },
    // Rotating search radar.
    { name: 'radar-post', paint: 'metal', articulation: 'radar', pos: [0, 4.65, -1.0], shape: { kind: 'box', w: 0.1, h: 0.25, d: 0.1 } },
    { name: 'radar', paint: 'secondary', articulation: 'radar', pos: [0, 4.9, -1.0], rot: [-12, 0, 0], shape: { kind: 'box', w: 1.3, h: 0.42, d: 0.08, c: 0.03 } },
    // Main guns: A, superfiring B, aft C.
    {
      name: 'turret-a',
      paint: 'primary',
      trim: 'metal',
      pos: [0, lgTop(4.3) - 0.02, 4.3],
      socket: { id: 'main-a', kind: 'turret' },
      rig: { traverse: [-150, 150], elevation: [-10, 75] }, // B's barbette aft
      shape: { kind: 'turret', radius: 0.5, height: 0.55, barrels: 2, barrelLength: 1.4, barrelRadius: 0.07 },
    },
    post('barbette-b', 'secondary', [0, lgTop(2.7) - 0.05, 2.7], 0.46, 0.42, 0.45, 8),
    {
      name: 'turret-b',
      paint: 'primary',
      trim: 'metal',
      pos: [0, lgTop(2.7) + 0.4, 2.7],
      socket: { id: 'main-b', kind: 'turret' },
      rig: { traverse: [-150, 150], elevation: [-10, 75] }, // the bridge aft
      shape: { kind: 'turret', radius: 0.5, height: 0.55, barrels: 2, barrelLength: 1.4, barrelRadius: 0.07 },
    },
    {
      name: 'turret-c',
      paint: 'primary',
      trim: 'metal',
      pos: [0, lgTop(-4.4) - 0.02, -4.4],
      rot: [0, 180, 0],
      socket: { id: 'main-c', kind: 'turret' },
      rig: { traverse: [-150, 150], elevation: [-10, 75] }, // the deckhouse forward
      shape: { kind: 'turret', radius: 0.5, height: 0.55, barrels: 2, barrelLength: 1.4, barrelRadius: 0.07 },
    },
    // Missile cells.
    { name: 'vls-frame', paint: 'secondary', pos: [0, lgTop(-3.1) - 0.01, -3.1], shape: { kind: 'box', w: 1.5, h: 0.05, d: 0.9 } },
    {
      name: 'vls',
      paint: 'dark',
      pos: [-0.51, lgTop(-3.1) + 0.02, -2.9],
      repeat: { count: 4, step: [0.34, 0, 0] },
      shape: { kind: 'box', w: 0.26, h: 0.04, d: 0.26 },
    },
    {
      name: 'vls-2',
      paint: 'dark',
      pos: [-0.51, lgTop(-3.1) + 0.02, -3.3],
      repeat: { count: 4, step: [0.34, 0, 0] },
      shape: { kind: 'box', w: 0.26, h: 0.04, d: 0.26 },
    },
    {
      name: 'aft-greebles',
      paint: 'metal',
      trim: 'dark',
      pos: [0, lgTop(-5.7) - 0.02, -5.7],
      shape: { kind: 'greeble', w: 1.5, d: 1.4, count: 14, seed: 31, size: [0.1, 0.32], height: [0.04, 0.14] },
    },
    // Point-defence sponsons.
    { name: 'sponson', paint: 'primary', mirror: true, pos: [sideX(LG_HULL, 0.9, 0.55) + 0.18, 0.55, 0.9], shape: { kind: 'box', w: 0.55, h: 0.45, d: 1.6, c: 0.12 } },
    {
      name: 'pd-turret',
      paint: 'secondary',
      trim: 'metal',
      mirror: true,
      pos: [sideX(LG_HULL, 0.9, 0.55) + 0.2, 0.77, 0.9],
      rot: [0, 35, 0],
      socket: { id: 'pd', kind: 'turret' },
      rig: { traverse: [-130, 145] }, // across the forecastle, not through the deckhouse
      shape: { kind: 'turret', radius: 0.2, height: 0.22, barrels: 1, barrelLength: 0.55, barrelRadius: 0.04 },
    },
    // Radiators, fins, drive.
    {
      name: 'radiator',
      paint: 'dark',
      mirror: true,
      pos: [1.05, 0.35, -4.7],
      rot: [0, 0, 8],
      shape: { kind: 'wing', root: 2.4, tip: 1.4, span: 1.3, sweep: 0.9, thickness: 0.1, tipThickness: 0.08 },
    },
    {
      name: 'radiator-edge',
      paint: 'accent',
      mirror: true,
      pos: [2.33, 0.53, -5.6],
      rot: [0, 0, 8],
      shape: { kind: 'wing', root: 1.42, tip: 1.4, span: 0.08, sweep: 0.0, thickness: 0.12 },
    },
    {
      name: 'ventral-fin',
      paint: 'secondary',
      pos: [0, -1.35, -3.6],
      rot: [0, 0, -90],
      shape: { kind: 'wing', root: 3.2, tip: 1.4, span: 1.0, sweep: 1.5, thickness: 0.14 },
    },
    {
      name: 'drive-block',
      paint: 'metal',
      shape: {
        kind: 'loft',
        stations: [
          { z: -7.9, w: 2.3, h: 1.75, c: 0.45 },
          { z: -6.9, w: 2.45, h: 1.85, c: 0.5 },
        ],
      },
    },
    bell('bell', [0.72, -0.3, -8.3], 0.46, 0.8, true),
    bell('bell-top', [0, 0.45, -8.3], 0.46, 0.8),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [1.33, 2.42, 0.05], shape: { kind: 'box', w: 0.08, h: 0.1, d: 0.2 } },
  ],
  engines: [
    { pos: [0.72, -0.3, -8.72], radius: 0.4, plume: 4.5, mirror: true },
    { pos: [0, 0.45, -8.72], radius: 0.4, plume: 4.5 },
  ],
  articulations: [{ id: 'radar', pivot: [0, 4.55, -1.0], axis: [0, 1, 0], range: [0, 360], channel: 'radar', mirror: false }],
  hardpoints: [{ id: 'bridge', pos: [0, 2.6, 0.8], kind: 'gun' }],
};

// ═════════════════════════════════════════════════════════════════════════
// CVS-07 HESPERUS DAWN — fleet carrier, ~1.45 km (modelled 1:100)
// ═════════════════════════════════════════════════════════════════════════

const CV_HULL: Station[] = [
  { z: -6.4, w: 2.5, wb: 2.1, h: 1.7, y: 0.0, c: 0.3 },
  { z: -2.0, w: 2.7, wb: 2.2, h: 1.8, y: 0.0, c: 0.35 },
  { z: 4.0, w: 2.6, wb: 2.0, h: 1.75, y: 0.0, c: 0.35 },
  { z: 6.3, w: 2.3, wb: 1.4, h: 1.5, y: -0.1, c: 0.35 },
  { z: 6.9, w: 2.1, wb: 1.2, h: 1.3, y: -0.15, c: 0.3 },
];
const CV_POD: Station[] = [
  { z: -5.2, w: 1.25, h: 1.25, x: 2.3, y: -0.35, c: 0.3 },
  { z: 4.6, w: 1.3, h: 1.35, x: 2.3, y: -0.35, c: 0.35 },
  { z: 5.8, w: 1.2, h: 1.25, x: 2.3, y: -0.35, c: 0.3 },
];
const DECK_Y = 0.97;
const DECK_TOP = DECK_Y + 0.06;
/** Bow hangar (hollow): mouth plane, back wall and opening, in units (1 = 100 m). */
export const CV_BAY = { y: 0.05, mouth: 7.6, back: 6.92, w: 1.3, h: 0.7 };
const ISLAND_X = 1.25;

export const HESPERUS_DAWN: Blueprint = {
  id: 'cvs07-hesperus-dawn',
  name: 'Hesperus Dawn',
  designation: 'CVS-07',
  faction: 'concord',
  shipClass: 'carrier',
  scale: 100,
  ramp: 'classic',
  notes:
    "Vanguard's mothership: pulled out of reserve, patched twice, and still the only carrier in the Reach with a hangar deck you can fly straight through.",
  parts: [
    { name: 'hull', paint: 'primary', group: 1, shape: { kind: 'loft', stations: CV_HULL } },
    {
      name: 'keel',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.0, w: 1.6, wb: 0.9, h: 0.7, y: -1.05, c: 0.25 },
          { z: 5.5, w: 1.3, wb: 0.7, h: 0.6, y: -0.95, c: 0.22 },
          { z: 6.8, w: 0.6, wb: 0.3, h: 0.4, y: -0.8, c: 0.1 },
        ],
      },
    },
    { name: 'bow-band', paint: 'accent', shape: band(CV_HULL, 5.7, 6.0, 0.02) },
    { name: 'hull-band', paint: 'secondary', shape: band(CV_HULL, -4.6, -4.0, 0.02) },
    // Flight deck (overhangs the hull), angled deck to port.
    {
      name: 'deck',
      paint: 'dark',
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.3, w: 3.0, h: 0.12, y: DECK_Y, c: 0.03 },
          { z: 4.8, w: 3.0, h: 0.12, y: DECK_Y, c: 0.03 },
          { z: 7.2, w: 2.0, h: 0.12, y: DECK_Y, c: 0.03 },
        ],
      },
    },
    { name: 'angled-deck', paint: 'dark', pos: [-1.55, DECK_Y, 2.2], rot: [0, -9, 0], shape: { kind: 'box', w: 1.0, h: 0.12, d: 5.6, c: 0.03 } },
    { name: 'angled-sponson', paint: 'primary', pos: [-1.5, DECK_Y - 0.3, 2.0], rot: [0, -9, 0], shape: { kind: 'box', w: 0.7, h: 0.5, d: 3.6, c: 0.1 } },
    { name: 'deck-edge', paint: 'primary', mirror: true, pos: [1.5, DECK_Y - 0.12, -0.8], shape: { kind: 'box', w: 0.1, h: 0.14, d: 11.0, c: 0.03 } },
    // Deck markings.
    {
      name: 'centreline',
      paint: 'primary',
      pos: [0, DECK_TOP + 0.005, -5.4],
      repeat: { count: 14, step: [0, 0, 0.8] },
      shape: { kind: 'box', w: 0.05, h: 0.02, d: 0.34 },
    },
    { name: 'angled-line', paint: 'accent', pos: [-1.55, DECK_TOP + 0.005, 2.2], rot: [0, -9, 0], shape: { kind: 'box', w: 0.04, h: 0.02, d: 5.4 } },
    { name: 'catapult', paint: 'accent', mirror: true, pos: [0.55, DECK_TOP + 0.005, 5.2], shape: { kind: 'box', w: 0.05, h: 0.02, d: 3.6 } },
    {
      name: 'catapult-lights',
      paint: 'glow',
      emissive: 1.4,
      mirror: true,
      pos: [0.64, DECK_TOP + 0.01, 3.6],
      repeat: { count: 9, step: [0, 0, 0.42] },
      shape: { kind: 'box', w: 0.03, h: 0.03, d: 0.1 },
    },
    {
      name: 'elevator',
      paint: 'metal',
      pos: [-0.85, DECK_TOP, -1.2],
      repeat: { count: 2, step: [0, 0, -2.2] },
      shape: { kind: 'box', w: 0.7, h: 0.02, d: 0.7 },
    },
    {
      name: 'deck-lights',
      paint: 'glow',
      emissive: 1.4,
      mirror: true,
      pos: [1.47, DECK_TOP + 0.01, 4.4],
      repeat: { count: 12, step: [0, 0, -0.9] },
      shape: { kind: 'box', w: 0.04, h: 0.03, d: 0.12 },
    },
    { name: 'deck-patch', paint: 'metal', pos: [0.3, DECK_TOP, -3.7], rot: [0, 6, 0], shape: { kind: 'box', w: 0.5, h: 0.015, d: 0.4 } },
    // Island superstructure (starboard).
    { name: 'island', paint: 'primary', pos: [ISLAND_X, DECK_TOP + 0.45, -0.9], shape: { kind: 'box', w: 0.55, h: 0.9, d: 2.0, c: 0.08 } },
    { name: 'island-stripe', paint: 'accent', pos: [ISLAND_X, DECK_TOP + 0.7, -0.9], shape: { kind: 'box', w: 0.57, h: 0.1, d: 2.02, c: 0.02 } },
    { name: 'island-upper', paint: 'primary', pos: [ISLAND_X, DECK_TOP + 1.15, -0.7], shape: { kind: 'box', w: 0.5, h: 0.5, d: 1.3, c: 0.06 } },
    { name: 'island-bridge', paint: 'secondary', pos: [ISLAND_X, DECK_TOP + 1.52, -0.4], shape: { kind: 'box', w: 0.72, h: 0.28, d: 0.9, c: 0.05 } },
    { name: 'island-windows', paint: 'glass', emissive: 0.6, pos: [ISLAND_X, DECK_TOP + 1.55, -0.3], shape: { kind: 'box', w: 0.74, h: 0.08, d: 0.72 } },
    {
      name: 'island-ports',
      paint: 'glass',
      emissive: 0.6,
      mirror: false,
      pos: [ISLAND_X - 0.28, DECK_TOP + 0.3, -0.1],
      repeat: { count: 5, step: [0, 0, -0.35] },
      shape: { kind: 'box', w: 0.02, h: 0.06, d: 0.14 },
    },
    { name: 'island-dome', paint: 'primary', pos: [ISLAND_X, DECK_TOP + 1.4, -1.15], shape: { kind: 'dome', radius: 0.2, segments: 10, hemisphere: true } },
    post('island-mast', 'metal', [ISLAND_X, DECK_TOP + 1.66, -0.8], 0.05, 0.025, 1.0, 6),
    { name: 'island-yard', paint: 'metal', pos: [ISLAND_X, DECK_TOP + 2.2, -0.8], shape: { kind: 'box', w: 0.7, h: 0.03, d: 0.03 } },
    { name: 'radar', paint: 'secondary', articulation: 'radar', pos: [ISLAND_X, DECK_TOP + 2.78, -0.8], rot: [-10, 0, 0], shape: { kind: 'box', w: 0.6, h: 0.2, d: 0.04, c: 0.01 } },
    // Hangar pods: bow mouths, side bays, pylons, point defence.
    { name: 'pod', paint: 'primary', mirror: true, shape: { kind: 'loft', stations: CV_POD } },
    { name: 'pod-band', paint: 'accent', mirror: true, shape: band(CV_POD, 4.0, 4.3, 0.02) },
    { name: 'pod-band-aft', paint: 'secondary', mirror: true, shape: band(CV_POD, -4.4, -3.6, 0.02) },
    { name: 'pod-mouth', paint: 'dark', mirror: true, pos: [2.3, -0.35, 5.82], shape: { kind: 'box', w: 0.95, h: 0.85, d: 0.1, c: 0.2 } },
    {
      name: 'pod-mouth-lights',
      paint: 'glow',
      emissive: 1.2,
      mirror: true,
      pos: [2.3, 0.12, 5.84],
      repeat: { count: 2, step: [0, -0.94, 0] },
      shape: { kind: 'box', w: 0.9, h: 0.04, d: 0.06 },
    },
    {
      name: 'side-bay',
      paint: 'dark',
      mirror: true,
      pos: [2.94, -0.35, 3.3],
      repeat: { count: 5, step: [0, 0, -1.35] },
      shape: { kind: 'box', w: 0.06, h: 0.45, d: 0.8, c: 0.04 },
    },
    {
      name: 'side-bay-light',
      paint: 'glow',
      emissive: 1.0,
      mirror: true,
      pos: [2.96, -0.08, 3.3],
      repeat: { count: 5, step: [0, 0, -1.35] },
      shape: { kind: 'box', w: 0.04, h: 0.03, d: 0.8 },
    },
    {
      name: 'pylon',
      paint: 'secondary',
      mirror: true,
      pos: [1.52, -0.3, 3.2],
      repeat: { count: 3, step: [0, 0, -3.4] },
      shape: { kind: 'box', w: 0.7, h: 0.35, d: 1.3, c: 0.06 },
    },
    {
      name: 'pd',
      paint: 'secondary',
      trim: 'metal',
      mirror: true,
      pos: [2.3, 0.33, 3.6],
      rot: [0, 30, 0],
      repeat: { count: 4, step: [0, 0, -2.4] },
      socket: { id: 'pd', kind: 'turret' },
      rig: { traverse: [-50, 160] }, // the hull and flight deck inboard
      shape: { kind: 'turret', radius: 0.14, height: 0.14, barrels: 2, barrelLength: 0.36, barrelRadius: 0.02 },
    },
    {
      name: 'pod-greebles',
      paint: 'metal',
      trim: 'dark',
      mirror: true,
      pos: [2.3, 0.3, -2.4],
      shape: { kind: 'greeble', w: 0.6, d: 5.0, count: 26, seed: 77, size: [0.06, 0.2], height: [0.02, 0.08] },
    },
    {
      name: 'hull-greebles',
      paint: 'metal',
      trim: 'dark',
      mirror: true,
      pos: [1.3, 0.3, 0.2],
      rot: [0, 0, -90],
      shape: { kind: 'greeble', w: 0.8, d: 11.0, count: 50, seed: 5, size: [0.06, 0.24], height: [0.02, 0.06] },
    },
    { name: 'scorch', paint: 'dark', pos: [2.95, -0.55, -1.9], rot: [0, 0, 0], shape: { kind: 'box', w: 0.02, h: 0.3, d: 0.6 } },
    { name: 'patch', paint: 'metal', pos: [-2.95, -0.6, 0.8], shape: { kind: 'box', w: 0.02, h: 0.25, d: 0.5 } },
    bell('pod-bell', [2.3, -0.35, -5.55], 0.46, 0.7, true),
    // Bow launch bay (a hollow hangar block under the deck overhang — you
    // fly into it: see bays.ts) + stern bay.
    ...hollowBay({ id: 'bow-bay', y: CV_BAY.y, mouth: CV_BAY.mouth, back: CV_BAY.back, w: CV_BAY.w, h: CV_BAY.h, outerW: 1.8, outerH: 1.34, collarY: 0.24, collarDepth: CV_BAY.mouth - 6.8, paint: 'primary' }),
    { name: 'bow-bay-band', paint: 'accent', pos: [0, 0.83, 7.3], shape: { kind: 'box', w: 1.82, h: 0.1, d: 0.12, c: 0.03 } },
    { name: 'bow-bay-band-side', paint: 'accent', mirror: true, pos: [0.9, 0.05, 7.3], shape: { kind: 'box', w: 0.04, h: 0.7, d: 0.12 } },
    {
      name: 'drive-block',
      paint: 'metal',
      shape: {
        kind: 'loft',
        stations: [
          { z: -7.2, w: 2.4, h: 1.6, c: 0.3 },
          { z: -6.4, w: 2.5, h: 1.7, c: 0.3 },
        ],
      },
    },
    { name: 'stern-bay', paint: 'dark', pos: [0, 0.5, -7.22], shape: { kind: 'box', w: 1.3, h: 0.34, d: 0.1, c: 0.08 } },
    bell('bell', [0.78, -0.25, -7.55], 0.4, 0.7, true),
    bell('bell-centre', [0, -0.25, -7.55], 0.4, 0.7),
  ],
  engines: [
    { pos: [0.78, -0.25, -7.9], radius: 0.36, plume: 3.5, mirror: true },
    { pos: [0, -0.25, -7.9], radius: 0.36, plume: 3.5 },
    { pos: [2.3, -0.35, -5.9], radius: 0.4, plume: 3.5, mirror: true },
  ],
  articulations: [{ id: 'radar', pivot: [ISLAND_X, DECK_TOP + 2.66, -0.8], axis: [0, 1, 0], range: [0, 360], channel: 'radar', mirror: false }],
  hardpoints: [
    { id: 'bow-bay', pos: [0, CV_BAY.y, CV_BAY.mouth], kind: 'hangar' },
    { id: 'stern-bay', pos: [0, 0.5, -7.3], rot: [0, 180, 0], kind: 'hangar' },
    { id: 'pod-bay', pos: [2.3, -0.35, 5.9], kind: 'hangar', mirror: true },
    { id: 'catapult', pos: [0.55, DECK_TOP + 0.05, 3.4], kind: 'hangar', mirror: true },
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// BB INDOMITABLE — dreadnought, ~2.15 km (modelled 1:100)
// ═════════════════════════════════════════════════════════════════════════

const BB_HULL: Station[] = [
  { z: -8.6, w: 3.0, wb: 2.4, h: 2.3, y: 0.1, c: 0.55 },
  { z: -3.0, w: 3.4, wb: 2.6, h: 2.6, y: 0.1, c: 0.65 },
  { z: 4.0, w: 3.1, wb: 2.2, h: 2.4, y: 0.0, c: 0.6 },
  { z: 8.4, w: 1.9, wb: 1.0, h: 1.7, y: -0.3, c: 0.45 },
  { z: 10.6, w: 0.5, wb: 0.2, h: 0.6, y: -0.6, c: 0.15 },
];
const bbTop = (z: number) => topAt(BB_HULL, z);

/** Triple-gun main battery turret. */
function mainTurret(id: string, z: number, lift: number, aft: boolean, traverse = 150): Part[] {
  const y = bbTop(z) - 0.03;
  const parts: Part[] = [];
  if (lift > 0) parts.push(post(`${id}-barbette`, 'secondary', [0, y, z], 0.84, 0.8, lift + 0.05, 10));
  parts.push({
    name: id,
    paint: 'primary',
    trim: 'metal',
    pos: [0, y + lift, z],
    rot: aft ? [0, 180, 0] : [0, 0, 0],
    socket: { id, kind: 'turret' },
    rig: { traverse: [-traverse, traverse], elevation: [-8, 60] },
    shape: { kind: 'turret', radius: 0.88, height: 0.85, barrels: 3, barrelLength: 2.8, barrelRadius: 0.1, housing: [1.85, 0.58, 2.1] },
  });
  parts.push({ name: `${id}-roof`, paint: 'accent', pos: [0, y + lift + 0.87, z + (aft ? 0.35 : -0.35)], shape: { kind: 'box', w: 0.7, h: 0.04, d: 0.6 } });
  return parts;
}

const TOWER_Z = 1.1;
const TOWER_Y = bbTop(TOWER_Z);

export const INDOMITABLE: Blueprint = {
  id: 'bb-indomitable',
  name: 'Indomitable',
  designation: 'BB-01',
  faction: 'concord',
  shipClass: 'dreadnought',
  scale: 100,
  ramp: 'classic',
  notes: 'The last Concord dreadnought in the Reach. Her twelve main guns were designed to crack Lanterns, and nobody has asked her to try.',
  parts: [
    { name: 'hull', paint: 'primary', group: 1, shape: { kind: 'loft', stations: BB_HULL } },
    {
      name: 'keel',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -8.2, w: 2.0, wb: 1.2, h: 1.2, y: -1.3, c: 0.4 },
          { z: 5.0, w: 1.8, wb: 0.8, h: 1.2, y: -1.25, c: 0.38 },
          { z: 9.6, w: 0.4, wb: 0.2, h: 0.4, y: -0.9 },
        ],
      },
    },
    {
      name: 'ram',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: 7.0, w: 0.9, wb: 0.3, h: 0.8, y: -0.95, c: 0.25 },
          { z: 11.3, w: 0.05, h: 0.1, y: -1.05 },
        ],
      },
    },
    { name: 'bow-band', paint: 'accent', shape: band(BB_HULL, 7.3, 7.65, 0.02) },
    { name: 'stern-band', paint: 'secondary', shape: band(BB_HULL, -7.9, -7.2, 0.02) },
    ...belt(BB_HULL, [5.2, 2.9, 0.6, -1.7, -4.0, -6.3], 0.15, 0.85, 2.1),
    // Rows of lit ports along the hull.
    ...[3.6, -2.2].map(
      (z): Part => ({
        name: 'ports',
        paint: 'glass',
        emissive: 0.7,
        mirror: true,
        pos: [sideX(BB_HULL, z - 1.2, 0.72) + 0.02, 0.72, z],
        repeat: { count: 6, step: [0, 0, -0.45] },
        shape: { kind: 'box', w: 0.04, h: 0.07, d: 0.16 },
      }),
    ),
    // Main battery: A, B (superfiring) forward; X (superfiring), Y aft.
    ...mainTurret('main-a', 5.9, 0, false, 145), // masked aft by superfiring B
    ...mainTurret('main-b', 3.6, 0.55, false),
    ...mainTurret('main-x', -4.2, 0.55, true),
    ...mainTurret('main-y', -6.6, 0, true, 145), // masked forward by superfiring X
    // Pagoda tower.
    { name: 'tower-base', paint: 'primary', pos: [0, TOWER_Y + 0.55, TOWER_Z], shape: { kind: 'box', w: 1.9, h: 1.2, d: 2.8, c: 0.22 } },
    { name: 'tower-stripe', paint: 'accent', pos: [0, TOWER_Y + 0.75, TOWER_Z + 1.41], shape: { kind: 'box', w: 1.92, h: 0.16, d: 0.04 } },
    { name: 'tower-mid', paint: 'primary', pos: [0, TOWER_Y + 1.7, TOWER_Z + 0.15], shape: { kind: 'box', w: 1.3, h: 1.2, d: 2.0, c: 0.16 } },
    { name: 'tower-upper', paint: 'primary', pos: [0, TOWER_Y + 2.6, TOWER_Z + 0.3], shape: { kind: 'box', w: 1.0, h: 0.7, d: 1.4, c: 0.12 } },
    { name: 'bridge', paint: 'secondary', pos: [0, TOWER_Y + 3.1, TOWER_Z + 0.5], shape: { kind: 'box', w: 2.3, h: 0.36, d: 0.9, c: 0.06 } },
    { name: 'bridge-windows', paint: 'glass', emissive: 0.6, pos: [0, TOWER_Y + 3.13, TOWER_Z + 0.55], shape: { kind: 'box', w: 2.32, h: 0.09, d: 0.7 } },
    { name: 'director', paint: 'primary', pos: [0, TOWER_Y + 3.55, TOWER_Z + 0.25], shape: { kind: 'box', w: 0.9, h: 0.55, d: 0.9, c: 0.1 } },
    { name: 'rangefinder', paint: 'metal', pos: [0, TOWER_Y + 3.65, TOWER_Z + 0.25], shape: { kind: 'box', w: 2.1, h: 0.14, d: 0.18, c: 0.03 } },
    {
      name: 'tower-ports',
      paint: 'glass',
      emissive: 0.6,
      mirror: true,
      pos: [0.66, TOWER_Y + 1.8, TOWER_Z + 0.8],
      repeat: { count: 4, step: [0, 0, -0.4] },
      shape: { kind: 'box', w: 0.02, h: 0.1, d: 0.2 },
    },
    {
      name: 'tower-ports-low',
      paint: 'glass',
      emissive: 0.6,
      mirror: true,
      pos: [0.96, TOWER_Y + 0.4, TOWER_Z + 1.0],
      repeat: { count: 6, step: [0, 0, -0.38] },
      shape: { kind: 'box', w: 0.02, h: 0.1, d: 0.2 },
    },
    post('mast', 'metal', [0, TOWER_Y + 3.82, TOWER_Z], 0.09, 0.04, 1.6, 6),
    { name: 'yard', paint: 'metal', pos: [0, TOWER_Y + 4.6, TOWER_Z], shape: { kind: 'box', w: 1.2, h: 0.05, d: 0.05 } },
    { name: 'radar', paint: 'secondary', articulation: 'radar', pos: [0, TOWER_Y + 5.55, TOWER_Z], rot: [-10, 0, 0], shape: { kind: 'box', w: 0.9, h: 0.26, d: 0.05, c: 0.01 } },
    // Radiator stack aft of the tower.
    {
      name: 'stack',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -2.1, w: 0.8, h: 1.1, y: bbTop(-1.4) + 0.5, c: 0.25 },
          { z: -0.6, w: 0.9, h: 1.3, y: bbTop(-1.4) + 0.6, c: 0.28 },
        ],
      },
    },
    { name: 'stack-cap', paint: 'glass', emissive: 0.9, pos: [0, bbTop(-1.4) + 1.27, -1.3], shape: { kind: 'box', w: 0.7, h: 0.08, d: 1.2, c: 0.02 } },
    // Secondary battery on gun-deck sponsons.
    { name: 'gun-deck', paint: 'primary', mirror: true, pos: [sideX(BB_HULL, 0.3, 0.8) + 0.28, 0.8, 0.3], shape: { kind: 'box', w: 0.7, h: 0.46, d: 6.4, c: 0.12 } },
    { name: 'gun-deck-stripe', paint: 'secondary', mirror: true, pos: [sideX(BB_HULL, 0.3, 0.8) + 0.64, 0.8, 0.3], shape: { kind: 'box', w: 0.04, h: 0.16, d: 6.2 } },
    {
      name: 'secondary',
      paint: 'secondary',
      trim: 'metal',
      mirror: true,
      pos: [sideX(BB_HULL, 0.3, 0.8) + 0.3, 1.02, 2.9],
      rot: [0, 28, 0],
      repeat: { count: 4, step: [0, 0, -1.75] },
      socket: { id: 'secondary', kind: 'turret' },
      rig: { traverse: [-55, 150] }, // the hull and tower inboard
      shape: { kind: 'turret', radius: 0.24, height: 0.26, barrels: 2, barrelLength: 0.8, barrelRadius: 0.035 },
    },
    // Ventral turrets.
    {
      name: 'ventral',
      paint: 'secondary',
      trim: 'metal',
      pos: [0, -1.88, 3.2],
      rot: [0, 0, 180],
      repeat: { count: 2, step: [0, 0, -6.5] },
      socket: { id: 'ventral', kind: 'turret' },
      rig: { elevation: [-5, 80] },
      shape: { kind: 'turret', radius: 0.4, height: 0.4, barrels: 2, barrelLength: 1.2, barrelRadius: 0.05 },
    },
    // Deck machinery.
    {
      name: 'deck-greebles-fore',
      paint: 'metal',
      trim: 'dark',
      pos: [0, bbTop(7.4) - 0.02, 7.4],
      shape: { kind: 'greeble', w: 1.0, d: 1.2, count: 14, seed: 13, size: [0.08, 0.28], height: [0.03, 0.12] },
    },
    {
      name: 'deck-greebles-mid',
      paint: 'metal',
      trim: 'dark',
      pos: [0, bbTop(-3.0) - 0.02, -3.0],
      shape: { kind: 'greeble', w: 1.9, d: 1.8, count: 22, seed: 19, size: [0.1, 0.32], height: [0.03, 0.14] },
    },
    {
      name: 'deck-greebles-aft',
      paint: 'metal',
      trim: 'dark',
      pos: [0, bbTop(-7.8) - 0.02, -7.8],
      shape: { kind: 'greeble', w: 1.6, d: 1.0, count: 12, seed: 29, size: [0.08, 0.26], height: [0.03, 0.1] },
    },
    // Radiator fins + drive.
    {
      name: 'radiator',
      paint: 'secondary',
      mirror: true,
      pos: [1.5, 0.25, -6.0],
      rot: [0, 0, -6],
      shape: { kind: 'wing', root: 2.8, tip: 1.4, span: 1.4, sweep: 1.0, thickness: 0.12, tipThickness: 0.1 },
    },
    {
      name: 'drive-block',
      paint: 'metal',
      shape: {
        kind: 'loft',
        stations: [
          { z: -9.6, w: 2.9, h: 2.2, y: 0.1, c: 0.55 },
          { z: -8.5, w: 3.1, h: 2.35, y: 0.1, c: 0.6 },
        ],
      },
    },
    bell('bell-centre', [0, 0.12, -9.95], 0.62, 0.9),
    bell('bell-upper', [0.95, 0.65, -9.85], 0.44, 0.75, true),
    bell('bell-lower', [0.95, -0.4, -9.85], 0.44, 0.75, true),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [1.16, TOWER_Y + 3.1, TOWER_Z + 0.5], shape: { kind: 'box', w: 0.04, h: 0.08, d: 0.2 } },
  ],
  engines: [
    { pos: [0, 0.12, -10.4], radius: 0.55, plume: 4.5 },
    { pos: [0.95, 0.65, -10.25], radius: 0.4, plume: 3.5, mirror: true },
    { pos: [0.95, -0.4, -10.25], radius: 0.4, plume: 3.5, mirror: true },
  ],
  articulations: [{ id: 'radar', pivot: [0, TOWER_Y + 5.42, TOWER_Z], axis: [0, 1, 0], range: [0, 360], channel: 'radar', mirror: false }],
  hardpoints: [{ id: 'bridge', pos: [0, TOWER_Y + 3.2, TOWER_Z + 1.0], kind: 'gun' }],
};
