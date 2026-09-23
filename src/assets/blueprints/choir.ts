import type { Blueprint } from '../Blueprint';

/**
 * CANTOR — Sable Choir interceptor. Forward-swept blade wings, a single
 * resonance drive, and a crystal "eye" that broadcasts the Choir's hymn on
 * every open channel. ~15 m.
 */
export const CANTOR: Blueprint = {
  id: 'choir-cantor',
  name: 'Cantor',
  designation: 'SC-4',
  faction: 'choir',
  shipClass: 'interceptor',
  ramp: 'triple',
  notes: 'Pilots are said to hum in unison with the drive. Nobody who has heard it close up wants to again.',
  parts: [
    {
      name: 'spine',
      paint: 'primary',
      group: 1,
      shape: {
        kind: 'loft',
        stations: [
          { z: -6.0, w: 0.9, h: 1.0, c: 0.4 },
          { z: -1.2, w: 1.7, h: 1.5, y: 0.1, c: 0.7 },
          { z: 3.0, w: 1.1, h: 1.0, y: 0.05, c: 0.5 },
          { z: 7.5, w: 0.06, h: 0.35, y: -0.1 },
        ],
      },
    },
    {
      name: 'collar',
      paint: 'accent',
      emissive: 0.35,
      shape: {
        kind: 'loft',
        stations: [
          { z: -0.4, w: 1.72, h: 1.52, y: 0.1, c: 0.7 },
          { z: 0.1, w: 1.66, h: 1.46, y: 0.09, c: 0.68 },
        ],
      },
    },
    {
      name: 'eye',
      paint: 'glass',
      emissive: 0.9,
      pos: [0, 0.48, 3.0],
      shape: { kind: 'dome', radius: 1, scale: [0.35, 0.3, 1.2], segments: 12 },
    },
    {
      name: 'blade',
      paint: 'secondary',
      mirror: true,
      pos: [0.55, -0.1, -3.4],
      rot: [0, 0, -14],
      shape: { kind: 'wing', root: 4.4, tip: 2.0, span: 6.0, sweep: -3.6, thickness: 0.3, tipThickness: 0.1, bevel: 1 },
    },
    {
      name: 'blade-edge',
      paint: 'accent',
      emissive: 0.55,
      mirror: true,
      pos: [0.6, -0.12, -3.3],
      rot: [0, 0, -14],
      shape: { kind: 'wing', root: 0.5, tip: 0.35, span: 5.9, sweep: -3.45, thickness: 0.2, tipThickness: 0.08, bevel: 1 },
    },
    {
      name: 'tip-crystal',
      paint: 'glass',
      emissive: 0.7,
      mirror: true,
      pos: [6.3, 1.1, 0.8],
      rot: [0, 0, 80],
      shape: { kind: 'wing', root: 2.2, tip: 0.2, span: 2.0, sweep: 1.9, thickness: 0.18, bevel: 1 },
    },
    {
      name: 'dorsal-blade',
      paint: 'primary',
      pos: [0, 0.7, -0.5],
      rot: [0, 0, 90],
      shape: { kind: 'wing', root: 4.5, tip: 0.7, span: 2.4, sweep: 3.6, thickness: 0.22, bevel: 1 },
    },
    {
      name: 'ventral-blade',
      paint: 'secondary',
      pos: [0, -0.6, -1.5],
      rot: [0, 0, -90],
      shape: { kind: 'wing', root: 3.0, tip: 0.6, span: 1.4, sweep: 2.2, thickness: 0.2, bevel: 1 },
    },
    {
      name: 'drive',
      paint: 'metal',
      pos: [0, 0, -6.4],
      shape: { kind: 'cylinder', rFront: 0.55, rBack: 0.72, length: 1.4, segments: 6 },
    },
    {
      name: 'drive-ring',
      paint: 'accent',
      emissive: 0.4,
      pos: [0, 0, -7.0],
      shape: { kind: 'torus', radius: 0.95, tube: 0.12, segments: 6, tubeSegments: 4 },
    },
  ],
  engines: [{ pos: [0, 0, -7.2], radius: 0.55, plume: 5.5 }],
  hardpoints: [{ id: 'lance', pos: [0, -0.2, 7.0], kind: 'beam' }],
};

