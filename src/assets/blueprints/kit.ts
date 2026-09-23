import { Euler, MathUtils, Vector3 } from 'three';
import type { Part, Shape, Station, Vec3 } from '../Blueprint';

/**
 * Design helpers for authoring blueprints. Pure data transforms — they return
 * plain Part fragments, so blueprints stay serialisable data.
 */

export interface WingSpec {
  pos: Vec3;
  rot?: Vec3;
  root: number;
  tip: number;
  span: number;
  sweep: number;
  thickness: number;
  tipThickness?: number;
  bevel?: number;
}

const chordAt = (w: WingSpec, s: number) => w.root + ((w.tip - w.root) * s) / w.span;
const leAt = (w: WingSpec, s: number) => (w.sweep * s) / w.span;
const thickAt = (w: WingSpec, s: number) => {
  const tt = w.tipThickness ?? w.thickness * 0.6;
  return w.thickness + ((tt - w.thickness) * s) / w.span;
};

/** A point on a wing: span station `s` (m), chord fraction `f` (0 = LE, 1 = TE), offset `dy` normal to the wing. */
export function wingPoint(w: WingSpec, s: number, f = 0, dy = 0): Vec3 {
  const local = new Vector3(s, dy, -(leAt(w, s) + f * chordAt(w, s)));
  const r = w.rot ?? [0, 0, 0];
  local.applyEuler(new Euler(MathUtils.degToRad(r[0]), MathUtils.degToRad(r[1]), MathUtils.degToRad(r[2]), 'XYZ'));
  return [w.pos[0] + local.x, w.pos[1] + local.y, w.pos[2] + local.z];
}

/** The wing as a single shape. */
export function wingShape(w: WingSpec): Pick<Part, 'pos' | 'rot' | 'shape'> {
  return {
    pos: w.pos,
    rot: w.rot,
    shape: { kind: 'wing', root: w.root, tip: w.tip, span: w.span, sweep: w.sweep, thickness: w.thickness, tipThickness: w.tipThickness, bevel: w.bevel },
  };
}

/**
 * A panel of a wing: spanwise [s0, s1] (m) × chordwise [f0, f1] (0 = LE,
 * 1 = TE), sitting exactly where it lies on the full planform. `grow`
 * thickens it (for paint overlays like stripes, flaps and tip caps).
 */
export function wingSlice(w: WingSpec, s0: number, s1: number, grow = 0, f0 = 0, f1 = 1): Pick<Part, 'pos' | 'rot' | 'shape'> {
  const e = grow * 0.3; // nudge overlay edges out so they never z-fight
  const lead = (s: number) => leAt(w, s) + f0 * chordAt(w, s);
  const chord = (s: number) => (f1 - f0) * chordAt(w, s);
  const e0 = f0 > 0 ? 0 : e;
  const e1 = f1 < 1 ? 0 : e;
  return {
    pos: wingPoint(w, s0, f0 - e0 / chordAt(w, s0)),
    rot: w.rot,
    shape: {
      kind: 'wing',
      root: chord(s0) + e0 + e1,
      tip: chord(s1) + e0 + e1,
      span: s1 - s0,
      sweep: lead(s1) - lead(s0),
      thickness: thickAt(w, s0) + grow,
      tipThickness: thickAt(w, s1) + grow,
      bevel: w.bevel,
    },
  };
}

/** Linear interpolation of a loft section at `z`. */
export function sectionAt(stations: Station[], z: number): Station {
  const st = [...stations].sort((a, b) => a.z - b.z);
  if (z <= st[0].z) return { ...st[0], z };
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const l = (p: number, q: number) => p + (q - p) * t;
      return {
        z,
        w: l(a.w, b.w),
        wb: l(a.wb ?? a.w, b.wb ?? b.w),
        h: l(a.h, b.h),
        x: l(a.x ?? 0, b.x ?? 0),
        y: l(a.y ?? 0, b.y ?? 0),
        c: l(a.c ?? 0, b.c ?? 0),
      };
    }
  }
  return { ...st[st.length - 1], z };
}

/**
 * A paint band wrapped around a loft between z0 and z1 — slightly inflated so
 * it sits proud of the hull (ID stripes, armour collars, nose bands).
 */
