import type { Blueprint, Part, Station } from '../Blueprint';
import { band, wingPoint, wingSlice, type WingSpec } from './kit';

// ═════════════════════════════════════════════════════════════════════════
// VF-31 HARRIER — variable-geometry strike fighter, ~22 m
// ═════════════════════════════════════════════════════════════════════════

const HARRIER_FUSE: Station[] = [
  { z: -5.0, w: 2.2, wb: 2.0, h: 1.6, y: 0.25, c: 0.4 },
  { z: 0.0, w: 2.4, wb: 2.1, h: 2.0, y: 0.3, c: 0.5 },
  { z: 4.5, w: 2.3, wb: 1.9, h: 2.1, y: 0.3, c: 0.55 },
  { z: 7.5, w: 1.7, wb: 1.3, h: 1.6, y: 0.1, c: 0.45 },
  { z: 9.8, w: 0.95, wb: 0.75, h: 0.95, y: -0.15, c: 0.28 },
];

const HARRIER_NACELLE: Station[] = [
  { z: 2.3, w: 1.5, h: 1.7, x: 2.25, y: -0.45, c: 0.35 },
  { z: -1.0, w: 1.75, h: 1.8, x: 2.25, y: -0.45, c: 0.45 },
  { z: -8.2, w: 1.7, h: 1.7, x: 2.25, y: -0.4, c: 0.5 },
  { z: -9.9, w: 1.45, h: 1.45, x: 2.25, y: -0.4, c: 0.45 },
];

/** Swing wing planform (authored spread, 20° leading edge). */
const HARRIER_WING: WingSpec = {
  pos: [2.9, 0.28, 0.9],
  rot: [0, 0, -2],
  root: 4.4,
  tip: 1.8,
  span: 8.2,
  sweep: 3.0,
  thickness: 0.36,
  tipThickness: 0.16,
};

const HARRIER_TAIL: WingSpec = {
  pos: [2.35, 0.5, -5.4],
  rot: [0, 0, 78],
  root: 3.7,
  tip: 1.4,
  span: 3.5,
  sweep: 2.7,
  thickness: 0.22,
  tipThickness: 0.14,
};

