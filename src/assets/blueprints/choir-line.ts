import type { Blueprint, Part, Station } from '../Blueprint';
import { ribsAlong, shoulderY, topAt, wingSlice, type WingSpec } from './kit';
import { bd, crystal, cyl, hp, lf, post, turret } from './yard';

/**
 * Zenith Hegemony designs for the shipyard: the Seraph crystal interceptor
 * (sold to outsiders only at high standing) and the Canticle frigate that
 * fills the gap between the Vesper and the Cathedral. Hegemony language:
 * diamond-section lofts, arched ribs, glowing seams, forward-swept blades,
 * crystal everywhere, and nothing that looks bolted on.
 */

// ═════════════════════════════════════════════════════════════════════════
// SC-9 SERAPH — halo-ring crystal interceptor, ~21 m
// ═════════════════════════════════════════════════════════════════════════

const SR_SPINE: Station[] = [
  { z: -7.2, w: 0.8, h: 0.9, c: 0.4 },
  { z: -3.0, w: 1.6, h: 1.8, y: 0.0, c: 0.8 },
  { z: 3.0, w: 1.25, h: 1.4, y: 0.05, c: 0.62 },
  { z: 8.0, w: 0.5, h: 0.6, c: 0.25 },
  { z: 11.0, w: 0.04, h: 0.06 },
];
const HALO_Z = -4.3;
const HALO_R = 4.35;
const SR_BLADE = { root: 5.2, tip: 1.3, span: 3.75, sweep: 3.1, thickness: 0.26, tipThickness: 0.08, bevel: 1 };
const D45 = Math.SQRT1_2;

