import type { Blueprint, Part, Station } from '../Blueprint';
import { sideX, topAt } from './kit';
import { bd, bell, bx, cyl, hp, lf, post, turret, windows } from './yard';

// ═════════════════════════════════════════════════════════════════════════
// DDG-40 ARBITER — Directorate fork-bow destroyer, ~620 m (modelled 1:30)
// ═════════════════════════════════════════════════════════════════════════

/** Aft main hull. */
const AR_HULL: Station[] = [
  { z: -10.0, w: 2.6, wb: 2.2, h: 2.0, y: 0.1, c: 0.45 },
  { z: -6.0, w: 3.2, wb: 2.6, h: 2.4, y: 0.1, c: 0.55 },
  { z: 0.5, w: 3.0, wb: 2.4, h: 2.2, y: 0.0, c: 0.55 },
  { z: 2.4, w: 2.6, wb: 2.0, h: 1.8, y: -0.05, c: 0.5 },
];
/** One bow prong (starboard; mirrored). */
const AR_PRONG: Station[] = [
  { z: -0.5, w: 1.1, wb: 0.9, h: 1.7, x: 0.95, y: 0.0, c: 0.3 },
  { z: 5.0, w: 1.0, wb: 0.8, h: 1.5, x: 0.95, y: -0.05, c: 0.3 },
  { z: 8.4, w: 0.8, wb: 0.55, h: 1.1, x: 0.85, y: -0.15, c: 0.25 },
  { z: 9.8, w: 0.3, wb: 0.2, h: 0.4, x: 0.7, y: -0.25, c: 0.1 },
];
const arTop = (z: number) => topAt(AR_HULL, z);
const prTop = (z: number) => topAt(AR_PRONG, z);
const TOWER_Z = -2.6;
const TY = arTop(TOWER_Z);
const MAIN = { radius: 0.42, height: 0.42, barrels: 2, barrelLength: 1.4, barrelRadius: 0.05, housing: [0.8, 0.28, 0.95] as [number, number, number] };
/** Prong battery (clear forward, masked inboard by the other prong), aft X (masked forward by the tower), keel mount. */
const AR_GUNS = [
  turret('prong-a', [0.95, prTop(6.4) - 0.02, 6.4], { ...MAIN, mirror: true, traverse: [-80, 160] }),
  turret('prong-b', [0.95, prTop(3.9) - 0.02, 3.9], { ...MAIN, mirror: true, traverse: [-90, 165] }),
  turret('main-x', [0, arTop(-6.4) - 0.02, -6.4], { ...MAIN, radius: 0.5, housing: [0.95, 0.3, 1.1], barrels: 3, yaw: 180, traverse: [-150, 150], elevation: [-10, 70] }),
  turret('ventral', [0, -1.12, -4.0], { ...MAIN, ventral: true, paint: 'secondary' }),
];