export const HARRIER: Blueprint = {
  id: 'vf31-harrier',
  name: 'Harrier',
  designation: 'VF-31',
  faction: 'concord',
  shipClass: 'strike-fighter',
  ramp: 'classic',
  notes:
    'Two-seat strike fighter built around a wide lifting body and a pair of conformal ordnance pods. ' +
    'Slower than a Kestrel and twice as expensive to lose.',
  parts: [
    { name: 'fuselage', paint: 'primary', group: 1, shape: { kind: 'loft', stations: HARRIER_FUSE } },
    {
      name: 'radome',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: 9.8, w: 0.95, wb: 0.75, h: 0.95, y: -0.15, c: 0.28 },
          { z: 11.4, w: 0.16, h: 0.18, y: -0.32 },
        ],
      },
    },
    { name: 'nose-band', paint: 'accent', shape: band(HARRIER_FUSE, 8.4, 8.9, 0.02) },
    // Lifting-body "pancake" between the nacelles.
    {
      name: 'pancake',
      paint: 'primary',
      shape: {
        kind: 'loft',
        stations: [
          { z: 3.2, w: 2.2, h: 0.9, y: -0.3, c: 0.3 },
          { z: 0.6, w: 5.4, wb: 5.2, h: 1.0, y: -0.25, c: 0.35 },
          { z: -7.6, w: 5.4, wb: 5.0, h: 0.9, y: -0.25, c: 0.3 },
          { z: -9.7, w: 3.0, h: 0.5, y: -0.2, c: 0.2 },
        ],
      },
    },
    { name: 'nacelle', paint: 'primary', mirror: true, shape: { kind: 'loft', stations: HARRIER_NACELLE } },
    { name: 'nacelle-band', paint: 'secondary', mirror: true, shape: band(HARRIER_NACELLE, -8.0, -7.2, 0.03) },
    { name: 'intake', paint: 'dark', mirror: true, pos: [2.25, -0.45, 2.33], shape: { kind: 'box', w: 1.15, h: 1.3, d: 0.1, c: 0.25 } },
    {
      name: 'intake-ramp',
      paint: 'secondary',
      mirror: true,
      pos: [1.45, -0.2, 3.0],
      rot: [0, 0, 90],
      shape: { kind: 'wing', root: 2.6, tip: 1.4, span: 0.9, sweep: 1.4, thickness: 0.14 },
    },
    {
      name: 'nozzle',
      paint: 'dark',
      mirror: true,
      pos: [2.25, -0.4, -10.3],
      shape: { kind: 'cylinder', rFront: 0.66, rBack: 0.76, length: 1.0, segments: 12, open: true },
    },
    {
      name: 'nozzle-ring',
      paint: 'metal',
      mirror: true,
      pos: [2.25, -0.4, -9.85],
      shape: { kind: 'cylinder', rFront: 0.74, rBack: 0.74, length: 0.2, segments: 12 },
    },
    // Fixed glove (the swing wing pivots inside it).
    {
      name: 'glove',
      paint: 'primary',
      mirror: true,
      pos: [2.15, 0.28, 4.2],
      rot: [0, 0, -2],
      shape: { kind: 'wing', root: 8.1, tip: 4.5, span: 1.45, sweep: 3.7, thickness: 0.62, tipThickness: 0.52 },
    },
    {
      name: 'glove-edge',
      paint: 'accent',
      mirror: true,
      pos: [2.2, 0.3, 4.1],
      rot: [0, 0, -2],
      shape: { kind: 'wing', root: 0.9, tip: 0.55, span: 1.35, sweep: 3.45, thickness: 0.66, tipThickness: 0.56 },
    },
    // Swing wing (articulated).
    { name: 'wing', paint: 'primary', mirror: true, articulation: 'wing', ...wingSlice(HARRIER_WING, 0, 8.2) },
    { name: 'wing-stripe', paint: 'secondary', mirror: true, articulation: 'wing', ...wingSlice(HARRIER_WING, 5.6, 6.6, 0.05) },
    { name: 'wing-tip', paint: 'accent', mirror: true, articulation: 'wing', ...wingSlice(HARRIER_WING, 7.75, 8.2, 0.05) },
    { name: 'flap', paint: 'secondary', mirror: true, articulation: 'wing', ...wingSlice(HARRIER_WING, 1.9, 5.4, 0.04, 0.72, 1) },
    {
      name: 'wing-pylon',
      paint: 'dark',
      mirror: true,
      articulation: 'wing',
      pos: wingPoint(HARRIER_WING, 4.4, 0.45, -0.35),
      shape: { kind: 'box', w: 0.18, h: 0.4, d: 1.6, c: 0.05 },
    },
    {
      name: 'wing-missile',
      paint: 'accent',
      trim: 'metal',
      mirror: true,
      articulation: 'wing',
      pos: wingPoint(HARRIER_WING, 4.4, 0.4, -0.7),
      shape: {
        kind: 'lathe',
        segments: 8,
        profile: [
          [0, -1.6],
          [0.16, -1.5],
          [0.16, 1.0],
          [0.1, 1.4],
          [0, 1.6],
        ],
      },
    },
    {
      name: 'nav-light',
      paint: 'glow',
      mirror: true,
      articulation: 'wing',
      emissive: 1.5,
      pos: wingPoint(HARRIER_WING, 8.25, 0.4),
      shape: { kind: 'box', w: 0.12, h: 0.12, d: 0.4 },
    },
    // Twin tails + caps.
    { name: 'tail', paint: 'secondary', mirror: true, ...wingSlice(HARRIER_TAIL, 0, 3.5) },
    { name: 'tail-cap', paint: 'accent', mirror: true, ...wingSlice(HARRIER_TAIL, 3.05, 3.5, 0.05) },
    { name: 'tail-band', paint: 'primary', mirror: true, ...wingSlice(HARRIER_TAIL, 1.6, 2.1, 0.04) },
    {
      name: 'stabilator',
      paint: 'primary',
      mirror: true,
      pos: [3.0, -0.35, -7.4],
      rot: [0, 0, -4],
      shape: { kind: 'wing', root: 3.0, tip: 1.0, span: 3.0, sweep: 2.3, thickness: 0.22, tipThickness: 0.12 },
    },
    {
      name: 'ventral-fin',
      paint: 'dark',
      mirror: true,
      pos: [2.7, -1.2, -6.2],
      rot: [0, 0, -105],
      shape: { kind: 'wing', root: 2.3, tip: 0.9, span: 1.0, sweep: 1.3, thickness: 0.14 },
    },
    // Tandem canopy + frame.
    {
      name: 'canopy',
      paint: 'glass',
      pos: [0, 1.32, 5.3],
      shape: { kind: 'dome', radius: 1, scale: [0.72, 0.62, 2.6], segments: 16 },
    },
    {
      name: 'canopy-frame',
      paint: 'secondary',
      pos: [0, 1.32, 5.0],
      scale: [1.13, 0.97, 1],
      shape: { kind: 'rib', radius: 0.64, thickness: 0.09, depth: 0.2, arc: 180, segments: 10 },
    },
    {
      name: 'spine',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -8.2, w: 0.9, h: 0.4, y: 1.0, c: 0.15 },
          { z: -2.0, w: 1.3, h: 0.9, y: 1.25, c: 0.3 },
          { z: 3.1, w: 1.05, h: 0.8, y: 1.38, c: 0.3 },
        ],
      },
    },
    { name: 'spine-band', paint: 'accent', pos: [0, 1.66, -4.2], shape: { kind: 'box', w: 1.16, h: 0.12, d: 0.5, c: 0.04 } },
    { name: 'airbrake', paint: 'primary', pos: [0, 1.52, -6.4], rot: [-5, 0, 0], shape: { kind: 'box', w: 1.6, h: 0.1, d: 1.5, c: 0.04 } },
    { name: 'irst', paint: 'glass', pos: [0, -0.6, 8.6], shape: { kind: 'dome', radius: 0.26, segments: 8 } },
    // Conformal ordnance pods under the lifting body.
    {
      name: 'pod-pylon',
      paint: 'dark',
      mirror: true,
      pos: [1.15, -0.85, -1.2],
      shape: { kind: 'box', w: 0.3, h: 0.4, d: 4.4, c: 0.08 },
    },
    {
      name: 'pod',
      paint: 'metal',
      mirror: true,
      shape: {
        kind: 'loft',
        stations: [
          { z: -5.4, w: 0.7, h: 0.7, x: 1.15, y: -1.35, c: 0.25 },
          { z: -4.8, w: 1.0, h: 1.0, x: 1.15, y: -1.35, c: 0.34 },
          { z: 2.6, w: 1.0, h: 1.0, x: 1.15, y: -1.35, c: 0.34 },
          { z: 3.8, w: 0.55, h: 0.55, x: 1.15, y: -1.35, c: 0.2 },
          { z: 4.5, w: 0.08, h: 0.08, x: 1.15, y: -1.35 },
        ],
      },
    },
    {
      name: 'pod-band',
      paint: 'accent',
      mirror: true,
      pos: [1.15, -1.35, 2.2],
      shape: { kind: 'box', w: 1.06, h: 1.06, d: 0.35, c: 0.36 },
    },
    {
      name: 'pod-fin',
      paint: 'secondary',
      mirror: true,
      pos: [1.5, -1.35, -4.2],
      rot: [0, 0, -45],
      shape: { kind: 'wing', root: 1.2, tip: 0.5, span: 0.6, sweep: 0.6, thickness: 0.08 },
    },
    { name: 'vent', paint: 'dark', mirror: true, pos: [2.25, 0.46, -3.6], shape: { kind: 'box', w: 0.8, h: 0.08, d: 1.6, c: 0.03 } },
  ],
  engines: [{ pos: [2.25, -0.4, -10.85], radius: 0.64, plume: 7.5, mirror: true }],
  articulations: [
    // 20° → 70° leading-edge sweep.
    { id: 'wing', pivot: [3.35, 0.28, -0.3], axis: [0, 1, 0], range: [0, 50], channel: 'sweep' },
  ],
  hardpoints: [
    { id: 'gun', pos: [0.75, -0.3, 8.2], kind: 'gun', mirror: true },
    { id: 'pod', pos: [1.15, -1.35, 4.5], kind: 'missile', mirror: true },
    { id: 'wing-rail', pos: wingPoint(HARRIER_WING, 4.4, 0.1, -0.7), kind: 'missile', mirror: true, articulation: 'wing' },
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// SB-9 WARHORSE — heavy strike bomber, ~35 m, torpedo bay
// ═════════════════════════════════════════════════════════════════════════

const WH_FUSE: Station[] = [
  { z: -13.6, w: 3.6, wb: 3.8, h: 3.2, y: 0.5, c: 0.8 },
  { z: -6.0, w: 4.4, wb: 5.0, h: 4.4, y: 0.3, c: 1.0 },
  { z: 4.0, w: 4.4, wb: 4.8, h: 4.4, y: 0.2, c: 1.0 },
  { z: 10.0, w: 3.8, wb: 3.8, h: 3.8, y: 0.0, c: 0.9 },
  { z: 14.2, w: 2.8, wb: 2.6, h: 2.8, y: -0.3, c: 0.7 },
  { z: 16.6, w: 1.6, wb: 1.3, h: 1.6, y: -0.55, c: 0.4 },
];

const WH_WING_IN: WingSpec = {
  pos: [2.1, 1.0, 5.6],
  rot: [0, 0, -1],
  root: 11.0,
  tip: 7.0,
  span: 4.8,
  sweep: 4.0,
  thickness: 1.1,
  tipThickness: 0.9,
};
const WH_WING_OUT: WingSpec = {
  pos: wingPoint(WH_WING_IN, 4.8),
  rot: [0, 0, -4],
  root: 7.0,
  tip: 3.0,
  span: 10.5,
  sweep: 3.8,
  thickness: 0.9,
  tipThickness: 0.35,
};
const WH_STAB: WingSpec = {
  pos: [1.4, 1.3, -10.0],
  rot: [0, 0, 0],
  root: 4.6,
  tip: 2.8,
  span: 5.4,
  sweep: 1.8,
  thickness: 0.42,
  tipThickness: 0.3,
};

/** One engine nacelle hung under a wing: `top` is the wing's lower surface. */
function nacelle(name: string, wing: WingSpec, s: number, front: number, length: number): Part[] {
  const [x, top, zLE] = wingPoint(wing, s, 0, -(wing.thickness * 0.45));
  const y = top - 0.72;
  const z0 = zLE + front;
  const st: Station[] = [
    { z: z0, w: 1.7, h: 1.7, x, y, c: 0.5 },
    { z: z0 - 2.0, w: 1.95, h: 1.95, x, y, c: 0.62 },
    { z: z0 - length + 2.0, w: 1.85, h: 1.85, x, y, c: 0.58 },
    { z: z0 - length, w: 1.45, h: 1.45, x, y, c: 0.45 },
  ];
  return [
    { name, paint: 'primary', mirror: true, shape: { kind: 'loft', stations: st } },
    { name: `${name}-band`, paint: 'secondary', mirror: true, shape: band(st, z0 - length + 2.4, z0 - length + 3.3, 0.03) },
    { name: `${name}-lip`, paint: 'accent', mirror: true, shape: band(st, z0 - 0.35, z0, 0.03) },
    { name: `${name}-intake`, paint: 'dark', mirror: true, pos: [x, y, z0 + 0.02], shape: { kind: 'box', w: 1.2, h: 1.2, d: 0.1, c: 0.36 } },
    { name: `${name}-cone`, paint: 'metal', mirror: true, pos: [x, y, z0 + 0.1], shape: { kind: 'dome', radius: 0.36, segments: 8, scale: [1, 1, 1.4] } },
    {
      name: `${name}-nozzle`,
      paint: 'dark',
      mirror: true,
      pos: [x, y, z0 - length - 0.4],
      shape: { kind: 'cylinder', rFront: 0.6, rBack: 0.68, length: 0.9, segments: 12, open: true },
    },
    { name: `${name}-pylon`, paint: 'secondary', mirror: true, pos: [x, top - 0.05, z0 - length * 0.45], rot: [0, 0, 0], shape: { kind: 'box', w: 0.3, h: 0.5, d: length * 0.6, c: 0.08 } },
  ];
}
const WH_NACELLE_IN = wingPoint(WH_WING_IN, 2.6, 0, -(WH_WING_IN.thickness * 0.45));
const WH_NACELLE_OUT = wingPoint(WH_WING_OUT, 2.6, 0, -(WH_WING_OUT.thickness * 0.45));

export const WARHORSE: Blueprint = {
  id: 'sb9-warhorse',
  name: 'Warhorse',
  designation: 'SB-9',
  faction: 'concord',
  shipClass: 'bomber',
  ramp: 'classic',
  notes:
    'A flying torpedo bay with a crew of four. The anti-ship torpedo it carries is longer than a Kestrel.',
  parts: [
    { name: 'fuselage', paint: 'primary', group: 1, shape: { kind: 'loft', stations: WH_FUSE } },
    {
      name: 'nose',
      paint: 'dark',
      shape: {
        kind: 'loft',
        stations: [
          { z: 16.6, w: 1.6, wb: 1.3, h: 1.6, y: -0.55, c: 0.4 },
          { z: 18.2, w: 0.5, h: 0.5, y: -0.8, c: 0.15 },
        ],
      },
    },
    { name: 'nose-band', paint: 'accent', shape: band(WH_FUSE, 14.4, 15.2, 0.03) },
    { name: 'waist-band', paint: 'secondary', shape: band(WH_FUSE, -1.6, 0.0, 0.03) },
    { name: 'tail-band', paint: 'accent', shape: band(WH_FUSE, -12.6, -12.1, 0.03) },
    // Stepped greenhouse cockpit.
    {
      name: 'canopy',
      paint: 'glass',
      shape: {
        kind: 'loft',
        stations: [
          { z: 9.4, w: 2.3, h: 0.8, y: 1.95, c: 0.3 },
          { z: 12.4, w: 2.1, h: 0.95, y: 1.58, c: 0.34 },
          { z: 14.3, w: 1.5, h: 0.3, y: 1.1, c: 0.1 },
        ],
      },
    },
    {
      name: 'canopy-frame',
      paint: 'secondary',
      pos: [0, 1.48, 10.8],
      repeat: { count: 3, step: [0, 0, 1.05] },
      scale: [1.45, 0.95, 1],
      shape: { kind: 'rib', radius: 0.78, thickness: 0.1, depth: 0.2, arc: 180, segments: 8 },
    },
    {
      name: 'windows',
      paint: 'glass',
      emissive: 0.4,
      mirror: true,
      pos: [1.4, 1.2, 8.6],
      rot: [0, 0, 45],
      repeat: { count: 4, step: [0, 0, -1.0] },
      shape: { kind: 'box', w: 0.1, h: 0.42, d: 0.62, c: 0.05 },
    },
    {
      name: 'spine',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -12.5, w: 1.3, h: 0.5, y: 2.2, c: 0.2 },
          { z: -4.0, w: 1.8, h: 0.8, y: 2.6, c: 0.3 },
          { z: 8.0, w: 1.5, h: 0.6, y: 2.3, c: 0.25 },
        ],
      },
    },
    {
      name: 'spine-greebles',
      paint: 'metal',
      trim: 'dark',
      pos: [0, 2.95, -7.0],
      shape: { kind: 'greeble', w: 1.4, d: 8, count: 18, seed: 9, size: [0.18, 0.5], height: [0.05, 0.16] },
    },
    {
      name: 'side-greebles',
      paint: 'metal',
      trim: 'dark',
      mirror: true,
      pos: [2.28, -0.3, -4.0],
      rot: [0, 0, -90],
      shape: { kind: 'greeble', w: 1.8, d: 7, count: 14, seed: 17, size: [0.2, 0.55], height: [0.05, 0.14] },
    },
    // Tail cone + tail gun.
    {
      name: 'tail-cone',
      paint: 'primary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -16.2, w: 1.4, h: 1.3, y: 0.8, c: 0.38 },
          { z: -13.6, w: 3.4, wb: 3.6, h: 3.0, y: 0.5, c: 0.75 },
        ],
      },
    },
    {
      name: 'tail-gun',
      paint: 'secondary',
      trim: 'metal',
      pos: [0, 1.25, -15.3],
      rot: [0, 180, 0],
      socket: { id: 'tail-gun', kind: 'turret' },
      shape: { kind: 'turret', radius: 0.55, height: 0.6, barrels: 2, barrelLength: 1.4, barrelRadius: 0.07 },
    },
    // Dorsal turret.
    {
      name: 'dorsal-turret',
      paint: 'secondary',
      trim: 'metal',
      pos: [0, 2.72, 3.4],
      rot: [0, 12, 0],
      socket: { id: 'dorsal-turret', kind: 'turret' },
      shape: { kind: 'turret', radius: 0.85, height: 0.85, barrels: 2, barrelLength: 2.4, barrelRadius: 0.1 },
    },
    // High-mounted cranked wing.
    { name: 'wing-inner', paint: 'primary', mirror: true, ...wingSlice(WH_WING_IN, 0, 4.8) },
    { name: 'wing-outer', paint: 'primary', mirror: true, ...wingSlice(WH_WING_OUT, 0, 10.5) },
    { name: 'wing-stripe', paint: 'secondary', mirror: true, ...wingSlice(WH_WING_OUT, 6.2, 7.6, 0.06) },
    { name: 'wing-tip', paint: 'accent', mirror: true, ...wingSlice(WH_WING_OUT, 9.9, 10.5, 0.06) },
    { name: 'flap', paint: 'secondary', mirror: true, ...wingSlice(WH_WING_OUT, 0.5, 8.6, 0.04, 0.72, 1) },
    { name: 'flap-inner', paint: 'secondary', mirror: true, ...wingSlice(WH_WING_IN, 0.4, 4.6, 0.04, 0.78, 1) },
    { name: 'wing-fence', paint: 'dark', mirror: true, ...wingSlice(WH_WING_OUT, 0, 0.18, 0.14) },
    {
      name: 'nav-light',
      paint: 'glow',
      mirror: true,
      emissive: 1.5,
      pos: wingPoint(WH_WING_OUT, 10.55, 0.4),
      shape: { kind: 'box', w: 0.16, h: 0.16, d: 0.5 },
    },
    ...nacelle('nacelle-in', WH_WING_IN, 2.6, 1.2, 11.0),
    ...nacelle('nacelle-out', WH_WING_OUT, 2.6, 0.9, 10.0),
    {
      name: 'wing-pylon',
      paint: 'dark',
      mirror: true,
      pos: wingPoint(WH_WING_OUT, 6.8, 0.3, -0.5),
      shape: { kind: 'box', w: 0.22, h: 0.6, d: 2.0, c: 0.06 },
    },
    {
      name: 'wing-missile',
      paint: 'metal',
      mirror: true,
      pos: wingPoint(WH_WING_OUT, 6.8, 0.3, -1.0),
      shape: {
        kind: 'lathe',
        segments: 8,
        profile: [
          [0, -1.8],
          [0.24, -1.7],
          [0.24, 1.1],
          [0.15, 1.55],
          [0, 1.8],
        ],
      },
    },
    // Horizontal tail with end-plate twin fins.
    { name: 'stabiliser', paint: 'primary', mirror: true, ...wingSlice(WH_STAB, 0, 5.4) },
    { name: 'stab-stripe', paint: 'secondary', mirror: true, ...wingSlice(WH_STAB, 3.6, 4.3, 0.05) },
    {
      name: 'fin',
      paint: 'secondary',
      mirror: true,
      pos: wingPoint(WH_STAB, 5.35, -0.15),
      rot: [0, 0, 88],
      shape: { kind: 'wing', root: 3.6, tip: 1.8, span: 3.4, sweep: 1.9, thickness: 0.36, tipThickness: 0.24 },
    },
    {
      name: 'fin-lower',
      paint: 'secondary',
      mirror: true,
      pos: wingPoint(WH_STAB, 5.35, -0.05),
      rot: [0, 0, -92],
      shape: { kind: 'wing', root: 3.3, tip: 1.8, span: 1.3, sweep: 0.8, thickness: 0.34, tipThickness: 0.26 },
    },
    {
      name: 'fin-cap',
      paint: 'accent',
      mirror: true,
      pos: [wingPoint(WH_STAB, 5.35)[0] - 0.12, wingPoint(WH_STAB, 5.35)[1] + 3.0, wingPoint(WH_STAB, 5.35)[2] - 1.65],
      rot: [0, 0, 88],
      shape: { kind: 'wing', root: 2.05, tip: 1.8, span: 0.4, sweep: 0.25, thickness: 0.3, tipThickness: 0.26 },
    },
    // ── Torpedo bay: keel rails, dark bay roof, torpedo, hinged doors ──
    {
      name: 'bay-rail',
      paint: 'primary',
      mirror: true,
      pos: [1.36, -2.3, 0.4],
      shape: { kind: 'box', w: 0.3, h: 1.0, d: 13.2, c: 0.1 },
    },
    { name: 'bay-roof', paint: 'dark', pos: [0, -1.9, 0.4], shape: { kind: 'box', w: 2.5, h: 0.12, d: 13.0 } },
    {
      name: 'bay-end',
      paint: 'dark',
      pos: [0, -2.3, 6.95],
      repeat: { count: 2, step: [0, 0, -13.1] },
      shape: { kind: 'box', w: 2.5, h: 0.9, d: 0.1 },
    },
    {
      name: 'torpedo',
      paint: 'metal',
      pos: [0, -2.35, 0.6],
      shape: {
        kind: 'lathe',
        segments: 10,
        profile: [
          [0, -5.6],
          [0.3, -5.5],
          [0.44, -4.8],
          [0.44, 3.6],
          [0.34, 4.8],
          [0, 5.4],
        ],
      },
    },
    {
      name: 'torpedo-warhead',
      paint: 'accent',
      pos: [0, -2.35, 0.6],
      shape: {
        kind: 'lathe',
        segments: 10,
        profile: [
          [0, 2.6],
          [0.46, 2.6],
          [0.46, 3.62],
          [0.36, 4.8],
          [0.02, 5.42],
          [0, 5.42],
        ],
      },
    },
    {
      name: 'torpedo-fins',
      paint: 'secondary',
      pos: [0, -2.35, -4.3],
      repeat: { count: 2, rot: [0, 0, 90] },
      shape: { kind: 'box', w: 1.5, h: 0.06, d: 0.9, c: 0.02 },
    },
    {
      name: 'bay-door',
      paint: 'primary',
      mirror: true,
      articulation: 'bayDoor',
      pos: [0.61, -2.86, 0.4],
      shape: { kind: 'box', w: 1.2, h: 0.1, d: 13.0, c: 0.03 },
    },
    {
      name: 'bay-door-stripe',
      paint: 'accent',
      mirror: true,
      articulation: 'bayDoor',
      pos: [0.61, -2.92, 5.4],
      shape: { kind: 'box', w: 1.1, h: 0.04, d: 0.8 },
    },
    // Chin sensor turret.
    {
      name: 'chin-turret',
      paint: 'dark',
      trim: 'metal',
      pos: [0, -1.5, 14.2],
      rot: [0, 0, 180],
      socket: { id: 'chin-gun', kind: 'gun' },
      shape: { kind: 'turret', radius: 0.45, height: 0.45, barrels: 1, barrelLength: 1.2, barrelRadius: 0.08 },
    },
  ],
  engines: [
    { pos: [WH_NACELLE_IN[0], WH_NACELLE_IN[1] - 0.72, WH_NACELLE_IN[2] + 1.2 - 11.0 - 0.85], radius: 0.56, plume: 8, mirror: true },
    { pos: [WH_NACELLE_OUT[0], WH_NACELLE_OUT[1] - 0.72, WH_NACELLE_OUT[2] + 0.9 - 10.0 - 0.85], radius: 0.56, plume: 8, mirror: true },
  ],
  articulations: [{ id: 'bayDoor', pivot: [1.21, -2.82, 0.4], axis: [0, 0, 1], range: [0, 100], channel: 'bay' }],
  hardpoints: [
    { id: 'torpedo', pos: [0, -2.35, 6.0], kind: 'missile' },
    { id: 'wing-pylon', pos: wingPoint(WH_WING_OUT, 6.8, 0.1, -1.0), kind: 'missile', mirror: true },
  ],
};