export const SERAPH: Blueprint = {
  id: 'choir-seraph',
  name: 'Seraph',
  designation: 'SC-9',
  faction: 'choir',
  shipClass: 'interceptor',
  ramp: 'triple',
  notes:
    'A crystal dart inside a singing halo. Four emitters on the ring fire as one chord; the ring itself is the antenna. ' +
    'The Hegemony sells them to outsiders only after the foundry-gardens have heard the buyer sing.',
  parts: [
    lf('spine', 'primary', SR_SPINE, { group: 1 }),
    bd('collar', 'accent', SR_SPINE, -1.2, -0.8, 0.03, { emissive: 0.4 }),
    bd('seam', 'glass', SR_SPINE, 5.0, 5.15, 0.02, { emissive: 0.9 }),
    { name: 'eye', paint: 'glass', emissive: 0.9, pos: [0, 0.6, 3.1], shape: { kind: 'dome', radius: 1, scale: [0.38, 0.32, 1.5], segments: 12 } },
    lf('nose-crystal', 'glass', crystal(3.2, 0.5, 0.2).map((s) => ({ ...s, z: s.z + 10.1 })), { emissive: 0.7 }),
    // X-blades out to the halo.
    { name: 'blade', paint: 'secondary', mirror: true, pos: [0.42, 0.42, -0.4], rot: [0, 0, 45], shape: { kind: 'wing', ...SR_BLADE } },
    { name: 'blade-low', paint: 'secondary', mirror: true, pos: [0.42, -0.42, -0.4], rot: [0, 0, -45], shape: { kind: 'wing', ...SR_BLADE } },
    { name: 'blade-edge', paint: 'accent', emissive: 0.5, mirror: true, pos: [0.44, 0.44, -0.45], rot: [0, 0, 45], shape: { kind: 'wing', root: 0.5, tip: 0.3, span: 3.6, sweep: 3.0, thickness: 0.29, tipThickness: 0.1, bevel: 1 } },
    { name: 'blade-edge-low', paint: 'accent', emissive: 0.5, mirror: true, pos: [0.44, -0.44, -0.45], rot: [0, 0, -45], shape: { kind: 'wing', root: 0.5, tip: 0.3, span: 3.6, sweep: 3.0, thickness: 0.29, tipThickness: 0.1, bevel: 1 } },
    // The halo: a broad band with glowing lips.
    { name: 'halo', paint: 'primary', pos: [0, 0, HALO_Z], scale: [1, 1, 3.4], shape: { kind: 'torus', radius: HALO_R, tube: 0.2, segments: 32, tubeSegments: 6 } },
    { name: 'halo-lip', paint: 'glass', emissive: 0.9, pos: [0, 0, HALO_Z + 0.66], shape: { kind: 'torus', radius: HALO_R, tube: 0.1, segments: 32, tubeSegments: 4 } },
    { name: 'halo-lip-aft', paint: 'accent', emissive: 0.4, pos: [0, 0, HALO_Z - 0.66], shape: { kind: 'torus', radius: HALO_R, tube: 0.1, segments: 32, tubeSegments: 4 } },
    // Four emitter crystals on the ring (radial array), plus small chimes between.
    {
      name: 'emitter',
      paint: 'glass',
      emissive: 0.8,
      pos: [HALO_R * D45, HALO_R * D45, HALO_Z + 0.3],
      repeat: { count: 4, rot: [0, 0, 90] },
      socket: { id: 'emitter', kind: 'beam' },
      shape: { kind: 'loft', stations: crystal(3.4, 0.55, 0.25) },
    },
    {
      name: 'emitter-clamp',
      paint: 'secondary',
      pos: [HALO_R * D45, HALO_R * D45, HALO_Z],
      rot: [0, 0, 45],
      repeat: { count: 4, rot: [0, 0, 90] },
      shape: { kind: 'box', w: 0.7, h: 0.5, d: 1.5, c: 0.2 },
    },
    {
      name: 'chime',
      paint: 'accent',
      emissive: 0.3,
      pos: [0, HALO_R + 0.25, HALO_Z - 0.2],
      rot: [-90, 0, 0],
      repeat: { count: 4, rot: [0, 0, 90] },
      shape: { kind: 'loft', stations: crystal(1.4, 0.3, 0.1) },
    },
    // Resonance drive.
    cyl('drive', 'metal', [0, 0, -7.4], 0.5, 0.7, 1.4, { segments: 6 }),
    { name: 'drive-ring', paint: 'accent', emissive: 0.45, pos: [0, 0, -8.0], shape: { kind: 'torus', radius: 0.9, tube: 0.12, segments: 6, tubeSegments: 4 } },
    {
      name: 'spine-ridge',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.6, w: 0.28, h: 0.28, y: 0.5, c: 0.12 },
          { z: -2.8, w: 0.44, h: 0.44, y: 0.95, c: 0.18 },
          { z: 1.6, w: 0.24, h: 0.24, y: 0.72, c: 0.1 },
        ],
      },
    },
    {
      name: 'tine',
      paint: 'metal',
      mirror: true,
      shape: {
        kind: 'loft',
        stations: [
          { z: 1.2, w: 0.26, h: 0.3, x: 0.52, y: -0.4, c: 0.1 },
          { z: 6.4, w: 0.2, h: 0.2, x: 0.34, y: -0.34, c: 0.08 },
          { z: 7.6, w: 0.03, h: 0.03, x: 0.3, y: -0.32 },
        ],
      },
    },
  ],
  engines: [{ pos: [0, 0, -8.2], radius: 0.55, plume: 6 }],
  hardpoints: [hp('tine', 'beam', [0.3, -0.32, 7.7], { mirror: true })],
};

// ═════════════════════════════════════════════════════════════════════════
// SFF-3 CANTICLE — organ-pipe frigate, ~500 m (modelled 1:20)
// ═════════════════════════════════════════════════════════════════════════

