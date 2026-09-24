import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CelMaterial } from '@/render/materials/CelMaterial';
import {
  KESSEN_LIVERY,
  PLANS,
  statureOf,
  type BodyPlan,
  type FrameLivery,
  type FramePaint,
  type FrameVariant,
  type WeaponKind,
} from './data';
import { BONE_TREE, BONE_NAMES, type BoneName } from './rig';
import { HELD, blendPoses, createPoseBuffer, sampleClip, type ClipId, type PoseBuffer } from './clips';

/**
 * Kessen frames in the game renderer: a real 42-bone hierarchy with rigid,
 * chamfered armour parts bound 100 % to one bone each. The parts on a bone
 * are merged into one vertex-painted cel mesh (one draw call per bone, all
 * frames share one material), so ink lines come from the post pass's region
 * ids exactly as they do on ships. Hydraulic pistons are re-aimed after
 * every pose. Frames are built at a canonical ~8 m and scaled so the top of
 * the head sits at their Stature's height.
 */


/** Surface per paint slot: [emissive, gloss]. */
const SURFACE: Record<FramePaint, [number, number]> = {
  primary: [0, 0.55],
  secondary: [0, 0.45],
  dark: [0, 0.25],
  accent: [0, 0.6],
  metal: [0, 0.9],
  hazard: [0, 0.5],
  bright: [0, 0.8],
  glow: [1, 0],
};

// ── geometry ─────────────────────────────────────────────────────────────

function chamferShape(w: number, h: number, c: number): Shape {
  const s = new Shape();
  const x = w / 2;
  const y = h / 2;
  c = Math.min(c, x * 0.45, y * 0.45);
  s.moveTo(-x + c, -y);
  s.lineTo(x - c, -y);
  s.lineTo(x, -y + c);
  s.lineTo(x, y - c);
  s.lineTo(x - c, y);
  s.lineTo(-x + c, y);
  s.lineTo(-x, y - c);
  s.lineTo(-x, -y + c);
  s.closePath();
  return s;
}

function trapShape(wt: number, wb: number, h: number, c: number): Shape {
  const s = new Shape();
  const y = h / 2;
  c = Math.min(c, Math.min(wt, wb) * 0.2, y * 0.4);
  s.moveTo(-wb / 2 + c, -y);
  s.lineTo(wb / 2 - c, -y);
  s.lineTo(wb / 2, -y + c);
  s.lineTo(wt / 2, y - c);
  s.lineTo(wt / 2 - c, y);
  s.lineTo(-wt / 2 + c, y);
  s.lineTo(-wt / 2, y - c);
  s.lineTo(-wb / 2, -y + c);
  s.closePath();
  return s;
}

function extrude(shape: Shape, d: number, c: number): BufferGeometry {
  const bev = Math.min(c * 0.6, d * 0.3);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(d - 2 * bev, 0.001),
    bevelEnabled: bev > 0.001,
    bevelThickness: bev,
    bevelSize: bev * 0.8,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.center();
  return g;
}

const G = {
  /** Chamfered box: w (x) × h (y) × d (z). */
  box: (w: number, h: number, d: number, c = 0.08) => extrude(chamferShape(w, h, c), d, c),
  /** Chamfered trapezoid prism: top width, bottom width, height, depth. */
  trap: (wt: number, wb: number, h: number, d: number, c = 0.08) => extrude(trapShape(wt, wb, h, c), d, c),
  /** Cylinder along Y. */
  cyl: (rt: number, rb: number, h: number, seg = 10) => new CylinderGeometry(rt, rb, h, seg),
  sphere: (r: number) => new IcosahedronGeometry(r, 1),
};

// ── part collection ──────────────────────────────────────────────────────

type V3 = [number, number, number];

interface PartOpts {
  paint?: FramePaint;
  /** Hex override (glow tints, one-off colours). */
  color?: string;
  pos?: V3;
  rot?: V3;
}

interface Draft {
  geo: BufferGeometry;
  color: Color;
  surface: [number, number, number, number];
}

class Collector {
  readonly byBone = new Map<BoneName, Draft[]>();
  private region = 1;
  constructor(readonly livery: FrameLivery) {}

  part(bone: BoneName, geo: BufferGeometry, o: PartOpts = {}): void {
    const paint = o.paint ?? 'primary';
    const m = new Matrix4().compose(
      new Vector3(...(o.pos ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(o.rot ?? [0, 0, 0]))),
      new Vector3(1, 1, 1),
    );
    geo.applyMatrix4(m);
    const [em, gloss] = SURFACE[paint];
    const list = this.byBone.get(bone) ?? [];
    list.push({ geo, color: new Color(o.color ?? this.livery[paint]), surface: [this.region++, em, gloss, 0] });
    this.byBone.set(bone, list);
  }
}

/** Keep exactly the attributes the cel material reads, non-indexed, painted. */
function finish(d: Draft): BufferGeometry {
  const g = d.geo.index ? d.geo.toNonIndexed() : d.geo;
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  const col = new Float32Array(n * 3);
  const surf = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = d.color.r;
    col[i * 3 + 1] = d.color.g;
    col[i * 3 + 2] = d.color.b;
    surf.set(d.surface, i * 4);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('surface', new Float32BufferAttribute(surf, 4));
  return g;
}

let sharedMaterial: CelMaterial | null = null;

/** One cel material for every Kessen frame (ink id range 3000+, clear of the three ship factions). */
export function frameMaterial(): CelMaterial {
  sharedMaterial ??= new CelMaterial({ vertexPaint: true, ramp: 'classic', inkId: 3000, rimWidth: 0.6 });
  return sharedMaterial;
}

// ── body ────────────────────────────────────────────────────────────────

interface Layout {
  P: BodyPlan;
  b: number;
  ankle: number;
  shin: number;
  thigh: number;
  uArm: number;
  fArm: number;
  hipY: number;
}

