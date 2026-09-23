import type { Blueprint, Part, Station, Vec3 } from '../Blueprint';
import { band, ribsAlong, sectionAt, shoulderY, topAt, wingSlice, type WingSpec } from './kit';

/** A faceted spire: a tapering loft stood upright on (x, y, z). */
function spire(name: string, pos: Vec3, w: number, height: number, paint: Part['paint'] = 'primary', down = false): Part {
  return {
    name,
    paint,
    pos,
    rot: [down ? 90 : -90, 0, 0],
    shape: {
      kind: 'loft',
      stations: [
        { z: 0, w, h: w * 1.4, c: w * 0.35 },
        { z: height * 0.7, w: w * 0.7, h: w, c: w * 0.3 },
        { z: height, w: 0.04 * w, h: 0.04 * w },
      ],
    },
  };
}

/** A crystal: a diamond-section loft along Z. */
function crystal(len: number, girth: number, at = 0.3): Station[] {
  return [
    { z: -len * at, w: girth * 0.1, h: girth * 0.1, c: girth * 0.05 },
    { z: 0, w: girth, h: girth, c: girth / 2 },
    { z: len * (1 - at) * 0.55, w: girth * 0.85, h: girth * 0.85, c: girth * 0.425 },
    { z: len * (1 - at), w: 0.02, h: 0.02 },
  ];
}

// ═════════════════════════════════════════════════════════════════════════
// SC-7 PSALTER — torpedo bomber, ~26 m
// ═════════════════════════════════════════════════════════════════════════

const PS_HULL: Station[] = [
  { z: -11.0, w: 1.8, wb: 1.2, h: 1.6, c: 0.6 },
  { z: -5.0, w: 3.2, wb: 2.0, h: 2.2, y: 0.1, c: 0.9 },
  { z: 3.0, w: 2.6, wb: 1.6, h: 1.9, y: 0.0, c: 0.8 },
  { z: 9.0, w: 1.2, wb: 0.8, h: 1.1, y: -0.15, c: 0.45 },
  { z: 12.5, w: 0.08, h: 0.3, y: -0.3 },
];

const PS_WING: WingSpec = {
  pos: [1.2, -0.1, -3.8],
  rot: [0, 0, -8],
  root: 7.0,
  tip: 2.6,
  span: 8.0,
  sweep: -4.5,
  thickness: 0.42,
  tipThickness: 0.12,
  bevel: 1,
};

const HARP_Z = -3.8;
const HARP_R = 3.4;
const HARP_Y = -0.1;

