import type { Blueprint, Station } from '../Blueprint';
import { band, flipX, wingPoint, wingSlice, type WingSpec } from './kit';

const SJ_BODY: Station[] = [
  { z: -5.6, w: 2.0, h: 1.5, y: 0.0, c: 0.2 },
  { z: -2.0, w: 2.5, h: 1.9, y: 0.1, c: 0.25 },
  { z: 2.5, w: 2.4, h: 1.9, y: 0.05, c: 0.25 },
  { z: 5.0, w: 1.6, h: 1.3, y: -0.1, c: 0.2 },
  { z: 6.6, w: 0.95, h: 0.75, y: -0.25, c: 0.15 },
];

/** Starboard: a Kestrel outer wing pulled off a wreck, still in MCDF ivory. */
const SJ_WING_R: WingSpec = {
  pos: [1.1, -0.3, 1.9],
  rot: [0, 0, -4],
  root: 5.2,
  tip: 1.6,
  span: 5.6,
  sweep: 4.0,
  thickness: 0.34,
  tipThickness: 0.16,
};

/** Port: a Choir blade, forward-swept, bolted on with a mirrored mount. */
const SJ_BLADE: WingSpec = {
  pos: [1.1, 0.0, -1.5],
  rot: [0, 0, -9],
  root: 4.2,
  tip: 1.7,
  span: 5.2,
  sweep: -3.0,
  thickness: 0.3,
  tipThickness: 0.1,
  bevel: 1,
};

/**
 * "SCRAPJACK" — Rustwake mercenary fighter. Deliberately asymmetric: every
 * one is different, built around a hauler cab with whatever wings, engines
 * and guns the salvage crews could bolt on. Wrecked parts keep the livery of
 * the side they were pulled from (`Part.livery`).
 */