function layoutBones(bones: Record<BoneName, Group>, P: BodyPlan): Layout {
  const b = P.bulk;
  const ankle = 0.55;
  const shin = 2.0 * P.legK;
  const thigh = 1.8 * P.legK;
  const hipY = ankle + shin + thigh;
  const uArm = 1.45 * P.armK;
  const fArm = 1.5 * P.armK;
  const at = (n: BoneName, x: number, y: number, z: number) => bones[n].position.set(x, y, z);
  at('hips', 0, hipY, 0);
  at('thigh_L', P.hipW, -0.15, 0);
  at('thigh_R', -P.hipW, -0.15, 0);
  for (const s of ['L', 'R'] as const) {
    at(`shin_${s}`, 0, -thigh, 0);
    at(`foot_${s}`, 0, -shin, 0);
    at(`toe_${s}`, 0, -ankle + 0.15, 0.75);
  }
  at('skirt_F', 0, -0.05, 0.5 * b);
  at('skirt_B', 0, 0, -0.5 * b);
  at('skirt_L', 0.75 * b, 0, 0);
  at('skirt_R', -0.75 * b, 0, 0);
  at('spine', 0, 0.35, 0);
  at('chest', 0, 0.55, 0);
  at('neck', 0, P.head === 'hood' ? 1.3 : 1.55, 0.05);
  at('head', 0, 0.28, 0);
  at('crest', 0, 0.55 * P.headK, 0);
  at('hatch', 0, 0.75, 0.62 * b);
  at('shoulder_L', P.shW, 1.2, 0);
  at('shoulder_R', -P.shW, 1.2, 0);
  for (const s of ['L', 'R'] as const) {
    at(`upperarm_${s}`, 0, -0.05, 0);
    at(`forearm_${s}`, 0, -uArm, 0);
    at(`hand_${s}`, 0, -fArm, 0);
    at(`fingers_${s}`, 0, -0.48, 0.05);
    at(`thumb_${s}`, s === 'L' ? -0.2 : 0.2, -0.2, 0.22);
    at(`weapon_${s}`, 0, -0.3, 0.05);
    at(`pauldron_${s}`, s === 'L' ? 0.12 : -0.12, 0.12, 0);
  }
  at('shield_L', 0.5 * b, -fArm * 0.5, 0);
  at('backpack', 0, 0.85, -0.72 * b);
  at('jet_L', 0.45, -0.55, -0.15);
  at('jet_R', -0.45, -0.55, -0.15);
  at('mount_L', P.shW * 0.72, 1.62, -0.35);
  at('mount_R', -P.shW * 0.72, 1.62, -0.35);
  return { P, b, ankle, shin, thigh, uArm, fArm, hipY };
}

