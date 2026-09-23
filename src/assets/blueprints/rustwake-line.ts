import type { Blueprint, Part, Station, Vec3 } from '../Blueprint';
import { flipX, topAt, wingSlice, type WingSpec } from './kit';
import { bd, bell, bx, cyl, hazard, hp, lf, post, turret, turrets, windows } from './yard';

/**
 * Rustwake clan designs: patchwork, rust and harpoons. Nothing is new and
 * nothing matches — salvaged parts keep the livery of the side they were
 * pulled from (`Part.livery`), and every hull is at least slightly
 * asymmetric.
 */

/** Container / crate colours the clans paint (or don't). */
const CRATE = ['#7a3b24', '#556b3a', '#c7902a', '#38505e', '#8c8474'];

// ═════════════════════════════════════════════════════════════════════════
// RW-H "GAFF" — harpoon raider, ~19 m
// ═════════════════════════════════════════════════════════════════════════

const GF_BODY: Station[] = [
  { z: -6.6, w: 1.5, h: 1.2, y: 0.0, c: 0.25 },
  { z: -2.0, w: 2.0, h: 1.6, y: 0.1, c: 0.3 },
  { z: 3.0, w: 1.8, h: 1.5, y: 0.05, c: 0.3 },
  { z: 6.0, w: 1.1, h: 0.9, y: -0.15, c: 0.2 },
  { z: 7.8, w: 0.4, h: 0.4, y: -0.25, c: 0.1 },
];
const GF_OUT: WingSpec = { pos: [0.85, -0.15, -1.2], rot: [0, 0, -6], root: 3.4, tip: 1.6, span: 3.4, sweep: 1.9, thickness: 0.24, tipThickness: 0.16 };
const HARPOON: Vec3 = [0.72, 1.12, 0];

