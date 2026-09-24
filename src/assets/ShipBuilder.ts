import {
  Box3,
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
import type { Articulation, Blueprint, Hardpoint, Livery, Paint, Part, Vec3 } from './Blueprint';
import { buildShapeParts, flipWinding } from './HullKit';
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

/** A live hinge on a built ship (see `Blueprint.articulations`). */
export interface ArticulationNode {
  /** Joint id; mirrored twins are `${id}.L`. */
  id: string;
  /** Pivot node (child of its parent joint, or of `root`). Its children move with the joint. */
  node: Group;
  /** Merged mesh of the parts riding on this joint (null if none — e.g. a pure parent joint). */
  mesh: Mesh | null;
  /** Hinge axis in the parent's frame (mirrored for twins so equal angles move symmetrically). */
  axis: Vector3;
  /** Angle limits in radians. */
  range: [number, number];
  channel?: string;
  /** Id of the mirrored twin, if any (only set on the authored joint). */
  twin?: string;
  angle: number;
}

export interface ShipModel {
  blueprint: Blueprint;
  root: Group;
  /** The static merged hull (every part that is not on an articulated joint). */
  hull: Mesh;
  /** Every hull mesh: the static hull first, then one merged mesh per joint. */
  meshes: Mesh[];
  engines: EngineNode[];
  /** Hardpoint sockets as Object3Ds parented to the ship (weapons attach here). */
  sockets: Map<string, Object3D>;
  /** Articulated joints by id (authored ids plus mirrored `.L` twins). */
  articulations: Map<string, ArticulationNode>;
  /** Bounding radius in metres (after scale). */
  radius: number;
  length: number;
  /** Rest-pose bounds in the ship frame, metres (after scale; joints included). */
  bounds: Box3;
  /** Total hull triangle count (all meshes). */
  triangles: number;
  setThrottle(t: number): void;
  /** Set a joint angle in radians (relative to the authored pose). Also drives its mirrored twin. */
  setArticulation(id: string, angle: number): void;
  getArticulation(id: string): number;
  /** Drive every joint on `channel`, t = 0..1 across each joint's range. */
  setChannel(channel: string, t: number): void;
  /** Variable-geometry wings: 0 = fully spread, 1 = fully swept (channel 'sweep'). */
  setWingSweep(t: number): void;
  /** Stowage fold (channel 'fold'): 0 = flight, 1 = folded. */
  setWingFold(t: number): void;
}

const MIRROR = new Matrix4().makeScale(-1, 1, 1);
const ORIGIN = new Vector3();

function eulerDeg(r: Vec3): Euler {
  return new Euler(MathUtils.degToRad(r[0]), MathUtils.degToRad(r[1]), MathUtils.degToRad(r[2]), 'XYZ');
}

export function partMatrix(p: Part): Matrix4 {
  const pos = new Vector3(...(p.pos ?? [0, 0, 0]));
  const q = new Quaternion().setFromEuler(eulerDeg(p.rot ?? [0, 0, 0]));
  const s = new Vector3(...(p.scale ?? [1, 1, 1]));
  return new Matrix4().compose(pos, q, s);
}

/** Transform of repeat copy i (applied on top of the part matrix). */
export function repeatMatrix(p: Part, i: number): Matrix4 {
  if (!p.repeat || i === 0) return new Matrix4();
  const st = p.repeat.step ?? [0, 0, 0];
  const r = p.repeat.rot ?? [0, 0, 0];
  const t = new Matrix4().makeTranslation(st[0] * i, st[1] * i, st[2] * i);
  const rot = new Matrix4().makeRotationFromEuler(eulerDeg([r[0] * i, r[1] * i, r[2] * i]));
  return t.multiply(rot);
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
      damage: true,
    });
    materialCache.set(key, m);
  }
  return m;
}

interface JointDraft {
  id: string;
  def: Articulation;
  /** Pivot in unscaled ship coordinates (rest pose). */
  pivot: Vector3;
  axis: Vector3;
  parent?: string;
  twin?: string;
  isTwin: boolean;
  geos: BufferGeometry[];
}