function buildBody(c: Collector, L: Layout, v: FrameVariant): void {
  const { P, b, ankle, shin, thigh, uArm, fArm } = L;
  const ck = P.chestK;
  const part = c.part.bind(c);
  const sides = [['L', 1], ['R', -1]] as const;

  // Pelvis + skirts.
  part('hips', G.box(1.35 * b, 0.75, 0.95 * b, 0.12), { paint: 'dark' });
  part('hips', G.trap(0.55 * b, 0.3 * b, 0.5, 0.7 * b), { pos: [0, -0.45, 0.08] });
  part('skirt_F', G.trap(0.95 * b, 0.75 * b, 0.85, 0.14, 0.1), { pos: [0, -0.35, 0.05] });
  part('skirt_B', G.trap(1.1 * b, 0.9 * b, 0.8, 0.14, 0.1), { pos: [0, -0.3, -0.05] });
  for (const [s, sx] of sides) {
    part(`skirt_${s}`, G.trap(0.8 * b, 0.95 * b, 0.95, 0.14, 0.1), { paint: 'secondary', pos: [0.08 * sx, -0.4, 0], rot: [0, Math.PI / 2, 0] });
  }
  if (v.stature <= 2) part('skirt_F', G.box(0.8 * b, 0.16, 0.04, 0.01), { paint: 'hazard', pos: [0, -0.66, 0.12] });

  // Legs.
  const fw = P.feet === 'wide' ? 1.15 : 0.95;
  for (const [s, sx] of sides) {
    part(`thigh_${s}`, G.sphere(0.38 * b), { paint: 'dark' });
    part(`thigh_${s}`, G.box(0.72 * b, thigh * 0.85, 0.82 * b, 0.1), { pos: [0, -thigh * 0.5, 0] });
    part(`thigh_${s}`, G.box(0.5 * b, thigh * 0.4, 0.3, 0.06), { paint: 'dark', pos: [0.2 * sx * b, -thigh * 0.55, 0.3 * b] });
    part(`shin_${s}`, G.cyl(0.32 * b, 0.32 * b, 0.7 * b, 10), { paint: 'dark', rot: [0, 0, Math.PI / 2] });
    part(`shin_${s}`, G.box(0.95 * b, shin * 0.92, 1.05 * b, 0.14), { paint: 'secondary', pos: [0, -shin * 0.52, 0.02] });
    part(`shin_${s}`, G.trap(0.62 * b, 0.45 * b, 0.62, 0.3, 0.08), { paint: 'accent', pos: [0, 0.02, 0.48 * b], rot: [-0.25, 0, 0] });
    part(`shin_${s}`, G.box(0.55 * b, shin * 0.45, 0.35, 0.08), { paint: 'dark', pos: [0, -shin * 0.45, -0.55 * b] });
    part(`shin_${s}`, G.box(0.38 * b, 0.1, 0.1, 0.02), { paint: 'glow', pos: [0, -shin * 0.62, -0.74 * b] });
    // Stature pips down the shin plate (the stencilled Roman numeral, as bars).
    for (let i = 0; i < v.stature; i++) {
      part(`shin_${s}`, G.box(0.1 * b, 0.34 * b, 0.04, 0.01), { paint: 'accent', pos: [(i - (v.stature - 1) / 2) * 0.15 * b, -shin * 0.62, 0.55 * b] });
    }
    part(`foot_${s}`, G.cyl(0.26 * b, 0.26 * b, 0.6 * b, 8), { paint: 'dark', rot: [0, 0, Math.PI / 2] });
    part(`foot_${s}`, G.trap(0.8 * b * fw, 1.0 * b * fw, ankle * 1.05, 1.35, 0.1), { pos: [0, -ankle * 0.55, 0.05], rot: [-Math.PI / 2, 0, 0] });
    part(`toe_${s}`, G.trap(0.8 * b * fw, 0.95 * b * fw, 0.5, 0.35, 0.08), { paint: 'dark', pos: [0, -0.08, 0.2], rot: [-Math.PI / 2, 0, 0] });
    part(`foot_${s}`, G.box(0.7 * b * fw, 0.35, 0.4, 0.06), { paint: 'dark', pos: [0, -ankle * 0.7, -0.75] });
    if (P.feet === 'skate') {
      for (const z of [-0.45, 0.35]) part(`foot_${s}`, G.cyl(0.2, 0.2, 0.5 * b, 10), { paint: 'metal', pos: [0, -ankle - 0.05, z], rot: [0, 0, Math.PI / 2] });
    }
  }

  // Waist + torso.
  part('spine', G.cyl(0.5 * b, 0.62 * b, 0.62, 10), { paint: 'dark', pos: [0, 0.2, 0] });
  const chestW = 2.0 * ck;
  const chestD = 1.3 * b;
  part('chest', G.trap(chestW, chestW * 0.72, 1.45, chestD, 0.18), { pos: [0, 0.78, 0] });
  part('chest', G.box(chestW * 0.62, 0.45, chestD * 0.9, 0.1), { paint: 'dark', pos: [0, 0.05, 0] });
  part('chest', G.box(chestW * 0.9, 0.35, chestD * 0.85, 0.1), { paint: 'dark', pos: [0, 1.52, -0.05] });
  // Heartcase hatch (the cockpit): bone plates, a teal sight slit.
  part('hatch', G.trap(chestW * 0.52, chestW * 0.38, 0.95, 0.22, 0.1), { paint: 'secondary', pos: [0, 0.02, 0.05] });
  part('hatch', G.box(chestW * 0.2, 0.12, 0.1, 0.02), { paint: 'glow', pos: [0, 0.3, 0.18] });
  for (const sx of [1, -1]) {
    part('chest', G.trap(0.45 * ck, 0.3 * ck, 0.9, 0.3, 0.06), { paint: 'accent', pos: [sx * chestW * 0.38, 1.0, chestD * 0.5], rot: [0.12, 0, 0] });
  }

  buildHead(c, P, v);

  // Arms.
  for (const [s, sx] of sides) {
    part(`shoulder_${s}`, G.sphere(0.42 * b), { paint: 'dark' });
    buildPauldron(c, P, sx, s);
    part(`upperarm_${s}`, G.box(0.58 * b, uArm * 0.8, 0.62 * b, 0.08), { paint: 'dark', pos: [0, -uArm * 0.5, 0] });
    part(`upperarm_${s}`, G.box(0.66 * b, uArm * 0.45, 0.7 * b, 0.1), { pos: [0, -uArm * 0.38, 0] });
    part(`forearm_${s}`, G.cyl(0.3 * b, 0.3 * b, 0.62 * b, 10), { paint: 'dark', rot: [0, 0, Math.PI / 2] });
    part(`forearm_${s}`, G.box(0.78 * b, fArm * 0.88, 0.82 * b, 0.12), { paint: 'secondary', pos: [0, -fArm * 0.52, 0] });
    part(`forearm_${s}`, G.box(0.25, fArm * 0.5, 0.6 * b, 0.05), { paint: 'accent', pos: [0.42 * b * sx, -fArm * 0.45, 0] });
    part(`hand_${s}`, G.box(0.46 * b, 0.5, 0.55 * b, 0.06), { paint: 'dark', pos: [0, -0.22, 0] });
    part(`fingers_${s}`, G.box(0.44 * b, 0.4, 0.48 * b, 0.06), { paint: 'dark', pos: [0, -0.18, -0.02] });
    part(`thumb_${s}`, G.box(0.16, 0.34, 0.16, 0.03), { paint: 'dark', pos: [0, -0.14, 0] });
  }

  buildPack(c, P);
}