export const ARBITER: Blueprint = {
  id: 'ddg40-arbiter',
  name: 'Arbiter',
  designation: 'DDG-40',
  faction: 'concord',
  shipClass: 'frigate',
  scale: 30,
  ramp: 'classic',
  notes:
    'Fork-bow destroyer: the two prongs carry the forward battery and cradle a spinal gate-breaker between them. The ' +
    'line ship between the Lantern Guards and the carriers — there are nine, and the Board knows each one by name.',
  parts: [
    lf('hull', 'primary', AR_HULL, { group: 1 }),
    lf('keel', 'secondary', [
      { z: -9.6, w: 1.6, wb: 1.0, h: 0.8, y: -1.1, c: 0.3 },
      { z: 1.8, w: 1.4, wb: 0.9, h: 0.8, y: -1.0, c: 0.28 },
    ]),
    bd('stern-band', 'secondary', AR_HULL, -9.4, -8.8, 0.02),
    bd('waist-band', 'accent', AR_HULL, 0.9, 1.2, 0.02),
    lf('prong', 'primary', AR_PRONG, { mirror: true }),
    bd('prong-band', 'accent', AR_PRONG, 8.0, 8.3, 0.02, { mirror: true }),
    bd('prong-panel', 'secondary', AR_PRONG, 1.0, 2.6, 0.02, { mirror: true }),
    // Spinal gate-breaker cradled between the prongs.
    cyl('breaker', 'metal', [0, -0.1, 3.8], 0.36, 0.42, 10.0, { segments: 10 }),
    {
      name: 'breaker-coil',
      paint: 'accent',
      pos: [0, -0.1, 1.4],
      repeat: { count: 5, step: [0, 0, 1.6] },
      shape: { kind: 'cylinder', rFront: 0.5, rBack: 0.5, length: 0.24, segments: 10 },
    },
    { name: 'breaker-muzzle', paint: 'glow', emissive: 1.2, pos: [0, -0.1, 8.82], shape: { kind: 'cylinder', rFront: 0.3, rBack: 0.3, length: 0.05, segments: 10 } },
    bx('breaker-web', 'dark', [0.6, -0.1, 4.2], [0.3, 0.2, 0.5], 0.05, { mirror: true, repeat: { count: 3, step: [0, 0, 1.8] } }),
    // Side armour + lit ports.
    ...[-0.2, -2.4, -4.6, -6.8].map((z): Part => bx('belt', 'secondary', [sideX(AR_HULL, z, 0.1) + 0.03, 0.1, z], [0.08, 0.7, 1.9], 0.03, { mirror: true })),
    windows('ports', [sideX(AR_HULL, -1.5, 0.6) + 0.005, 0.6, -0.5], 10, [0, 0, -0.45], [0.02, 0.07, 0.16], { mirror: true }),
    windows('prong-ports', [sideX(AR_PRONG, 3, 0.3) + 0.96, 0.3, 6.0], 6, [0, 0, -0.5], [0.02, 0.06, 0.14], { mirror: true }),
    // Tower.
    bx('tower-base', 'primary', [0, TY + 0.4, TOWER_Z], [1.5, 0.85, 2.4], 0.18),
    bx('tower-stripe', 'accent', [0, TY + 0.55, TOWER_Z + 1.21], [1.52, 0.1, 0.03]),
    bx('tower-mid', 'primary', [0, TY + 1.05, TOWER_Z + 0.15], [1.05, 0.55, 1.5], 0.12),
    bx('bridge', 'secondary', [0, TY + 1.45, TOWER_Z + 0.35], [1.8, 0.24, 0.6], 0.05),
    bx('bridge-glass', 'glass', [0, TY + 1.47, TOWER_Z + 0.42], [1.82, 0.07, 0.46], 0, { emissive: 0.6 }),
    bx('director', 'primary', [0, TY + 1.75, TOWER_Z + 0.1], [0.6, 0.36, 0.6], 0.07),
    windows('tower-ports', [0.53, TY + 1.08, TOWER_Z + 0.6], 3, [0, 0, -0.4], [0.02, 0.07, 0.15], { mirror: true }),
    post('mast', 'metal', [0, TY + 1.9, TOWER_Z - 0.1], 0.05, 0.025, 1.1, 6),
    bx('yard', 'metal', [0, TY + 2.55, TOWER_Z - 0.1], [0.9, 0.04, 0.05]),
    { name: 'radar', paint: 'secondary', articulation: 'radar', pos: [0, TY + 3.05, TOWER_Z - 0.1], rot: [-10, 0, 0], shape: { kind: 'box', w: 0.7, h: 0.2, d: 0.04, c: 0.01 } },
    // VLS fields.
    ...[-0.6, -1.0].flatMap((z, r): Part[] => [
      { name: `vls-${r}`, paint: 'dark', pos: [-0.75, arTop(z) + 0.02, z], repeat: { count: 6, step: [0.3, 0, 0] }, shape: { kind: 'box', w: 0.22, h: 0.04, d: 0.22 } },
    ]),
    bx('vls-frame', 'secondary', [0, arTop(-0.8) - 0.01, -0.8], [1.9, 0.05, 0.8]),
    ...AR_GUNS,
    post('barbette-x', 'secondary', [0, arTop(-6.4) - 0.1, -6.4], 0.5, 0.48, 0.12, 10),
    // Radiator wings + fins.
    { name: 'radiator', paint: 'secondary', mirror: true, pos: [1.4, 0.2, -5.0], rot: [0, 0, -8], shape: { kind: 'wing', root: 3.2, tip: 1.6, span: 1.8, sweep: 1.4, thickness: 0.12, tipThickness: 0.1 } },
    { name: 'radiator-edge', paint: 'accent', mirror: true, pos: [3.18, -0.05, -6.4], rot: [0, 0, -8], shape: { kind: 'wing', root: 1.62, tip: 1.6, span: 0.08, sweep: 0.0, thickness: 0.14 } },
    { name: 'fin', paint: 'secondary', pos: [0, -1.45, -7.4], rot: [0, 0, -90], shape: { kind: 'wing', root: 2.4, tip: 1.1, span: 0.9, sweep: 1.2, thickness: 0.12 } },
    {
      name: 'deck-aft',
      paint: 'metal',
      trim: 'dark',
      pos: [0, arTop(-8.6) - 0.02, -8.6],
      shape: { kind: 'greeble', w: 1.8, d: 1.2, count: 14, seed: 88, size: [0.08, 0.28], height: [0.03, 0.12] },
    },
    // Drive: four bells in a diamond.
    lf('drive-block', 'metal', [
      { z: -10.9, w: 2.4, h: 1.9, y: 0.1, c: 0.45 },
      { z: -9.8, w: 2.6, h: 2.0, y: 0.1, c: 0.5 },
    ]),
    bell('bell', [0.62, 0.1, -11.3], 0.46, 0.7, true),
    bell('bell-top', [0, 0.72, -11.25], 0.38, 0.6),
    bell('bell-low', [0, -0.52, -11.25], 0.38, 0.6),
    { name: 'nav-light', paint: 'glow', emissive: 1.5, mirror: true, pos: [0.91, TY + 1.45, TOWER_Z + 0.35], shape: { kind: 'box', w: 0.04, h: 0.08, d: 0.18 } },
  ],
  engines: [
    { pos: [0.62, 0.1, -11.7], radius: 0.4, plume: 4.5, mirror: true },
    { pos: [0, 0.72, -11.6], radius: 0.32, plume: 3.6 },
    { pos: [0, -0.52, -11.6], radius: 0.32, plume: 3.6 },
  ],
  articulations: [
    { id: 'radar', pivot: [0, TY + 3.0, TOWER_Z - 0.1], axis: [0, 1, 0], range: [0, 360], channel: 'radar', mirror: false },
  ],
  hardpoints: [
    hp('breaker', 'beam', [0, -0.1, 8.9]),
    hp('vls', 'missile', [0, arTop(-0.8) + 0.1, -0.8], { rot: [-90, 0, 0] }),
    hp('hangar', 'hangar', [0, -1.5, -2.0], { rot: [90, 0, 0] }),
    hp('bridge', 'gun', [0, TY + 1.5, TOWER_Z + 0.7]),
  ],
};