const CN_HULL: Station[] = [
  { z: -10.0, w: 1.5, wb: 0.9, h: 2.1, c: 0.6 },
  { z: -5.0, w: 2.6, wb: 1.5, h: 3.2, y: 0.1, c: 1.0 },
  { z: 2.0, w: 2.2, wb: 1.3, h: 2.8, y: 0.0, c: 0.9 },
  { z: 7.2, w: 1.1, wb: 0.65, h: 1.5, y: -0.1, c: 0.45 },
  { z: 10.2, w: 0.14, h: 0.3, y: -0.2 },
];
const cnTop = (z: number) => topAt(CN_HULL, z);
const CN_BLADE: WingSpec = {
  pos: [0.95, -0.2, -3.2],
  rot: [0, 0, -12],
  root: 6.0,
  tip: 1.8,
  span: 5.2,
  sweep: -2.8,
  thickness: 0.34,
  tipThickness: 0.1,
  bevel: 1,
};
/** Organ pipes along the dorsal line: [z, height, radius]. */
const PIPES: [number, number, number][] = [
  [-6.2, 1.6, 0.2],
  [-5.5, 2.4, 0.24],
  [-4.75, 3.2, 0.27],
  [-3.95, 3.8, 0.3],
  [-3.1, 3.3, 0.27],
  [-2.3, 2.6, 0.24],
  [-1.55, 1.9, 0.2],
];
/** Shoulder emitters: arcs keep them off the organ pipes on the spine. */
const CN_EMIT = [
  turret('emitter-f', [0.78, shoulderY(CN_HULL, 3.4, 0.78) - 0.05, 3.4], {
    radius: 0.3,
    height: 0.3,
    barrels: 1,
    barrelLength: 0.9,
    barrelRadius: 0.07,
    paint: 'secondary',
    trim: 'glass',
    mirror: true,
    traverse: [-100, 170],
  }),
  turret('emitter-a', [0.9, shoulderY(CN_HULL, -7.4, 0.6) - 0.05, -7.4], {
    radius: 0.26,
    height: 0.28,
    barrels: 1,
    barrelLength: 0.8,
    barrelRadius: 0.06,
    yaw: 160,
    paint: 'secondary',
    trim: 'glass',
    mirror: true,
    traverse: [-140, 90],
  }),
];

