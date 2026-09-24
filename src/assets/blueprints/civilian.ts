import type { Blueprint, Livery, Part, Station } from '../Blueprint';
import { sideX, topAt, wingSlice, type WingSpec } from './kit';
import { bd, bell, bx, cyl, hazard, hp, lf, post, turret, windows } from './yard';

/**
 * Civilian and trade traffic — flown by AI between stations. They register
 * under the Directorate (`faction: 'concord'`, the merchant marine's flag
 * of convenience) but carry their own company liveries, so a spawner can
 * put them on any team (usually 'neutral').
 */

/** Anchorage Bulk Carriers — weathered ivory, slate teal, amber. */
const BULK: Partial<Livery> = {
  primary: '#cfc8b6',
  secondary: '#3e5c6b',
  accent: '#eaa21c',
  dark: '#2b2d33',
  metal: '#8a8f98',
  glass: '#8fe0ff',
  glow: '#ffd08a',
  plumeCore: '#fff4e0',
};
/** Tey Ebon Works — black hulls, ivory cabs, black-light violet. */
const EBON: Partial<Livery> = {
  primary: '#4a4458',
  secondary: '#d9d2c2',
  accent: '#b56bff',
  dark: '#15131c',
  metal: '#6e6980',
  glass: '#c98bff',
  glow: '#a66bff',
  plumeCore: '#f3e6ff',
};
/** Timetable Line (golden age) — cream, navy, liner red, brass. */
const LINER: Partial<Livery> = {
  primary: '#f1e8d2',
  secondary: '#1f3558',
  accent: '#c8342b',
  dark: '#1b1f2a',
  metal: '#b89b5e',
  glass: '#ffd98a',
  glow: '#ffe2a8',
  plumeCore: '#fffaf0',
};
/** Meridian Ore Company — safety yellow, gunmetal, black. */
const ORE: Partial<Livery> = {
  primary: '#dba21e',
  secondary: '#4a4f57',
  accent: '#e8e4d8',
  dark: '#222327',
  metal: '#9a9588',
  glass: '#9fe8ff',
  glow: '#ffbf6b',
  plumeCore: '#fff2dc',
};
/** Swift Couriers of the Accord — white, signal red, gold. */
const COURIER: Partial<Livery> = {
  primary: '#f3f1ec',
  secondary: '#b8202e',
  accent: '#ffcf2e',
  dark: '#22242c',
  metal: '#a0a4ae',
  glass: '#57d4ff',
  glow: '#8fe3ff',
};

/** Shipping-container colours (weathered corporate paint). */
const BOX = ['#b8452a', '#2f6b8f', '#d9a21e', '#4f7a3a', '#8b2f4a', '#c9c3b4', '#3e5c6b', '#a05a2a'];

// ═════════════════════════════════════════════════════════════════════════
// MV LONGHAUL — bulk container freighter, ~255 m (modelled 1:10)
// ═════════════════════════════════════════════════════════════════════════

const LH_CAB: Station[] = [
  { z: 9.2, w: 2.6, wb: 2.8, h: 2.2, y: 0.2, c: 0.45 },
  { z: 12.0, w: 2.6, wb: 2.6, h: 2.2, y: 0.2, c: 0.45 },
  { z: 13.4, w: 1.9, wb: 1.6, h: 1.5, y: -0.05, c: 0.4 },
  { z: 14.0, w: 1.2, wb: 0.9, h: 0.8, y: -0.2, c: 0.25 },
];
const LH_BAYS = [6.9, 3.8, 0.7, -2.4, -5.5];

/** One bay of four 40-foot boxes around the spine, plus a top box. */
function containerBay(z: number, seed: number): Part[] {
  const slots: [number, number][] = [
    [0.68, 0.68],
    [-0.68, 0.68],
    [0.68, -0.68],
    [-0.68, -0.68],
    [0, 1.98],
  ];
  return slots.flatMap(([x, y], i): Part[] => {
    const color = BOX[(seed * 5 + i * 3) % BOX.length];
    return [
      bx(`box-${seed}-${i}`, 'secondary', [x, y, z], [1.3, 1.3, 2.8], 0.05, { color }),
      bx(`box-rib-${seed}-${i}`, 'secondary', [x, y, z - 0.8], [1.36, 1.36, 0.12], 0.05, { color, repeat: { count: 2, step: [0, 0, 1.6] } }),
    ];
  });
}

