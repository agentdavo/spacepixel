import type { Blueprint, Part, Station, Vec3 } from '../Blueprint';
import { sideX, topAt, wingPoint, wingSlice, type WingSpec } from './kit';
import { KESTREL } from './concord';
import { bd, bell, bx, cyl, hazard, hp, lf, missile, post, turret, turrets, windows } from './yard';

/**
 * The Vanguard progression line — Directorate-built ships the player can
 * buy, from a refitted Kestrel to a light frigate of their own. Each tier
 * is visibly bigger and meaner than the last; every design keeps the
 * Anchorage yard language (ivory plating, cobalt panels, signal-orange
 * bands, chamfered lofts) so the line reads as one family.
 */

// ═════════════════════════════════════════════════════════════════════════
// T2 · VF-27S SUPER KESTREL — Kestrel refit with a booster pack, ~19 m
// ═════════════════════════════════════════════════════════════════════════

const SK_BOOST: Station[] = [
  { z: -8.5, w: 0.86, h: 0.86, x: 0.58, y: 1.3, c: 0.3 },
  { z: -2.6, w: 0.98, h: 0.98, x: 0.58, y: 1.3, c: 0.34 },
  { z: -1.1, w: 0.5, h: 0.5, x: 0.58, y: 1.18, c: 0.18 },
];