function buildHead(c: Collector, P: BodyPlan, v: FrameVariant): void {
  const k = P.headK;
  const part = c.part.bind(c);
  part('neck', G.cyl(0.26, 0.32, 0.4, 8), { paint: 'dark', pos: [0, 0.15, 0] });
  const style = v.head ?? P.head;
  if (style === 'fettler') {
    // Power-armour helm: the pilot's own head is in here.
    part('head', G.box(0.72 * k, 0.7 * k, 0.8 * k, 0.2), { pos: [0, 0.32 * k, 0] });
    part('head', G.box(0.66 * k, 0.16 * k, 0.1, 0.03), { paint: 'glow', pos: [0, 0.38 * k, 0.4 * k] });
    part('head', G.box(0.5 * k, 0.22 * k, 0.28, 0.05), { paint: 'secondary', pos: [0, 0.14 * k, 0.36 * k] });
    part('head', G.box(0.08, 0.5 * k, 0.08, 0.02), { paint: 'accent', pos: [0.32 * k, 0.72 * k, -0.2] });
  } else if (style === 'mono') {
    // Turret head with a three-lens cluster.
    part('head', G.box(0.85 * k, 0.6 * k, 0.8 * k, 0.12), { pos: [0, 0.3 * k, 0] });
    part('head', G.cyl(0.24 * k, 0.24 * k, 0.3, 10), { paint: 'dark', pos: [0, 0.32 * k, 0.45 * k], rot: [Math.PI / 2, 0, 0] });
    for (const [x, y, r] of [[0, 0.36, 0.13], [-0.14, 0.24, 0.07], [0.15, 0.24, 0.06]]) {
      part('head', G.cyl(r * k, r * k, 0.08, 10), { paint: 'glow', pos: [x * k, y * k, 0.61 * k], rot: [Math.PI / 2, 0, 0] });
    }
    part('head', G.box(0.06, 0.55 * k, 0.06, 0.01), { paint: 'metal', pos: [-0.35 * k, 0.75 * k, -0.2] });
  } else if (style === 'visor' || style === 'crest') {
    part('head', G.trap(0.7 * k, 0.85 * k, 0.62 * k, 0.85 * k, 0.12), { pos: [0, 0.3 * k, 0] });
    part('head', G.trap(0.62 * k, 0.5 * k, 0.12 * k, 0.1, 0.02), { paint: 'glow', pos: [0, 0.38 * k, 0.43 * k] });
    part('head', G.trap(0.42 * k, 0.28 * k, 0.26 * k, 0.28, 0.05), { paint: 'secondary', pos: [0, 0.1 * k, 0.4 * k] });
    for (const sx of [1, -1]) part('head', G.box(0.14, 0.4 * k, 0.5 * k, 0.03), { paint: 'dark', pos: [sx * 0.45 * k, 0.28 * k, 0] });
    if (style === 'crest') {
      // Semaphore-arm crest: a railway signal arm the commander raises.
      part('crest', G.box(0.1, 0.5, 0.1, 0.02), { paint: 'dark', pos: [0.12, 0.1, -0.15] });
      part('crest', G.box(1.3 * k, 0.18, 0.08, 0.04), { paint: 'accent', pos: [0.62 * k, 0.32, -0.15] });
      part('crest', G.box(0.1, 0.19, 0.09, 0.02), { paint: 'secondary', pos: [1.0 * k, 0.32, -0.15] });
      part('crest', G.cyl(0.08, 0.08, 0.06, 10), { paint: 'glow', color: '#ff5a3d', pos: [0.12, 0.32, -0.08], rot: [Math.PI / 2, 0, 0] });
    } else {
      part('crest', G.box(0.06, 0.45, 0.06, 0.01), { paint: 'metal', pos: [0.3 * k, 0.05, -0.25] });
    }
  } else if (style === 'hood') {
    // Derrick: head sunk between the shoulders under a hood.
    part('head', G.trap(1.0 * k, 1.1 * k, 0.55 * k, 0.9 * k, 0.15), { pos: [0, 0.28 * k, 0] });
    part('head', G.box(0.8 * k, 0.1 * k, 0.1, 0.02), { paint: 'glow', pos: [0, 0.22 * k, 0.46 * k] });
    part('head', G.trap(1.2 * k, 1.1 * k, 0.2, 1.1 * k, 0.05), { paint: 'secondary', pos: [0, 0.6 * k, -0.05] });
  } else if (style === 'sensor') {
    // Gauge: long sensor head with a raised rangefinder crest.
    part('head', G.box(0.62 * k, 0.5 * k, 1.1 * k, 0.12), { pos: [0, 0.3 * k, 0.05] });
    part('head', G.box(0.5 * k, 0.1 * k, 0.1, 0.02), { paint: 'glow', pos: [0, 0.34 * k, 0.61 * k] });
    part('crest', G.box(0.9 * k, 0.22, 0.3, 0.05), { paint: 'dark', pos: [0, -0.05, -0.1] });
    for (const sx of [1, -1]) part('crest', G.cyl(0.1, 0.1, 0.12, 10), { paint: 'glow', pos: [sx * 0.42 * k, -0.05, 0.08], rot: [Math.PI / 2, 0, 0] });
  }
}

function buildPauldron(c: Collector, P: BodyPlan, sx: number, s: 'L' | 'R'): void {
  const b = P.bulk;
  const bone = `pauldron_${s}` as const;
  const part = c.part.bind(c);
  if (P.pauldron === 'round') {
    part(bone, G.cyl(0.62 * b, 0.7 * b, 0.9 * b, 10), { paint: 'secondary', pos: [0.15 * sx, 0.05, 0] });
    part(bone, G.box(0.2, 0.2, 0.9 * b, 0.03), { paint: 'accent', pos: [0.62 * b * sx, 0.05, 0] });
  } else if (P.pauldron === 'block') {
    part(bone, G.trap(1.15 * b, 1.4 * b, 1.05, 1.3 * b, 0.14), { paint: 'secondary', pos: [0.3 * sx, 0.1, 0], rot: [0, 0, -0.18 * sx] });
    part(bone, G.box(0.3, 0.9, 1.1 * b, 0.05), { paint: 'accent', pos: [0.95 * b * sx, -0.05, 0], rot: [0, 0, -0.18 * sx] });
  } else if (P.pauldron === 'tall') {
    part(bone, G.trap(1.3 * b, 1.6 * b, 1.6, 1.5 * b, 0.18), { paint: 'secondary', pos: [0.4 * sx, 0.3, 0], rot: [0, 0, -0.12 * sx] });
    part(bone, G.box(0.9 * b, 0.35, 1.2 * b, 0.06), { paint: 'dark', pos: [0.4 * sx, 1.15, 0] });
    for (const z of [-0.35, 0, 0.35]) part(bone, G.box(0.7 * b, 0.07, 0.12, 0.01), { paint: 'glow', pos: [0.4 * sx, 1.33, z * b] });
    part(bone, G.box(0.32, 1.3, 1.25 * b, 0.05), { paint: 'accent', pos: [1.08 * b * sx, 0.2, 0], rot: [0, 0, -0.12 * sx] });
  }
}