export const PSALTER: Blueprint = {
  id: 'choir-psalter',
  name: 'Psalter',
  designation: 'SC-7',
  faction: 'choir',
  shipClass: 'bomber',
  ramp: 'triple',
  notes:
    'Carries a single grown-crystal torpedo tuned to a target hull. The dorsal "harp" sings the tuning note before release.',
  parts: [
    { name: 'hull', paint: 'primary', group: 1, shape: { kind: 'loft', stations: PS_HULL } },
    { name: 'seam-fore', paint: 'glass', emissive: 0.9, shape: band(PS_HULL, 1.4, 1.65, 0.03) },
    { name: 'seam-aft', paint: 'glass', emissive: 0.9, shape: band(PS_HULL, -7.4, -7.15, 0.03) },
    { name: 'collar', paint: 'secondary', shape: band(PS_HULL, -9.6, -8.6, 0.04) },
    { name: 'eye', paint: 'glass', emissive: 0.9, pos: [0, 0.6, 6.0], shape: { kind: 'dome', radius: 1, scale: [0.36, 0.3, 1.4], segments: 12 } },
    // Forward-swept blades.
    { name: 'blade', paint: 'secondary', mirror: true, ...wingSlice(PS_WING, 0, 8.0) },
    { name: 'blade-edge', paint: 'accent', emissive: 0.55, mirror: true, ...wingSlice(PS_WING, 0.4, 7.6, 0.05, 0, 0.12) },
    { name: 'blade-crystal', paint: 'glass', emissive: 0.8, mirror: true, ...wingSlice(PS_WING, 7.4, 8.0, 0.08) },
    { name: 'blade-vane', paint: 'primary', mirror: true, ...wingSlice(PS_WING, 3.2, 3.5, 0.18, 0.3, 1) },
    {
      name: 'tail-blade',
      paint: 'primary',
      mirror: true,
      pos: [0.9, -0.4, -8.2],
      rot: [0, 0, -35],
      shape: { kind: 'wing', root: 3.6, tip: 1.2, span: 3.5, sweep: 2.8, thickness: 0.25, bevel: 1 },
    },
    {
      name: 'keel-blade',
      paint: 'secondary',
      pos: [0, -0.7, -6.2],
      rot: [0, 0, -90],
      shape: { kind: 'wing', root: 4.6, tip: 1.6, span: 1.5, sweep: 2.8, thickness: 0.3, bevel: 1 },
    },
    // Dorsal harp: an arch with glowing strings.
    {
      name: 'harp',
      paint: 'secondary',
      pos: [0, HARP_Y, HARP_Z],
      shape: { kind: 'rib', radius: HARP_R, thickness: 0.36, depth: 0.6, arc: 200, start: -10, segments: 16, c: 0.12 },
    },
    {
      name: 'harp-edge',
      paint: 'accent',
      emissive: 0.4,
      pos: [0, HARP_Y, HARP_Z - 0.33],
      shape: { kind: 'rib', radius: HARP_R, thickness: 0.2, depth: 0.12, arc: 190, start: -5, segments: 16 },
    },
    ...[-2.2, -1.1, 0, 1.1, 2.2].map((x): Part => {
      const base = topAt(PS_HULL, HARP_Z) - 0.1;
      const top = HARP_Y + Math.sqrt((HARP_R - 0.15) ** 2 - x * x);
      return {
        name: 'harp-string',
        paint: 'glow',
        emissive: 1.1,
        pos: [x, (base + top) / 2, HARP_Z],
        shape: { kind: 'box', w: 0.07, h: top - base, d: 0.1 },
      };
    }),
    {
      name: 'harp-crystal',
      paint: 'glass',
      emissive: 1.0,
      pos: [0, HARP_Y + HARP_R + 0.1, HARP_Z],
      rot: [-90, 0, 0],
      shape: { kind: 'loft', stations: crystal(1.4, 0.45, 0.1) },
    },
    // Torpedo cradle + the crystal torpedo.
    { name: 'cradle', paint: 'dark', mirror: true, pos: [0.7, -1.45, 0.4], rot: [0, 0, -20], shape: { kind: 'box', w: 0.26, h: 1.3, d: 6.0, c: 0.08 } },
    { name: 'torpedo', paint: 'glass', emissive: 0.85, pos: [0, -2.45, 0.8], shape: { kind: 'loft', stations: crystal(13, 1.4, 0.35) } },
    {
      name: 'torpedo-clamp',
      paint: 'secondary',
      pos: [0, -2.45, -1.6],
      repeat: { count: 2, step: [0, 0, 3.8] },
      shape: { kind: 'torus', radius: 0.78, tube: 0.12, segments: 8, tubeSegments: 4 },
    },
    // Resonance drive.
    { name: 'drive', paint: 'metal', pos: [0, 0, -11.4], shape: { kind: 'cylinder', rFront: 0.7, rBack: 0.9, length: 1.4, segments: 6 } },
    {
      name: 'drive-ring',
      paint: 'accent',
      emissive: 0.4,
      pos: [0, 0, -12.1],
      shape: { kind: 'torus', radius: 1.15, tube: 0.14, segments: 6, tubeSegments: 4 },
    },
    {
      name: 'side-drive',
      paint: 'metal',
      mirror: true,
      pos: [1.25, -0.35, -10.4],
      shape: { kind: 'cylinder', rFront: 0.34, rBack: 0.46, length: 1.8, segments: 6 },
    },
  ],
  engines: [
    { pos: [0, 0, -12.4], radius: 0.7, plume: 7 },
    { pos: [1.25, -0.35, -11.4], radius: 0.36, plume: 4, mirror: true },
  ],
  hardpoints: [
    { id: 'torpedo', pos: [0, -2.45, 9.2], kind: 'missile' },
    { id: 'harp', pos: [0, HARP_Y + HARP_R + 1.4, HARP_Z], kind: 'beam' },
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// VESPER — escort corvette, ~150 m, spinal lance (modelled 1:10)
// ═════════════════════════════════════════════════════════════════════════

const VS_HULL: Station[] = [
  { z: -6.0, w: 1.4, wb: 0.9, h: 2.4, c: 0.6 },
  { z: -2.0, w: 2.2, wb: 1.3, h: 3.0, y: 0.1, c: 0.95 },
  { z: 3.0, w: 1.7, wb: 1.0, h: 2.5, y: 0.0, c: 0.8 },
  { z: 6.0, w: 0.85, wb: 0.5, h: 1.3, y: -0.1, c: 0.4 },
  { z: 7.2, w: 0.15, h: 0.3, y: -0.2 },
];

const VS_BLADE: WingSpec = {
  pos: [0.75, 0.0, -2.4],
  rot: [0, 0, -18],
  root: 4.6,
  tip: 1.6,
  span: 3.4,
  sweep: -1.6,
  thickness: 0.3,
  tipThickness: 0.1,
  bevel: 1,
};

export const VESPER: Blueprint = {
  id: 'choir-vesper',
  name: 'Vesper',
  designation: 'SCE-2',
  faction: 'choir',
  shipClass: 'corvette',
  scale: 10,
  ramp: 'triple',
  notes:
    'An escort built around a single spinal lance that runs the length of the keel. Vespers travel in threes, and fire together.',
  parts: [
    { name: 'hull', paint: 'primary', group: 1, shape: { kind: 'loft', stations: VS_HULL } },
    ...ribsAlong(VS_HULL, [-4.2, -3.0, -1.0, 0.2, 1.4], { thickness: 0.14, depth: 0.28, grow: 0.08, arc: 230, start: -25, segments: 12, c: 0.04 }).map(
      (r): Part => ({ name: 'rib', paint: 'secondary', ...r }),
    ),
    { name: 'seam', paint: 'glass', emissive: 0.9, shape: band(VS_HULL, 3.6, 3.75, 0.02) },
    { name: 'seam-aft', paint: 'glass', emissive: 0.9, shape: band(VS_HULL, -5.3, -5.15, 0.02) },
    { name: 'eye', paint: 'glass', emissive: 0.9, pos: [0, 0.78, 4.4], shape: { kind: 'dome', radius: 1, scale: [0.28, 0.24, 1.0], segments: 12 } },
    // Spinal lance.
    {
      name: 'lance',
      paint: 'metal',
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.6, w: 0.9, h: 0.9, y: -1.3, c: 0.3 },
          { z: 7.6, w: 0.62, h: 0.62, y: -1.3, c: 0.21 },
        ],
      },
    },
    { name: 'lance-web', paint: 'secondary', pos: [0, -0.85, -0.2], shape: { kind: 'box', w: 0.34, h: 0.7, d: 10.5, c: 0.1 } },
    {
      name: 'lance-coil',
      paint: 'accent',
      emissive: 0.6,
      pos: [0, -1.3, 1.2],
      repeat: { count: 5, step: [0, 0, 1.3] },
      shape: { kind: 'torus', radius: 0.52, tube: 0.1, segments: 8, tubeSegments: 4 },
    },
    { name: 'lance-tip', paint: 'glass', emissive: 1.1, pos: [0, -1.3, 7.6], shape: { kind: 'loft', stations: crystal(2.2, 0.75, 0.05) } },
    // Blades.
    {
      name: 'dorsal-blade',
      paint: 'secondary',
      pos: [0, 1.25, 0.6],
      rot: [0, 0, 90],
      shape: { kind: 'wing', root: 6.4, tip: 1.3, span: 2.7, sweep: 5.3, thickness: 0.3, tipThickness: 0.1, bevel: 1 },
    },
    {
      name: 'dorsal-edge',
      paint: 'accent',
      emissive: 0.5,
      pos: [0, 1.25, 0.65],
      rot: [0, 0, 90],
      shape: { kind: 'wing', root: 0.5, tip: 0.3, span: 2.6, sweep: 5.1, thickness: 0.33, tipThickness: 0.12, bevel: 1 },
    },
    {
      name: 'ventral-blade',
      paint: 'secondary',
      pos: [0, -1.65, -2.4],
      rot: [0, 0, -90],
      shape: { kind: 'wing', root: 4.2, tip: 0.9, span: 1.7, sweep: 3.4, thickness: 0.26, tipThickness: 0.08, bevel: 1 },
    },
    { name: 'blade', paint: 'primary', mirror: true, ...wingSlice(VS_BLADE, 0, 3.4) },
    { name: 'blade-edge', paint: 'accent', emissive: 0.5, mirror: true, ...wingSlice(VS_BLADE, 0.3, 3.2, 0.04, 0, 0.14) },
    { name: 'blade-crystal', paint: 'glass', emissive: 0.8, mirror: true, ...wingSlice(VS_BLADE, 2.9, 3.4, 0.06) },
    {
      name: 'aft-blade',
      paint: 'secondary',
      mirror: true,
      pos: [0.5, 0.75, -4.4],
      rot: [0, 0, 35],
      shape: { kind: 'wing', root: 2.4, tip: 0.8, span: 2.2, sweep: 1.8, thickness: 0.2, bevel: 1 },
    },
    // Emitter turrets on the shoulders.
    ...[2.2, -3.4].map(
      (z, i): Part => ({
        name: 'emitter',
        paint: 'secondary',
        trim: 'glass',
        mirror: true,
        pos: [0.62, shoulderY(VS_HULL, z, 0.62) - 0.02, z],
        rot: [0, i ? -20 : 15, -18],
        socket: { id: `emitter-${i}`, kind: 'turret' },
        shape: { kind: 'turret', radius: 0.26, height: 0.28, barrels: 1, barrelLength: 0.8, barrelRadius: 0.06 },
      }),
    ),
    {
      name: 'gallery',
      paint: 'glass',
      emissive: 0.6,
      mirror: true,
      pos: [0.98, -0.25, 1.3],
      rot: [0, -3, 0],
      repeat: { count: 5, step: [0, 0, -0.55] },
      shape: { kind: 'box', w: 0.06, h: 0.16, d: 0.3 },
    },
    // Drive.
    { name: 'drive', paint: 'metal', pos: [0, 0.05, -6.5], shape: { kind: 'cylinder', rFront: 0.62, rBack: 0.78, length: 1.2, segments: 6 } },
    { name: 'drive-ring', paint: 'accent', emissive: 0.45, pos: [0, 0.05, -7.0], shape: { kind: 'torus', radius: 0.98, tube: 0.12, segments: 6, tubeSegments: 4 } },
  ],
  engines: [
    { pos: [0, 0.05, -7.15], radius: 0.6, plume: 5 },
    { pos: [0, -1.3, -6.7], radius: 0.36, plume: 3 },
  ],
  hardpoints: [{ id: 'lance', pos: [0, -1.3, 9.8], kind: 'beam' }],
};