export const GAFF: Blueprint = {
  id: 'rw-gaff',
  name: 'Gaff',
  designation: 'RW-H "Gaff"',
  faction: 'rustwake',
  shipClass: 'interceptor',
  ramp: 'classic',
  notes:
    'Harpoon raider. It does not shoot you down; it spears you, reels you in and lets the clan cut you open at leisure. ' +
    'The cable is rated for a corvette. Nobody has tested that on purpose.',
  parts: [
    lf('body', 'primary', GF_BODY, { group: 1 }),
    bd('nose-band', 'accent', GF_BODY, 5.4, 5.8, 0.03),
    bd('rear-band', 'secondary', GF_BODY, -5.4, -4.6, 0.03),
    lf('nose', 'secondary', [
      { z: 7.8, w: 0.4, h: 0.4, y: -0.25, c: 0.1 },
      { z: 8.6, w: 0.12, h: 0.12, y: -0.3 },
    ]),
    // Low racing canopy, offset to port so the harpoon clears.
    lf('cab', 'glass', [
      { z: 0.6, w: 0.9, h: 0.6, x: -0.3, y: 0.95, c: 0.2 },
      { z: 3.0, w: 0.85, h: 0.55, x: -0.3, y: 0.92, c: 0.2 },
      { z: 4.2, w: 0.5, h: 0.2, x: -0.3, y: 0.78, c: 0.08 },
    ]),
    bx('cab-frame', 'dark', [-0.3, 1.1, 2.0], [0.95, 0.08, 0.14], 0.02, { repeat: { count: 2, step: [0, 0, 1.0] } }),
    // The harpoon launcher: tube, barbed head, cable drum.
    cyl('harpoon-tube', 'metal', [HARPOON[0], HARPOON[1], 1.2], 0.3, 0.34, 9.0, { segments: 10 }),
    cyl('harpoon-muzzle', 'accent', [HARPOON[0], HARPOON[1], 5.6], 0.38, 0.38, 0.4, { segments: 10 }),
    hazard('harpoon-hazard', [HARPOON[0] - 0.18, HARPOON[1], 5.6], 3, 0.18, [0.06, 0.8, 0.42]),
    cyl('harpoon-shaft', 'dark', [HARPOON[0], HARPOON[1], 7.3], 0.08, 0.08, 3.0, { segments: 6 }),
    lf('harpoon-head', 'accent', [
      { z: 8.7, w: 0.5, h: 0.5, x: HARPOON[0], y: HARPOON[1], c: 0.25 },
      { z: 9.3, w: 0.62, h: 0.62, x: HARPOON[0], y: HARPOON[1], c: 0.31 },
      { z: 11.2, w: 0.02, h: 0.02, x: HARPOON[0], y: HARPOON[1] },
    ]),
    {
      name: 'harpoon-barb',
      paint: 'metal',
      pos: [HARPOON[0], HARPOON[1], 9.3],
      rot: [0, 0, 0],
      repeat: { count: 3, rot: [0, 0, 120] },
      shape: { kind: 'wing', root: 1.2, tip: 0.25, span: 0.7, sweep: -0.7, thickness: 0.08 },
    },
    bx('harpoon-clamp', 'dark', [HARPOON[0], 0.85, 2.5], [0.4, 0.4, 0.5], 0.08, { repeat: { count: 3, step: [0, 0, -2.4] } }),
    { name: 'drum', paint: 'secondary', pos: [HARPOON[0], HARPOON[1] + 0.1, -4.2], rot: [0, 90, 0], shape: { kind: 'cylinder', rFront: 0.62, rBack: 0.62, length: 0.9, segments: 12 } },
    { name: 'drum-cable', paint: 'dark', pos: [HARPOON[0], HARPOON[1] + 0.1, -4.2], rot: [0, 90, 0], shape: { kind: 'cylinder', rFront: 0.66, rBack: 0.66, length: 0.55, segments: 12 } },
    // Outriggers with pod engines — the port one off a Directorate tanker.
    { name: 'outrigger', paint: 'primary', ...wingSlice(GF_OUT, 0, 3.4) },
    { name: 'outrigger-port', paint: 'primary', livery: 'concord', ...flipX(wingSlice(GF_OUT, 0, 3.4)) },
    { name: 'outrigger-stripe', paint: 'secondary', livery: 'concord', ...flipX(wingSlice(GF_OUT, 2.2, 2.7, 0.05)) },
    { name: 'weld', paint: 'metal', ...flipX(wingSlice(GF_OUT, 0.1, 0.6, 0.1)) },
    cyl('pod', 'metal', [4.25, -0.4, -2.5], 0.42, 0.46, 3.0, { segments: 8 }),
    cyl('pod-port', 'secondary', [-4.25, -0.4, -2.6], 0.38, 0.4, 2.6, { segments: 12 }),
    cyl('pod-band', 'accent', [4.25, -0.4, -1.8], 0.48, 0.48, 0.3, { segments: 8 }),
    bell('pod-bell', [4.25, -0.4, -4.3], 0.44, 0.6),
    bell('pod-bell-port', [-4.25, -0.4, -4.2], 0.38, 0.5),
    // Main drive.
    cyl('drive', 'metal', [0, 0.05, -6.9], 0.78, 0.72, 1.6, { segments: 8 }),
    bell('drive-bell', [0, 0.05, -8.0], 0.7, 0.7),
    bx('strap', 'dark', [0, 0.05, -6.6], [1.9, 0.12, 0.22], 0, { repeat: { count: 2, step: [0, 0, -0.6] } }),
    // Fins: one tall olive fin on port, a stub on starboard.
    { name: 'fin', paint: 'secondary', pos: [-0.45, 0.75, -3.0], rot: [0, 0, 98], shape: { kind: 'wing', root: 3.2, tip: 1.0, span: 2.4, sweep: 2.4, thickness: 0.18, tipThickness: 0.1 } },
    { name: 'fin-cap', paint: 'accent', pos: [-0.8, 3.1, -5.35], rot: [0, 0, 98], shape: { kind: 'wing', root: 1.05, tip: 1.0, span: 0.25, sweep: 0.1, thickness: 0.14 } },
    { name: 'ventral-fin', paint: 'dark', pos: [0.3, -0.6, -4.0], rot: [0, 0, -100], shape: { kind: 'wing', root: 2.2, tip: 0.8, span: 1.2, sweep: 1.4, thickness: 0.14 } },
    // Patches, gun, lamp.
    bx('patch', 'metal', [-1.02, 0.1, 1.2], [0.08, 0.9, 1.8], 0.02, { rot: [0, 0, 6] }),
    bx('patch-b', 'accent', [0.95, -0.2, -2.4], [0.08, 0.6, 1.0], 0.02, { rot: [10, 0, 0] }),
    bx('patch-c', 'secondary', [-0.4, 0.86, -3.6], [0.8, 0.07, 1.2], 0.02, { rot: [0, 12, 0] }),
    bx('gun', 'dark', [-0.55, -0.62, 5.2], [0.3, 0.3, 1.4], 0.06),
    cyl('gun-barrel', 'metal', [-0.55, -0.62, 6.7], 0.07, 0.09, 1.8, { segments: 6 }),
    { name: 'lamp', paint: 'glow', emissive: 1.4, pos: [-0.3, 1.3, 0.2], shape: { kind: 'dome', radius: 0.12, segments: 6 } },
  ],
  engines: [
    { pos: [0, 0.05, -8.4], radius: 0.6, plume: 7 },
    { pos: [4.25, -0.4, -4.65], radius: 0.36, plume: 4 },
    { pos: [-4.25, -0.4, -4.5], radius: 0.3, plume: 3.4 },
  ],
  hardpoints: [hp('harpoon', 'missile', [HARPOON[0], HARPOON[1], 10.7]), hp('gun', 'gun', [-0.55, -0.62, 7.7])],
};