function buildPack(c: Collector, P: BodyPlan): void {
  const part = c.part.bind(c);
  if (P.pack === 'small') {
    part('backpack', G.box(1.3, 1.1, 0.55, 0.1));
    part('backpack', G.box(0.9, 0.12, 0.1, 0.02), { paint: 'glow', pos: [0, -0.35, -0.3] });
    return;
  }
  const big = P.pack === 'bigjets' || P.pack === 'crane';
  const j = big ? 1.3 : 1;
  part('backpack', G.box(big ? 1.9 : 1.5, big ? 1.5 : 1.3, 0.75, 0.14));
  for (const s of ['L', 'R'] as const) {
    part(`jet_${s}`, G.cyl(0.26 * j, 0.36 * j, 0.7, 10), { paint: 'dark', pos: [0, -0.1, -0.2] });
    part(`jet_${s}`, G.cyl(0.24 * j, 0.24 * j, 0.05, 10), { paint: 'glow', pos: [0, -0.46, -0.2] });
  }
  if (P.pack === 'crane') {
    // A folded works-crane boom on the back: the Gantry's namesake.
    part('backpack', G.box(0.35, 3.2, 0.35, 0.05), { paint: 'hazard', pos: [0.55, 1.4, -0.3], rot: [0, 0, -0.08] });
    part('backpack', G.box(0.35, 3.2, 0.35, 0.05), { paint: 'hazard', pos: [-0.55, 1.4, -0.3], rot: [0, 0, 0.08] });
    part('backpack', G.box(1.5, 0.3, 0.4, 0.05), { paint: 'dark', pos: [0, 2.95, -0.3] });
    part('backpack', G.cyl(0.12, 0.12, 0.4, 8), { paint: 'glow', color: '#ff5a3d', pos: [0, 3.2, -0.3] });
  }
}

// ── weapons ─────────────────────────────────────────────────────────────
// Long guns lie along the hand's -Y (the forearm direction), grip at the socket.

type WeaponBuilder = (part: (geo: BufferGeometry, o?: PartOpts) => void) => void;