const mirrorAxis = (a: Vector3) => new Vector3(a.x, -a.y, -a.z);

/**
 * Compiles a Blueprint into a renderable ship: a single merged static hull
 * mesh (one draw call regardless of part count), one merged mesh per
 * articulated joint (swing wings, bay doors, radar), engine plume meshes and
 * hardpoint sockets. This is the heart of the asset pipeline — designs are
 * data, and the same blueprint can be re-liveried for any faction.
 */
export function buildShip(bp: Blueprint, liveryOverride?: Partial<Livery>): ShipModel {
  const livery: Livery = { ...FACTIONS[bp.faction].livery, ...bp.livery, ...liveryOverride };
  const scale = bp.scale ?? 1;

  // ── joints ────────────────────────────────────────────────────────────
  const defs = new Map<string, Articulation>();
  for (const a of bp.articulations ?? []) defs.set(a.id, a);
  for (const p of bp.parts) {
    if (p.articulation && typeof p.articulation !== 'string' && !defs.has(p.articulation.id)) {
      defs.set(p.articulation.id, p.articulation);
    }
  }
  const jointOf = (p: Part): string | undefined =>
    p.articulation === undefined ? undefined : typeof p.articulation === 'string' ? p.articulation : p.articulation.id;
  const mirroredUse = new Set<string>();
  for (const p of bp.parts) {
    const j = jointOf(p);
    if (j && !defs.has(j)) throw new Error(`ShipBuilder: ${bp.id} part "${p.name ?? '?'}" uses unknown joint "${j}"`);
    if (j && p.mirror) mirroredUse.add(j);
  }
  for (const hp of bp.hardpoints ?? []) if (hp.articulation && hp.mirror) mirroredUse.add(hp.articulation);
  // A joint gets a mirrored twin when mirrored parts ride on it (or on a descendant).
  const needsTwin = (id: string): boolean => {
    const d = defs.get(id)!;
    if (d.mirror === false) return false;
    if (mirroredUse.has(id)) return true;
    return [...defs.values()].some((c) => c.parent === id && needsTwin(c.id));
  };
  const joints = new Map<string, JointDraft>();
  for (const d of defs.values()) {
    const axis = new Vector3(...d.axis).normalize();
    const base: JointDraft = { id: d.id, def: d, pivot: new Vector3(...d.pivot), axis, parent: d.parent, isTwin: false, geos: [] };
    joints.set(d.id, base);
    if (needsTwin(d.id)) {
      const tid = `${d.id}.L`;
      base.twin = tid;
      const parentTwin = d.parent && needsTwin(d.parent) ? `${d.parent}.L` : d.parent;
      joints.set(tid, {
        id: tid,
        def: d,
        pivot: new Vector3(-d.pivot[0], d.pivot[1], d.pivot[2]),
        axis: mirrorAxis(axis),
        parent: parentTwin,
        isTwin: true,
        geos: [],
      });
    }
  }

  // ── parts ─────────────────────────────────────────────────────────────
  const staticGeos: BufferGeometry[] = [];
  const bucket = (joint: string | undefined) => (joint ? joints.get(joint)!.geos : staticGeos);
  let nextRegion = bp.parts.length + 1;
  const socketDrafts: { id: string; kind: Hardpoint['kind']; matrix: Matrix4; joint?: string }[] = [];

  bp.parts.forEach((part, index) => {
    const shape = buildShapeParts(part.shape);
    const pal: Livery = part.livery ? FACTIONS[part.livery].livery : livery;
    const mainColor = new Color(part.color ?? pal[part.paint]);
    const [emDefault, glossDefault] = PAINT_SURFACE[part.paint];
    const trimPaint = part.trim ?? part.paint;
    const [trimEm, trimGloss] = PAINT_SURFACE[trimPaint];
    const trimColor = new Color(part.trim ? pal[part.trim] : (part.color ?? pal[part.paint]));
    const joint = jointOf(part);
    const twin = joint ? joints.get(joint)!.twin : undefined;
    const count = Math.max(1, Math.floor(part.repeat?.count ?? 1));
    const trimRegion = shape.trim ? nextRegion++ : 0;

    for (let i = 0; i < count; i++) {
      const m = repeatMatrix(part, i).multiply(partMatrix(part));
      const flip = m.determinant() < 0;
      const region = part.group ?? (i === 0 ? 1 + index : nextRegion++);
      const pieces: BufferGeometry[] = [];

      const main = shape.main.clone();
      main.applyMatrix4(m);
      if (flip) flipWinding(main);
      paintGeometry(main, mainColor, [region, part.emissive ?? emDefault, part.gloss ?? glossDefault, part.shade ?? 0]);
      pieces.push(normaliseAttributes(main));
      if (shape.trim) {
        const t = shape.trim.clone();
        t.applyMatrix4(m);
        if (flip) flipWinding(t);
        paintGeometry(t, trimColor, [trimRegion, trimEm, trimGloss, part.shade ?? 0]);
        pieces.push(normaliseAttributes(t));
      }
      bucket(joint).push(...pieces);
      if (part.socket) {
        const sid = count > 1 ? `${part.socket.id}-${i}` : part.socket.id;
        socketDrafts.push({ id: sid, kind: part.socket.kind, matrix: m, joint });
      }

      if (part.mirror) {
        const target = twin ?? joint;
        for (const g of pieces) {
          const mg = g.clone();
          mg.applyMatrix4(MIRROR);
          flipWinding(mg);
          bucket(target).push(mg);
        }
        if (part.socket) {
          const sid = count > 1 ? `${part.socket.id}-${i}.L` : `${part.socket.id}.L`;
          socketDrafts.push({ id: sid, kind: part.socket.kind, matrix: MIRROR.clone().multiply(m), joint: target });
        }
      }
    }
  });

  // ── bounds (rest pose, unscaled) ─────────────────────────────────────
  const all = [...staticGeos, ...[...joints.values()].flatMap((j) => j.geos)];
  const box = new Box3();
  for (const g of all) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  const centre = box.getCenter(new Vector3());
  let r2 = 0;
  const tmp = new Vector3();
  for (const g of all) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) r2 = Math.max(r2, tmp.fromBufferAttribute(pos, i).distanceToSquared(centre));
  }

  const root = new Group();
  root.name = bp.id;
  const material = hullMaterial(bp);
  let triangles = 0;
  const makeMesh = (geos: BufferGeometry[], name: string, offset?: Vector3): Mesh => {
    const merged = geos.length ? mergeGeometries(geos, false) : new BufferGeometry();
    if (!merged) throw new Error(`ShipBuilder: failed to merge geometry for ${name}`);
    if (offset) merged.translate(-offset.x, -offset.y, -offset.z);
    merged.scale(scale, scale, scale);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    triangles += (merged.getAttribute('position')?.count ?? 0) / 3;
    const mesh = new Mesh(merged, material);
    mesh.name = name;
    return mesh;
  };

  const hull = makeMesh(staticGeos, `${bp.id}:hull`);
  root.add(hull);
  const meshes: Mesh[] = [hull];

  // Joint nodes: create, then parent (parents may be declared after children).
  const articulations = new Map<string, ArticulationNode>();
  for (const j of joints.values()) {
    const node = new Group();
    node.name = `${bp.id}:joint:${j.id}`;
    const mesh = j.geos.length ? makeMesh(j.geos, `${bp.id}:${j.id}`, j.pivot) : null;
    if (mesh) {
      node.add(mesh);
      meshes.push(mesh);
    }
    const [lo, hi] = j.def.range ?? [0, 90];
    articulations.set(j.id, {
      id: j.id,
      node,
      mesh,
      axis: j.axis,
      range: [MathUtils.degToRad(lo), MathUtils.degToRad(hi)],
      channel: j.def.channel,
      twin: j.twin,
      angle: 0,
    });
  }
  for (const j of joints.values()) {
    const a = articulations.get(j.id)!;
    const parent = j.parent ? joints.get(j.parent) : undefined;
    if (j.parent && !parent) throw new Error(`ShipBuilder: ${bp.id} joint "${j.id}" has unknown parent "${j.parent}"`);
    a.node.position.copy(j.pivot).sub(parent ? parent.pivot : ORIGIN).multiplyScalar(scale);
    (parent ? articulations.get(parent.id)!.node : root).add(a.node);
  }

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

  // Sockets: parented to their joint (if any) so weapons ride on moving parts.
  const sockets = new Map<string, Object3D>();
  const placeSocket = (id: string, kind: Hardpoint['kind'], matrix: Matrix4, joint?: string) => {
    const o = new Object3D();
    o.name = id;
    const pos = new Vector3();
    const q = new Quaternion();
    matrix.decompose(pos, q, new Vector3());
    const j = joint ? joints.get(joint) : undefined;
    if (j) pos.sub(j.pivot);
    o.position.copy(pos).multiplyScalar(scale);
    o.quaternion.copy(q);
    o.userData.kind = kind;
    (j ? articulations.get(j.id)!.node : root).add(o);
    sockets.set(id, o);
  };
  for (const hp of bp.hardpoints ?? []) {
    const m = new Matrix4().compose(new Vector3(...hp.pos), new Quaternion().setFromEuler(eulerDeg(hp.rot ?? [0, 0, 0])), new Vector3(1, 1, 1));
    placeSocket(hp.id, hp.kind, m, hp.articulation);
    if (hp.mirror) {
      const twin = hp.articulation ? (joints.get(hp.articulation)?.twin ?? hp.articulation) : undefined;
      placeSocket(`${hp.id}.L`, hp.kind, MIRROR.clone().multiply(m), twin);
    }
  }
  for (const s of socketDrafts) placeSocket(s.id, s.kind, s.matrix, s.joint);

  const applyJoint = (a: ArticulationNode, angle: number) => {
    a.angle = angle;
    a.node.quaternion.setFromAxisAngle(a.axis, angle);
  };

  const model: ShipModel = {
    blueprint: bp,
    root,
    hull,
    meshes,
    engines,
    sockets,
    articulations,
    radius: Math.sqrt(r2) * scale,
    length: (box.max.z - box.min.z) * scale,
    bounds: new Box3(box.min.clone().multiplyScalar(scale), box.max.clone().multiplyScalar(scale)),
    triangles,
    setThrottle(t: number) {
      const k = MathUtils.clamp(t, 0, 1.6);
      for (const e of engines) {
        e.plume.scale.z = Math.max(0.001, e.basePlume * (0.25 + 0.75 * k));
        e.plume.visible = k > 0.01;
      }
    },
    setArticulation(id: string, angle: number) {
      const a = articulations.get(id);
      if (!a) return;
      applyJoint(a, angle);
      if (a.twin) applyJoint(articulations.get(a.twin)!, angle);
    },
    getArticulation(id: string) {
      return articulations.get(id)?.angle ?? 0;
    },
    setChannel(channel: string, t: number) {
      const k = MathUtils.clamp(t, 0, 1);
      for (const a of articulations.values()) {
        if (a.channel !== channel || a.id.endsWith('.L')) continue;
        model.setArticulation(a.id, MathUtils.lerp(a.range[0], a.range[1], k));
      }
    },
    setWingSweep(t: number) {
      model.setChannel('sweep', t);
    },
    setWingFold(t: number) {
      model.setChannel('fold', t);
    },
  };
  for (const j of joints.values()) {
    if (!j.isTwin && j.def.rest) model.setArticulation(j.id, MathUtils.degToRad(j.def.rest));
  }
  model.setThrottle(1);
  return model;
}