// ═════════════════════════════════════════════════════════════════════════
// RW-B "KNUCKLEDUSTER" — clan brawler, ~32 m, grapple arms (modelled 1:1.5)
// ═════════════════════════════════════════════════════════════════════════

const KD_BODY: Station[] = [
  { z: -9.0, w: 3.0, wb: 3.2, h: 2.4, y: 0.2, c: 0.4 },
  { z: -3.0, w: 3.8, wb: 4.0, h: 3.0, y: 0.3, c: 0.5 },
  { z: 4.0, w: 3.8, wb: 4.0, h: 3.0, y: 0.25, c: 0.5 },
  { z: 7.4, w: 3.0, wb: 3.4, h: 2.4, y: 0.05, c: 0.4 },
];
const kdTop = (z: number) => topAt(KD_BODY, z);
const KD_ARM_PIVOT: Vec3 = [2.25, -0.35, 3.2];
const KD_GUN = turret('dorsal', [0.3, kdTop(-1.5) + 0.2, -1.5], {
  radius: 0.55,
  height: 0.55,
  barrels: 2,
  barrelLength: 1.8,
  barrelRadius: 0.07,
  paint: 'secondary',
  joint: 'dorsal',
});
KD_GUN.parts[0].livery = 'concord';

/** One grapple arm (authored on +X, mirrored): boom, forearm, two claws. */
const kdArm = (): Part[] => [
  bx('arm-shoulder', 'dark', KD_ARM_PIVOT, [0.9, 0.9, 1.0], 0.2, { mirror: true }),
  lf('arm', 'secondary', [
    { z: 3.4, w: 0.7, h: 0.8, x: 2.35, y: -0.35, c: 0.18 },
    { z: 8.6, w: 0.6, h: 0.65, x: 2.6, y: -0.45, c: 0.15 },
  ], { mirror: true, articulation: 'arm' }),
  bx('arm-piston', 'metal', [2.15, 0.2, 5.4], [0.18, 0.18, 3.6], 0.04, { mirror: true, articulation: 'arm', rot: [-6, 0, 0] }),
  bx('arm-wrist', 'dark', [2.6, -0.45, 8.9], [0.8, 0.8, 0.6], 0.15, { mirror: true, articulation: 'arm' }),
  { name: 'claw', paint: 'accent', mirror: true, articulation: 'arm', pos: [2.6, -0.05, 9.2], rot: [-90, 0, 0], shape: { kind: 'wing', root: 0.6, tip: 0.2, span: 1.6, sweep: -0.9, thickness: 0.16 } },
  { name: 'claw-low', paint: 'accent', mirror: true, articulation: 'arm', pos: [2.6, -0.85, 9.2], rot: [90, 0, 0], shape: { kind: 'wing', root: 0.6, tip: 0.2, span: 1.6, sweep: 0.9, thickness: 0.16 } },
];