/**
 * CATHEDRAL — Sable Choir dreadnought, 2.6 km. Modelled at 1:100 and scaled.
 * Spires are resonance towers; the prow "rose window" is the main lance.
 */
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
    {
      name: 'nave',
      paint: 'primary',
      group: 1,
      shape: {
        kind: 'loft',
        stations: [
          { z: -12.0, w: 3.0, wb: 2.4, h: 3.2, c: 0.9 },
          { z: -4.0, w: 4.2, wb: 3.0, h: 3.8, y: 0.2, c: 1.2 },
          { z: 5.0, w: 3.4, wb: 2.2, h: 3.0, y: 0.0, c: 1.0 },
          { z: 11.0, w: 1.6, wb: 0.8, h: 1.8, y: -0.4, c: 0.5 },
          { z: 14.0, w: 0.2, h: 0.4, y: -0.6 },
        ],
      },
    },
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
    // Resonance spires (lofted along Z then stood upright).
    ...[
      { z: -6.5, hgt: 6.5, w: 1.3 },
      { z: -2.0, hgt: 8.5, w: 1.6 },
      { z: 2.5, hgt: 5.0, w: 1.1 },
    ].map((s, i) => ({
      name: `spire-${i}`,
      paint: 'primary' as const,
      pos: [0, 1.6, s.z] as [number, number, number],
      rot: [-90, 0, 0] as [number, number, number],
      shape: {
        kind: 'loft' as const,
        stations: [
          { z: 0, w: s.w, h: s.w * 1.4, c: s.w * 0.35 },
          { z: s.hgt * 0.7, w: s.w * 0.7, h: s.w, c: s.w * 0.3 },
          { z: s.hgt, w: 0.05, h: 0.05 },
        ],
      },
    })),
    ...[-6.5, -2.0, 2.5].map((z, i) => ({
      name: `spire-glow-${i}`,
      paint: 'glass' as const,
      emissive: 1.2,
      pos: [0, 3.2 + i * 0.3, z] as [number, number, number],
      shape: { kind: 'box' as const, w: 1.0, h: 0.25, d: 1.45 - i * 0.2, c: 0.1 },
    })),
    // Flying buttresses.
    {
      name: 'buttress',
      paint: 'secondary',
      mirror: true,
      pos: [1.8, 0.4, 3.0],
      rot: [0, 0, 28],
      shape: { kind: 'wing', root: 7.0, tip: 2.0, span: 4.0, sweep: 5.0, thickness: 0.5, bevel: 1 },
    },
    {
      name: 'buttress-low',
      paint: 'secondary',
      mirror: true,
      pos: [1.3, -1.4, 0.0],
      rot: [0, 0, -32],
      shape: { kind: 'wing', root: 6.0, tip: 1.4, span: 3.0, sweep: 4.4, thickness: 0.45, bevel: 1 },
    },
    // Hangar galleries.
    {
      name: 'gallery',
      paint: 'dark',
      mirror: true,
      pos: [1.95, -0.2, -2.0],
      shape: { kind: 'box', w: 0.3, h: 0.9, d: 6.0, c: 0.1 },
    },
    {
      name: 'gallery-lights',
      paint: 'accent',
      emissive: 0.9,
      mirror: true,
      pos: [2.08, 0.1, -2.0],
      shape: { kind: 'box', w: 0.08, h: 0.1, d: 5.6 },
    },
    // Rose window / main lance aperture.
    {
      name: 'rose-window',
      paint: 'glass',
      emissive: 1.0,
      pos: [0, -0.35, 10.9],
      rot: [0, 0, 0],
      shape: { kind: 'torus', radius: 0.55, tube: 0.14, segments: 12, tubeSegments: 4 },
    },
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
    { id: 'lance', pos: [0, -0.35, 11.2], kind: 'beam' },
    { id: 'turret-a', pos: [1.6, 1.6, 6.0], kind: 'turret', mirror: true },
    { id: 'turret-b', pos: [1.9, 1.3, -8.0], kind: 'turret', mirror: true },
    { id: 'hangar', pos: [2.1, -0.2, -2.0], kind: 'hangar', mirror: true },
  ],
};