export const LONGHAUL: Blueprint = {
  id: 'civ-longhaul',
  name: 'Longhaul',
  designation: 'MV',
  faction: 'concord',
  shipClass: 'frigate',
  scale: 10,
  ramp: 'classic',
  livery: BULK,
  notes:
    'The bulk freighter of the Reach: a cab, a spine and whatever boxes fit. Twenty-five standard containers, six crew, ' +
    'and a captain who knows every station bosun between Anchorage and Tessaly by first name.',
  parts: [
    bx('spine', 'metal', [0, 0, 0.6], [0.6, 0.6, 17.6], 0.1, { group: 1 }),
    bx('frame', 'dark', [0, 0.65, 8.35], [2.9, 3.0, 0.18], 0.2, { repeat: { count: 6, step: [0, 0, -3.1] } }),
    ...LH_BAYS.flatMap((z, i) => containerBay(z, i)),
    // Cab.
    lf('cab', 'primary', LH_CAB),
    bd('cab-band', 'accent', LH_CAB, 10.0, 10.5, 0.03),
    lf('bridge', 'primary', [
      { z: 10.2, w: 2.0, h: 0.8, y: 1.7, c: 0.2 },
      { z: 12.1, w: 2.0, h: 0.8, y: 1.7, c: 0.2 },
      { z: 12.5, w: 1.7, h: 0.4, y: 1.55, c: 0.1 },
    ]),
    bx('bridge-glass', 'glass', [0, 1.82, 11.8], [2.04, 0.18, 1.0], 0, { emissive: 0.6 }),
    bx('bridge-wings', 'secondary', [0, 1.95, 11.6], [3.4, 0.12, 0.5], 0.04),
    windows('cab-ports', [1.33, 0.6, 12.0], 4, [0, 0, -0.55], [0.03, 0.14, 0.26], { mirror: true }),
    post('mast', 'metal', [0, 2.1, 10.6], 0.06, 0.03, 1.4, 5),
    { name: 'mast-light', paint: 'glow', emissive: 1.5, pos: [0, 3.55, 10.6], shape: { kind: 'dome', radius: 0.1, segments: 6 } },
    hazard('bow-hazard', [-0.8, -0.6, 13.72], 5, 0.4, [0.12, 0.6, 0.1], { rot: [0, 0, 40] }),
    bx('docking-collar', 'dark', [0, -1.1, 11.0], [1.0, 0.3, 1.0], 0.1),
    // Engine module.
    lf('engine-module', 'primary', [
      { z: -10.8, w: 2.4, wb: 2.4, h: 2.0, c: 0.45 },
      { z: -8.2, w: 2.6, wb: 2.6, h: 2.2, c: 0.5 },
      { z: -7.4, w: 1.6, wb: 1.6, h: 1.4, c: 0.35 },
    ]),
    bd('engine-band', 'secondary', [
      { z: -10.8, w: 2.4, wb: 2.4, h: 2.0, c: 0.45 },
      { z: -8.2, w: 2.6, wb: 2.6, h: 2.2, c: 0.5 },
    ], -9.9, -9.2, 0.03),
    { name: 'radiator', paint: 'dark', mirror: true, pos: [1.25, 0.2, -7.8], rot: [0, 0, 15], shape: { kind: 'wing', root: 2.4, tip: 1.6, span: 2.2, sweep: 0.6, thickness: 0.08 } },
    bell('bell', [0.62, 0, -11.2], 0.55, 0.8, true),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [1.72, 1.95, 11.6], shape: { kind: 'box', w: 0.08, h: 0.1, d: 0.2 } },
    turret('pd', [0, 1.13, -8.6], { radius: 0.2, height: 0.22, barrels: 1, barrelLength: 0.5, barrelRadius: 0.035, paint: 'secondary', yaw: 180, traverse: [-130, 130] }),
  ],
  engines: [{ pos: [0.62, 0, -11.65], radius: 0.48, plume: 4.5, mirror: true }],
  hardpoints: [hp('dock', 'hangar', [0, -1.25, 11.0], { rot: [90, 0, 0] }), hp('bridge', 'gun', [0, 1.9, 12.3])],
};

