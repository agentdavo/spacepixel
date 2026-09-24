import type { Articulation, Part, Vec3 } from '../Blueprint';
import type { StationKind } from '@/game/economy';

/**
 * Berths for big hulls on every station (docking for every hull size),
 * modelled in station units (1 = 100 m) like the rest of stations.ts.
 *
 *  - Two CLAMP GANTRIES for gunships and corvettes (40–200 m): a lattice
 *    boom out of the hub collar to a tower, and a swing arm on its own joint
 *    (`clamp-0`, `clamp-1`) that lies stowed along the boom's tower, then
 *    swings out square to clamp the hull's flank. The ship lies alongside,
 *    parallel to the docking axis, nose out.
 *  - One MOORING PYLON for frigates (> 200 m): a long lattice mast past the
 *    habitat ring with a bollard and beacon at the tip; the frigate holds
 *    station off its end on a lit tether while a lighter ferries the crew.
 *
 * Everything sits forward of the ring plane (z ≈ +3 units, the ring spins at
 * z = −1.5), so no berth ever sweeps the ring. Orbital ports carry their
 * gantries on ±Y (their vanes own ±X) and the pylon on +X; every other kind
 * has gantries on ±X and the pylon on −Y.
 */
export interface GantrySpec {
  /** Articulation id and channel (`clamp-<i>`). */
  id: string;
  /** Radial direction in the station's XY plane (unit). */
  dir: [number, number];
  /** Station-z of the boom and arm (units). */
  z: number;
  /** Tower radius from the axis, and the arm's length (units). */
  towerR: number;
  armLen: number;
}

export interface MooringSpec {
  dir: [number, number];
  z: number;
  /** Bollard radius from the axis (units). */
  tipR: number;
}

export interface BerthLayout {
  clamps: GantrySpec[];
  mooring: MooringSpec;
}

const Z = 3.0;
const TOWER_R = 3.6;
const ARM = 0.9;
const MAST_R = 7.6;

export function berthLayout(kind: Exclude<StationKind, 'carrier' | 'surface'>): BerthLayout {
  const clampDirs: [number, number][] = kind === 'orbital' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
  return {
    clamps: clampDirs.map((dir, i) => ({ id: `clamp-${i}`, dir, z: Z, towerR: TOWER_R, armLen: ARM })),
    mooring: { dir: kind === 'orbital' ? [1, 0] : [0, -1], z: Z, tipR: MAST_R },
  };
}

/** Box of size (along, across, deep) laid along radial `dir`, `across` in the station plane ⟂ dir. */
function radialBox(dir: [number, number], along: number, across: number, deep: number): { w: number; h: number; d: number } {
  return dir[0] !== 0 ? { w: along, h: across, d: deep } : { w: across, h: along, d: deep };
}

const at = (dir: [number, number], r: number, z: number, perp = 0): Vec3 => [dir[0] * r - dir[1] * perp, dir[1] * r + dir[0] * perp, z];

/** Stow angle (degrees) that turns `dir` onto −Z about the in-plane perpendicular axis. */
function stowAngle(dir: [number, number]): { axis: Vec3; stow: number } {
  const axis: Vec3 = [-dir[1], dir[0], 0];
  // Rotating dir by +90° about axis = dir × … : for dir = +X, axis = +Y, +90° takes +X to −Z.
  return { axis, stow: 90 };
}

