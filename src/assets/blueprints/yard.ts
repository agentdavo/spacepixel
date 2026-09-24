import type { Hardpoint, Paint, Part, Station, TurretRigDef, Vec3 } from '../Blueprint';
import { band } from './kit';

/**
 * Shipwright's helpers for the shipyard designs (progression line, Rustwake
 * clans, civilian traffic, mid-tier warships). Terse constructors that
 * return plain Part data, so the blueprints stay serialisable and every
 * design goes through the same hull kit → ShipBuilder → cel + ink path.
 */

type Extra = Partial<Omit<Part, 'shape' | 'paint' | 'name'>>;

/** Chamfered box. */
export const bx = (name: string, paint: Paint, pos: Vec3, size: Vec3, c = 0, extra: Extra = {}): Part => ({
  name,
  paint,
  pos,
  shape: { kind: 'box', w: size[0], h: size[1], d: size[2], c },
  ...extra,
});

/** Cylinder along Z (front radius, back radius). */
export const cyl = (name: string, paint: Paint, pos: Vec3, rFront: number, rBack: number, length: number, extra: Extra & { segments?: number; open?: boolean } = {}): Part => {
  const { segments, open, ...rest } = extra;
  return { name, paint, pos, shape: { kind: 'cylinder', rFront, rBack, length, segments: segments ?? 12, open }, ...rest };
};

/** Loft from stations. */
export const lf = (name: string, paint: Paint, stations: Station[], extra: Extra = {}): Part => ({
  name,
  paint,
  shape: { kind: 'loft', stations },
  ...extra,
});

/** Upright cylinder standing on `pos` — masts, barbettes, stacks. */
export function post(name: string, paint: Paint, pos: Vec3, rBottom: number, rTop: number, height: number, segments = 8, extra: Extra = {}): Part {
  return {
    name,
    paint,
    pos: [pos[0], pos[1] + height / 2, pos[2]],
    rot: [-90, 0, 0],
    shape: { kind: 'cylinder', rFront: rTop, rBack: rBottom, length: height, segments },
    ...extra,
  };
}

/** Engine bell: open cylinder facing aft. */
export function bell(name: string, pos: Vec3, r: number, length: number, mirror = false, segments = 12): Part {
  return { name, paint: 'dark', mirror, pos, shape: { kind: 'cylinder', rFront: r * 0.84, rBack: r, length, segments, open: true } };
}

/** A lit window row: `count` small glass boxes stepping along `step`. */
export function windows(name: string, pos: Vec3, count: number, step: Vec3, size: Vec3, extra: Extra = {}): Part {
  return {
    name,
    paint: 'glass',
    emissive: 0.8,
    pos,
    repeat: { count, step },
    shape: { kind: 'box', w: size[0], h: size[1], d: size[2] },
    ...extra,
  };
}

/** A crystal: a diamond-section loft along Z (Hegemony shipwrighting). */
export function crystal(len: number, girth: number, at = 0.3): Station[] {
  return [
    { z: -len * at, w: girth * 0.1, h: girth * 0.1, c: girth * 0.05 },
    { z: 0, w: girth, h: girth, c: girth / 2 },
    { z: len * (1 - at) * 0.55, w: girth * 0.85, h: girth * 0.85, c: girth * 0.425 },
    { z: len * (1 - at), w: 0.02, h: 0.02 },
  ];
}

/** Missile / torpedo body along Z, centred on its origin. */
export function missile(len: number, r: number): Part['shape'] {
  return {
    kind: 'lathe',
    segments: 8,
    profile: [
      [0, -len / 2],
      [r, -len / 2 + len * 0.05],
      [r, len * 0.3],
      [r * 0.6, len * 0.43],
      [0, len / 2],
    ],
  };
}

export interface TurretOpts {
  radius: number;
  height: number;
  barrels?: number;
  barrelLength: number;
  barrelRadius?: number;
  housing?: Vec3;
  /** Yaw of the rest pose in degrees (180 = aft-facing). */
  yaw?: number;
  /** Mounted upside down under the hull. */
  ventral?: boolean;
  /** Roll of the mount in degrees (a turret on a sloped shoulder or a hull side). */
  tilt?: number;
  paint?: Paint;
  trim?: Paint;
  mirror?: boolean;
  /**
   * Traverse limits in degrees relative to the rest yaw, + toward the part's
   * own +X (outboard on a starboard mount; mirrored copies mirror it).
   * Default all round. Keep it off the ship's own superstructure.
   */
  traverse?: [number, number];
  /** Elevation limits above the mount plane, degrees (default −8…80). */
  elevation?: [number, number];
}

/**
 * A gun turret with a turret socket at its base. The builder rigs it
 * (ShipBuilder `TurretRigInfo`): the base and housing train on a traverse
 * joint named `id`, the mantlet and barrels elevate on `${id}/el` about the
 * trunnion, within `traverse` / `elevation`.
 */
export function turret(id: string, pos: Vec3, o: TurretOpts): Part {
  const yaw = o.yaw ?? 0;
  const roll = (o.ventral ? 180 : 0) + (o.tilt ?? 0);
  const rig: TurretRigDef = {};
  if (o.traverse) rig.traverse = o.traverse;
  if (o.elevation) rig.elevation = o.elevation;
  return {
    name: id,
    paint: o.paint ?? 'primary',
    trim: o.trim ?? 'metal',
    pos,
    rot: [0, yaw, roll],
    mirror: o.mirror,
    socket: { id, kind: 'turret' },
    rig,
    shape: {
      kind: 'turret',
      radius: o.radius,
      height: o.height,
      barrels: o.barrels ?? 2,
      barrelLength: o.barrelLength,
      barrelRadius: o.barrelRadius,
      housing: o.housing,
    },
  };
}

/** Hardpoint shorthand. */
export const hp = (id: string, kind: Hardpoint['kind'], pos: Vec3, extra: Partial<Hardpoint> = {}): Hardpoint => ({ id, kind, pos, ...extra });

/** Hazard chevrons: `count` dark slats across a band, tilted 40°. */
export function hazard(name: string, pos: Vec3, count: number, pitch: number, size: Vec3, extra: Extra = {}): Part {
  return {
    name,
    paint: 'dark',
    pos,
    rot: [0, 0, 40],
    repeat: { count, step: [pitch, 0, 0] },
    shape: { kind: 'box', w: size[0], h: size[1], d: size[2] },
    ...extra,
  };
}

/** A paint band wrapped around a loft between z0 and z1 (see kit `band`). */
export const bd = (name: string, paint: Paint, stations: Station[], z0: number, z1: number, grow = 0.02, extra: Extra = {}): Part => ({
  name,
  paint,
  shape: band(stations, z0, z1, grow),
  ...extra,
});