// ═════════════════════════════════════════════════════════════════════════
// EGT UMBRA — Ebon-gas tanker, ~290 m (modelled 1:14)
// ═════════════════════════════════════════════════════════════════════════

const UM_TANKS = [6.2, 2.7, -0.8, -4.3];
const UM_R = 1.55;

export const UMBRA: Blueprint = {
  id: 'civ-umbra',
  name: 'Umbra',
  designation: 'EGT',
  faction: 'concord',
  shipClass: 'frigate',
  scale: 14,
  ramp: 'classic',
  livery: EBON,
  notes:
    'Ebon-gas tanker. Four confinement spheres, each ringed in field coils that glow black-light violet when they ' +
    'are working — and a crew who watch the glow the way sailors used to watch the sky.',
  parts: [
    bx('keel', 'metal', [0, -0.2, 0.6], [0.9, 0.7, 17.2], 0.15, { group: 1 }),
    bx('gantry', 'dark', [0, 1.72, 0.9], [0.45, 0.2, 14.0], 0.06),
    ...UM_TANKS.flatMap((z, i): Part[] => [
      { name: `tank-${i}`, paint: 'primary', pos: [0, 0.1, z], shape: { kind: 'dome', radius: UM_R, segments: 18 } },
      { name: `coil-${i}`, paint: 'glass', emissive: 1.0, pos: [0, 0.1, z], shape: { kind: 'torus', radius: UM_R + 0.03, tube: 0.1, segments: 32, tubeSegments: 4 } },
      { name: `coil-v-${i}`, paint: 'glass', emissive: 0.8, pos: [0, 0.1, z], rot: [0, 90, 0], shape: { kind: 'torus', radius: UM_R + 0.04, tube: 0.07, segments: 32, tubeSegments: 4 } },
      { name: `collar-${i}`, paint: 'secondary', pos: [0, 0.1, z], rot: [90, 0, 0], shape: { kind: 'torus', radius: 0.95, tube: 0.16, segments: 16, tubeSegments: 6 } },
      bx(`saddle-${i}`, 'metal', [0, -1.2, z], [1.2, 0.6, 1.6], 0.2),
    ]),
    bx('warning', 'accent', [0.84, 1.02, 0.95], [0.02, 0.28, 12.6], 0, { mirror: true, emissive: 0.3 }),
    // Cab.
    lf('cab', 'secondary', [
      { z: 8.2, w: 2.0, wb: 2.2, h: 1.8, y: 0.0, c: 0.4 },
      { z: 10.6, w: 2.0, wb: 2.0, h: 1.8, y: 0.0, c: 0.4 },
      { z: 11.6, w: 1.4, wb: 1.1, h: 1.0, y: -0.2, c: 0.3 },
    ]),
    lf('cab-top', 'secondary', [
      { z: 8.6, w: 1.5, h: 0.6, y: 1.15, c: 0.15 },
      { z: 10.4, w: 1.5, h: 0.6, y: 1.15, c: 0.15 },
      { z: 10.8, w: 1.2, h: 0.3, y: 1.05, c: 0.08 },
    ]),
    bx('bridge-glass', 'glass', [0, 1.22, 10.1], [1.54, 0.14, 0.8], 0, { emissive: 0.6, color: '#8fe0ff' }),
    bx('cab-band', 'primary', [0, 0, 9.4], [2.06, 1.86, 0.4], 0.4),
    windows('cab-ports', [1.03, 0.3, 10.2], 3, [0, 0, -0.6], [0.03, 0.12, 0.26], { mirror: true, color: '#8fe0ff' }),
    hazard('cab-hazard', [-0.7, -0.62, 11.3], 4, 0.46, [0.12, 0.5, 0.1], { rot: [0, 0, 40] }),
    // Vent masts (black-light discharge).
    ...[4.45, 0.95, -2.55].map((z, i): Part => post(`vent-${i}`, 'metal', [0, 1.8, z], 0.08, 0.05, 0.9, 6)),
    ...[4.45, 0.95, -2.55].map((z, i): Part => ({ name: `vent-glow-${i}`, paint: 'glow', emissive: 1.4, pos: [0, 2.75, z], shape: { kind: 'dome', radius: 0.11, segments: 6 } })),
    // Engines.
    lf('engine-module', 'secondary', [
      { z: -8.6, w: 2.2, h: 1.9, c: 0.45 },
      { z: -6.4, w: 2.4, h: 2.0, c: 0.5 },
      { z: -5.8, w: 1.4, h: 1.2, c: 0.3 },
    ]),
    bx('engine-band', 'accent', [0, 0, -7.4], [2.36, 1.98, 0.3], 0.48, { emissive: 0.4 }),
    { name: 'radiator', paint: 'dark', mirror: true, pos: [1.1, 0.0, -6.0], rot: [0, 0, 0], shape: { kind: 'wing', root: 2.0, tip: 1.4, span: 1.8, sweep: 0.4, thickness: 0.08 } },
    bell('bell', [0.55, 0.3, -9.0], 0.46, 0.7, true),
    bell('bell-low', [0, -0.5, -9.0], 0.46, 0.7),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [2.95, 0.0, -6.8], shape: { kind: 'box', w: 0.08, h: 0.08, d: 0.2 } },
  ],
  engines: [
    { pos: [0.55, 0.3, -9.4], radius: 0.4, plume: 4, mirror: true },
    { pos: [0, -0.5, -9.4], radius: 0.4, plume: 4 },
  ],
  hardpoints: [hp('dock', 'hangar', [0, -1.0, 9.6], { rot: [90, 0, 0] }), hp('bridge', 'gun', [0, 1.3, 10.6])],
};

