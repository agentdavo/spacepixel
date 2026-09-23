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