export const KNUCKLEDUSTER: Blueprint = {
  id: 'rw-knuckleduster',
  name: 'Knuckleduster',
  designation: 'RW-B "Knuckleduster"',
  faction: 'rustwake',
  shipClass: 'strike-fighter',
  scale: 1.5,
  ramp: 'classic',
  notes:
    'Clan brawler: an ore-tug cab armoured like a bank vault, a ram prow, two grapple arms and a Directorate point-defence ' +
    'turret that its previous owners would like back. Sold to outsiders who have drunk with the clan and lived.',
  parts: [
    lf('body', 'primary', KD_BODY, { group: 1 }),
    bd('body-band', 'secondary', KD_BODY, -6.4, -5.2, 0.04),
    // Ram prow with hazard stripes.
    lf('ram', 'metal', [
      { z: 7.2, w: 3.4, wb: 3.6, h: 2.6, y: 0.05, c: 0.4 },
      { z: 9.0, w: 3.6, wb: 3.0, h: 2.2, y: -0.1, c: 0.5 },
      { z: 9.8, w: 2.8, wb: 2.0, h: 1.4, y: -0.25, c: 0.4 },
    ]),
    bx('ram-plate', 'accent', [0, -0.1, 9.2], [3.7, 0.9, 0.4], 0.12, { rot: [-12, 0, 0] }),
    hazard('ram-hazard', [-1.5, -0.1, 9.42], 7, 0.5, [0.18, 1.0, 0.1], { rot: [-12, 0, 40] }),
    // Armoured cab: slit windows in a raised block.
    lf('cab', 'secondary', [
      { z: 2.0, w: 2.2, h: 0.9, y: kdTop(3) + 0.35, c: 0.2 },
      { z: 5.8, w: 2.2, h: 0.9, y: kdTop(5.5) + 0.35, c: 0.2 },
      { z: 6.6, w: 1.8, h: 0.4, y: kdTop(6.4) + 0.12, c: 0.1 },
    ]),
    windows('cab-slit', [-0.66, kdTop(5.6) + 0.5, 5.95], 3, [0.66, 0, 0], [0.42, 0.1, 0.1], { rot: [-40, 0, 0] }),
    windows('cab-side', [1.12, kdTop(4) + 0.42, 4.6], 3, [0, 0, -0.8], [0.04, 0.12, 0.4], { mirror: true }),
    // Bolted armour plates (every one different).
    bx('plate', 'metal', [2.02, 0.5, 0.6], [0.14, 1.5, 3.2], 0.04, { rot: [0, 0, 8] }),
    bx('plate-b', 'secondary', [-2.03, 0.1, -1.4], [0.14, 1.9, 2.6], 0.04, { rot: [0, 0, -5] }),
    bx('plate-c', 'accent', [1.9, 0.9, -4.6], [0.14, 0.9, 1.6], 0.04, { rot: [4, 0, 12] }),
    bx('plate-d', 'metal', [-0.6, kdTop(-5) + 0.05, -5.0], [1.6, 0.12, 2.2], 0.04, { rot: [0, 8, 0] }),
    {
      name: 'rivets',
      paint: 'dark',
      pos: [-2.12, 0.9, 0.2],
      repeat: { count: 5, step: [0, 0, -0.6] },
      shape: { kind: 'box', w: 0.06, h: 0.12, d: 0.12 },
    },
    // Grapple arms.
    ...kdArm(),
    // Salvaged Directorate PD turret on a scrap ring.
    post('turret-ring', 'dark', [0.3, kdTop(-1.5) - 0.05, -1.5], 0.66, 0.62, 0.3, 8),
    ...KD_GUN.parts,
    // Two mismatched engines.
    cyl('engine', 'metal', [1.1, 0.3, -9.6], 1.05, 0.98, 2.6, { segments: 8 }),
    cyl('engine-band', 'accent', [1.1, 0.3, -9.0], 1.1, 1.1, 0.3, { segments: 8 }),
    bell('engine-bell', [1.1, 0.3, -11.2], 0.95, 0.8, false, 8),
    cyl('engine-port', 'secondary', [-1.25, 0.05, -9.3], 0.8, 0.74, 2.0, { segments: 12, livery: 'concord' }),
    bell('engine-port-bell', [-1.25, 0.05, -10.6], 0.72, 0.7),
    bx('engine-strap', 'dark', [0, 0.2, -9.2], [3.8, 0.14, 0.26], 0, { repeat: { count: 2, step: [0, 0, -0.9] } }),
    { name: 'fin', paint: 'secondary', pos: [-0.3, kdTop(-7) - 0.1, -6.0], rot: [0, 0, 90], shape: { kind: 'wing', root: 3.2, tip: 1.2, span: 2.0, sweep: 2.2, thickness: 0.2 } },
    { name: 'stub-wing', paint: 'primary', mirror: true, pos: [1.9, -0.6, -3.2], rot: [0, 0, -8], shape: { kind: 'wing', root: 3.6, tip: 1.8, span: 2.0, sweep: 1.2, thickness: 0.3 } },
    bx('rocket-pod', 'secondary', [3.6, -1.0, -4.0], [0.9, 0.8, 2.2], 0.12, { mirror: true }),
    {
      name: 'rocket-tubes',
      paint: 'dark',
      mirror: true,
      pos: [3.38, -1.0, -2.88],
      repeat: { count: 2, step: [0.44, 0, 0] },
      shape: { kind: 'cylinder', rFront: 0.14, rBack: 0.14, length: 0.08, segments: 6 },
    },
    {
      name: 'machinery',
      paint: 'dark',
      trim: 'metal',
      pos: [-0.8, kdTop(-7.4), -7.4],
      shape: { kind: 'greeble', w: 1.4, d: 2.0, count: 10, seed: 404, size: [0.15, 0.45], height: [0.06, 0.24] },
    },
    { name: 'lamp', paint: 'glow', emissive: 1.4, mirror: true, pos: [1.5, kdTop(6) + 0.05, 6.5], shape: { kind: 'dome', radius: 0.14, segments: 6 } },
  ],
  engines: [
    { pos: [1.1, 0.3, -11.6], radius: 0.8, plume: 8 },
    { pos: [-1.25, 0.05, -10.95], radius: 0.6, plume: 6 },
  ],
  articulations: [
    // Grapple arms swing in to grab (0 = open, 1 = clamped).
    { id: 'arm', pivot: KD_ARM_PIVOT, axis: [0, 1, 0], range: [0, -24], channel: 'claw' },
    ...(KD_GUN.joint ? [KD_GUN.joint] : []),
  ],
  hardpoints: [
    hp('claw', 'gun', [2.6, -0.45, 10.4], { mirror: true, articulation: 'arm' }),
    hp('rockets', 'missile', [3.6, -1.0, -2.8], { mirror: true }),
  ],
};

