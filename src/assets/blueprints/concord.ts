import type { Blueprint } from '../Blueprint';

/**
 * VF-27 KESTREL — MCDF variable-geometry interceptor.
 * Twin-engine, canard-delta with swing wings (sweep animated in M7).
 * ~17 m long. The workhorse of the Vanguard squadron.
 */
export const KESTREL: Blueprint = {
  id: 'vf27-kestrel',
  name: 'Kestrel',
  designation: 'VF-27',
  faction: 'concord',
  shipClass: 'interceptor',
  ramp: 'classic',
  notes:
    'Mass-produced at the Anchorage yards after the Lantern Incident. Swing wings fold for ' +
    'atmospheric entry and carrier stowage; the canopy is a single-piece crystal-lattice bubble.',
  parts: [
    // Fuselage — one continuous loft from exhaust bay to needle nose.
    {
      name: 'fuselage',
      paint: 'primary',
      group: 1,
      shape: {
        kind: 'loft',
        stations: [
          { z: -7.0, w: 2.7, wb: 2.3, h: 1.45, y: 0.0, c: 0.38 },
          { z: -2.0, w: 3.1, wb: 2.5, h: 1.75, y: 0.05, c: 0.45 },
          { z: 2.4, w: 2.2, wb: 1.7, h: 1.6, y: 0.0, c: 0.45 },
          { z: 5.4, w: 1.25, wb: 0.9, h: 1.0, y: -0.12, c: 0.3 },
          { z: 7.9, w: 0.16, h: 0.18, y: -0.3 },
        ],
      },
    },
    // Signal-orange nose band.
    {
      name: 'nose-band',
      paint: 'accent',
      shape: {
        kind: 'loft',
        stations: [
          { z: 4.0, w: 1.74, wb: 1.31, h: 1.32, y: -0.064, c: 0.42 },
          { z: 4.45, w: 1.6, wb: 1.19, h: 1.23, y: -0.082, c: 0.4 },
        ],
      },
    },
    // Dorsal spine behind the canopy (cobalt).
    {
      name: 'spine',
      paint: 'secondary',
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.6, w: 0.9, h: 0.4, y: 0.72, c: 0.15 },
          { z: -1.0, w: 1.1, h: 0.7, y: 0.85, c: 0.25 },
          { z: 1.6, w: 0.8, h: 0.5, y: 0.8, c: 0.2 },
        ],
      },
    },
    // Canopy bubble.
    {
      name: 'canopy',
      paint: 'glass',
      pos: [0, 0.78, 2.7],
      shape: { kind: 'dome', radius: 1, scale: [0.62, 0.55, 1.9], segments: 16 },
    },
    // Side intakes.
    {
      name: 'intake',
      paint: 'primary',
      mirror: true,
      shape: {
        kind: 'loft',
        stations: [
          { z: -3.2, w: 0.8, h: 1.0, x: 1.45, y: -0.2, c: 0.2 },
          { z: 1.4, w: 0.95, h: 1.05, x: 1.35, y: -0.2, c: 0.22 },
        ],
      },
    },
    {
      name: 'intake-mouth',
      paint: 'dark',
      mirror: true,
      pos: [1.36, -0.2, 1.42],
      shape: { kind: 'box', w: 0.7, h: 0.8, d: 0.1, c: 0.15 },
    },
    // Main swing wings.
    {
      name: 'wing',
      paint: 'primary',
      mirror: true,
      pos: [1.5, -0.05, 1.2],
      rot: [0, 0, -3],
      shape: { kind: 'wing', root: 6.0, tip: 1.7, span: 5.4, sweep: 4.2, thickness: 0.34, tipThickness: 0.16 },
    },
    // Cobalt wing stripe (overlay slab near the tip).
    {
      name: 'wing-stripe',
      paint: 'secondary',
      mirror: true,
      pos: [4.4, 0.02, -1.6],
      rot: [0, 0, -3],
      shape: { kind: 'wing', root: 2.7, tip: 2.1, span: 1.0, sweep: 0.75, thickness: 0.26, tipThickness: 0.2 },
    },
    // Wingtip missile rails.
    {
      name: 'tip-rail',
      paint: 'accent',
      mirror: true,
      pos: [6.85, -0.34, -3.6],
      shape: { kind: 'cylinder', rFront: 0.08, rBack: 0.19, length: 2.8, segments: 8 },
    },
    // Canards.
    {
      name: 'canard',
      paint: 'secondary',
      mirror: true,
      pos: [0.8, 0.12, 4.7],
      rot: [0, 0, 6],
      shape: { kind: 'wing', root: 1.5, tip: 0.5, span: 1.4, sweep: 1.0, thickness: 0.12 },
    },
    // Canted twin tails.
    {
      name: 'tail',
      paint: 'secondary',
      mirror: true,
      pos: [0.95, 0.55, -3.2],
      rot: [0, 0, 72],
      shape: { kind: 'wing', root: 3.3, tip: 1.2, span: 2.8, sweep: 2.4, thickness: 0.2, tipThickness: 0.12 },
    },
    {
      name: 'tail-cap',
      paint: 'accent',
      mirror: true,
      pos: [1.8, 3.2, -5.65],
      rot: [0, 0, 72],
      shape: { kind: 'wing', root: 1.25, tip: 1.0, span: 0.35, sweep: 0.2, thickness: 0.16 },
    },
    // Ventral strakes.
    {
      name: 'strake',
      paint: 'dark',
      mirror: true,
      pos: [0.8, -0.62, -4.6],
      rot: [0, 0, -120],
      shape: { kind: 'wing', root: 2.0, tip: 0.8, span: 0.9, sweep: 1.0, thickness: 0.12 },
    },
    // Engine nacelles + nozzles.
    {
      name: 'nacelle',
      paint: 'metal',
      mirror: true,
      pos: [0.78, -0.05, -6.8],
      shape: { kind: 'cylinder', rFront: 0.78, rBack: 0.7, length: 2.2, segments: 12 },
    },
    {
      name: 'nozzle',
      paint: 'dark',
      mirror: true,
      pos: [0.78, -0.05, -8.2],
      shape: { kind: 'cylinder', rFront: 0.68, rBack: 0.78, length: 0.9, segments: 12, open: true },
    },
    // Nav lights.
    { name: 'nav-light', paint: 'glow', pos: [7.0, -0.05, -3.0], shape: { kind: 'box', w: 0.14, h: 0.1, d: 0.3 }, emissive: 1.5 },
  ],
  engines: [{ pos: [0.78, -0.05, -8.55], radius: 0.6, plume: 6.5, mirror: true }],
  hardpoints: [
    { id: 'gun', pos: [0.6, -0.4, 5.6], kind: 'gun', mirror: true },
    { id: 'rail', pos: [6.85, -0.34, -2.2], kind: 'missile', mirror: true },
  ],
};