export const WEAPONS: Record<WeaponKind, WeaponBuilder> = {
  scribeRifle(p) {
    p(G.box(0.36, 2.2, 0.55, 0.06), { paint: 'dark', pos: [0, -0.7, 0.25] });
    p(G.box(0.22, 1.6, 0.26, 0.04), { paint: 'metal', pos: [0, -2.4, 0.3] });
    p(G.cyl(0.16, 0.16, 0.2, 10), { paint: 'glow', pos: [0, -3.25, 0.3] });
    p(G.box(0.3, 0.5, 0.25, 0.04), { paint: 'secondary', pos: [0, -0.5, 0.62] });
    p(G.box(0.3, 0.9, 0.35, 0.05), { paint: 'dark', pos: [0, 0.6, 0.2] });
    p(G.box(0.1, 0.8, 0.1, 0.02), { paint: 'glow', pos: [0.19, -1.2, 0.25] });
  },
  knockerCarbine(p) {
    p(G.box(0.34, 1.5, 0.5, 0.06), { paint: 'dark', pos: [0, -0.5, 0.25] });
    for (let i = 0; i < 3; i++) p(G.cyl(0.24, 0.24, 0.14, 10), { paint: 'accent', pos: [0, -1.35 - i * 0.28, 0.3] });
    p(G.cyl(0.13, 0.13, 1.0, 8), { paint: 'metal', pos: [0, -1.65, 0.3] });
    p(G.cyl(0.15, 0.15, 0.08, 10), { paint: 'glow', pos: [0, -2.2, 0.3] });
    p(G.box(0.28, 0.5, 0.4, 0.05), { paint: 'dark', pos: [0, -0.35, 0.75] });
  },
  knockerPistol(p) {
    p(G.box(0.28, 0.9, 0.42, 0.05), { paint: 'dark', pos: [0, -0.45, 0.25] });
    p(G.cyl(0.18, 0.18, 0.12, 10), { paint: 'accent', pos: [0, -0.95, 0.3] });
    p(G.cyl(0.11, 0.11, 0.06, 10), { paint: 'glow', pos: [0, -1.02, 0.3] });
  },
  knockerCannon(p) {
    p(G.box(0.55, 2.4, 0.8, 0.1), { paint: 'dark', pos: [0, -0.8, 0.35] });
    for (let i = 0; i < 4; i++) p(G.cyl(0.42, 0.42, 0.2, 12), { paint: 'accent', pos: [0, -2.1 - i * 0.4, 0.4] });
    p(G.cyl(0.26, 0.3, 1.8, 10), { paint: 'metal', pos: [0, -2.7, 0.4] });
    p(G.cyl(0.24, 0.24, 0.1, 12), { paint: 'glow', pos: [0, -3.62, 0.4] });
    p(G.box(0.5, 0.8, 0.5, 0.06), { paint: 'secondary', pos: [0, -0.6, 0.95] });
  },
  spikeDriver(p) {
    p(G.box(0.42, 2.0, 0.6, 0.06), { paint: 'dark', pos: [0, -0.5, 0.25] });
    for (const x of [-0.16, 0.16]) p(G.box(0.1, 3.4, 0.3, 0.02), { paint: 'metal', pos: [x, -2.8, 0.3] });
    for (let i = 0; i < 6; i++) p(G.box(0.46, 0.08, 0.42, 0.02), { paint: 'glow', pos: [0, -1.6 - i * 0.48, 0.3] });
    p(G.trap(0.14, 0.02, 0.5, 0.14, 0.02), { paint: 'secondary', pos: [0, -1.4, 0.3], rot: [0, 0, Math.PI] });
    p(G.box(0.3, 1.0, 0.35, 0.05), { paint: 'dark', pos: [0, 0.7, 0.2] });
    p(G.box(0.3, 0.7, 0.3, 0.05), { paint: 'secondary', pos: [0, -0.6, 0.7] });
  },
  rivetGun(p) {
    p(G.box(0.36, 1.0, 0.5, 0.06), { paint: 'dark', pos: [0, -0.45, 0.25] });
    p(G.cyl(0.36, 0.36, 0.35, 10), { paint: 'hazard', pos: [0, -0.4, 0.75], rot: [0, 0, Math.PI / 2] });
    p(G.cyl(0.2, 0.26, 0.6, 8), { paint: 'metal', pos: [0, -1.2, 0.3] });
  },
  scribeKnife(p) {
    p(G.box(0.18, 0.4, 0.22, 0.03), { paint: 'dark', pos: [0, -0.2, 0.2] });
    p(G.trap(0.03, 0.16, 1.1, 0.05, 0.01), { paint: 'glow', pos: [0, -0.9, 0.2], rot: [0, 0, Math.PI] });
  },
  heatChisel(p) {
    p(G.box(0.26, 0.9, 0.3, 0.04), { paint: 'dark', pos: [0, -0.3, 0.2] });
    p(G.box(0.5, 0.18, 0.4, 0.04), { paint: 'accent', pos: [0, -0.8, 0.2] });
    p(G.trap(0.9, 0.55, 2.4, 0.14, 0.06), { paint: 'metal', pos: [0, -2.1, 0.2], rot: [0, 0, Math.PI] });
    p(G.box(0.9, 0.12, 0.16, 0.02), { paint: 'glow', color: '#ffb04a', pos: [0, -3.3, 0.2] });
  },
  maul(p) {
    p(G.cyl(0.14, 0.14, 4.2, 8), { paint: 'dark', pos: [0, -0.9, 0.2] });
    p(G.box(1.8, 1.0, 1.0, 0.14), { paint: 'secondary', pos: [0, -3.1, 0.2], rot: [0, 0, Math.PI / 2] });
    for (const y of [-2.35, -3.85]) p(G.box(1.1, 0.12, 1.1, 0.02), { paint: 'glow', pos: [0, y, 0.2] });
    p(G.box(1.1, 0.5, 1.05, 0.08), { paint: 'accent', pos: [0, -3.1, 0.2] });
  },
  piledriver(p) {
    p(G.box(1.1, 3.0, 1.1, 0.15), { paint: 'dark', pos: [0, -1.0, 0.1] });
    p(G.box(1.2, 1.4, 1.2, 0.12), { paint: 'hazard', pos: [0, -0.4, 0.1] });
    for (let i = 0; i < 3; i++) p(G.cyl(0.6, 0.6, 0.18, 12), { paint: 'accent', pos: [0, -1.6 - i * 0.35, 0.1] });
    p(G.cyl(0.18, 0.18, 2.6, 8), { paint: 'metal', pos: [0, -3.1, 0.1] });
    p(G.cyl(0.01, 0.2, 0.9, 8), { paint: 'bright', pos: [0, -4.8, 0.1], rot: [Math.PI, 0, 0] });
  },
  knellLance(p) {
    p(G.cyl(0.16, 0.16, 3.4, 8), { paint: 'dark', pos: [0, -1.0, 0.2] });
    p(G.box(1.1, 0.35, 0.45, 0.06), { paint: 'accent', pos: [0, -2.7, 0.2] });
    for (const x of [-0.42, 0.42]) p(G.box(0.18, 3.0, 0.3, 0.04), { paint: 'secondary', pos: [x, -4.3, 0.2] });
    p(G.box(0.62, 2.8, 0.03, 0.005), { paint: 'glow', color: '#b9fff4', pos: [0, -4.35, 0.2] });
    for (let i = 0; i < 5; i++) p(G.box(0.66, 0.05, 0.05, 0.01), { paint: 'glow', pos: [0, -3.2 - i * 0.55, 0.2] });
  },
  longScribe(p) {
    p(G.box(0.7, 0.8, 1.8, 0.1), { paint: 'dark', pos: [0, 0.2, 0] });
    p(G.box(0.35, 0.35, 3.8, 0.05), { paint: 'metal', pos: [0, 0.3, 2.3] });
    p(G.box(0.5, 0.5, 0.6, 0.06), { paint: 'accent', pos: [0, 0.3, 1.1] });
    p(G.cyl(0.2, 0.2, 0.1, 10), { paint: 'glow', pos: [0, 0.3, 4.25], rot: [Math.PI / 2, 0, 0] });
  },
  cinders(p) {
    p(G.box(1.2, 0.9, 1.1, 0.1), { paint: 'secondary', pos: [0, 0.35, 0] });
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) p(G.cyl(0.09, 0.09, 0.05, 8), { paint: 'accent', pos: [-0.39 + i * 0.26, 0.1 + j * 0.25, 0.56], rot: [Math.PI / 2, 0, 0] });
    }
  },
  mortar(p) {
    p(G.box(1.0, 0.8, 1.2, 0.1), { paint: 'dark', pos: [0, 0.2, 0] });
    p(G.cyl(0.42, 0.46, 2.6, 12), { paint: 'secondary', pos: [0, 1.5, 0.35], rot: [0.45, 0, 0] });
    p(G.cyl(0.47, 0.47, 0.25, 12), { paint: 'accent', pos: [0, 2.55, 0.85], rot: [0.45, 0, 0] });
  },
  lidEmitter(p) {
    p(G.box(0.8, 0.9, 0.8, 0.1), { paint: 'dark', pos: [0, 0.3, 0] });
    p(G.cyl(0.8, 0.45, 0.3, 12), { paint: 'secondary', pos: [0, 1.0, 0.1] });
    p(G.cyl(0.55, 0.55, 0.05, 12), { paint: 'glow', pos: [0, 1.17, 0.1] });
  },
  bufferKite(p) {
    p(G.trap(1.7, 0.9, 3.2, 0.25, 0.2), { paint: 'secondary', pos: [0.05, -0.2, 0.2], rot: [0, Math.PI / 2, 0] });
    p(G.trap(1.1, 0.55, 2.3, 0.1, 0.1), { paint: 'accent', pos: [0.18, -0.25, 0.2], rot: [0, Math.PI / 2, 0] });
    p(G.box(0.06, 1.6, 0.9, 0.01), { paint: 'glow', pos: [0.25, -0.2, 0.2] });
  },
  bufferBoard(p) {
    p(G.box(0.22, 2.2, 1.5, 0.1), { paint: 'secondary', pos: [0.1, -0.2, 0.25] });
    p(G.box(0.04, 0.3, 1.4, 0.01), { paint: 'hazard', pos: [0.22, -1.1, 0.25] });
  },
  bufferWall(p) {
    p(G.box(0.3, 4.6, 2.3, 0.18), { paint: 'secondary', pos: [0.1, -0.5, 0.3] });
    p(G.box(0.1, 3.6, 0.5, 0.05), { paint: 'accent', pos: [0.26, -0.5, 0.3] });
    for (const y of [0.9, -1.9]) p(G.box(0.08, 0.1, 1.9, 0.01), { paint: 'glow', pos: [0.27, y, 0.3] });
  },
  tongsArm(p) {
    p(G.box(0.3, 1.8, 0.3, 0.04), { paint: 'hazard', pos: [0, 0.9, 0.3], rot: [0.5, 0, 0] });
    p(G.box(0.25, 1.2, 0.25, 0.04), { paint: 'dark', pos: [0, 1.9, 1.3], rot: [1.6, 0, 0] });
    p(G.box(0.08, 0.3, 0.08, 0.02), { paint: 'glow', color: '#ffd07a', pos: [0, 1.9, 2.0] });
  },
  cloak(p) {
    for (const x of [-0.55, 0.55]) p(G.box(0.1, 1.4, 0.6, 0.03), { paint: 'dark', pos: [x, 0.3, -0.1], rot: [0, 0, x * 0.5] });
    for (const x of [-0.55, 0.55]) p(G.box(0.04, 1.1, 0.4, 0.01), { paint: 'glow', color: '#9ffff0', pos: [x * 1.05, 0.3, -0.1], rot: [0, 0, x * 0.5] });
  },
};