// ═════════════════════════════════════════════════════════════════════════
// TSS MERIDIAN STAR — golden-age passenger liner, ~430 m (modelled 1:20)
// ═════════════════════════════════════════════════════════════════════════

const MS_HULL: Station[] = [
  { z: -9.6, w: 1.3, wb: 0.9, h: 1.1, y: 0.1, c: 0.45 },
  { z: -7.0, w: 2.2, wb: 1.7, h: 1.8, y: 0.0, c: 0.7 },
  { z: 3.0, w: 2.4, wb: 1.8, h: 2.0, y: 0.0, c: 0.75 },
  { z: 7.6, w: 1.8, wb: 1.2, h: 1.6, y: -0.05, c: 0.6 },
  { z: 10.2, w: 0.8, wb: 0.4, h: 0.8, y: -0.15, c: 0.3 },
  { z: 11.3, w: 0.1, wb: 0.05, h: 0.12, y: -0.2 },
];
const msTop = (z: number) => topAt(MS_HULL, z);
/** Promenade decks: [z0, z1, width, height] stepped up from the hull top. */
const MS_DECKS: [number, number, number, number][] = [
  [-6.6, 7.2, 1.9, 0.5],
  [-5.2, 5.6, 1.5, 0.45],
  [-3.6, 3.4, 1.1, 0.4],
];
const MS_FIN: WingSpec = { pos: [0.8, -0.1, -5.0], rot: [0, 0, -16], root: 3.6, tip: 1.4, span: 2.0, sweep: 2.4, thickness: 0.18, tipThickness: 0.1 };

function msDeck(i: number): Part[] {
  const [z0, z1, w, h] = MS_DECKS[i];
  let y = msTop(0) - 0.05;
  for (let k = 0; k < i; k++) y += MS_DECKS[k][3];
  const st: Station[] = [
    { z: z0, w: w * 0.7, h, y: y + h / 2, c: h * 0.45 },
    { z: z0 + 1.0, w, h, y: y + h / 2, c: h * 0.3 },
    { z: z1 - 1.2, w, h, y: y + h / 2, c: h * 0.3 },
    { z: z1, w: w * 0.55, h: h * 0.7, y: y + h * 0.4, c: h * 0.3 },
  ];
  const n = Math.floor((z1 - z0 - 2.4) / 0.36);
  return [
    lf(`deck-${i}`, 'primary', st),
    bd(`deck-rail-${i}`, 'secondary', st, z0 + 0.4, z0 + 0.6, 0.02),
    windows(`deck-windows-${i}`, [w / 2 + 0.005, y + h * 0.5, z1 - 1.3], n, [0, 0, -0.36], [0.02, h * 0.36, 0.2], { mirror: true, emissive: 0.45 }),
  ];
}