export function band(stations: Station[], z0: number, z1: number, grow = 0.02): Shape {
  const inner = stations.filter((s) => s.z > z0 && s.z < z1).map((s) => s.z);
  const zs = [z0, ...inner, z1];
  return {
    kind: 'loft',
    stations: zs.map((z) => {
      const s = sectionAt(stations, z);
      return { ...s, w: s.w + grow * 2, wb: (s.wb ?? s.w) + grow * 2, h: s.h + grow * 2, c: (s.c ?? 0) + grow * 0.5 };
    }),
  };
}

/** Top-surface height of a loft at (z), ignoring chamfer. */
export function topAt(stations: Station[], z: number): number {
  const s = sectionAt(stations, z);
  return (s.y ?? 0) + s.h / 2;
}

/** Half-width of a loft at z, measured at its vertical centre. */
export function halfWidthAt(stations: Station[], z: number): number {
  const s = sectionAt(stations, z);
  return (s.w + (s.wb ?? s.w)) / 4;
}

/** Evenly spaced values. */
export function range(from: number, to: number, count: number): number[] {
  if (count <= 1) return [from];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

/**
 * Mirror a part fragment to the other side of the ship (exact reflection
 * across X = 0) — for asymmetric designs where only one side gets the part.
 */
export function flipX<T extends Pick<Part, 'pos' | 'rot' | 'scale'>>(p: T): T {
  const pos = p.pos ?? [0, 0, 0];
  const rot = p.rot ?? [0, 0, 0];
  const s = p.scale ?? [1, 1, 1];
  return { ...p, pos: [-pos[0], pos[1], pos[2]], rot: [rot[0], -rot[1], -rot[2]], scale: [-s[0], s[1], s[2]] };
}

export interface RibOptions {
  thickness: number;
  depth: number;
  /** Clearance above the hull surface. */
  grow?: number;
  /** Degrees swept from `start` (default: wraps from just below the waterline on one side to the other). */
  arc?: number;
  start?: number;
  segments?: number;
  c?: number;
}

/**
 * Arched ribs that wrap a loft's upper half at each z in `zs` — the rib
 * radius and aspect follow the hull section there, so they hug the plating.
 */
export function ribsAlong(stations: Station[], zs: number[], o: RibOptions): Pick<Part, 'pos' | 'scale' | 'shape'>[] {
  return zs.map((z) => {
    const s = sectionAt(stations, z);
    const g = o.grow ?? 0;
    const halfW = Math.max(s.w, s.wb ?? s.w) / 2 + g + o.thickness / 2;
    const halfH = s.h / 2 + g + o.thickness / 2;
    return {
      pos: [s.x ?? 0, s.y ?? 0, z],
      scale: [halfW / halfH, 1, 1],
      shape: {
        kind: 'rib',
        radius: halfH,
        thickness: o.thickness,
        depth: o.depth,
        arc: o.arc ?? 220,
        start: o.start ?? -20,
        segments: o.segments ?? 12,
        c: o.c,
      },
    };
  });
}

/** Where the upper chamfer of a loft section passes a given |x| (for seating parts on shoulders). */
export function shoulderY(stations: Station[], z: number, x: number): number {
  const s = sectionAt(stations, z);
  const top = (s.y ?? 0) + s.h / 2;
  const c = Math.min(s.c ?? 0, s.w / 2, s.h / 2);
  const flat = s.w / 2 - c;
  const ax = Math.abs(x);
  if (ax <= flat) return top;
  return top - Math.min(ax - flat, c);
}

/** X of a loft's right-hand side at height y (for seating belts, sponsons and windows on sloped sides). */
export function sideX(stations: Station[], z: number, y: number): number {
  const s = sectionAt(stations, z);
  const w = s.w / 2;
  const wb = (s.wb ?? s.w) / 2;
  const h = s.h / 2;
  const c = Math.min(s.c ?? 0, w, wb, h);
  const cy = s.y ?? 0;
  const pts: [number, number][] = [
    [wb - c, -h],
    [wb, -h + c],
    [w, h - c],
    [w - c, h],
  ];
  const ly = MathUtils.clamp(y - cy, -h, h);
  for (let i = 0; i < 3; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (ly >= y0 && ly <= y1 && y1 > y0) return (s.x ?? 0) + x0 + ((x1 - x0) * (ly - y0)) / (y1 - y0);
  }
  return (s.x ?? 0) + w;
}