// ── pistons ─────────────────────────────────────────────────────────────

interface Piston {
  group: Group;
  sleeve: Mesh;
  rod: Mesh;
  a: Group;
  la: Vector3;
  b: Group;
  lb: Vector3;
}

function pistonMesh(r: number, paint: FramePaint, livery: FrameLivery): Mesh {
  const d: Draft = { geo: G.cyl(r, r, 1, 8), color: new Color(livery[paint]), surface: [900, 0, SURFACE[paint][1], 0] };
  const m = new Mesh(finish(d), frameMaterial());
  return m;
}

// ── the frame ───────────────────────────────────────────────────────────

/** Bones whose armour can touch the ground (feet, toes, knees). */
const CONTACT_BONES: readonly BoneName[] = ['foot_L', 'foot_R', 'toe_L', 'toe_R', 'shin_L', 'shin_R'];

/**
 * Ground probes for one bone mesh: its support points in 26 directions (the
 * extreme vertices of its convex hull), in bone space. Whatever the pose, the
 * lowest point of the mesh is one of these, to within a few centimetres.
 */
function supportPoints(g: BufferGeometry): Vector3[] {
  const pos = g.getAttribute('position');
  const out: Vector3[] = [];
  const v = new Vector3();
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        let best = -Infinity;
        let bi = 0;
        for (let i = 0; i < pos.count; i++) {
          const d = pos.getX(i) * x + pos.getY(i) * y + pos.getZ(i) * z;
          if (d > best) {
            best = d;
            bi = i;
          }
        }
        v.fromBufferAttribute(pos, bi);
        if (!out.some((o) => o.distanceToSquared(v) < 1e-6)) out.push(v.clone());
      }
    }
  }
  return out;
}

const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _up = new Vector3(0, 1, 0);
const _inv = new Matrix4();

/**
 * A built, animated Kessen frame. `root` is yours to place (origin at the
 * feet, +Z forward); the frame keeps itself standing on y = 0 of `root`.
 */
export class KessenFrame {
  readonly root = new Group();
  /** Scale + ground offset (inside `root`). */
  private readonly rig = new Group();
  readonly bones = {} as Record<BoneName, Group>;
  readonly meshes: Mesh[] = [];
  readonly height: number;
  /** Canonical metres → world metres, so the top of the head sits at the Stature's height. */
  scale = 1;
  readonly triangles: number;
  private readonly pistons: Piston[] = [];
  private readonly probes: [BoneName, Vector3][] = [];
  private readonly hipY: number;

  private clipId: ClipId = 'idle';
  private clipTime = 0;
  private prevId: ClipId = 'idle';
  private prevTime = 0;
  private fade = 0;
  private fadeLen = 0;
  private readonly bufA = createPoseBuffer();
  private readonly bufB = createPoseBuffer();
  private readonly pose = createPoseBuffer();