export const CANTICLE: Blueprint = {
  id: 'choir-canticle',
  name: 'Canticle',
  designation: 'SFF-3',
  faction: 'choir',
  shipClass: 'frigate',
  scale: 20,
  ramp: 'triple',
  notes:
    'Line frigate. The dorsal organ is seven resonance pipes tuned a fifth apart; played together they are a beam ' +
    'battery, played in sequence they are a hymn every Hegemony ship in range sings back.',
  parts: [
    lf('hull', 'primary', CN_HULL, { group: 1 }),
    ...ribsAlong(CN_HULL, [-8.4, -6.9, 0.2, 1.6, 3.0, 4.4], { thickness: 0.14, depth: 0.3, grow: 0.08, arc: 230, start: -25, segments: 12, c: 0.04 }).map(
      (r): Part => ({ name: 'rib', paint: 'secondary', ...r }),
    ),
    bd('seam', 'glass', CN_HULL, 5.6, 5.76, 0.02, { emissive: 0.9 }),
    bd('seam-aft', 'glass', CN_HULL, -9.2, -9.05, 0.02, { emissive: 0.9 }),
    bd('collar', 'accent', CN_HULL, -0.7, -0.35, 0.04, { emissive: 0.3 }),
    { name: 'eye', paint: 'glass', emissive: 0.9, pos: [0, cnTop(6.0) - 0.25, 6.0], shape: { kind: 'dome', radius: 1, scale: [0.3, 0.26, 1.2], segments: 12 } },
    // The organ: a pipe loft platform, seven pipes with glowing mouths.
    lf('organ-base', 'secondary', [
      { z: -6.7, w: 0.7, h: 0.5, y: cnTop(-6.6) + 0.05, c: 0.2 },
      { z: -4.0, w: 0.9, h: 0.6, y: cnTop(-4.0) + 0.1, c: 0.25 },
      { z: -1.0, w: 0.6, h: 0.45, y: cnTop(-1.0) + 0.05, c: 0.18 },
    ]),
    ...PIPES.flatMap(([z, h, r], i): Part[] => [
      post(`pipe-${i}`, 'primary', [0, cnTop(z) + 0.2, z], r * 1.08, r, h, 8),
      post(`pipe-lip-${i}`, 'accent', [0, cnTop(z) + 0.2 + h * 0.3, z], r * 1.2, r * 1.2, 0.12, 8, { emissive: 0.3 }),
      {
        name: `pipe-mouth-${i}`,
        paint: 'glass',
        emissive: 1.0,
        pos: [0, cnTop(z) + 0.2 + h, z],
        rot: [-90, 0, 0],
        socket: { id: `pipe-${i}`, kind: 'beam' },
        shape: { kind: 'loft', stations: crystal(0.9, r * 1.6, 0.05) },
      },
    ]),
    // Blades (forward-swept) with crystal tips; ventral keel blade.
    { name: 'blade', paint: 'primary', mirror: true, ...wingSlice(CN_BLADE, 0, 5.2) },
    { name: 'blade-edge', paint: 'accent', emissive: 0.5, mirror: true, ...wingSlice(CN_BLADE, 0.3, 5.0, 0.05, 0, 0.12) },
    { name: 'blade-crystal', paint: 'glass', emissive: 0.8, mirror: true, ...wingSlice(CN_BLADE, 4.6, 5.2, 0.06) },
    { name: 'blade-rib', paint: 'secondary', mirror: true, ...wingSlice(CN_BLADE, 2.0, 2.3, 0.08) },
    {
      name: 'ventral-blade',
      paint: 'secondary',
      pos: [0, -1.5, 1.0],
      rot: [0, 0, -90],
      shape: { kind: 'wing', root: 7.8, tip: 1.6, span: 2.4, sweep: 6.2, thickness: 0.3, tipThickness: 0.1, bevel: 1 },
    },
    {
      name: 'ventral-edge',
      paint: 'accent',
      emissive: 0.5,
      pos: [0, -1.5, 1.05],
      rot: [0, 0, -90],
      shape: { kind: 'wing', root: 0.55, tip: 0.3, span: 2.3, sweep: 6.0, thickness: 0.33, tipThickness: 0.12, bevel: 1 },
    },
    {
      name: 'aft-blade',
      paint: 'secondary',
      mirror: true,
      pos: [0.5, 0.9, -8.2],
      rot: [0, 0, 35],
      shape: { kind: 'wing', root: 2.8, tip: 0.8, span: 2.4, sweep: 2.0, thickness: 0.2, bevel: 1 },
    },
    // Emitter turrets on the shoulders.
    ...CN_EMIT,
    // Gallery windows.
    {
      name: 'gallery',
      paint: 'glass',
      emissive: 0.6,
      mirror: true,
      pos: [1.12, -0.25, 1.8],
      rot: [0, -3, 0],
      repeat: { count: 8, step: [0, 0, -0.6] },
      shape: { kind: 'box', w: 0.06, h: 0.18, d: 0.3 },
    },
    // Spinal lance.
    lf('lance', 'metal', [
      { z: -8.0, w: 0.8, h: 0.8, y: -1.35, c: 0.28 },
      { z: 10.6, w: 0.55, h: 0.55, y: -1.35, c: 0.19 },
    ]),
    {
      name: 'lance-coil',
      paint: 'accent',
      emissive: 0.6,
      pos: [0, -1.35, 3.6],
      repeat: { count: 5, step: [0, 0, 1.3] },
      shape: { kind: 'torus', radius: 0.48, tube: 0.1, segments: 8, tubeSegments: 4 },
    },
    lf('lance-tip', 'glass', crystal(2.2, 0.7, 0.05).map((s) => ({ ...s, z: s.z + 10.6, y: -1.35 })), { emissive: 1.1 }),
    // Triple resonance drive.
    cyl('drive', 'metal', [0, 0.1, -10.4], 0.62, 0.8, 1.3, { segments: 6 }),
    { name: 'drive-ring', paint: 'accent', emissive: 0.45, pos: [0, 0.1, -11.0], shape: { kind: 'torus', radius: 1.0, tube: 0.13, segments: 6, tubeSegments: 4 } },
    cyl('drive-side', 'metal', [0.9, -0.7, -9.6], 0.36, 0.46, 1.0, { segments: 6, mirror: true }),
    { name: 'drive-side-ring', paint: 'accent', emissive: 0.45, mirror: true, pos: [0.9, -0.7, -10.1], shape: { kind: 'torus', radius: 0.58, tube: 0.09, segments: 6, tubeSegments: 4 } },
  ],
  engines: [
    { pos: [0, 0.1, -11.1], radius: 0.62, plume: 5 },
    { pos: [0.9, -0.7, -10.15], radius: 0.36, plume: 3.4, mirror: true },
  ],
  hardpoints: [hp('lance', 'beam', [0, -1.35, 12.2]), hp('bridge', 'gun', [0, cnTop(6.0), 6.4])],
};