// ═════════════════════════════════════════════════════════════════════════
// RW-G "BULLDOG" — scrap gunboat, ~68 m (modelled 1:2.5)
// ═════════════════════════════════════════════════════════════════════════

const BD_TANK: Station[] = [
  { z: -9.6, w: 4.2, h: 4.2, y: 0.0, c: 1.25 },
  { z: -8.8, w: 4.8, h: 4.8, y: 0.0, c: 1.45 },
  { z: 6.0, w: 4.8, h: 4.8, y: 0.0, c: 1.45 },
  { z: 7.0, w: 4.2, h: 4.2, y: -0.1, c: 1.25 },
];
const BD_GUNS = turrets([
  turret('turret-fore', [0, 2.55, 3.6], { radius: 1.0, height: 1.0, barrels: 3, barrelLength: 3.2, barrelRadius: 0.11, housing: [1.7, 0.7, 1.9], paint: 'secondary', joint: 'turret-fore' }),
  turret('turret-aft', [0.3, 2.55, -4.2], { radius: 0.85, height: 0.85, barrels: 2, barrelLength: 2.6, barrelRadius: 0.1, yaw: 170, joint: 'turret-aft' }),
]);
BD_GUNS.parts[1].livery = 'concord';

export const BULLDOG: Blueprint = {
  id: 'rw-bulldog',
  name: 'Bulldog',
  designation: 'RW-G "Bulldog"',
  faction: 'rustwake',
  shipClass: 'corvette',
  scale: 2.5,
  ramp: 'classic',
  notes:
    'An ore-tug fuel tank with a cab welded on the front, two turrets welded on top and a mass-driver welded underneath. ' +
    'The welds are the strongest part of the ship.',
  parts: [
    lf('tank', 'primary', BD_TANK, { group: 1 }),
    ...[-6.0, -2.6, 0.8].map((z) => bd('tank-hoop', 'metal', BD_TANK, z, z + 0.5, 0.06)),
    bd('tank-stripe', 'accent', BD_TANK, 4.2, 4.8, 0.06),
    // Cab welded to the front.
    lf('cab', 'secondary', [
      { z: 6.8, w: 3.6, wb: 3.8, h: 3.2, y: 0.3, c: 0.5 },
      { z: 10.0, w: 3.2, wb: 3.4, h: 2.8, y: 0.2, c: 0.45 },
      { z: 11.2, w: 2.6, wb: 2.8, h: 1.8, y: -0.1, c: 0.35 },
    ]),
    lf('cab-glass', 'glass', [
      { z: 9.6, w: 2.8, h: 0.6, y: 1.35, c: 0.1 },
      { z: 10.6, w: 2.4, h: 0.4, y: 1.0, c: 0.08 },
    ]),
    bx('bumper', 'accent', [0, -0.6, 11.3], [3.0, 0.9, 0.5], 0.14),
    hazard('bumper-hazard', [-1.2, -0.6, 11.56], 5, 0.6, [0.2, 1.0, 0.1]),
    windows('cab-ports', [1.72, 0.9, 9.2], 3, [0, 0, -0.8], [0.04, 0.24, 0.45], { mirror: true }),
    // Turrets (the aft one still in Directorate paint) on welded decks.
    bx('deck', 'metal', [0, 2.3, -0.2], [2.2, 0.3, 11.0], 0.1),
    bx('deck-edge', 'dark', [1.15, 2.2, -0.2], [0.12, 0.2, 10.6], 0, { mirror: true }),
    ...BD_GUNS.parts,
    // Ventral mass-driver.
    bx('driver-cradle', 'dark', [0, -2.55, 2.0], [0.9, 0.7, 9.0], 0.15),
    cyl('driver', 'metal', [0, -3.0, 7.0], 0.34, 0.44, 13.0, { segments: 8 }),
    bx('driver-brake', 'secondary', [0, -3.0, 13.7], [1.0, 0.7, 0.9], 0.15),
    {
      name: 'driver-coil',
      paint: 'accent',
      pos: [0, -3.0, 4.0],
      repeat: { count: 4, step: [0, 0, 2.0] },
      shape: { kind: 'cylinder', rFront: 0.56, rBack: 0.56, length: 0.3, segments: 8 },
    },
    // Scaffold and crates on the flanks.
    bx('scaffold', 'metal', [2.65, 0.0, -1.0], [0.12, 0.12, 12.0], 0, { mirror: true, repeat: { count: 2, step: [0, 1.4, 0] } }),
    bx('scaffold-post', 'metal', [2.65, 0.7, 4.6], [0.12, 1.6, 0.12], 0, { mirror: true, repeat: { count: 5, step: [0, 0, -2.6] } }),
    ...[
      [2.95, 0.7, 2.8, 0],
      [2.95, 0.7, 0.8, 1],
      [2.95, -0.6, -2.4, 2],
      [-2.95, 0.7, 3.4, 3],
      [-2.95, -0.6, -0.6, 4],
      [-2.95, 0.7, -4.0, 1],
    ].map(([x, y, z, c]): Part => bx('crate', 'secondary', [x, y, z], [0.6, 1.1, 1.7], 0.08, { color: CRATE[c] })),
    // Mismatched radiators.
    { name: 'radiator', paint: 'dark', pos: [2.0, 1.2, -6.8], rot: [0, 0, 30], shape: { kind: 'wing', root: 2.8, tip: 1.6, span: 2.6, sweep: 1.0, thickness: 0.14 } },
    { name: 'radiator-port', paint: 'secondary', livery: 'concord', pos: [-2.0, 1.0, -7.0], rot: [0, 0, 150], shape: { kind: 'wing', root: 2.4, tip: 1.2, span: 2.2, sweep: 1.0, thickness: 0.14 } },
    // Engine cluster: four bells, no two alike.
    lf('thrust-frame', 'dark', [
      { z: -11.0, w: 4.4, h: 4.0, c: 0.9 },
      { z: -9.6, w: 4.6, h: 4.2, c: 1.0 },
    ]),
    bell('bell-a', [1.1, 0.9, -11.6], 1.0, 1.2),
    bell('bell-b', [-1.2, 1.0, -11.4], 0.8, 0.9),
    bell('bell-c', [-0.9, -1.1, -11.5], 0.9, 1.0, false, 8),
    bell('bell-d', [1.3, -1.2, -11.3], 0.6, 0.7),
    post('mast', 'metal', [-0.8, 2.4, 1.2], 0.1, 0.05, 2.6, 5),
    { name: 'lamp', paint: 'glow', emissive: 1.4, pos: [-0.8, 5.05, 1.2], shape: { kind: 'dome', radius: 0.2, segments: 6 } },
    {
      name: 'machinery',
      paint: 'dark',
      trim: 'metal',
      pos: [0, 2.45, -0.3],
      shape: { kind: 'greeble', w: 1.8, d: 3.0, count: 10, seed: 606, size: [0.2, 0.6], height: [0.1, 0.35] },
    },
  ],
  engines: [
    { pos: [1.1, 0.9, -12.25], radius: 0.85, plume: 8 },
    { pos: [-1.2, 1.0, -11.9], radius: 0.66, plume: 6 },
    { pos: [-0.9, -1.1, -12.05], radius: 0.74, plume: 7 },
    { pos: [1.3, -1.2, -11.7], radius: 0.5, plume: 5 },
  ],
  articulations: BD_GUNS.joints,
  hardpoints: [hp('driver', 'gun', [0, -3.0, 14.2]), hp('bridge', 'gun', [0, 1.4, 10.4])],
};