export const MERIDIAN_STAR: Blueprint = {
  id: 'civ-meridian-star',
  name: 'Meridian Star',
  designation: 'TSS',
  faction: 'concord',
  shipClass: 'carrier',
  scale: 20,
  ramp: 'classic',
  livery: LINER,
  notes:
    'A Timetable Line express liner, laid down four centuries before the Shattering and never once late. Three ' +
    'promenade decks, an observation dome at the bow and 2,400 berths. She still flies the old route, on the old schedule.',
  parts: [
    lf('hull', 'primary', MS_HULL, { group: 1 }),
    // Navy lower hull + liner-red boot stripe.
    lf(
      'lower-hull',
      'secondary',
      MS_HULL.map((s) => ({ ...s, w: s.w + 0.03, wb: (s.wb ?? s.w) + 0.03, h: s.h * 0.42, y: (s.y ?? 0) - s.h * 0.3, c: Math.min(s.c ?? 0, s.h * 0.2) })),
    ),
    lf(
      'boot-stripe',
      'accent',
      MS_HULL.map((s) => ({ ...s, w: s.w + 0.05, wb: s.w * 0.92 + 0.05, h: s.h * 0.08, y: (s.y ?? 0) - s.h * 0.07, c: 0 })),
    ),
    // Hull portholes: two rows.
    ...[0.35, 0.0].map((y, r): Part =>
      windows(`ports-${r}`, [sideX(MS_HULL, 1.0, y) + 0.005, y, 7.0 - r * 0.18], 38 - r * 2, [0, 0, -0.36], [0.02, 0.1, 0.16], { mirror: true, emissive: 0.4 }),
    ),
    ...[0, 1, 2].flatMap(msDeck),
    // Bridge at the head of the top deck.
    lf('bridge', 'primary', [
      { z: 2.4, w: 1.3, h: 0.36, y: msTop(0) + 1.53, c: 0.15 },
      { z: 3.6, w: 1.3, h: 0.36, y: msTop(0) + 1.53, c: 0.15 },
      { z: 3.9, w: 1.0, h: 0.2, y: msTop(0) + 1.48, c: 0.08 },
    ]),
    bx('bridge-glass', 'glass', [0, msTop(0) + 1.58, 3.4], [1.32, 0.1, 0.5], 0, { emissive: 0.9 }),
    // Observation dome at the bow.
    { name: 'dome', paint: 'glass', emissive: 0.5, pos: [0, msTop(8.4) - 0.1, 8.4], shape: { kind: 'dome', radius: 1, scale: [0.5, 0.36, 0.9], segments: 16, hemisphere: true } },
    { name: 'dome-ring', paint: 'metal', pos: [0, msTop(8.4) - 0.1, 8.4], rot: [90, 0, 0], scale: [0.52, 0.92, 1], shape: { kind: 'torus', radius: 1, tube: 0.05, segments: 24, tubeSegments: 4 } },
    // Raked twin funnels (radiator stacks) — cream, red band, navy cap.
    ...[-0.9, -3.0].flatMap((z, i): Part[] => {
      const y = msTop(0) + 1.3;
      return [
        { name: `funnel-${i}`, paint: 'primary', pos: [0, y, z], rot: [-18, 0, 0], shape: { kind: 'box', w: 0.62, h: 1.3, d: 1.3, c: 0.28 } },
        { name: `funnel-band-${i}`, paint: 'accent', pos: [0, y + 0.42, z - 0.13], rot: [-18, 0, 0], shape: { kind: 'box', w: 0.64, h: 0.22, d: 1.32, c: 0.28 } },
        { name: `funnel-cap-${i}`, paint: 'secondary', pos: [0, y + 0.64, z - 0.2], rot: [-18, 0, 0], shape: { kind: 'box', w: 0.64, h: 0.18, d: 1.32, c: 0.28 } },
      ];
    }),
    // Art-deco fins + stern.
    { name: 'fin', paint: 'secondary', mirror: true, ...wingSlice(MS_FIN, 0, 2.0) },
    { name: 'fin-tip', paint: 'accent', mirror: true, ...wingSlice(MS_FIN, 1.7, 2.0, 0.03) },
    { name: 'dorsal-fin', paint: 'primary', pos: [0, msTop(-7.5) - 0.1, -6.8], rot: [0, 0, 90], shape: { kind: 'wing', root: 2.8, tip: 1.0, span: 1.6, sweep: 2.4, thickness: 0.16 } },
    { name: 'dorsal-fin-band', paint: 'accent', pos: [0, msTop(-7.5) + 0.7, -7.9], rot: [0, 0, 90], shape: { kind: 'wing', root: 1.35, tip: 1.2, span: 0.2, sweep: 0.3, thickness: 0.19 } },
    ...[0.55, -0.55].map((x, i): Part => cyl(`nacelle-${i}`, 'metal', [x, -0.25, -9.4], 0.36, 0.42, 1.2, { segments: 14 })),
    cyl('nacelle-top', 'metal', [0, 0.45, -9.5], 0.32, 0.38, 1.0, { segments: 14 }),
    bell('bell', [0.55, -0.25, -10.1], 0.36, 0.4, true, 14),
    bell('bell-top', [0, 0.45, -10.1], 0.32, 0.36, false, 14),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [1.2, 0.2, 3.0], shape: { kind: 'box', w: 0.05, h: 0.06, d: 0.18 } },
    bx('name-board', 'metal', [sideX(MS_HULL, 8.6, 0.35) + 0.01, 0.35, 8.6], [0.02, 0.12, 1.1], 0, { mirror: true }),
  ],
  engines: [
    { pos: [0.55, -0.25, -10.35], radius: 0.3, plume: 3.4, mirror: true },
    { pos: [0, 0.45, -10.35], radius: 0.28, plume: 3 },
  ],
  hardpoints: [hp('dock', 'hangar', [sideX(MS_HULL, 0, -0.3), -0.3, 0], { mirror: true, rot: [0, 90, 0] }), hp('bridge', 'gun', [0, msTop(0) + 1.6, 3.8])],
};