  constructor(
    readonly variant: FrameVariant,
    livery: FrameLivery = KESSEN_LIVERY,
  ) {
    const info = statureOf(variant);
    const P = PLANS[info.plan];
    this.height = info.height;
    this.root.name = `kessen:${variant.id}`;
    this.root.add(this.rig);

    for (const [name, parent] of BONE_TREE) {
      const g = new Group();
      g.name = name;
      this.bones[name] = g;
      if (parent) this.bones[parent].add(g);
    }
    this.rig.add(this.bones.root);
    const L = layoutBones(this.bones, P);
    this.hipY = L.hipY;

    const c = new Collector(livery);
    buildBody(c, L, variant);
    for (const w of variant.weapons) WEAPONS[w.kind]((geo, o) => c.part(w.bone, geo, o));

    const mat = frameMaterial();
    let tris = 0;
    for (const name of BONE_NAMES) {
      const drafts = c.byBone.get(name);
      if (!drafts?.length) continue;
      const merged = mergeGeometries(drafts.map(finish), false);
      if (!merged) throw new Error(`KessenFrame: could not merge ${variant.id}/${name}`);
      merged.computeBoundingSphere();
      tris += merged.getAttribute('position').count / 3;
      const mesh = new Mesh(merged, mat);
      mesh.name = `kessen:${variant.id}:${name}`;
      this.bones[name].add(mesh);
      this.meshes.push(mesh);
      if (CONTACT_BONES.includes(name)) for (const p of supportPoints(merged)) this.probes.push([name, p]);
    }

    // Hydraulics: thigh→shin and upperarm→forearm, re-aimed after every pose.
    const b = P.bulk;
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      this.addPiston(`thigh_${s}`, [0.46 * b * sx, -L.thigh * 0.25, -0.2], `shin_${s}`, [0.5 * b * sx, -L.shin * 0.35, -0.2], 0.09 * b, livery);
      this.addPiston(`upperarm_${s}`, [0, -L.uArm * 0.2, -0.38 * b], `forearm_${s}`, [0, -L.fArm * 0.35, -0.45 * b], 0.07 * b, livery);
    }
    for (const p of this.pistons) tris += (p.sleeve.geometry.getAttribute('position').count * 2) / 3;
    this.triangles = tris;

    // Measure standing height: the top of the head armour, feet planted.
    this.apply(createPoseBuffer(), true);
    let top = -Infinity;
    const headMesh = this.bones.head.children.find((o): o is Mesh => o instanceof Mesh);
    if (headMesh) {
      _inv.copy(this.bones.root.matrixWorld).invert();
      for (const p of supportPoints(headMesh.geometry)) top = Math.max(top, _a.copy(p).applyMatrix4(headMesh.matrixWorld).applyMatrix4(_inv).y);
      top += this.rig.position.y;
    }
    this.scale = Number.isFinite(top) && top > 0 ? info.height / top : 1;
    this.rig.scale.setScalar(this.scale);

    this.play('idle', 0);
    this.update(0);
  }

  private addPiston(a: BoneName, la: V3, b: BoneName, lb: V3, r: number, livery: FrameLivery): void {
    const group = new Group();
    const sleeve = pistonMesh(r, 'metal', livery);
    const rod = pistonMesh(r * 0.55, 'bright', livery);
    group.add(sleeve, rod);
    this.bones.root.add(group);
    this.meshes.push(sleeve, rod);
    this.pistons.push({ group, sleeve, rod, a: this.bones[a], la: new Vector3(...la), b: this.bones[b], lb: new Vector3(...lb) });
  }

  get clip(): ClipId {
    return this.clipId;
  }

  /** Cross-fade to a clip over `fade` seconds (0 = cut). */
  play(clip: ClipId, fade = 0.35): void {
    if (clip === this.clipId && this.fadeLen === 0 && fade > 0) return;
    this.prevId = this.clipId;
    this.prevTime = this.clipTime;
    this.clipId = clip;
    this.clipTime = 0;
    this.fadeLen = fade;
    this.fade = 0;
  }

  update(dt: number): void {
    this.clipTime += dt;
    this.prevTime += dt;
    const ctx = { stance: this.variant.stance, stature: this.variant.stature };
    sampleClip(this.clipId, HELD.has(this.clipId) ? 0 : this.clipTime, ctx, this.bufB);
    if (this.fadeLen > 0) {
      this.fade = Math.min(1, this.fade + dt / this.fadeLen);
      sampleClip(this.prevId, HELD.has(this.prevId) ? 0 : this.prevTime, ctx, this.bufA);
      const w = this.fade * this.fade * (3 - 2 * this.fade);
      blendPoses(this.bufA, this.bufB, w, this.pose);
      if (this.fade >= 1) this.fadeLen = 0;
      this.apply(this.pose, this.clipId !== 'boost');
    } else {
      this.apply(this.bufB, this.clipId !== 'boost');
    }
  }

  /** Pose the rig, re-aim the pistons and (optionally) plant the lowest contact on y = 0. */
  apply(p: PoseBuffer, grounded: boolean): void {
    for (const n of BONE_NAMES) {
      if (n === 'root') continue;
      const r = p.rot[n];
      this.bones[n].rotation.set(r[0], r[1], r[2]);
    }
    this.bones.hips.position.y = this.hipY - p.hipsDrop;
    this.rig.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);

    // Pistons live in bones.root space.
    _inv.copy(this.bones.root.matrixWorld).invert();
    for (const pi of this.pistons) {
      _a.copy(pi.la).applyMatrix4(pi.a.matrixWorld).applyMatrix4(_inv);
      _b.copy(pi.lb).applyMatrix4(pi.b.matrixWorld).applyMatrix4(_inv);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _d.divideScalar(len || 1);
      pi.group.position.copy(_a);
      pi.group.quaternion.setFromUnitVectors(_up, _d);
      pi.sleeve.scale.set(1, len * 0.6, 1);
      pi.sleeve.position.set(0, len * 0.3, 0);
      pi.rod.scale.set(1, len * 0.6, 1);
      pi.rod.position.set(0, len * 0.7, 0);
    }

    // Ground: lowest probe in bones.root space (canonical metres).
    let lo = Infinity;
    if (grounded) {
      for (const [bone, v] of this.probes) {
        _a.copy(v).applyMatrix4(this.bones[bone].matrixWorld).applyMatrix4(_inv);
        if (_a.y < lo) lo = _a.y;
      }
    } else lo = 0;
    this.rig.position.y = (-lo + p.lift) * this.scale;
    this.root.updateMatrixWorld(true);
  }
}