// ═════════════════════════════════════════════════════════════════════════
// SCD-1 CATHEDRAL — dreadnought, ~2.9 km (modelled 1:100)
// ═════════════════════════════════════════════════════════════════════════

const NAVE: Station[] = [
  { z: -12.0, w: 3.0, wb: 2.4, h: 3.2, c: 0.9 },
  { z: -4.0, w: 4.2, wb: 3.0, h: 3.8, y: 0.2, c: 1.2 },
  { z: 5.0, w: 3.4, wb: 2.2, h: 3.0, y: 0.0, c: 1.0 },
  { z: 10.6, w: 2.2, wb: 1.4, h: 2.4, y: -0.3, c: 0.7 },
  { z: 11.4, w: 2.1, wb: 1.3, h: 2.3, y: -0.3, c: 0.66 },
];
const FACADE_Z = 11.4;

const SPIRES = [
  { z: -6.5, hgt: 6.5, w: 1.3 },
  { z: -2.0, hgt: 8.5, w: 1.6 },
  { z: 2.5, hgt: 5.0, w: 1.1 },
];

/** Greeble patches along the nave roof, between the spires, tilted to follow it. */
function roofGreebles(z0: number, z1: number, seed: number): Part {
  const zc = (z0 + z1) / 2;
  const slope = Math.atan2(topAt(NAVE, z1) - topAt(NAVE, z0), z1 - z0);
  return {
    name: 'roof-greebles',
    paint: 'secondary',
    trim: 'glass',
    pos: [0, topAt(NAVE, zc) - 0.02, zc],
    rot: [(-slope * 180) / Math.PI, 0, 0],
    shape: { kind: 'greeble', w: 1.5, d: z1 - z0, count: Math.round((z1 - z0) * 9), seed, size: [0.08, 0.32], height: [0.04, 0.18] },
  };
}