// ═════════════════════════════════════════════════════════════════════════
// MB TALLOW — ore mining barge, ~150 m (modelled 1:10)
// ═════════════════════════════════════════════════════════════════════════

const TL_HOPPER: Station[] = [
  { z: -4.6, w: 3.6, wb: 3.0, h: 2.4, y: 0.0, c: 0.3 },
  { z: 3.2, w: 3.6, wb: 3.0, h: 2.4, y: 0.0, c: 0.3 },
];
const TL_HEAD_Z = 7.4;

export const TALLOW: Blueprint = {
  id: 'civ-tallow',
  name: 'Tallow',
  designation: 'MB',
  faction: 'concord',
  shipClass: 'corvette',
  scale: 10,
  ramp: 'classic',
  livery: ORE,
  notes:
    'Asteroid mining barge: a cutter head on a boom, a hopper the size of a cathedral nave and a crew of nine who are ' +
    'paid by the tonne. Slow, ugly, and the reason Meridian eats.',
  parts: [
    lf('hopper', 'secondary', TL_HOPPER, { group: 1 }),
    ...[-3.4, -1.4, 0.6, 2.4].map((z): Part => bd('hopper-rib', 'primary', TL_HOPPER, z, z + 0.3, 0.05)),
    {
      name: 'ore',
      paint: 'dark',
      trim: 'metal',
      color: '#5a4636',
      pos: [0, 1.2, -0.7],
      shape: { kind: 'greeble', w: 3.0, d: 7.0, count: 30, seed: 7, size: [0.3, 0.9], height: [0.1, 0.5] },
    },
    // Boom + cutter head (spins on channel 'drill').
    lf('boom', 'primary', [
      { z: 3.0, w: 1.6, h: 1.4, y: -0.2, c: 0.3 },
      { z: 6.4, w: 1.1, h: 1.0, y: -0.2, c: 0.25 },
    ]),
    hazard('boom-hazard', [-0.45, -0.2, 5.2], 4, 0.3, [0.12, 1.2, 0.8], { rot: [0, 0, 40] }),
    cyl('head', 'metal', [0, -0.2, TL_HEAD_Z], 1.1, 1.3, 1.6, { segments: 12, articulation: 'drill' }),
    {
      name: 'teeth',
      paint: 'primary',
      articulation: 'drill',
      pos: [1.05, -0.2, TL_HEAD_Z + 0.6],
      repeat: { count: 10, rot: [0, 0, 36] },
      shape: { kind: 'box', w: 0.3, h: 0.3, d: 0.6, c: 0.08 },
    },
    { name: 'head-cone', paint: 'dark', articulation: 'drill', pos: [0, -0.2, TL_HEAD_Z + 0.8], shape: { kind: 'dome', radius: 0.9, segments: 12, hemisphere: false, scale: [1, 1, 0.6] } },
    // Cab off to port, high.
    lf('cab', 'primary', [
      { z: 2.6, w: 1.2, h: 1.0, x: -1.2, y: 1.8, c: 0.2 },
      { z: 4.6, w: 1.2, h: 1.0, x: -1.2, y: 1.8, c: 0.2 },
      { z: 5.1, w: 1.0, h: 0.5, x: -1.2, y: 1.65, c: 0.1 },
    ]),
    bx('cab-glass', 'glass', [-1.2, 1.95, 4.5], [1.22, 0.3, 0.3], 0, { emissive: 0.6 }),
    bx('cab-leg', 'dark', [-1.2, 1.3, 3.4], [0.5, 0.4, 1.0], 0.08),
    // Grapple arms under the boom.
    bx('arm', 'metal', [0.9, -1.3, 4.8], [0.2, 0.2, 3.0], 0.04, { mirror: true, rot: [0, -6, 0] }),
    bx('arm-claw', 'primary', [1.05, -1.3, 6.4], [0.35, 0.5, 0.35], 0.06, { mirror: true }),
    // Ore crane on the hopper.
    post('crane-post', 'dark', [1.3, 1.2, -3.6], 0.14, 0.12, 0.9, 6),
    bx('crane-boom', 'primary', [1.3, 2.05, -1.8], [0.16, 0.18, 3.8], 0.03, { rot: [-10, 0, 0] }),
    // Engines under the stern.
    lf('engine-block', 'primary', [
      { z: -6.6, w: 3.0, h: 1.6, y: -0.3, c: 0.3 },
      { z: -4.6, w: 3.2, h: 1.8, y: -0.3, c: 0.35 },
    ]),
    bell('bell', [0.8, -0.3, -6.9], 0.42, 0.6, true),
    bell('bell-in', [0.0, 0.2, -6.9], 0.3, 0.5),
    { ...windows('work-lights', [1.66, 1.0, 2.6], 4, [0, 0, -2.0], [0.04, 0.15, 0.2], { mirror: true, emissive: 1.2 }), paint: 'glow' },
  ],
  engines: [
    { pos: [0.8, -0.3, -7.25], radius: 0.36, plume: 3.4, mirror: true },
    { pos: [0, 0.2, -7.2], radius: 0.25, plume: 2.6 },
  ],
  articulations: [{ id: 'drill', pivot: [0, -0.2, TL_HEAD_Z], axis: [0, 0, 1], range: [0, 360], channel: 'drill', mirror: false }],
  hardpoints: [hp('drill', 'gun', [0, -0.2, TL_HEAD_Z + 1.4]), hp('bridge', 'gun', [-1.2, 2.0, 4.8])],
};