// ═════════════════════════════════════════════════════════════════════════
// RW-C "MOTHER LODE" — clan hauler-carrier, ~430 m (modelled 1:20)
// ═════════════════════════════════════════════════════════════════════════

const ML_CMD: Station[] = [
  { z: 5.8, w: 2.2, wb: 2.4, h: 1.8, y: 0.3, c: 0.35 },
  { z: 8.6, w: 2.2, wb: 2.4, h: 1.8, y: 0.3, c: 0.35 },
  { z: 9.8, w: 1.6, wb: 1.8, h: 1.2, y: 0.1, c: 0.3 },
];
/** Salvaged carrier deck (a sawn-off Directorate hull), starboard. */
const ML_DECK: Station[] = [
  { z: -6.5, w: 2.0, wb: 1.6, h: 0.9, x: 2.35, y: -0.1, c: 0.2 },
  { z: 4.2, w: 2.0, wb: 1.6, h: 0.9, x: 2.35, y: -0.1, c: 0.2 },
  { z: 5.0, w: 1.8, wb: 1.3, h: 0.7, x: 2.35, y: -0.15, c: 0.2 },
];
const ML_CRANE_PIVOT: Vec3 = [-1.6, 1.1, 1.0];

export const MOTHER_LODE: Blueprint = {
  id: 'rw-mother-lode',
  name: 'Mother Lode',
  designation: 'RW-C "Mother Lode"',
  faction: 'rustwake',
  shipClass: 'carrier',
  scale: 20,
  ramp: 'classic',
  notes:
    'A clan home: a gas-skimmer spine with three hab drums, a flight deck sawn off a dead Directorate carrier, a crane ' +
    'for taking prizes apart and a scoop at the bow for drinking stars. Four hundred people live aboard. Most were born there.',
  parts: [
    // Spine truss.
    bx('spine', 'metal', [0, 0, -0.5], [0.7, 0.7, 17.5], 0.12, { group: 1 }),
    bx('truss', 'dark', [0.55, 0.55, 3.8], [0.12, 0.12, 13.0], 0, { mirror: true, repeat: { count: 2, step: [0, -1.1, 0] } }),
    bx('truss-web', 'dark', [0, 0, 3.0], [1.25, 1.25, 0.1], 0, { repeat: { count: 9, step: [0, 0, -1.2] } }),
    // Command block + windows (an old freighter cab).
    lf('command', 'primary', ML_CMD),
    bd('command-band', 'accent', ML_CMD, 8.0, 8.35, 0.03),
    windows('bridge', [0, 1.02, 9.3], 1, [0, 0, 0], [1.5, 0.12, 0.4], { rot: [-30, 0, 0] }),
    windows('command-ports', [1.13, 0.5, 8.0], 5, [0, 0, -0.45], [0.03, 0.1, 0.2], { mirror: true }),
    // Gas scoop at the bow (a closed lathe ring).
    {
      name: 'scoop',
      paint: 'secondary',
      pos: [0, 0.1, 9.8],
      shape: { kind: 'lathe', segments: 14, profile: [[0.6, 0], [1.5, 1.6], [1.35, 1.7], [0.5, 0.15], [0.6, 0]] },
    },
    { name: 'scoop-glow', paint: 'glow', emissive: 1.1, color: '#ffae4f', pos: [0, 0.1, 10.0], shape: { kind: 'dome', radius: 0.5, segments: 10, scale: [1, 1, 0.3] } },
    // Three hab drums around the spine (radial array).
    {
      name: 'hab',
      paint: 'primary',
      pos: [0, 1.2, 2.6],
      repeat: { count: 3, rot: [0, 0, 120] },
      shape: { kind: 'cylinder', rFront: 0.9, rBack: 0.9, length: 3.2, segments: 12 },
    },
    {
      name: 'hab-band',
      paint: 'accent',
      pos: [0, 1.2, 3.2],
      repeat: { count: 3, rot: [0, 0, 120] },
      shape: { kind: 'cylinder', rFront: 0.94, rBack: 0.94, length: 0.25, segments: 12 },
    },
    {
      name: 'hab-windows',
      paint: 'glass',
      emissive: 0.9,
      color: '#ffcf7a',
      pos: [0, 2.1, 2.6],
      repeat: { count: 3, rot: [0, 0, 120] },
      shape: { kind: 'box', w: 0.5, h: 0.04, d: 2.6 },
    },
    // Flight deck off a dead carrier (still in Directorate ivory), with its hangar mouth.
    lf('deck', 'primary', ML_DECK, { livery: 'concord' }),
    bd('deck-band', 'secondary', ML_DECK, 1.0, 1.6, 0.03, { livery: 'concord' }),
    bx('deck-line', 'accent', [2.35, 0.37, -0.8], [0.08, 0.02, 10.0], 0, { livery: 'concord' }),
    bx('hangar-mouth', 'dark', [2.35, -0.12, 5.0], [1.5, 0.5, 0.1], 0.1),
    bx('deck-arm', 'metal', [1.25, 0.0, 2.0], [1.3, 0.3, 0.4], 0.05, { repeat: { count: 3, step: [0, 0, -3.6] } }),
    bx('deck-patch', 'primary', [2.6, 0.38, -3.4], [0.9, 0.04, 1.4], 0.02, { rot: [0, 8, 0] }),
    // Port: strapped containers + prize crane.
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Part =>
      bx('container', 'secondary', [-1.25 - (i % 2) * 0.62, -0.35 + Math.floor(i / 4) * 0.62, -2.0 - (Math.floor(i / 2) % 2) * 1.5], [0.58, 0.58, 1.4], 0.04, {
        color: CRATE[(i * 3) % CRATE.length],
      }),
    ),
    post('crane-post', 'metal', [ML_CRANE_PIVOT[0], 0.3, ML_CRANE_PIVOT[2]], 0.2, 0.16, 0.9, 8),
    bx('crane-boom', 'accent', [-1.6, 1.25, 3.4], [0.22, 0.26, 4.8], 0.05, { rot: [-8, 0, 0], articulation: 'crane' }),
    hazard('crane-hazard', [-1.6, 1.25, 4.8], 1, 0, [0.24, 0.1, 0.6], { articulation: 'crane', rot: [-8, 0, 40] }),
    bx('crane-hook', 'dark', [-1.6, 0.9, 5.7], [0.2, 0.5, 0.2], 0.03, { articulation: 'crane' }),
    // Launch tubes under the spine.
    cyl('launch-tube', 'secondary', [0.45, -0.95, 3.8], 0.28, 0.28, 5.0, { mirror: true, segments: 10 }),
    cyl('launch-mouth', 'dark', [0.45, -0.95, 6.35], 0.22, 0.22, 0.1, { mirror: true, segments: 10 }),
    // Reactor + engine block: three bells and a salvaged monster.
    lf('reactor', 'secondary', [
      { z: -7.0, w: 1.9, h: 1.9, c: 0.55 },
      { z: -6.0, w: 2.1, h: 2.1, c: 0.6 },
      { z: -4.8, w: 1.7, h: 1.7, c: 0.5 },
    ]),
    { name: 'reactor-ring', paint: 'glow', emissive: 1.0, color: '#ffae4f', pos: [0, 0, -5.9], shape: { kind: 'torus', radius: 1.14, tube: 0.07, segments: 16, tubeSegments: 4 } },
    lf('drive-block', 'dark', [
      { z: -9.6, w: 2.6, h: 1.8, c: 0.4 },
      { z: -7.0, w: 2.8, h: 2.0, c: 0.45 },
    ]),
    bell('bell', [0.65, 0.4, -10.0], 0.46, 0.8, true),
    bell('bell-low', [0, -0.55, -10.0], 0.5, 0.9),
    cyl('monster', 'metal', [0, 1.35, -8.4], 0.62, 0.7, 2.4, { segments: 8, livery: 'concord' }),
    bell('monster-bell', [0, 1.35, -9.9], 0.66, 0.7, false, 8),
    { name: 'radiator', paint: 'dark', pos: [0.9, 0.0, -3.4], rot: [0, 0, -4], repeat: { count: 1 }, shape: { kind: 'wing', root: 2.4, tip: 1.6, span: 2.6, sweep: 0.9, thickness: 0.08 } },
    { name: 'radiator-port', paint: 'secondary', pos: [-0.9, -0.3, -3.8], rot: [0, 0, 190], shape: { kind: 'wing', root: 2.0, tip: 1.2, span: 2.2, sweep: 0.8, thickness: 0.08 } },
    post('mast', 'metal', [0, 1.2, 7.0], 0.06, 0.03, 1.4, 5),
    { name: 'lamp', paint: 'glow', emissive: 1.4, pos: [0, 2.65, 7.0], shape: { kind: 'dome', radius: 0.1, segments: 6 } },
    turret('pd', [0, 0.35, -2.4], { radius: 0.24, height: 0.26, barrels: 2, barrelLength: 0.7, barrelRadius: 0.035, paint: 'secondary' }).parts[0],
  ],
  engines: [
    { pos: [0.65, 0.4, -10.4], radius: 0.4, plume: 4.2, mirror: true },
    { pos: [0, -0.55, -10.45], radius: 0.42, plume: 4.2 },
    { pos: [0, 1.35, -10.25], radius: 0.56, plume: 5 },
  ],
  articulations: [{ id: 'crane', pivot: ML_CRANE_PIVOT, axis: [0, 1, 0], range: [-60, 60], channel: 'crane', mirror: false }],
  hardpoints: [
    hp('hangar', 'hangar', [2.35, -0.12, 5.1]),
    hp('tube', 'hangar', [0.45, -0.95, 6.4], { mirror: true }),
    hp('bridge', 'gun', [0, 1.1, 9.4]),
  ],
};