const BATTERY_Z = [-10.2, -8.6, -4.4, -3.2, 0.4, 1.6, 4.4, 5.8, 7.2];
const SPIRELETS = [
  { z: -9.4, h: 2.2 },
  { z: -3.8, h: 3.2 },
  { z: 1.0, h: 2.6 },
  { z: 5.1, h: 1.9 },
];

export const CATHEDRAL: Blueprint = {
  id: 'choir-cathedral',
  name: 'Cathedral',
  designation: 'SCD-1',
  faction: 'choir',
  shipClass: 'dreadnought',
  scale: 100,
  ramp: 'dramatic',
  notes: 'Three were sighted at the fall of Tessaly Gate. One is still unaccounted for.',
  parts: [
    { name: 'nave', paint: 'primary', group: 1, shape: { kind: 'loft', stations: NAVE } },
    {
      name: 'keel',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -11.0, w: 1.4, wb: 0.4, h: 1.6, y: -2.2, c: 0.3 },
          { z: 6.0, w: 1.6, wb: 0.3, h: 2.2, y: -2.4, c: 0.3 },
          { z: 10.5, w: 0.3, wb: 0.1, h: 0.6, y: -1.4 },
        ],
      },
    },
    { name: 'keel-seam', paint: 'glass', emissive: 1.0, pos: [0, -3.42, -2.0], shape: { kind: 'box', w: 0.12, h: 0.08, d: 13.0 } },
    // Prow ram under the west-front facade.
    {
      name: 'ram',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: 9.0, w: 1.4, wb: 0.5, h: 1.2, y: -1.2, c: 0.4 },
          { z: 11.4, w: 1.1, wb: 0.4, h: 1.0, y: -1.3, c: 0.35 },
          { z: 14.6, w: 0.1, h: 0.2, y: -1.5 },
        ],
      },
    },
    // Ribs over the nave (between spires) and glowing seams.
    ...ribsAlong(NAVE, [-10.6, -9.0, -4.4, 0.2, 4.2, 6.0, 7.8, 9.6], { thickness: 0.24, depth: 0.36, grow: 0.12, arc: 250, start: -35, segments: 14, c: 0.08 }).map(
      (r): Part => ({ name: 'rib', paint: 'secondary', ...r }),
    ),
    { name: 'seam-a', paint: 'glass', emissive: 1.0, shape: band(NAVE, -7.9, -7.75, 0.03) },
    { name: 'seam-b', paint: 'glass', emissive: 1.0, shape: band(NAVE, -0.7, -0.55, 0.03) },
    { name: 'seam-c', paint: 'glass', emissive: 1.0, shape: band(NAVE, 3.3, 3.45, 0.03) },
    // Resonance spires with glowing bands and window slits.
    ...SPIRES.map((s, i) => spire(`spire-${i}`, [0, topAt(NAVE, s.z) - 0.3, s.z], s.w, s.hgt)),
    ...SPIRES.map(
      (s, i): Part => ({
        name: `spire-glow-${i}`,
        paint: 'glass',
        emissive: 1.2,
        pos: [0, topAt(NAVE, s.z) + 0.5 + i * 0.3, s.z],
        shape: { kind: 'box', w: s.w * 0.8, h: 0.25, d: s.w * 1.2, c: 0.1 },
      }),
    ),
    ...SPIRES.map(
      (s): Part => ({
        name: 'spire-slit',
        paint: 'glass',
        emissive: 1.0,
        pos: [0, topAt(NAVE, s.z) + s.hgt * 0.38, s.z + s.w * 0.55],
        shape: { kind: 'box', w: s.w * 0.14, h: s.hgt * 0.26, d: 0.06 },
      }),
    ),
    ...SPIRELETS.map((s) => ({ ...spire('spirelet', [1.2, shoulderY(NAVE, s.z, 1.2) - 0.15, s.z], 0.55, s.h), mirror: true })),
    ...SPIRELETS.map(
      (s): Part => ({
        name: 'spirelet-glow',
        paint: 'glass',
        emissive: 1.1,
        mirror: true,
        pos: [1.2, shoulderY(NAVE, s.z, 1.2) + s.h * 0.35, s.z + 0.2],
        shape: { kind: 'box', w: 0.1, h: s.h * 0.25, d: 0.06 },
      }),
    ),
    // Roof greebles between the spires.
    roofGreebles(-11.2, -7.6, 3),
    roofGreebles(-5.4, -3.0, 5),
    roofGreebles(-0.8, 1.6, 7),
    roofGreebles(3.4, 9.4, 11),
    // Broadside battery along the roof edges.
    ...BATTERY_Z.map((z, i): Part => {
      const s = sectionAt(NAVE, z);
      const x = s.w / 2 - (s.c ?? 0) - 0.15;
      return {
        name: 'battery',
        paint: 'secondary',
        trim: 'metal',
        mirror: true,
        pos: [x, topAt(NAVE, z) - 0.02, z],
        rot: [0, 18 + (i % 3) * 14, 0],
        socket: { id: `battery-${i}`, kind: 'turret' },
        shape: { kind: 'turret', radius: 0.26, height: 0.3, barrels: 2, barrelLength: 0.75, barrelRadius: 0.045 },
      };
    }),
    // Flying buttresses with pinnacles.
    {
      name: 'buttress',
      paint: 'secondary',
      mirror: true,
      pos: [1.8, 0.4, 3.0],
      rot: [0, 0, 28],
      shape: { kind: 'wing', root: 7.0, tip: 2.0, span: 4.0, sweep: 5.0, thickness: 0.5, bevel: 1 },
    },
    { name: 'buttress-edge', paint: 'accent', emissive: 0.35, mirror: true, ...wingSlice({ pos: [1.8, 0.4, 3.0], rot: [0, 0, 28], root: 7, tip: 2, span: 4, sweep: 5, thickness: 0.5, bevel: 1 }, 0.3, 3.9, 0.06, 0, 0.1) },
    { ...spire('pinnacle', [5.3, 2.2, -3.0], 0.45, 1.9), mirror: true },
    {
      name: 'buttress-low',
      paint: 'secondary',
      mirror: true,
      pos: [1.3, -1.4, 0.0],
      rot: [0, 0, -32],
      shape: { kind: 'wing', root: 6.0, tip: 1.4, span: 3.0, sweep: 4.4, thickness: 0.45, bevel: 1 },
    },
    { ...spire('pendant', [3.8, -2.9, -5.1], 0.4, 1.5, 'secondary', true), mirror: true },
    {
      name: 'buttress-aft',
      paint: 'primary',
      mirror: true,
      pos: [1.3, 0.9, -7.0],
      rot: [0, 0, 42],
      shape: { kind: 'wing', root: 4.6, tip: 1.2, span: 3.2, sweep: 3.8, thickness: 0.4, bevel: 1 },
    },
    { name: 'fin-crystal', paint: 'glass', emissive: 0.9, mirror: true, ...wingSlice({ pos: [1.3, 0.9, -7.0], rot: [0, 0, 42], root: 4.6, tip: 1.2, span: 3.2, sweep: 3.8, thickness: 0.4, bevel: 1 }, 2.7, 3.2, 0.08) },
    // Hangar galleries: an arcade of openings with lights.
    { name: 'gallery', paint: 'dark', mirror: true, pos: [1.95, -0.2, -2.0], shape: { kind: 'box', w: 0.3, h: 0.9, d: 6.0, c: 0.1 } },
    {
      name: 'gallery-pier',
      paint: 'secondary',
      mirror: true,
      pos: [2.08, -0.2, 0.9],
      repeat: { count: 7, step: [0, 0, -0.96] },
      shape: { kind: 'box', w: 0.14, h: 1.0, d: 0.18, c: 0.04 },
    },
    {
      name: 'gallery-arch',
      paint: 'secondary',
      mirror: true,
      pos: [2.08, 0.34, -2.0],
      shape: { kind: 'box', w: 0.16, h: 0.18, d: 6.2, c: 0.05 },
    },
    {
      name: 'gallery-lights',
      paint: 'accent',
      emissive: 1.0,
      mirror: true,
      pos: [2.06, -0.55, 0.42],
      repeat: { count: 6, step: [0, 0, -0.96] },
      shape: { kind: 'box', w: 0.06, h: 0.06, d: 0.4 },
    },
    // West-front facade: rose window, twin towers.
    { name: 'rose-ring', paint: 'secondary', pos: [0, -0.3, FACADE_Z + 0.02], shape: { kind: 'torus', radius: 0.78, tube: 0.1, segments: 16, tubeSegments: 4 } },
    { name: 'rose-window', paint: 'glass', emissive: 1.0, pos: [0, -0.3, FACADE_Z + 0.02], shape: { kind: 'torus', radius: 0.55, tube: 0.14, segments: 12, tubeSegments: 4 } },
    { name: 'rose-core', paint: 'glass', emissive: 1.3, pos: [0, -0.3, FACADE_Z], shape: { kind: 'dome', radius: 0.42, segments: 12, scale: [1, 1, 0.25] } },
    {
      name: 'rose-tracery',
      paint: 'secondary',
      pos: [0, -0.3, FACADE_Z + 0.08],
      repeat: { count: 4, rot: [0, 0, 45] },
      shape: { kind: 'box', w: 1.5, h: 0.06, d: 0.06 },
    },
    { ...spire('facade-tower', [0.78, 0.6, FACADE_Z - 0.3], 0.45, 2.4), mirror: true },
    { name: 'facade-arch', paint: 'secondary', pos: [0, -0.3, FACADE_Z + 0.02], scale: [1.0, 1.25, 1], shape: { kind: 'rib', radius: 0.95, thickness: 0.12, depth: 0.14, arc: 180, segments: 12 } },
    // Drive block.
    {
      name: 'drive-block',
      paint: 'metal',
      shape: {
        kind: 'loft',
        stations: [
          { z: -14.0, w: 4.2, h: 2.6, c: 1.0 },
          { z: -11.5, w: 3.4, h: 3.0, c: 1.0 },
        ],
      },
    },
    {
      name: 'drive-greebles',
      paint: 'secondary',
      trim: 'glass',
      mirror: true,
      pos: [1.9, 0.0, -12.8],
      rot: [0, 0, -90],
      shape: { kind: 'greeble', w: 1.0, d: 2.2, count: 14, seed: 23, size: [0.08, 0.3], height: [0.04, 0.14] },
    },
    { name: 'drive-collar', paint: 'glass', emissive: 0.9, pos: [0, 0, -11.6], shape: { kind: 'box', w: 3.5, h: 3.1, d: 0.12, c: 1.0 } },
    {
      name: 'drive-bell',
      paint: 'dark',
      mirror: true,
      pos: [1.2, 0, -14.5],
      shape: { kind: 'cylinder', rFront: 0.8, rBack: 1.0, length: 1.2, segments: 8, open: true },
    },
    {
      name: 'drive-bell-center',
      paint: 'dark',
      pos: [0, 0.2, -14.6],
      shape: { kind: 'cylinder', rFront: 0.9, rBack: 1.15, length: 1.4, segments: 8, open: true },
    },
  ],
  engines: [
    { pos: [1.2, 0, -15.0], radius: 0.8, plume: 7, mirror: true },
    { pos: [0, 0.2, -15.2], radius: 0.95, plume: 9 },
  ],
  hardpoints: [
    { id: 'lance', pos: [0, -0.3, FACADE_Z + 0.3], kind: 'beam' },
    { id: 'hangar', pos: [2.1, -0.2, -2.0], kind: 'hangar', mirror: true },
    ...SPIRES.map((s, i) => ({ id: `spire-${i}`, pos: [0, topAt(NAVE, s.z) - 0.3 + s.hgt, s.z] as Vec3, kind: 'beam' as const })),
  ],
};