// ═════════════════════════════════════════════════════════════════════════
// SWALLOW — Accord express courier, ~30 m
// ═════════════════════════════════════════════════════════════════════════

const SW_FUSE: Station[] = [
  { z: -12.0, w: 1.3, h: 1.2, y: 0.25, c: 0.5 },
  { z: -6.0, w: 2.0, h: 1.9, y: 0.3, c: 0.8 },
  { z: 4.0, w: 2.1, h: 2.0, y: 0.25, c: 0.85 },
  { z: 10.0, w: 1.5, h: 1.4, y: 0.05, c: 0.6 },
  { z: 14.0, w: 0.5, h: 0.45, y: -0.2, c: 0.2 },
  { z: 15.2, w: 0.06, h: 0.06, y: -0.3 },
];
const SW_IN: WingSpec = { pos: [0.85, 0.0, 1.8], rot: [0, 0, 16], root: 6.0, tip: 4.2, span: 3.0, sweep: 2.0, thickness: 0.36, tipThickness: 0.3 };
const SW_OUT: WingSpec = { pos: [0.85 + 3.0 * Math.cos(0.279), 3.0 * Math.sin(0.279), -0.2], rot: [0, 0, -7], root: 4.2, tip: 1.3, span: 6.0, sweep: 3.6, thickness: 0.3, tipThickness: 0.12 };

