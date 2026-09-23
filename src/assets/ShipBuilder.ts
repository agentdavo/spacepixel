import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { GlowMaterial } from '@/render/materials/GlowMaterial';
import type { Blueprint, Livery, Paint, Part, Vec3 } from './Blueprint';
import { buildShape, flipWinding } from './HullKit';
import { FACTIONS } from './Factions';

/** Surface presets per paint slot: [emissive, gloss]. */
const PAINT_SURFACE: Record<Paint, [number, number]> = {
  primary: [0, 0.55],
  secondary: [0, 0.45],
  accent: [0, 0.6],
  dark: [0, 0.25],
  metal: [0, 0.9],
  glass: [0.12, 1.0],
  glow: [1.0, 0],
};

export interface EngineNode {
  plume: Mesh;
  nozzle: Mesh;
  basePlume: number;
}

export interface ShipModel {
  blueprint: Blueprint;
  root: Group;
  hull: Mesh;
  engines: EngineNode[];
  /** Hardpoint sockets as Object3Ds parented to the ship (weapons attach here). */
  sockets: Map<string, Object3D>;
  /** Bounding radius in metres (after scale). */
  radius: number;
  length: number;
  setThrottle(t: number): void;
}

const MIRROR = new Matrix4().makeScale(-1, 1, 1);

function partMatrix(p: Part): Matrix4 {
  const pos = new Vector3(...(p.pos ?? [0, 0, 0]));
  const r = p.rot ?? [0, 0, 0];
  const q = new Quaternion().setFromEuler(
    new Euler(MathUtils.degToRad(r[0]), MathUtils.degToRad(r[1]), MathUtils.degToRad(r[2]), 'XYZ'),
  );
  const s = new Vector3(...(p.scale ?? [1, 1, 1]));
  return new Matrix4().compose(pos, q, s);
}

function paintGeometry(g: BufferGeometry, color: Color, surface: [number, number, number, number]): void {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const surf = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
    surf.set(surface, i * 4);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('surface', new Float32BufferAttribute(surf, 4));
}

/** Keep only the attributes the hull material consumes so merges never mismatch. */
function normaliseAttributes(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (!['position', 'normal', 'uv', 'color', 'surface'].includes(name)) out.deleteAttribute(name);
  }
  if (!out.getAttribute('uv')) {
    out.setAttribute('uv', new Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  }
  return out;
}

const materialCache = new Map<string, CelMaterial>();

function hullMaterial(bp: Blueprint): CelMaterial {
  const key = `${bp.faction}:${bp.ramp ?? 'classic'}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new CelMaterial({
      vertexPaint: true,
      ramp: bp.ramp ?? 'classic',
      inkId: bp.faction === 'concord' ? 0 : bp.faction === 'choir' ? 1000 : 2000,
      rimWidth: 0.6,
    });
    materialCache.set(key, m);
  }
  return m;
}

/**
 * Compiles a Blueprint into a renderable ship: a single merged hull mesh
 * (one draw call regardless of part count), engine plume meshes and hardpoint
 * sockets. This is the heart of the asset pipeline — designs are data, and
 * the same blueprint can be re-liveried for any faction.
 */
export function buildShip(bp: Blueprint, liveryOverride?: Partial<Livery>): ShipModel {
  const livery: Livery = { ...FACTIONS[bp.faction].livery, ...liveryOverride };
  const scale = bp.scale ?? 1;
  const geos: BufferGeometry[] = [];

  bp.parts.forEach((part, index) => {
    const base = buildShape(part.shape);
    base.applyMatrix4(partMatrix(part));
    const [emDefault, glossDefault] = PAINT_SURFACE[part.paint];
    const region = part.group ?? 1 + index;
    paintGeometry(base, new Color(livery[part.paint]), [
      region,
      part.emissive ?? emDefault,
      part.gloss ?? glossDefault,
      0,
    ]);
    geos.push(normaliseAttributes(base));

    if (part.mirror) {
      const m = base.clone();
      m.applyMatrix4(MIRROR);
      flipWinding(m);
      geos.push(normaliseAttributes(m));
    }
  });

  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`ShipBuilder: failed to merge geometry for ${bp.id}`);
  merged.scale(scale, scale, scale);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();

  const root = new Group();
  root.name = bp.id;
  const hull = new Mesh(merged, hullMaterial(bp));
  hull.name = `${bp.id}:hull`;
  root.add(hull);

  // Engine plumes: open cones extending back along -Z from each nozzle.
  const engines: EngineNode[] = [];
  // Capital-ship drives cover huge screen areas; keep them from swamping the bloom.
  const glowGain = scale > 10 ? 0.45 : 1;
  const plumeMat = new GlowMaterial({ color: livery.glow, core: livery.plumeCore, intensity: 3.2 * glowGain, lengthFalloff: true });
  const nozzleMat = new GlowMaterial({ color: livery.glow, core: livery.plumeCore, intensity: 5.0 * glowGain });
  const addEngine = (pos: Vec3, radius: number, plume: number) => {
    const p = new Vector3(...pos).multiplyScalar(scale);
    const r = radius * scale;
    const len = plume * scale;

    const plumeGeo = new CylinderGeometry(r * 0.15, r, 1, 14, 1, true);
    plumeGeo.rotateX(-Math.PI / 2); // +Y (thin end) → -Z
    plumeGeo.translate(0, 0, -0.5);
    const plumeMesh = new Mesh(plumeGeo, plumeMat);
    plumeMesh.position.copy(p);
    plumeMesh.scale.set(1, 1, len);
    plumeMesh.renderOrder = 10;

    const nozzleGeo = new CylinderGeometry(r * 0.92, r * 0.92, r * 0.1, 18);
    nozzleGeo.rotateX(Math.PI / 2);
    const nozzle = new Mesh(nozzleGeo, nozzleMat);
    nozzle.position.copy(p);
    nozzle.renderOrder = 11;

    root.add(plumeMesh, nozzle);
    engines.push({ plume: plumeMesh, nozzle, basePlume: len });
  };
  for (const e of bp.engines) {
    addEngine(e.pos, e.radius, e.plume);
    if (e.mirror) addEngine([-e.pos[0], e.pos[1], e.pos[2]], e.radius, e.plume);
  }

  const sockets = new Map<string, Object3D>();
  for (const hp of bp.hardpoints ?? []) {
    const make = (id: string, pos: Vec3) => {
      const o = new Object3D();
      o.name = id;
      o.position.set(...pos).multiplyScalar(scale);
      o.userData.kind = hp.kind;
      root.add(o);
      sockets.set(id, o);
    };
    make(hp.id, hp.pos);
    if (hp.mirror) make(`${hp.id}.L`, [-hp.pos[0], hp.pos[1], hp.pos[2]]);
  }

  const bb = merged.boundingBox!;
  const model: ShipModel = {
    blueprint: bp,
    root,
    hull,
    engines,
    sockets,
    radius: merged.boundingSphere!.radius,
    length: bb.max.z - bb.min.z,
    setThrottle(t: number) {
      const k = MathUtils.clamp(t, 0, 1.6);
      for (const e of engines) {
        e.plume.scale.z = Math.max(0.001, e.basePlume * (0.25 + 0.75 * k));
        e.plume.visible = k > 0.01;
      }
    },
  };
  model.setThrottle(1);
  return model;
}