export const SCRAPJACK: Blueprint = {
  id: 'rw-scrapjack',
  name: 'Scrapjack',
  designation: 'RW-M "Scrapjack"',
  faction: 'rustwake',
  shipClass: 'interceptor',
  ramp: 'classic',
  notes:
    'No two are alike. This one flies with a Concord wing, a Choir blade and an engine that used to belong to an ore tug.',
  parts: [
    { name: 'body', paint: 'primary', group: 1, shape: { kind: 'loft', stations: SJ_BODY } },
    {
      name: 'nose-cap',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: 6.6, w: 0.95, h: 0.75, y: -0.25, c: 0.15 },
          { z: 7.5, w: 0.5, h: 0.4, y: -0.3, c: 0.1 },
        ],
      },
    },
    { name: 'rear-band', paint: 'secondary', shape: band(SJ_BODY, -4.4, -3.2, 0.03) },
    // Hazard-striped bumper with diagonal slats.
    { name: 'bumper', paint: 'accent', pos: [0, -0.5, 5.35], rot: [-8, 0, 0], shape: { kind: 'box', w: 1.9, h: 0.46, d: 0.3, c: 0.06 } },
    {
      name: 'hazard',
      paint: 'dark',
      pos: [-0.66, -0.5, 5.44],
      rot: [-8, 0, 40],
      repeat: { count: 4, step: [0.44, 0, 0] },
      shape: { kind: 'box', w: 0.13, h: 0.5, d: 0.3 },
    },
    // Hauler cab with flat green glazing and cage frames.
    {
      name: 'cab',
      paint: 'glass',
      shape: {
        kind: 'loft',
        stations: [
          { z: 0.4, w: 1.5, h: 0.9, y: 1.15, c: 0.12 },
          { z: 3.0, w: 1.45, h: 0.85, y: 1.12, c: 0.12 },
          { z: 3.9, w: 1.1, h: 0.36, y: 0.9, c: 0.08 },
        ],
      },
    },
    {
      name: 'cab-frame',
      paint: 'dark',
      pos: [0, 0.82, 1.4],
      repeat: { count: 2, step: [0, 0, 1.2] },
      scale: [1.45, 1.1, 1],
      shape: { kind: 'rib', radius: 0.52, thickness: 0.08, depth: 0.14, arc: 180, segments: 6 },
    },
    { name: 'cab-roof', paint: 'secondary', pos: [0.05, 1.62, 1.4], rot: [0, 3, 0], shape: { kind: 'box', w: 1.2, h: 0.08, d: 1.8, c: 0.03 } },
    // ── starboard: salvaged Concord wing ──
    { name: 'wing-concord', paint: 'primary', livery: 'concord', ...wingSlice(SJ_WING_R, 0, 5.6) },
    { name: 'wing-concord-stripe', paint: 'secondary', livery: 'concord', ...wingSlice(SJ_WING_R, 3.4, 4.2, 0.05) },
    { name: 'wing-weld', paint: 'metal', ...wingSlice(SJ_WING_R, 0.1, 0.9, 0.12) },
    {
      name: 'tip-rail',
      paint: 'accent',
      livery: 'concord',
      pos: wingPoint(SJ_WING_R, 5.65, 0.5, -0.12),
      shape: { kind: 'cylinder', rFront: 0.08, rBack: 0.18, length: 2.4, segments: 8 },
    },
    { name: 'nav-concord', paint: 'glow', livery: 'concord', emissive: 1.5, pos: wingPoint(SJ_WING_R, 5.7, 0.2, 0.15), shape: { kind: 'box', w: 0.14, h: 0.1, d: 0.3 } },
    {
      name: 'fuel-tank',
      paint: 'secondary',
      pos: wingPoint(SJ_WING_R, 2.6, 0.45, -0.75),
      shape: {
        kind: 'lathe',
        segments: 10,
        profile: [
          [0, -1.9],
          [0.28, -1.7],
          [0.42, -1.0],
          [0.42, 1.0],
          [0.3, 1.65],
          [0, 1.95],
        ],
      },
    },
    { name: 'tank-pylon', paint: 'dark', pos: wingPoint(SJ_WING_R, 2.6, 0.45, -0.3), shape: { kind: 'box', w: 0.14, h: 0.4, d: 1.4 } },
    // ── port: salvaged Choir blade (authored on +X, flipped) ──
    { name: 'blade-choir', paint: 'primary', livery: 'choir', ...flipX(wingSlice(SJ_BLADE, 0, 5.2)) },
    { name: 'blade-edge', paint: 'accent', livery: 'choir', emissive: 0.3, ...flipX(wingSlice(SJ_BLADE, 0.3, 5.1, 0.05, 0, 0.14)) },
    { name: 'blade-crystal', paint: 'glass', livery: 'choir', emissive: 0.5, ...flipX(wingSlice(SJ_BLADE, 4.7, 5.2, 0.08)) },
    { name: 'blade-clamp', paint: 'metal', pos: [-1.35, 0.0, -2.9], shape: { kind: 'box', w: 0.7, h: 0.55, d: 2.4, c: 0.08 } },
    // Rocket pod slung under the blade.
    { name: 'rocket-pod', paint: 'secondary', pos: [-2.7, -0.75, -2.6], shape: { kind: 'box', w: 0.9, h: 0.75, d: 2.3, c: 0.1 } },
    { name: 'rocket-pod-band', paint: 'accent', pos: [-2.7, -0.75, -1.7], shape: { kind: 'box', w: 0.94, h: 0.79, d: 0.3, c: 0.1 } },
    {
      name: 'rocket-tubes',
      paint: 'dark',
      pos: [-2.88, -0.93, -1.42],
      repeat: { count: 2, step: [0.36, 0, 0] },
      shape: { kind: 'cylinder', rFront: 0.13, rBack: 0.13, length: 0.1, segments: 6 },
    },
    {
      name: 'rocket-tubes-top',
      paint: 'dark',
      pos: [-2.88, -0.57, -1.42],
      repeat: { count: 2, step: [0.36, 0, 0] },
      shape: { kind: 'cylinder', rFront: 0.13, rBack: 0.13, length: 0.1, segments: 6 },
    },
    { name: 'rocket-pylon', paint: 'metal', pos: [-2.7, -0.3, -2.8], shape: { kind: 'box', w: 0.16, h: 0.4, d: 1.4 } },
    // ── mismatched engines ──
    {
      name: 'engine-big',
      paint: 'metal',
      pos: [1.05, 0.1, -6.1],
      shape: { kind: 'cylinder', rFront: 0.95, rBack: 0.88, length: 3.4, segments: 8 },
    },
    { name: 'engine-big-band', paint: 'accent', pos: [1.05, 0.1, -5.2], shape: { kind: 'cylinder', rFront: 0.99, rBack: 0.99, length: 0.35, segments: 8 } },
    {
      name: 'engine-big-nozzle',
      paint: 'dark',
      pos: [1.05, 0.1, -8.1],
      shape: { kind: 'cylinder', rFront: 0.8, rBack: 0.92, length: 0.8, segments: 8, open: true },
    },
    {
      name: 'engine-small',
      paint: 'secondary',
      pos: [-0.95, -0.3, -5.9],
      shape: { kind: 'cylinder', rFront: 0.62, rBack: 0.56, length: 2.6, segments: 12 },
    },
    {
      name: 'engine-small-nozzle',
      paint: 'dark',
      pos: [-0.95, -0.3, -7.45],
      shape: { kind: 'cylinder', rFront: 0.5, rBack: 0.58, length: 0.6, segments: 12, open: true },
    },
    { name: 'strap', paint: 'dark', pos: [0.05, -0.1, -5.6], repeat: { count: 2, step: [0, 0, -1.1] }, shape: { kind: 'box', w: 3.2, h: 0.1, d: 0.2 } },
    // Tail fins: an olive fin and a stolen Choir ventral blade.
    {
      name: 'fin',
      paint: 'secondary',
      pos: [0.5, 0.85, -3.3],
      rot: [0, 0, 84],
      shape: { kind: 'wing', root: 3.2, tip: 1.1, span: 2.6, sweep: 2.3, thickness: 0.2, tipThickness: 0.12 },
    },
    { name: 'fin-cap', paint: 'accent', pos: [0.23, 3.43, -5.6], rot: [0, 0, 84], shape: { kind: 'wing', root: 1.2, tip: 1.0, span: 0.3, sweep: 0.2, thickness: 0.16 } },
    {
      name: 'ventral-blade',
      paint: 'secondary',
      livery: 'choir',
      pos: [-0.55, -0.7, -3.6],
      rot: [0, 0, -118],
      shape: { kind: 'wing', root: 2.4, tip: 0.6, span: 1.5, sweep: 1.7, thickness: 0.18, bevel: 1 },
    },
    // Bolt-on patches and machinery.
    { name: 'patch-a', paint: 'metal', pos: [1.24, 0.15, -1.4], rot: [0, 0, 4], shape: { kind: 'box', w: 0.08, h: 0.9, d: 1.6, c: 0.02 } },
    { name: 'patch-b', paint: 'secondary', pos: [-1.24, -0.25, 0.9], rot: [8, 0, 0], shape: { kind: 'box', w: 0.08, h: 0.7, d: 1.2, c: 0.02 } },
    { name: 'patch-c', paint: 'metal', pos: [0.45, 1.0, -2.4], rot: [0, 7, 0], shape: { kind: 'box', w: 0.9, h: 0.07, d: 1.3, c: 0.02 } },
    { name: 'patch-d', paint: 'accent', pos: [-0.8, 0.72, 3.4], rot: [0, -10, -30], shape: { kind: 'box', w: 0.5, h: 0.07, d: 0.7, c: 0.02 } },
    {
      name: 'machinery',
      paint: 'dark',
      trim: 'metal',
      pos: [-0.2, 1.0, -4.0],
      rot: [-5, 0, 0],
      shape: { kind: 'greeble', w: 1.2, d: 2.4, count: 10, seed: 42, size: [0.15, 0.45], height: [0.06, 0.22] },
    },
    // Nose cannon + salvage claw.
    { name: 'gun-housing', paint: 'dark', pos: [0.78, -0.5, 5.0], shape: { kind: 'box', w: 0.45, h: 0.45, d: 1.6, c: 0.08 } },
    { name: 'gun-barrel', paint: 'metal', pos: [0.78, -0.5, 6.9], shape: { kind: 'cylinder', rFront: 0.09, rBack: 0.12, length: 2.6, segments: 8 } },
    { name: 'gun-muzzle', paint: 'dark', pos: [0.78, -0.5, 8.2], shape: { kind: 'cylinder', rFront: 0.16, rBack: 0.16, length: 0.3, segments: 8 } },
    { name: 'claw-arm', paint: 'metal', mirror: true, pos: [0.42, -1.05, 4.6], rot: [18, 0, 0], shape: { kind: 'box', w: 0.2, h: 0.22, d: 2.0, c: 0.05 } },
    { name: 'claw-tip', paint: 'accent', mirror: true, pos: [0.42, -1.5, 5.75], rot: [-35, 0, 0], shape: { kind: 'box', w: 0.22, h: 0.7, d: 0.2, c: 0.05 } },
    // Antenna whip.
    { name: 'antenna', paint: 'metal', pos: [-0.55, 1.6, -2.0], rot: [-90, 0, 0], shape: { kind: 'cylinder', rFront: 0.02, rBack: 0.06, length: 1.6, segments: 5 } },
    { name: 'antenna-tip', paint: 'glow', emissive: 1.4, pos: [-0.55, 2.42, -2.0], shape: { kind: 'dome', radius: 0.09, segments: 6 } },
  ],
  engines: [
    { pos: [1.05, 0.1, -8.55], radius: 0.74, plume: 7.0 },
    { pos: [-0.95, -0.3, -7.8], radius: 0.46, plume: 4.2 },
  ],
  hardpoints: [
    { id: 'gun', pos: [0.78, -0.5, 8.3], kind: 'gun' },
    { id: 'rockets', pos: [-2.7, -0.75, -1.4], kind: 'missile' },
    { id: 'claw', pos: [0, -1.5, 6.0], kind: 'gun' },
  ],
};
