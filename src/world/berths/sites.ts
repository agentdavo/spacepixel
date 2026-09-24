import { Box3, Matrix4, Vector3 } from 'three';
import type { StationKind } from '@/game/economy';
import type { ShipModel } from '@/assets/ShipBuilder';
import { berthLayout } from '@/assets/blueprints/berths';
import { LIGHT_PULSE, LIGHT_STEADY, LIGHT_STROBE, type LightSpec } from '../setpieces/LightPoints';

/**
 * Big-hull berth sites on a station, in the station frame (metres): where the
 * clamp arm's pad sits when deployed, where the mooring bollard is, which way
 * the berthed hull lies from them, and which way is "up" for the hull.
 *
 * The hull always lies parallel to the docking axis, nose out (+Z), its flank
 * `gap` metres off the pad (clamp) or bollard (mooring):
 *
 *   ship centre = tip + side × (gap + half-beam)
 */
const SCALE = 100;

export interface StationBerth {
  cls: 'clamp' | 'mooring';
  index: number;
  /** Arm joint channel on the station model (clamp). */
  channel?: string;
  /** Unit radial direction from the station axis out to the berthed hull. */
  side: Vector3;
  /** The hull's "up" at this berth (⟂ side and the docking axis). */
  up: Vector3;
  /** Arm pad (deployed) / bollard, station frame, metres. */
  tip: Vector3;
  /** Tower foot (clamp) / mast root at the hub (mooring). */
  root: Vector3;
  /** Flank standoff from the tip (m). */
  gap: number;
  /** Tower half-height (m): the umbilicals leave from its ends. */
  towerHalf: number;
}

export function stationBerths(kind: Exclude<StationKind, 'carrier' | 'surface'>): StationBerth[] {
  const lay = berthLayout(kind);
  const out: StationBerth[] = [];
  lay.clamps.forEach((g, i) => {
    const side = new Vector3(g.dir[0], g.dir[1], 0);
    out.push({
      cls: 'clamp',
      index: i,
      channel: g.id,
      side,
      up: new Vector3(-g.dir[1], g.dir[0], 0).multiplyScalar(g.dir[0] + g.dir[1]).normalize(),
      tip: new Vector3(g.dir[0], g.dir[1], 0).multiplyScalar((g.towerR + g.armLen + 0.09) * SCALE).setZ(g.z * SCALE),
      root: new Vector3(g.dir[0], g.dir[1], 0).multiplyScalar(g.towerR * SCALE).setZ(g.z * SCALE),
      gap: 3,
      towerHalf: 0.62 * SCALE,
    });
  });
  const m = lay.mooring;
  out.push({
    cls: 'mooring',
    index: 0,
    side: new Vector3(m.dir[0], m.dir[1], 0),
    up: new Vector3(-m.dir[1], m.dir[0], 0).multiplyScalar(m.dir[0] + m.dir[1]).normalize(),
    tip: new Vector3(m.dir[0], m.dir[1], 0).multiplyScalar((m.tipR + 0.28) * SCALE).setZ(m.z * SCALE),
    root: new Vector3(m.dir[0], m.dir[1], 0).multiplyScalar(1.5 * SCALE).setZ(m.z * SCALE),
    gap: 160,
    towerHalf: 0,
  });
  return out;
}

/** Walkway lights along the gantry booms and the pylon, beacons at the tips (station frame). */
export function berthLights(kind: Exclude<StationKind, 'carrier' | 'surface'>, glow: string): LightSpec[] {
  const specs: LightSpec[] = [];
  for (const b of stationBerths(kind)) {
    const from = b.root.clone().setLength(b.cls === 'clamp' ? 140 : 150).setZ(b.root.z);
    const to = b.cls === 'clamp' ? b.root : b.tip;
    const n = b.cls === 'clamp' ? 5 : 11;
    for (let k = 0; k <= n; k++) {
      const p = from.clone().lerp(to, k / n);
      specs.push({ pos: p.clone().setZ(p.z + 24), color: glow, size: 5, mode: LIGHT_PULSE, rate: 0.7, phase: -k / n, gain: 1.6 });
      specs.push({ pos: p.clone().setZ(p.z - 24), color: glow, size: 5, mode: LIGHT_PULSE, rate: 0.7, phase: -k / n, gain: 1.6 });
    }
    if (b.cls === 'clamp') {
      for (const s of [-1, 1]) specs.push({ pos: b.root.clone().addScaledVector(b.up, s * (b.towerHalf + 10)), color: '#ff9b3f', size: 9, mode: LIGHT_STROBE, rate: 0.6, phase: b.index * 0.3 + s * 0.1, duty: 0.2, gain: 2.4 });
    } else {
      specs.push({ pos: b.tip.clone(), color: '#ffd24f', size: 16, mode: LIGHT_STROBE, rate: 0.5, phase: 0, duty: 0.12, gain: 3 });
      specs.push({ pos: b.tip.clone(), color: '#ffd24f', size: 9, mode: LIGHT_STEADY, gain: 1.8 });
    }
  }
  return specs;
}

/** Half extents of a built hull in its own frame (m): x = half-beam, y = half-height, z = half-length. */
const cache = new WeakMap<ShipModel, Vector3>();
const _inv = new Matrix4();
const _m = new Matrix4();
const _b = new Box3();
export function hullHalfExtents(model: ShipModel): Vector3 {
  const hit = cache.get(model);
  if (hit) return hit;
  const root = model.root;
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const box = new Box3();
  for (const mesh of model.meshes) {
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) continue;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    box.union(_b.copy(g.boundingBox).applyMatrix4(_m));
  }
  const half = box.isEmpty() ? new Vector3(model.radius * 0.3, model.radius * 0.2, model.length / 2) : new Vector3(Math.max(-box.min.x, box.max.x), Math.max(-box.min.y, box.max.y), Math.max(-box.min.z, box.max.z));
  cache.set(model, half);
  return half;
}