export const SWALLOW: Blueprint = {
  id: 'civ-swallow',
  name: 'Swallow',
  designation: 'XC-2',
  faction: 'concord',
  shipClass: 'interceptor',
  ramp: 'classic',
  livery: COURIER,
  notes:
    'An Accord-era express courier: gull wings, a T-tail and the fastest drive a civilian can legally buy. Carries ' +
    'mail, medicine, diplomatic pouches and, when nobody is looking, Ebon in the lining.',
  parts: [
    lf('fuselage', 'primary', SW_FUSE, { group: 1 }),
    // Red cheatline running nose to tail.
    lf('cheatline', 'secondary', SW_FUSE.map((s) => ({ ...s, w: s.w + 0.04, h: s.h * 0.14, y: (s.y ?? 0) - s.h * 0.02, c: 0 }))),
    lf('belly', 'primary', SW_FUSE.map((s) => ({ ...s, w: s.w * 0.7, h: s.h * 0.3, y: (s.y ?? 0) - s.h * 0.4, c: s.h * 0.1 }))),
    windows('cabin', [0.96, 0.62, 6.4], 9, [0, 0, -0.9], [0.04, 0.24, 0.42], { mirror: true }),
    { name: 'canopy', paint: 'glass', pos: [0, 0.95, 10.6], shape: { kind: 'dome', radius: 1, scale: [0.62, 0.52, 2.4], segments: 16 } },
    bx('canopy-frame', 'dark', [0, 1.3, 10.4], [0.12, 0.2, 2.6], 0.04, { rot: [4, 0, 0] }),
    // Gull wings.
    { name: 'wing-in', paint: 'primary', mirror: true, ...wingSlice(SW_IN, 0, 3.0) },
    { name: 'wing-out', paint: 'primary', mirror: true, ...wingSlice(SW_OUT, 0, 6.0) },
    { name: 'wing-stripe', paint: 'secondary', mirror: true, ...wingSlice(SW_OUT, 3.6, 4.4, 0.04) },
    { name: 'wing-tip', paint: 'accent', mirror: true, ...wingSlice(SW_OUT, 5.6, 6.0, 0.04) },
    cyl('nacelle', 'metal', [3.75, 0.8, -3.0], 0.52, 0.58, 4.4, { mirror: true, segments: 14 }),
    cyl('nacelle-lip', 'accent', [3.75, 0.8, -0.85], 0.54, 0.54, 0.2, { mirror: true, segments: 14 }),
    bell('nacelle-bell', [3.75, 0.8, -5.45], 0.5, 0.5, true, 14),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [9.8, 0.15, -3.8], shape: { kind: 'box', w: 0.12, h: 0.1, d: 0.35 } },
    // T-tail.
    { name: 'fin', paint: 'secondary', pos: [0, 1.1, -7.2], rot: [0, 0, 90], shape: { kind: 'wing', root: 4.8, tip: 2.2, span: 3.4, sweep: 3.6, thickness: 0.26, tipThickness: 0.18 } },
    { name: 'tailplane', paint: 'primary', mirror: true, pos: [0.05, 4.45, -10.6], rot: [0, 0, 0], shape: { kind: 'wing', root: 2.3, tip: 1.0, span: 3.0, sweep: 1.4, thickness: 0.16 } },
    { name: 'tailplane-tip', paint: 'accent', mirror: true, pos: [2.8, 4.45, -12.0], shape: { kind: 'wing', root: 1.05, tip: 1.0, span: 0.25, sweep: 0.05, thickness: 0.18 } },
    // Main drive.
    lf('drive', 'metal', [
      { z: -13.6, w: 1.2, h: 1.1, y: 0.25, c: 0.5 },
      { z: -11.6, w: 1.4, h: 1.3, y: 0.25, c: 0.6 },
    ]),
    bell('bell', [0, 0.25, -13.9], 0.6, 0.6, false, 14),
    bx('scoop', 'secondary', [0, 1.2, -3.0], [0.9, 0.5, 3.2], 0.2),
    bx('scoop-mouth', 'dark', [0, 1.2, -1.38], [0.7, 0.34, 0.06], 0.12),
  ],
  engines: [
    { pos: [0, 0.25, -14.2], radius: 0.5, plume: 7.5 },
    { pos: [3.75, 0.8, -5.7], radius: 0.4, plume: 5, mirror: true },
  ],
  hardpoints: [hp('gun', 'gun', [0, -0.3, 14.8])],
};