export const SUPER_KESTREL: Blueprint = {
  ...KESTREL,
  id: 'vf27s-super-kestrel',
  name: 'Super Kestrel',
  designation: 'VF-27S',
  notes:
    'A Kestrel with the Anchorage "super pack": twin dorsal boosters, shoulder missile pods and a ventral gun pod. ' +
    'Faster in a straight line, heavier in a turn, and the first thing a new Vanguard pilot buys with their own shares.',
  parts: [
    ...KESTREL.parts,
    // Dorsal booster pair (conformal to the spine, between the tails).
    lf('booster', 'secondary', SK_BOOST, { mirror: true, group: 40 }),
    bd('booster-band', 'accent', SK_BOOST, -3.4, -3.0, 0.03, { mirror: true }),
    bd('booster-ring', 'primary', SK_BOOST, -8.1, -7.5, 0.03, { mirror: true }),
    cyl('booster-nozzle', 'dark', [0.58, 1.3, -8.85], 0.36, 0.44, 0.7, { mirror: true, open: true, segments: 10 }),
    bx('booster-strut', 'dark', [0.58, 0.95, -5.0], [0.22, 0.3, 3.0], 0.05, { mirror: true }),
    // Shoulder micro-missile pods on the gloves.
    bx('shoulder-pod', 'primary', [2.0, 0.42, 1.3], [0.84, 0.46, 2.8], 0.14, { mirror: true }),
    bx('shoulder-pod-band', 'secondary', [2.0, 0.42, 0.3], [0.88, 0.5, 0.35], 0.14, { mirror: true }),
    {
      name: 'shoulder-tubes',
      paint: 'dark',
      mirror: true,
      pos: [1.74, 0.42, 2.71],
      repeat: { count: 3, step: [0.26, 0, 0] },
      shape: { kind: 'cylinder', rFront: 0.09, rBack: 0.09, length: 0.06, segments: 6 },
    },
    // Ventral GU-17 gun pod.
    bx('gunpod', 'metal', [0, -1.0, 0.4], [0.5, 0.52, 4.4], 0.14),
    bx('gunpod-band', 'accent', [0, -1.0, -1.2], [0.54, 0.56, 0.3], 0.14),
    bx('gunpod-pylon', 'dark', [0, -0.72, 0.4], [0.18, 0.2, 2.4], 0.04),
    cyl('gunpod-barrel', 'dark', [0, -1.02, 3.35], 0.08, 0.1, 1.6, { segments: 8 }),
    cyl('gunpod-muzzle', 'metal', [0, -1.02, 4.15], 0.14, 0.14, 0.26, { segments: 8 }),
    bx('gunpod-drum', 'dark', [0, -1.28, -1.0], [0.4, 0.14, 1.2], 0.05),
  ],
  engines: [...KESTREL.engines, { pos: [0.58, 1.3, -9.2], radius: 0.34, plume: 5.5, mirror: true }],
  hardpoints: [
    ...(KESTREL.hardpoints ?? []),
    hp('gunpod', 'gun', [0, -1.02, 4.3]),
    hp('shoulder', 'missile', [2.0, 0.42, 2.75], { mirror: true }),
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// T3 · VF-40 GAUNTLET — twin-engine heavy fighter, ~27 m, dorsal turret
// ═════════════════════════════════════════════════════════════════════════

const GT_FUSE: Station[] = [
  { z: -9.2, w: 2.2, wb: 2.0, h: 1.5, y: 0.35, c: 0.4 },
  { z: -3.0, w: 3.0, wb: 2.6, h: 2.1, y: 0.4, c: 0.55 },
  { z: 4.0, w: 2.8, wb: 2.2, h: 2.1, y: 0.35, c: 0.55 },
  { z: 8.6, w: 1.8, wb: 1.3, h: 1.5, y: 0.1, c: 0.45 },
  { z: 12.0, w: 0.9, wb: 0.6, h: 0.8, y: -0.2, c: 0.25 },
];
const GT_NAC: Station[] = [
  { z: 3.6, w: 1.7, h: 1.9, x: 2.25, y: -0.25, c: 0.45 },
  { z: 1.0, w: 2.0, h: 2.1, x: 2.25, y: -0.25, c: 0.6 },
  { z: -10.5, w: 2.0, h: 2.0, x: 2.25, y: -0.25, c: 0.6 },
  { z: -12.2, w: 1.6, h: 1.6, x: 2.25, y: -0.25, c: 0.5 },
];
const GT_WING: WingSpec = {
  pos: [3.1, 0.05, 1.2],
  rot: [0, 0, -2],
  root: 8.6,
  tip: 2.0,
  span: 7.4,
  sweep: 6.4,
  thickness: 0.46,
  tipThickness: 0.18,
};
const GT_TAIL: WingSpec = {
  pos: [2.35, 0.8, -6.6],
  rot: [0, 0, 68],
  root: 4.4,
  tip: 1.5,
  span: 3.9,
  sweep: 3.3,
  thickness: 0.24,
  tipThickness: 0.14,
};
const GT_TURRET = turret('dorsal', [0, topAt(GT_FUSE, -1.6) + 0.25, -1.6], {
  radius: 0.55,
  height: 0.55,
  barrels: 2,
  barrelLength: 1.7,
  barrelRadius: 0.07,
  housing: [0.85, 0.34, 1.0],
  paint: 'secondary',
  joint: 'dorsal',
});

export const GAUNTLET: Blueprint = {
  id: 'vf40-gauntlet',
  name: 'Gauntlet',
  designation: 'VF-40',
  faction: 'concord',
  shipClass: 'strike-fighter',
  ramp: 'classic',
  notes:
    'Heavy escort fighter: two Harrier cores in armoured nacelles, six pylons and a remote dorsal turret that the ' +
    'flight computer fights with while the pilot flies. Ugly in a turn; nothing in its weight class hits harder.',
  parts: [
    lf('fuselage', 'primary', GT_FUSE, { group: 1 }),
    lf('radome', 'secondary', [
      { z: 12.0, w: 0.9, wb: 0.6, h: 0.8, y: -0.2, c: 0.25 },
      { z: 14.3, w: 0.14, h: 0.16, y: -0.36 },
    ]),
    bd('nose-band', 'accent', GT_FUSE, 10.4, 10.9, 0.02),
    // Chines running the forebody into the gloves.
    { name: 'chine', paint: 'primary', mirror: true, pos: [1.05, 0.05, 11.2], rot: [0, 0, -4], shape: { kind: 'wing', root: 8.0, tip: 0.6, span: 1.35, sweep: 6.9, thickness: 0.22, tipThickness: 0.14 } },
    // Nacelles.
    lf('nacelle', 'primary', GT_NAC, { mirror: true }),
    bd('nacelle-band', 'secondary', GT_NAC, -9.6, -8.4, 0.03, { mirror: true }),
    bd('nacelle-lip', 'accent', GT_NAC, 3.2, 3.6, 0.03, { mirror: true }),
    bx('intake', 'dark', [2.25, -0.25, 3.63], [1.25, 1.45, 0.1], 0.3, { mirror: true }),
    cyl('nozzle', 'dark', [2.25, -0.25, -12.7], 0.72, 0.84, 1.0, { mirror: true, open: true }),
    cyl('nozzle-ring', 'metal', [2.25, -0.25, -12.2], 0.8, 0.8, 0.22, { mirror: true }),
    // Between the nacelles: a flat keel with the cannon tunnel.
    lf('keel', 'secondary', [
      { z: 2.5, w: 2.6, h: 0.7, y: -0.9, c: 0.2 },
      { z: -9.5, w: 2.8, h: 0.7, y: -0.8, c: 0.2 },
      { z: -11.2, w: 1.6, h: 0.4, y: -0.6, c: 0.15 },
    ]),
    // Wings + stripe + pylons.
    { name: 'wing', paint: 'primary', mirror: true, ...wingSlice(GT_WING, 0, 7.4) },
    { name: 'wing-stripe', paint: 'secondary', mirror: true, ...wingSlice(GT_WING, 4.6, 5.6, 0.05) },
    { name: 'wing-tip', paint: 'accent', mirror: true, ...wingSlice(GT_WING, 6.95, 7.4, 0.05) },
    { name: 'flap', paint: 'secondary', mirror: true, ...wingSlice(GT_WING, 0.6, 4.4, 0.04, 0.75, 1) },
    ...[1.6, 3.4, 5.2].flatMap((s, i): Part[] => [
      {
        name: `pylon-${i}`,
        paint: 'dark',
        mirror: true,
        pos: wingPoint(GT_WING, s, 0.42, -0.36),
        shape: { kind: 'box', w: 0.16, h: 0.36, d: 1.8 - i * 0.3, c: 0.04 },
      },
      {
        name: `missile-${i}`,
        paint: i === 0 ? 'metal' : 'accent',
        trim: 'metal',
        mirror: true,
        pos: wingPoint(GT_WING, s, 0.36, -0.72),
        socket: { id: `pylon-${i}`, kind: 'missile' },
        shape: missile(3.6 - i * 0.6, 0.2 - i * 0.02),
      },
    ]),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: wingPoint(GT_WING, 7.45, 0.4), shape: { kind: 'box', w: 0.12, h: 0.12, d: 0.4 } },
    // Canards on the chines.
    { name: 'canard', paint: 'secondary', mirror: true, pos: [1.25, 0.35, 8.2], rot: [0, 0, 5], shape: { kind: 'wing', root: 2.2, tip: 0.7, span: 1.9, sweep: 1.4, thickness: 0.14 } },
    // Twin canted tails.
    { name: 'tail', paint: 'secondary', mirror: true, ...wingSlice(GT_TAIL, 0, 3.9) },
    { name: 'tail-cap', paint: 'accent', mirror: true, ...wingSlice(GT_TAIL, 3.4, 3.9, 0.05) },
    { name: 'tail-band', paint: 'primary', mirror: true, ...wingSlice(GT_TAIL, 1.7, 2.3, 0.04) },
    { name: 'ventral-fin', paint: 'dark', mirror: true, pos: [2.6, -1.25, -8.0], rot: [0, 0, -112], shape: { kind: 'wing', root: 2.6, tip: 1.0, span: 1.2, sweep: 1.4, thickness: 0.14 } },
    // Side-by-side cockpit.
    { name: 'canopy', paint: 'glass', pos: [0, 1.42, 6.9], shape: { kind: 'dome', radius: 1, scale: [0.9, 0.62, 2.5], segments: 16 } },
    { name: 'canopy-frame', paint: 'secondary', pos: [0, 1.42, 6.5], scale: [1.4, 0.97, 1], shape: { kind: 'rib', radius: 0.64, thickness: 0.09, depth: 0.2, arc: 180, segments: 10 } },
    lf('spine', 'secondary', [
      { z: -9.0, w: 1.0, h: 0.4, y: 1.15, c: 0.15 },
      { z: -3.0, w: 1.5, h: 0.9, y: 1.45, c: 0.3 },
      { z: 4.4, w: 1.3, h: 0.8, y: 1.5, c: 0.3 },
    ]),
    // Remote dorsal turret on a low barbette.
    post('turret-ring', 'dark', [0, topAt(GT_FUSE, -1.6) - 0.05, -1.6], 0.62, 0.58, 0.32, 10),
    ...GT_TURRET.parts,
    bx('airbrake', 'primary', [0, 1.9, -6.2], [1.5, 0.1, 1.5], 0.04, { rot: [-5, 0, 0] }),
    bx('vent', 'dark', [2.25, 0.86, -4.0], [0.9, 0.08, 2.0], 0.03, { mirror: true }),
    {
      name: 'machinery',
      paint: 'metal',
      trim: 'dark',
      pos: [0, 1.62, -7.8],
      shape: { kind: 'greeble', w: 0.9, d: 1.6, count: 8, seed: 71, size: [0.12, 0.34], height: [0.05, 0.16] },
    },
    // Chin cannon.
    bx('cannon-fairing', 'secondary', [0, -1.0, 5.4], [0.8, 0.6, 5.0], 0.2),
    cyl('cannon', 'metal', [0, -1.0, 9.1], 0.11, 0.15, 2.6, { segments: 8 }),
    cyl('cannon-muzzle', 'dark', [0, -1.0, 10.45], 0.18, 0.18, 0.3, { segments: 8 }),
    bx('gun-port', 'dark', [0.72, -0.1, 10.2], [0.14, 0.14, 1.0], 0, { mirror: true, rot: [0, 0, -30] }),
    { name: 'irst', paint: 'glass', pos: [0, 0.8, 10.2], shape: { kind: 'dome', radius: 0.24, segments: 8 } },
  ],
  engines: [{ pos: [2.25, -0.25, -13.2], radius: 0.7, plume: 8.5, mirror: true }],
  articulations: [...(GT_TURRET.joint ? [GT_TURRET.joint] : [])],
  hardpoints: [
    hp('gun', 'gun', [0.72, -0.1, 10.8], { mirror: true }),
    hp('cannon', 'gun', [0, -1.0, 10.7]),
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// T4 · GS-12 BULWARK — assault gunship, ~54 m, crew 4 (modelled 1:2)
// ═════════════════════════════════════════════════════════════════════════

const BW_HULL: Station[] = [
  { z: -12.0, w: 4.0, wb: 4.4, h: 3.0, y: 0.2, c: 0.7 },
  { z: -6.0, w: 4.8, wb: 5.4, h: 3.9, y: 0.3, c: 0.9 },
  { z: 4.0, w: 4.4, wb: 5.0, h: 3.7, y: 0.2, c: 0.9 },
  { z: 9.0, w: 3.2, wb: 3.4, h: 2.8, y: -0.1, c: 0.7 },
  { z: 12.4, w: 1.6, wb: 1.4, h: 1.4, y: -0.45, c: 0.4 },
];
const BW_POD: Station[] = [
  { z: 2.8, w: 1.8, h: 2.0, x: 4.7, y: 0.1, c: 0.55 },
  { z: 0.8, w: 2.2, h: 2.4, x: 4.7, y: 0.1, c: 0.7 },
  { z: -11.0, w: 2.2, h: 2.4, x: 4.7, y: 0.1, c: 0.7 },
  { z: -12.6, w: 1.8, h: 2.0, x: 4.7, y: 0.1, c: 0.55 },
];
const BW_WING: WingSpec = {
  pos: [2.3, -0.5, 2.6],
  rot: [0, 0, -3],
  root: 7.2,
  tip: 3.6,
  span: 6.2,
  sweep: 3.4,
  thickness: 0.7,
  tipThickness: 0.45,
};
const bwTop = (z: number) => topAt(BW_HULL, z);
const BW_GUNS = turrets([
  turret('turret-dorsal', [0, bwTop(-2.4) + 0.55, -2.4], {
    radius: 1.15,
    height: 1.1,
    barrels: 2,
    barrelLength: 3.6,
    barrelRadius: 0.13,
    housing: [1.8, 0.7, 2.0],
    joint: 'turret-dorsal',
  }),
  turret('turret-chin', [0, -1.75, 7.2], {
    radius: 0.75,
    height: 0.8,
    barrels: 2,
    barrelLength: 2.2,
    barrelRadius: 0.08,
    ventral: true,
    paint: 'secondary',
    joint: 'turret-chin',
  }),
]);

export const BULWARK: Blueprint = {
  id: 'gs12-bulwark',
  name: 'Bulwark',
  designation: 'GS-12',
  faction: 'concord',
  shipClass: 'bomber',
  scale: 2,
  ramp: 'classic',
  notes:
    'Assault gunship and boarding tender. A pilot, a gunner, an engineer and a warden fly it; the dorsal twin ' +
    'is a cut-down frigate mount. The first ship in the line you cannot land on a carrier deck.',
  parts: [
    lf('hull', 'primary', BW_HULL, { group: 1 }),
    lf('nose', 'secondary', [
      { z: 12.4, w: 1.6, wb: 1.4, h: 1.4, y: -0.45, c: 0.4 },
      { z: 13.6, w: 0.6, wb: 0.5, h: 0.6, y: -0.6, c: 0.2 },
    ]),
    bd('nose-band', 'accent', BW_HULL, 10.4, 10.9, 0.03),
    bd('aft-band', 'secondary', BW_HULL, -10.8, -9.8, 0.03),
    // Armoured flight deck: stepped greenhouse over the nose.
    lf('cab', 'primary', [
      { z: 2.4, w: 2.8, h: 1.0, y: bwTop(3) + 0.4, c: 0.3 },
      { z: 7.8, w: 2.6, h: 1.0, y: bwTop(7.5) + 0.35, c: 0.3 },
    ]),
    lf('cab-glass', 'glass', [
      { z: 7.8, w: 2.5, h: 0.95, y: bwTop(7.5) + 0.35, c: 0.28 },
      { z: 9.2, w: 1.9, h: 0.3, y: bwTop(9.0) + 0.05, c: 0.1 },
    ]),
    bx('cab-frame', 'secondary', [0, bwTop(8.3) + 0.45, 8.5], [0.16, 0.9, 1.3], 0.04, { rot: [36, 0, 0] }),
    windows('cab-ports', [1.42, bwTop(4.0) + 0.45, 6.6], 4, [0, 0, -1.0], [0.06, 0.3, 0.55], { mirror: true }),
    // Armour belt + ID band.
    ...[6.0, 2.6, -0.8, -4.2, -7.6].map((z): Part => bx('belt', 'secondary', [sideX(BW_HULL, z, -0.2) + 0.05, -0.2, z], [0.16, 1.5, 3.0], 0.05, { mirror: true })),
    bx('side-stripe', 'accent', [sideX(BW_HULL, 3.4, 0.9) + 0.02, 0.9, 3.4], [0.08, 0.26, 7.5], 0, { mirror: true }),
    // Boarding hatch.
    bx('hatch', 'dark', [sideX(BW_HULL, -3.0, -0.3) + 0.14, -0.3, -3.0], [0.1, 1.9, 2.1], 0.2, { mirror: true }),
    hazard('hatch-hazard', [sideX(BW_HULL, -3.0, -0.3) + 0.21, -1.35, -3.9], 1, 0, [0.02, 0.24, 1.2], { mirror: true, rot: [0, 0, 0] }),
    // Stub wings, engine pods, missile racks.
    { name: 'wing', paint: 'primary', mirror: true, ...wingSlice(BW_WING, 0, 6.2) },
    { name: 'wing-stripe', paint: 'secondary', mirror: true, ...wingSlice(BW_WING, 3.9, 4.5, 0.06) },
    lf('pod', 'primary', BW_POD, { mirror: true }),
    bd('pod-band', 'secondary', BW_POD, -10.0, -8.6, 0.04, { mirror: true }),
    bd('pod-lip', 'accent', BW_POD, 2.3, 2.8, 0.04, { mirror: true }),
    bx('pod-intake', 'dark', [4.7, 0.1, 2.83], [1.3, 1.5, 0.1], 0.35, { mirror: true }),
    cyl('pod-nozzle', 'dark', [4.7, 0.1, -13.1], 0.82, 0.96, 1.1, { mirror: true, open: true }),
    cyl('pod-ring', 'metal', [4.7, 0.1, -12.55], 0.92, 0.92, 0.25, { mirror: true }),
    bx('rack', 'secondary', [8.0, -0.72, -0.2], [1.2, 1.3, 3.8], 0.2, { mirror: true }),
    {
      name: 'rack-tubes',
      paint: 'dark',
      mirror: true,
      pos: [7.73, -0.43, 1.66],
      repeat: { count: 3, step: [0.27, 0, 0] },
      shape: { kind: 'cylinder', rFront: 0.11, rBack: 0.11, length: 0.08, segments: 6 },
    },
    {
      name: 'rack-tubes-low',
      paint: 'dark',
      mirror: true,
      pos: [7.73, -1.0, 1.66],
      repeat: { count: 3, step: [0.27, 0, 0] },
      shape: { kind: 'cylinder', rFront: 0.11, rBack: 0.11, length: 0.08, segments: 6 },
    },
    bx('rack-band', 'accent', [8.0, -0.72, 1.2], [1.24, 1.34, 0.3], 0.2, { mirror: true }),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [8.65, -0.4, -1.5], shape: { kind: 'box', w: 0.12, h: 0.14, d: 0.5 } },
    // Dorsal fin + canted ventral fins.
    { name: 'fin', paint: 'secondary', pos: [0, bwTop(-8.5) - 0.1, -7.6], rot: [0, 0, 90], shape: { kind: 'wing', root: 5.0, tip: 2.0, span: 3.4, sweep: 3.6, thickness: 0.34, tipThickness: 0.22 } },
    { name: 'fin-cap', paint: 'accent', pos: [0, bwTop(-8.5) + 3.0, -11.1], rot: [0, 0, 90], shape: { kind: 'wing', root: 2.1, tip: 2.0, span: 0.3, sweep: 0.1, thickness: 0.36 } },
    { name: 'ventral-fin', paint: 'dark', mirror: true, pos: [1.4, -1.6, -8.4], rot: [0, 0, -120], shape: { kind: 'wing', root: 3.2, tip: 1.4, span: 1.6, sweep: 1.6, thickness: 0.2 } },
    // Turrets.
    post('barbette', 'secondary', [0, bwTop(-2.4) - 0.1, -2.4], 1.2, 1.15, 0.7, 12),
    ...BW_GUNS.parts,
    // Nose cannons.
    cyl('nose-gun', 'metal', [1.0, -1.0, 11.8], 0.12, 0.16, 3.0, { mirror: true, segments: 8 }),
    bx('nose-gun-fairing', 'dark', [1.0, -1.0, 9.6], [0.55, 0.55, 2.0], 0.12, { mirror: true }),
    // Deck machinery + drive block.
    {
      name: 'deck',
      paint: 'metal',
      trim: 'dark',
      pos: [0, bwTop(-6.8) - 0.02, -6.8],
      shape: { kind: 'greeble', w: 2.8, d: 3.2, count: 16, seed: 91, size: [0.2, 0.55], height: [0.06, 0.24] },
    },
    lf('drive-block', 'metal', [
      { z: -13.4, w: 3.6, h: 2.6, y: 0.2, c: 0.6 },
      { z: -11.8, w: 4.0, h: 2.9, y: 0.2, c: 0.7 },
    ]),
    bell('bell', [0, 0.2, -13.9], 0.95, 1.1),
    { name: 'lamp', paint: 'glow', emissive: 1.4, pos: [0, bwTop(1.2) + 0.08, 1.2], shape: { kind: 'box', w: 0.5, h: 0.14, d: 0.3 } },
  ],
  engines: [
    { pos: [4.7, 0.1, -13.7], radius: 0.82, plume: 9, mirror: true },
    { pos: [0, 0.2, -14.45], radius: 0.8, plume: 7 },
  ],
  articulations: BW_GUNS.joints,
  hardpoints: [
    hp('nose-gun', 'gun', [1.0, -1.0, 13.3], { mirror: true }),
    hp('rack', 'missile', [8.0, -0.72, 1.7], { mirror: true }),
    hp('bridge', 'gun', [0, bwTop(7.5) + 0.6, 8.6]),
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// T5 · CR-5 RESOLUTE — fast attack corvette, ~175 m, crew 20 (modelled 1:10)
// ═════════════════════════════════════════════════════════════════════════

const RS_HULL: Station[] = [
  { z: -7.4, w: 2.1, wb: 2.3, h: 1.5, y: 0.0, c: 0.4 },
  { z: -3.0, w: 2.7, wb: 2.9, h: 1.85, y: 0.05, c: 0.5 },
  { z: 3.0, w: 2.1, wb: 2.1, h: 1.6, y: 0.0, c: 0.45 },
  { z: 6.8, w: 1.15, wb: 0.95, h: 1.05, y: -0.15, c: 0.3 },
  { z: 8.4, w: 0.55, wb: 0.4, h: 0.62, y: -0.22, c: 0.15 },
];
const RS_WING: WingSpec = {
  pos: [1.2, -0.12, 1.4],
  rot: [0, 0, -5],
  root: 5.6,
  tip: 1.7,
  span: 2.3,
  sweep: 4.0,
  thickness: 0.3,
  tipThickness: 0.24,
};
const RS_NAC: Station[] = [
  { z: -1.4, w: 0.8, h: 0.9, x: 3.3, y: -0.3, c: 0.3 },
  { z: -2.4, w: 1.05, h: 1.15, x: 3.3, y: -0.3, c: 0.4 },
  { z: -7.3, w: 1.05, h: 1.15, x: 3.3, y: -0.3, c: 0.4 },
  { z: -7.9, w: 0.85, h: 0.95, x: 3.3, y: -0.3, c: 0.32 },
];
const rsTop = (z: number) => topAt(RS_HULL, z);
const RS_GUNS = turrets([
  turret('main-a', [0, rsTop(4.6) - 0.03, 4.6], { radius: 0.44, height: 0.46, barrels: 2, barrelLength: 1.35, barrelRadius: 0.06, housing: [0.8, 0.3, 0.95], joint: 'main-a' }),
  turret('main-b', [0, rsTop(-4.4) - 0.03, -4.4], { radius: 0.44, height: 0.46, barrels: 2, barrelLength: 1.35, barrelRadius: 0.06, housing: [0.8, 0.3, 0.95], yaw: 180, joint: 'main-b' }),
  turret('main-v', [0, -0.78, -2.6], { radius: 0.4, height: 0.42, barrels: 2, barrelLength: 1.1, barrelRadius: 0.05, ventral: true, paint: 'secondary', joint: 'main-v' }),
]);

export const RESOLUTE: Blueprint = {
  id: 'cr5-resolute',
  name: 'Resolute',
  designation: 'CR-5',
  faction: 'concord',
  shipClass: 'corvette',
  scale: 10,
  ramp: 'classic',
  notes:
    'Fast attack corvette. Twenty crew, three twin mounts and a spinal mass-driver slung under the keel — aimed by ' +
    'pointing the whole ship, which is why the Directorate lets fighter pilots command them.',
  parts: [
    lf('hull', 'primary', RS_HULL, { group: 1 }),
    bd('bow-band', 'accent', RS_HULL, 5.6, 5.95, 0.02),
    bd('aft-band', 'secondary', RS_HULL, -6.6, -6.0, 0.02),
    // Arrowhead lifting wings with outboard drive nacelles.
    { name: 'wing', paint: 'primary', mirror: true, ...wingSlice(RS_WING, 0, 2.3) },
    { name: 'wing-panel', paint: 'secondary', mirror: true, ...wingSlice(RS_WING, 0.5, 1.9, 0.04, 0.35, 0.9) },
    lf('nacelle', 'primary', RS_NAC, { mirror: true }),
    bd('nacelle-band', 'accent', RS_NAC, -2.9, -2.6, 0.02, { mirror: true }),
    bx('nacelle-intake', 'dark', [3.3, -0.3, -1.38], [0.55, 0.6, 0.06], 0.15, { mirror: true }),
    bell('nacelle-bell', [3.3, -0.3, -8.2], 0.42, 0.55, true),
    { name: 'nacelle-fin', paint: 'secondary', mirror: true, pos: [3.3, 0.2, -5.2], rot: [0, 0, 90], shape: { kind: 'wing', root: 2.4, tip: 1.0, span: 0.9, sweep: 1.3, thickness: 0.1 } },
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [3.3, 0.35, -1.9], shape: { kind: 'box', w: 0.08, h: 0.08, d: 0.2 } },
    // Spinal mass-driver under the keel.
    lf('driver', 'metal', [
      { z: -5.2, w: 0.72, h: 0.62, y: -1.02, c: 0.2 },
      { z: 8.6, w: 0.52, h: 0.46, y: -1.02, c: 0.15 },
    ]),
    bx('driver-web', 'secondary', [0, -0.78, 1.4], [0.3, 0.4, 10.0], 0.08),
    {
      name: 'driver-coil',
      paint: 'accent',
      pos: [0, -1.02, 1.0],
      repeat: { count: 5, step: [0, 0, 1.45] },
      shape: { kind: 'box', w: 0.78, h: 0.7, d: 0.22, c: 0.2 },
    },
    cyl('driver-muzzle', 'dark', [0, -1.02, 8.75], 0.3, 0.3, 0.3, { segments: 8 }),
    // Superstructure: forward conning tower.
    bx('deckhouse', 'primary', [0, rsTop(1.4) + 0.3, 1.2], [1.3, 0.62, 2.6], 0.16),
    lf('bridge', 'primary', [
      { z: 0.4, w: 1.05, h: 0.5, y: rsTop(1.4) + 0.85, c: 0.12 },
      { z: 2.1, w: 1.05, h: 0.5, y: rsTop(1.4) + 0.85, c: 0.12 },
      { z: 2.5, w: 0.9, h: 0.3, y: rsTop(1.4) + 0.78, c: 0.08 },
    ]),
    bx('bridge-glass', 'glass', [0, rsTop(1.4) + 0.93, 1.5], [1.08, 0.1, 1.6], 0, { emissive: 0.5 }),
    bx('bridge-wings', 'secondary', [0, rsTop(1.4) + 0.98, 1.9], [2.0, 0.1, 0.36], 0.03),
    bx('deckhouse-stripe', 'accent', [0, rsTop(1.4) + 0.42, 2.51], [1.32, 0.12, 0.04]),
    windows('ports', [0.66, rsTop(1.4) + 0.32, 2.2], 5, [0, 0, -0.45], [0.03, 0.1, 0.2], { mirror: true }),
    post('mast', 'metal', [0, rsTop(1.4) + 1.1, 0.8], 0.07, 0.035, 1.2, 6),
    bx('yard', 'metal', [0, rsTop(1.4) + 1.9, 0.8], [0.9, 0.05, 0.06]),
    // Missile cells aft of the tower.
    bx('vls-frame', 'secondary', [0, rsTop(-1.6) + 0.01, -1.6], [1.4, 0.05, 1.3]),
    { name: 'vls', paint: 'dark', pos: [-0.45, rsTop(-1.6) + 0.04, -1.2], repeat: { count: 4, step: [0.3, 0, 0] }, shape: { kind: 'box', w: 0.22, h: 0.04, d: 0.22 } },
    { name: 'vls-2', paint: 'dark', pos: [-0.45, rsTop(-1.6) + 0.04, -1.6], repeat: { count: 4, step: [0.3, 0, 0] }, shape: { kind: 'box', w: 0.22, h: 0.04, d: 0.22 } },
    { name: 'vls-3', paint: 'dark', pos: [-0.45, rsTop(-1.6) + 0.04, -2.0], repeat: { count: 4, step: [0.3, 0, 0] }, shape: { kind: 'box', w: 0.22, h: 0.04, d: 0.22 } },
    // Main mounts + point defence.
    ...RS_GUNS.parts,
    {
      name: 'pd',
      paint: 'secondary',
      trim: 'metal',
      mirror: true,
      pos: [1.7, rsTop(0) - 0.35, 0.2],
      rot: [0, 30, 0],
      socket: { id: 'pd', kind: 'turret' },
      shape: { kind: 'turret', radius: 0.16, height: 0.18, barrels: 1, barrelLength: 0.45, barrelRadius: 0.03 },
    },
    {
      name: 'aft-deck',
      paint: 'metal',
      trim: 'dark',
      pos: [0, rsTop(-6.2) - 0.02, -6.2],
      shape: { kind: 'greeble', w: 1.5, d: 1.2, count: 12, seed: 55, size: [0.08, 0.28], height: [0.03, 0.12] },
    },
    { name: 'ventral-fin', paint: 'secondary', pos: [0, -1.1, -5.6], rot: [0, 0, -90], shape: { kind: 'wing', root: 2.4, tip: 1.0, span: 0.8, sweep: 1.2, thickness: 0.12 } },
    lf('drive-block', 'metal', [
      { z: -8.1, w: 1.9, h: 1.35, c: 0.35 },
      { z: -7.2, w: 2.05, h: 1.45, c: 0.4 },
    ]),
    bell('bell', [0, 0.05, -8.45], 0.52, 0.7),
  ],
  engines: [
    { pos: [3.3, -0.3, -8.5], radius: 0.36, plume: 4.5, mirror: true },
    { pos: [0, 0.05, -8.82], radius: 0.46, plume: 5 },
  ],
  articulations: RS_GUNS.joints,
  hardpoints: [
    hp('driver', 'gun', [0, -1.02, 8.9]),
    hp('vls', 'missile', [0, rsTop(-1.6) + 0.1, -1.6], { rot: [-90, 0, 0] }),
    hp('bridge', 'gun', [0, rsTop(1.4) + 0.95, 2.3]),
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// T6 · FFL-3 VALIANT — light frigate, ~370 m (modelled 1:20)
// ═════════════════════════════════════════════════════════════════════════

const VL_HULL: Station[] = [
  { z: -8.0, w: 1.8, wb: 1.6, h: 1.5, y: 0.1, c: 0.35 },
  { z: -4.0, w: 2.2, wb: 1.9, h: 1.8, y: 0.1, c: 0.45 },
  { z: 3.0, w: 2.0, wb: 1.5, h: 1.7, y: 0.0, c: 0.45 },
  { z: 7.0, w: 1.3, wb: 0.7, h: 1.3, y: -0.15, c: 0.35 },
  { z: 9.4, w: 0.35, wb: 0.15, h: 0.45, y: -0.35, c: 0.1 },
];
const VL_NAC: Station[] = [
  { z: 1.4, w: 0.3, h: 0.3, x: 2.45, y: -0.25, c: 0.1 },
  { z: 0.4, w: 0.95, h: 0.95, x: 2.45, y: -0.25, c: 0.32 },
  { z: -1.0, w: 1.15, h: 1.15, x: 2.45, y: -0.25, c: 0.38 },
  { z: -8.4, w: 1.15, h: 1.15, x: 2.45, y: -0.25, c: 0.38 },
  { z: -9.0, w: 0.95, h: 0.95, x: 2.45, y: -0.25, c: 0.32 },
];
const vlTop = (z: number) => topAt(VL_HULL, z);
const VL_TOWER_Z = 0.4;
const VL_TY = vlTop(VL_TOWER_Z);
const VL_MAIN = { radius: 0.54, height: 0.52, barrels: 3, barrelLength: 1.85, barrelRadius: 0.055, housing: [1.12, 0.34, 1.28] as Vec3 };
const VL_GUNS = turrets([
  turret('main-a', [0, vlTop(5.4) - 0.03, 5.4], { ...VL_MAIN, joint: 'main-a' }),
  turret('main-b', [0, vlTop(3.8) + 0.3, 3.8], { ...VL_MAIN, joint: 'main-b' }),
  turret('main-x', [0, vlTop(-5.4) - 0.03, -5.4], { ...VL_MAIN, barrels: 2, yaw: 180, joint: 'main-x' }),
  turret('sec', [1.05, 0.62, 1.6], { radius: 0.2, height: 0.22, barrels: 2, barrelLength: 0.6, barrelRadius: 0.03, paint: 'secondary', mirror: true, yaw: 25 }),
  turret('sec-aft', [1.05, 0.62, -3.0], { radius: 0.2, height: 0.22, barrels: 2, barrelLength: 0.6, barrelRadius: 0.03, paint: 'secondary', mirror: true, yaw: 150 }),
]);

export const VALIANT: Blueprint = {
  id: 'ffl3-valiant',
  name: 'Valiant',
  designation: 'FFL-3',
  faction: 'concord',
  shipClass: 'frigate',
  scale: 20,
  ramp: 'classic',
  notes:
    'Light frigate on outboard drive nacelles, sold out of reserve to squadrons that have earned their own capital. ' +
    'Two triple mounts forward, a twin aft, a ventral bay for four fighters — and a bridge you command from, not a cockpit.',
  parts: [
    lf('hull', 'primary', VL_HULL, { group: 1 }),
    lf('keel', 'secondary', [
      { z: -7.8, w: 1.2, wb: 0.8, h: 0.7, y: -0.85, c: 0.25 },
      { z: 5.0, w: 1.0, wb: 0.6, h: 0.7, y: -0.8, c: 0.22 },
      { z: 8.6, w: 0.25, wb: 0.15, h: 0.3, y: -0.55 },
    ]),
    bd('bow-band', 'accent', VL_HULL, 6.6, 6.9, 0.02),
    bd('stern-band', 'secondary', VL_HULL, -7.4, -6.9, 0.02),
    ...[4.2, 1.9, -0.4, -2.7, -5.0].map((z): Part => bx('belt', 'secondary', [sideX(VL_HULL, z, 0.05) + 0.03, 0.05, z], [0.08, 0.55, 2.0], 0.03, { mirror: true })),
    windows('ports', [sideX(VL_HULL, 2.6, 0.45) + 0.01, 0.45, 2.6], 7, [0, 0, -0.42], [0.03, 0.06, 0.16], { mirror: true }),
    // Bow torpedo tubes.
    {
      name: 'torpedo-tubes',
      paint: 'dark',
      mirror: true,
      pos: [0.28, -0.3, 8.25],
      rot: [0, 12, 0],
      repeat: { count: 2, step: [0, -0.2, 0] },
      shape: { kind: 'cylinder', rFront: 0.07, rBack: 0.07, length: 0.05, segments: 8 },
    },
    // Outboard drive nacelles on swept pylons.
    { name: 'pylon', paint: 'primary', mirror: true, pos: [0.85, -0.15, -0.6], rot: [0, 0, -4], shape: { kind: 'wing', root: 4.0, tip: 3.2, span: 1.1, sweep: 1.0, thickness: 0.28, tipThickness: 0.26 } },
    { name: 'pylon-stripe', paint: 'secondary', mirror: true, pos: [0.9, -0.12, -1.4], rot: [0, 0, -4], shape: { kind: 'wing', root: 1.2, tip: 1.0, span: 1.0, sweep: 0.95, thickness: 0.31, tipThickness: 0.29 } },
    lf('nacelle', 'primary', VL_NAC, { mirror: true }),
    bd('nacelle-band', 'accent', VL_NAC, -1.6, -1.3, 0.02, { mirror: true }),
    bd('nacelle-panel', 'secondary', VL_NAC, -7.6, -6.2, 0.02, { mirror: true }),
    { name: 'nacelle-fin', paint: 'secondary', mirror: true, pos: [2.45, 0.3, -5.6], rot: [0, 0, 90], shape: { kind: 'wing', root: 2.8, tip: 1.2, span: 0.9, sweep: 1.5, thickness: 0.1 } },
    { name: 'nacelle-fin-low', paint: 'dark', mirror: true, pos: [2.45, -0.8, -6.0], rot: [0, 0, -90], shape: { kind: 'wing', root: 2.2, tip: 1.0, span: 0.6, sweep: 1.1, thickness: 0.1 } },
    bell('nacelle-bell', [2.45, -0.25, -9.3], 0.46, 0.6, true),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [2.45, 0.4, 0.2], shape: { kind: 'box', w: 0.05, h: 0.05, d: 0.16 } },
    // Tower.
    bx('tower-base', 'primary', [0, VL_TY + 0.33, VL_TOWER_Z], [1.15, 0.7, 2.1], 0.15),
    bx('tower-stripe', 'accent', [0, VL_TY + 0.45, VL_TOWER_Z + 1.06], [1.17, 0.1, 0.03]),
    bx('tower-mid', 'primary', [0, VL_TY + 0.9, VL_TOWER_Z + 0.1], [0.8, 0.55, 1.3], 0.1),
    bx('bridge', 'secondary', [0, VL_TY + 1.28, VL_TOWER_Z + 0.35], [1.45, 0.22, 0.55], 0.04),
    bx('bridge-glass', 'glass', [0, VL_TY + 1.3, VL_TOWER_Z + 0.42], [1.47, 0.06, 0.42], 0, { emissive: 0.6 }),
    bx('director', 'primary', [0, VL_TY + 1.56, VL_TOWER_Z + 0.1], [0.55, 0.34, 0.55], 0.06),
    bx('rangefinder', 'metal', [0, VL_TY + 1.62, VL_TOWER_Z + 0.1], [1.2, 0.08, 0.1], 0.02),
    windows('tower-ports', [0.41, VL_TY + 0.95, VL_TOWER_Z + 0.55], 3, [0, 0, -0.35], [0.02, 0.07, 0.14], { mirror: true }),
    post('mast', 'metal', [0, VL_TY + 1.72, VL_TOWER_Z - 0.1], 0.05, 0.025, 1.0, 6),
    { name: 'radar', paint: 'secondary', articulation: 'radar', pos: [0, VL_TY + 2.5, VL_TOWER_Z - 0.1], rot: [-10, 0, 0], shape: { kind: 'box', w: 0.6, h: 0.18, d: 0.04, c: 0.01 } },
    lf('stack', 'secondary', [
      { z: -1.9, w: 0.55, h: 0.6, y: vlTop(-1.5) + 0.25, c: 0.16 },
      { z: -0.9, w: 0.6, h: 0.7, y: vlTop(-1.5) + 0.3, c: 0.18 },
    ]),
    bx('stack-cap', 'glass', [0, vlTop(-1.5) + 0.66, -1.4], [0.5, 0.05, 0.85], 0, { emissive: 0.9 }),
    // Barbette for the superfiring mount.
    post('barbette-b', 'secondary', [0, vlTop(3.8) - 0.05, 3.8], 0.44, 0.42, 0.36, 10),
    ...VL_GUNS.parts,
    bx('gun-deck', 'primary', [1.0, 0.45, -0.7], [0.4, 0.28, 5.2], 0.08, { mirror: true }),
    // Ventral hangar: doors hinge outward on the keel (channel 'bay').
    bx('bay', 'dark', [0, -1.02, -3.0], [0.9, 0.06, 2.4]),
    bx('bay-door', 'secondary', [0.26, -1.08, -3.0], [0.5, 0.06, 2.4], 0.02, { mirror: true, articulation: 'bay-door' }),
    {
      name: 'deck-aft',
      paint: 'metal',
      trim: 'dark',
      pos: [0, vlTop(-7.0) - 0.02, -7.0],
      shape: { kind: 'greeble', w: 1.3, d: 1.0, count: 12, seed: 17, size: [0.07, 0.24], height: [0.03, 0.1] },
    },
    {
      name: 'deck-fore',
      paint: 'metal',
      trim: 'dark',
      pos: [0, vlTop(7.0) - 0.02, 6.9],
      shape: { kind: 'greeble', w: 0.8, d: 0.9, count: 8, seed: 23, size: [0.06, 0.2], height: [0.02, 0.08] },
    },
    { name: 'fin', paint: 'secondary', pos: [0, -1.05, -5.8], rot: [0, 0, -90], shape: { kind: 'wing', root: 2.6, tip: 1.1, span: 0.9, sweep: 1.3, thickness: 0.12 } },
    lf('drive-block', 'metal', [
      { z: -8.8, w: 1.6, h: 1.35, y: 0.1, c: 0.35 },
      { z: -7.8, w: 1.8, h: 1.5, y: 0.1, c: 0.4 },
    ]),
    bell('bell', [0, 0.1, -9.15], 0.52, 0.7),
  ],
  engines: [
    { pos: [2.45, -0.25, -9.6], radius: 0.4, plume: 4.5, mirror: true },
    { pos: [0, 0.1, -9.5], radius: 0.46, plume: 3.8 },
  ],
  articulations: [
    ...VL_GUNS.joints,
    { id: 'radar', pivot: [0, VL_TY + 2.45, VL_TOWER_Z - 0.1], axis: [0, 1, 0], range: [0, 360], channel: 'radar', mirror: false },
    { id: 'bay-door', pivot: [0.51, -1.08, -3.0], axis: [0, 0, 1], range: [0, 100], channel: 'bay' },
  ],
  hardpoints: [
    hp('bridge', 'gun', [0, VL_TY + 1.34, VL_TOWER_Z + 0.7]),
    hp('torpedo', 'missile', [0.28, -0.3, 8.3], { mirror: true }),
    hp('hangar', 'hangar', [0, -1.1, -3.0], { rot: [90, 0, 0] }),
  ],
};