function gantry(g: GantrySpec): { parts: Part[]; joint: Articulation } {
  const { dir, z, towerR, armLen, id } = g;
  const r0 = 1.25;
  const len = towerR - r0;
  const mid = (r0 + towerR) / 2;
  const { axis, stow } = stowAngle(dir);
  const parts: Part[] = [
    // Lattice boom: two chords and struts between them.
    { name: `${id}-chord`, paint: 'metal', pos: at(dir, mid, z + 0.17), shape: { kind: 'box', ...radialBox(dir, len, 0.13, 0.13), c: 0.02 } },
    { name: `${id}-chord-b`, paint: 'metal', pos: at(dir, mid, z - 0.17), shape: { kind: 'box', ...radialBox(dir, len, 0.13, 0.13), c: 0.02 } },
    {
      name: `${id}-strut`,
      paint: 'secondary',
      pos: at(dir, r0 + 0.35, z),
      repeat: { count: 5, step: [dir[0] * ((len - 0.5) / 4), dir[1] * ((len - 0.5) / 4), 0] },
      shape: { kind: 'box', ...radialBox(dir, 0.07, 0.09, 0.34) },
    },
    { name: `${id}-walk`, paint: 'accent', pos: at(dir, mid, z), shape: { kind: 'box', ...radialBox(dir, len, 0.26, 0.04) } },
    // The tower: stands across the boom end, carries the arm's hinge.
    { name: `${id}-tower`, paint: 'primary', pos: at(dir, towerR, z), shape: { kind: 'box', ...radialBox(dir, 0.26, 1.35, 0.34), c: 0.05 } },
    { name: `${id}-tower-cap`, paint: 'glow', emissive: 1.4, color: '#ff9b3f', pos: at(dir, towerR, z, 0.7), shape: { kind: 'box', w: 0.1, h: 0.1, d: 0.1 } },
    { name: `${id}-tower-cap-b`, paint: 'glow', emissive: 1.4, color: '#ff9b3f', pos: at(dir, towerR, z, -0.7), shape: { kind: 'box', w: 0.1, h: 0.1, d: 0.1 } },
    { name: `${id}-hinge`, paint: 'metal', pos: at(dir, towerR, z), rot: dir[0] !== 0 ? [90, 0, 0] : [0, 90, 0], shape: { kind: 'cylinder', rFront: 0.15, rBack: 0.15, length: 0.5, segments: 12 } },
    // The swing arm (on its joint): authored deployed, square to the boom.
    { name: `${id}-arm`, paint: 'secondary', articulation: id, pos: at(dir, towerR + armLen / 2 + 0.05, z), shape: { kind: 'box', ...radialBox(dir, armLen, 0.16, 0.18), c: 0.03 } },
    { name: `${id}-arm-band`, paint: 'accent', articulation: id, pos: at(dir, towerR + armLen * 0.35, z), shape: { kind: 'box', ...radialBox(dir, 0.1, 0.19, 0.21) } },
    { name: `${id}-pad`, paint: 'dark', articulation: id, pos: at(dir, towerR + armLen + 0.05, z), shape: { kind: 'box', ...radialBox(dir, 0.07, 0.34, 0.52), c: 0.02 } },
    { name: `${id}-pad-light`, paint: 'glow', emissive: 1.2, articulation: id, pos: at(dir, towerR + armLen - 0.02, z, 0.1), shape: { kind: 'box', w: 0.05, h: 0.05, d: 0.36 } },
  ];
  return { parts, joint: { id, pivot: at(dir, towerR, z), axis, range: [stow, 0], channel: id, mirror: false } };
}

function mooring(m: MooringSpec): Part[] {
  const { dir, z, tipR } = m;
  const r0 = 1.25;
  const len = tipR - r0;
  const mid = (r0 + tipR) / 2;
  return [
    { name: 'moor-chord', paint: 'metal', pos: at(dir, mid, z, 0.12), shape: { kind: 'box', ...radialBox(dir, len, 0.1, 0.12), c: 0.02 } },
    { name: 'moor-chord-b', paint: 'metal', pos: at(dir, mid, z, -0.12), shape: { kind: 'box', ...radialBox(dir, len, 0.1, 0.12), c: 0.02 } },
    {
      name: 'moor-strut',
      paint: 'secondary',
      pos: at(dir, r0 + 0.4, z),
      repeat: { count: 9, step: [dir[0] * ((len - 0.6) / 8), dir[1] * ((len - 0.6) / 8), 0] },
      shape: { kind: 'box', ...radialBox(dir, 0.08, 0.3, 0.09) },
    },
    { name: 'moor-band', paint: 'accent', pos: at(dir, r0 + len * 0.72, z), shape: { kind: 'box', ...radialBox(dir, 0.18, 0.4, 0.2) } },
    { name: 'moor-bollard', paint: 'primary', pos: at(dir, tipR, z), shape: { kind: 'dome', radius: 0.26, segments: 12 } },
    { name: 'moor-beacon', paint: 'glow', emissive: 1.6, color: '#ffd24f', pos: at(dir, tipR + 0.02, z), rot: dir[0] !== 0 ? [0, 90, 0] : [90, 0, 0], shape: { kind: 'rib', radius: 0.28, thickness: 0.05, depth: 0.08, arc: 360, segments: 16 } },
  ];
}

/** Gantry and pylon parts + the arms' joints for a station of `kind`. */
export function berthParts(kind: Exclude<StationKind, 'carrier' | 'surface'>): { parts: Part[]; joints: Articulation[] } {
  const lay = berthLayout(kind);
  const parts: Part[] = [];
  const joints: Articulation[] = [];
  for (const g of lay.clamps) {
    const b = gantry(g);
    parts.push(...b.parts);
    joints.push(b.joint);
  }
  parts.push(...mooring(lay.mooring));
  return { parts, joints };
}
