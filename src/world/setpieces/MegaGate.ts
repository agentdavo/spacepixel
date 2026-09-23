import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  atan,
  exp,
  float,
  fract,
  length,
  log,
  mix,
  pow,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
  attribute as tslAttribute,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { Blueprint, Part, Station } from '@/assets/Blueprint';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num, str } from './types';
import { LightPoints, LIGHT_PULSE, LIGHT_STEADY, LIGHT_STROBE, type LightSpec } from './LightPoints';
import { useBlendedMRT } from '../BlendedMRT';
import { smooth } from './util';

/** Authoring units: the outer ring has radius 100; the blueprint is scaled to `radius` metres. */
const U = 100;
const PETALS = 12;
const PETAL_CONE = 32; // degrees the petals lean toward the approach side (+Z)
const PETAL_BASE = 104;
const PETAL_STATIONS: Station[] = [
  { z: 0, w: 30, h: 3.2, c: 1.2 },
  { z: 18, w: 27, h: 2.8, y: -1.5, c: 1.0 },
  { z: 40, w: 17, h: 2.2, y: -5, c: 0.8 },
  { z: 60, w: 7, h: 1.4, y: -10.5, c: 0.5 },
  { z: 74, w: 0.6, h: 0.5, y: -16, c: 0.1 },
];
const RING_B_Z = 16;
const RING_C_Z = -18;
const SPIRE_OFFSET = 15;

/** Part transform for a radial element at `angle` (deg, around Z), radius r, leaning `tilt` deg about its tangent. */
function radialMatrix(angle: number, r: number, z: number, tilt: number): Matrix4 {
  const rz = new Matrix4().makeRotationZ(MathUtils.degToRad(angle));
  const m = new Matrix4().makeTranslation(0, r, z).premultiply(rz);
  return m.multiply(new Matrix4().makeRotationX(MathUtils.degToRad(tilt)));
}
function radialPart(angle: number, r: number, z: number, tilt: number): Pick<Part, 'pos' | 'rot'> {
  const m = radialMatrix(angle, r, z, tilt);
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  const p = new Vector3().setFromMatrixPosition(m);
  return { pos: [p.x, p.y, p.z], rot: [MathUtils.radToDeg(e.x), MathUtils.radToDeg(e.y), MathUtils.radToDeg(e.z)] };
}

function nexusBlueprint(): Blueprint {
  const ring = (r: number, t: number, d: number, paint: Part['paint'], extra: Partial<Part> = {}): Part => ({
    shape: { kind: 'rib', radius: r, thickness: t, depth: d, arc: 360, segments: 144, c: Math.min(t, d) * 0.18 },
    paint,
    ...extra,
  });
  const parts: Part[] = [
    // ── static crown ────────────────────────────────────────────────
    ring(100, 7, 9, 'primary', { name: 'outer-ring' }),
    ring(104.2, 1.4, 11.5, 'secondary', { name: 'outer-band' }),
    ring(96.3, 0.9, 10.6, 'accent', { name: 'inner-lip' }),
    ring(100, 2.2, 12.5, 'dark', { name: 'face-band', pos: [0, 0, 0] }),
    // Radial buttresses and fine ribbing: every copy gets its own ink region → panel lines at every scale.
    { name: 'buttress', paint: 'secondary', pos: [0, 104, 0], shape: { kind: 'box', w: 6.5, h: 13, d: 17, c: 1.8 }, repeat: { count: 24, rot: [0, 0, 15] } },
    { name: 'buttress-cap', paint: 'metal', pos: [0, 110.8, 0], shape: { kind: 'box', w: 3.2, h: 1.2, d: 19, c: 0.4 }, repeat: { count: 24, rot: [0, 0, 15] } },
    { name: 'rib-front', paint: 'primary', pos: [0, 100, 5.2], rot: [0, 0, 3.75], shape: { kind: 'box', w: 1.6, h: 8.2, d: 1.6, c: 0.4 }, repeat: { count: 96, rot: [0, 0, 3.75] } },
    { name: 'rib-back', paint: 'primary', pos: [0, 100, -5.2], rot: [0, 0, 3.75], shape: { kind: 'box', w: 1.6, h: 8.2, d: 1.6, c: 0.4 }, repeat: { count: 96, rot: [0, 0, 3.75] } },
    // Crown spires between the petals (radial, via Rx(-90): +Z → +Y).
    {
      name: 'spire',
      paint: 'primary',
      ...radialPart(SPIRE_OFFSET, 111, 0, -90),
      shape: {
        kind: 'loft',
        stations: [
          { z: 0, w: 7, h: 9, c: 2 },
          { z: 22, w: 3.6, h: 4.2, c: 1 },
          { z: 48, w: 0.4, h: 0.4, c: 0.1 },
        ],
      },
      repeat: { count: 6, rot: [0, 0, 60] },
    },
    // Petals: long blades rooted on the ring, coned toward the approach side.
    { name: 'petal', paint: 'primary', pos: [0, PETAL_BASE, 1.5], rot: [-90 + PETAL_CONE, 0, 0], shape: { kind: 'loft', stations: PETAL_STATIONS }, repeat: { count: PETALS, rot: [0, 0, 360 / PETALS] } },
    {
      name: 'petal-spine',
      paint: 'dark',
      pos: [0, PETAL_BASE, 1.5],
      rot: [-90 + PETAL_CONE, 0, 0],
      shape: { kind: 'loft', stations: PETAL_STATIONS.map((s) => ({ z: s.z, w: s.w * 0.22, h: s.h * 1.5, y: (s.y ?? 0) + 0.3, c: s.c })) },
      repeat: { count: PETALS, rot: [0, 0, 360 / PETALS] },
    },
    // Spokes carry the aperture ring (in the z = 0 plane; the spinning rings sit fore and aft).
    { name: 'spoke', paint: 'secondary', pos: [0, 79, 0], shape: { kind: 'box', w: 3.4, h: 34, d: 4.6, c: 0.9 }, repeat: { count: 8, rot: [0, 0, 45] } },
    ring(61, 3.2, 13, 'secondary', { name: 'aperture' }),
    ring(58.8, 0.8, 13.6, 'dark', { name: 'aperture-lip' }),
    // ── spinning rings (articulated → own meshes) ─────────────────
    ring(82, 4, 6, 'primary', { name: 'ring-b', pos: [0, 0, RING_B_Z], articulation: 'ringB' }),
    { name: 'ring-b-teeth', paint: 'metal', pos: [0, 86, RING_B_Z], shape: { kind: 'box', w: 2.6, h: 5, d: 7.5, c: 0.6 }, repeat: { count: 36, rot: [0, 0, 10] }, articulation: 'ringB' },
    { name: 'ring-b-vanes', paint: 'secondary', pos: [0, 77, RING_B_Z], rot: [0, 25, 0], shape: { kind: 'box', w: 0.8, h: 7, d: 9, c: 0.2 }, repeat: { count: 72, rot: [0, 0, 5] }, articulation: 'ringB' },
    ring(70, 3, 5, 'primary', { name: 'ring-c', pos: [0, 0, RING_C_Z], articulation: 'ringC' }),
    { name: 'ring-c-knobs', paint: 'accent', pos: [0, 73.5, RING_C_Z], shape: { kind: 'box', w: 4, h: 3, d: 6.5, c: 1 }, repeat: { count: 18, rot: [0, 0, 20] }, articulation: 'ringC' },
  ];
  return {
    id: 'setpiece-nexus',
    name: 'The Nexus',
    designation: 'PRE-SHATTERING MEGA-GATE',
    faction: 'choir',
    shipClass: 'dreadnought',
    scale: 1,
    ramp: 'dramatic',
    parts,
    engines: [],
    articulations: [
      { id: 'ringB', pivot: [0, 0, RING_B_Z], axis: [0, 0, 1], range: [0, 360], mirror: false },
      { id: 'ringC', pivot: [0, 0, RING_C_Z], axis: [0, 0, 1], range: [0, 360], mirror: false },
    ],
    livery: {
      primary: '#2c2540',
      secondary: '#17131f',
      accent: '#8e6bd8',
      dark: '#0c0a12',
      metal: '#5e577a',
      glass: '#8b5cff',
      glow: '#9a6bff',
      plumeCore: '#f2e8ff',
    },
  };
}


/**
 * Light-strip ribbons in authoring units: one along the front face of every
 * petal (uv.x = 0 at the root → 1 at the tip) and two circular tracks on the
 * crown and aperture lips (uv.x = angle / 2π). `sinfo` = [kind, index].
 */
function stripGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const info: number[] = [];
  const idx: number[] = [];
  const v = new Vector3();
  const quad = (a: Vector3, b: Vector3, ua: number, ub: number, kind: number, id: number) => {
    const base = pos.length / 3;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(ua, 0, ub, 1);
    info.push(kind, id, kind, id);
    return base;
  };
  // Petals.
  const SUB = 10;
  for (let i = 0; i < PETALS; i++) {
    const m = radialMatrix((360 / PETALS) * i, PETAL_BASE, 1.5, -90 + PETAL_CONE);
    let prev = -1;
    for (let s = 0; s < PETAL_STATIONS.length - 1; s++) {
      const A = PETAL_STATIONS[s];
      const B = PETAL_STATIONS[s + 1];
      for (let k = 0; k < SUB; k++) {
        const f = k / SUB;
        const z = MathUtils.lerp(A.z, B.z, f);
        const y = MathUtils.lerp((A.y ?? 0) - A.h / 2, (B.y ?? 0) - B.h / 2, f) - 0.15;
        const w = Math.max(0.35, MathUtils.lerp(A.w, B.w, f) * 0.09);
        const u = z / PETAL_STATIONS[PETAL_STATIONS.length - 1].z;
        const a = v.set(-w, y, z).applyMatrix4(m).clone();
        const b = v.set(w, y, z).applyMatrix4(m).clone();
        const base = quad(a, b, u, u, 0, i);
        if (prev >= 0) idx.push(prev, prev + 1, base + 1, prev, base + 1, base);
        prev = base;
      }
    }
  }
  // Circular tracks (front faces): crown lip and aperture lip.
  const track = (r: number, width: number, z: number, id: number) => {
    const N = 256;
    let prev = -1;
    let first = -1;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const base = quad(new Vector3(c * (r - width), s * (r - width), z), new Vector3(c * (r + width), s * (r + width), z), k / N, k / N, 1, id);
      if (first < 0) first = base;
      if (prev >= 0) idx.push(prev, prev + 1, base + 1, prev, base + 1, base);
      prev = base;
    }
  };
  track(96.8, 0.45, 5.35, 0);
  track(59.2, 0.4, 6.85, 1);
  track(59.2, 0.4, -6.85, 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('sinfo', new Float32BufferAttribute(info, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * The Nexus — an intact pre-Shattering mega-gate (default outer-ring radius
 * 12 km; ~38 km across the petal tips). A cel-shaded crown of rings,
 * buttresses, spires and twelve coned petals built through the ship kit (one
 * static hull draw + one per spinning ring), dwarfing the Lanterns. Its
 * aperture holds an Ebon-gas "black light" surface: an inverted-core field —
 * black at the heart, ultraviolet at the rim — that forms from the rim inward
 * as the gate wakes. Light pulses run down the petals into the aperture.
 *
 * Params: `radius` (m), `state` 'dormant' | 'awake', `yaw`/`pitch` (deg,
 * default facing +Z), `reach` (m, default 3000).
 * Flags: reads `nexus-awake` (starts the ~14 s awakening); sets
 * `${tag}-reached` within `reach` of the aperture centre.
 */
export class MegaGate implements SetPiece {
  readonly kind: SetPieceKind = 'megagate';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  /** 0 = dormant … 1 = fully awake (smoothed timeline). */
  awake = 0;
  private awakeT = 0;
  private awakening = false;
  private angleB = 0.4;
  private angleC = -0.9;
  private readonly model: ShipModel;
  private readonly lights: LightPoints;
  private readonly strips: Mesh;
  private readonly surface: Mesh;
  private readonly uTime: Node = uniform(0);
  private readonly uAwake: Node = uniform(0);
  private readonly reach: number;
  private readonly startAwake: boolean;
  private readonly owned: MeshBasicNodeMaterial[] = [];

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:megagate:${tag}`;
    const R = num(params, 'radius', 12_000);
    const k = R / U;
    this.radius = R * 1.7;
    this.reach = num(params, 'reach', 3000);
    this.startAwake = str(params, 'state', 'dormant') === 'awake';
    this.group.rotation.set(MathUtils.degToRad(num(params, 'pitch', 0)), MathUtils.degToRad(num(params, 'yaw', 0)), 0, 'YXZ');

    this.model = buildShip({ ...nexusBlueprint(), scale: k });
    this.model.setArticulation('ringB', this.angleB);
    this.model.setArticulation('ringC', this.angleC);
    this.group.add(this.model.root);

    // ── light strips (additive, animated) ────────────────────────────
    const stripMat = new MeshBasicNodeMaterial();
    stripMat.name = 'NexusStrips';
    stripMat.transparent = true;
    stripMat.depthWrite = false;
    stripMat.blending = AdditiveBlending;
    stripMat.side = DoubleSide;
    stripMat.colorNode = this.stripColor();
    stripMat.mrtNode = noInkMRT();
    this.owned.push(stripMat);
    const sg = stripGeometry();
    sg.scale(k, k, k);
    this.strips = new Mesh(sg, stripMat);
    this.strips.renderOrder = 12;
    useBlendedMRT(this.strips);
    this.group.add(this.strips);

    // ── black-light aperture surface ─────────────────────────────────
    const surfMat = new MeshBasicNodeMaterial();
    surfMat.name = 'NexusBlackLight';
    surfMat.transparent = true;
    surfMat.premultipliedAlpha = true;
    surfMat.depthWrite = false;
    surfMat.side = DoubleSide;
    const surf = this.surfaceNodes();
    surfMat.colorNode = surf.rgb;
    surfMat.opacityNode = surf.a;
    surfMat.mrtNode = noInkMRT();
    this.owned.push(surfMat);
    this.surface = new Mesh(new CircleGeometry(58.6 * k, 160), surfMat);
    this.surface.renderOrder = 8;
    useBlendedMRT(this.surface);
    this.group.add(this.surface);

    // ── running lights: spire tips, buttress lamps, aperture beacons ─
    const lights: LightSpec[] = [];
    const v = new Vector3();
    for (let i = 0; i < 6; i++) {
      const a = MathUtils.degToRad(SPIRE_OFFSET + i * 60);
      v.set(-Math.sin(a), Math.cos(a), 0).multiplyScalar(111 + 48.5).multiplyScalar(k);
      lights.push({ pos: v.clone(), color: '#b98cff', size: 1.4 * k, mode: LIGHT_PULSE, rate: 0.25, phase: i / 6, gain: 2.2 });
    }
    for (let i = 0; i < 24; i++) {
      const a = MathUtils.degToRad(i * 15);
      v.set(-Math.sin(a), Math.cos(a), 0).multiplyScalar(111.6 * k).setZ(9.6 * k);
      lights.push({ pos: v.clone(), color: '#8f6bff', size: 0.5 * k, mode: LIGHT_STEADY, gain: 1.1 });
      v.setZ(-9.6 * k);
      lights.push({ pos: v.clone(), color: '#8f6bff', size: 0.5 * k, mode: LIGHT_STEADY, gain: 0.8 });
    }
    for (let i = 0; i < PETALS; i++) {
      const tip = new Vector3(0, -16 - 0.2, 74).applyMatrix4(radialMatrix((360 / PETALS) * i, PETAL_BASE, 1.5, -90 + PETAL_CONE)).multiplyScalar(k);
      lights.push({ pos: tip, color: '#d9c4ff', size: 0.8 * k, mode: LIGHT_STROBE, rate: 0.4, phase: i / PETALS, duty: 0.06, gain: 2.5 });
    }
    this.lights = new LightPoints(lights, { minPixels: 1.8, glint: 0.9 });
    this.group.add(this.lights.mesh);
  }

  /** Petal pulses run tip → root → aperture; ring tracks chase around. Inverted cores: dark centre, UV rims. */
  private stripColor(): Node {
    return Fn(() => {
      const info: Node = (uv() as Node).x; // along
      const across: Node = (uv() as Node).y;
      const along: Node = info;
      const w: Node = this.uAwake;
      const t: Node = this.uTime;
      // Petals (kind 0): pulses travel from the tip (1) to the root (0).
      const p0: Node = fract(along.mul(2.2).add(t.mul(mix(0.05, 0.42, w))));
      const pulseP: Node = smoothstep(0.78, 0.9, p0).mul(float(1).sub(smoothstep(0.92, 0.99, p0)));
      // Tracks (kind 1): chasing segments around the ring.
      const p1: Node = fract(along.mul(24.0).sub(t.mul(mix(0.02, 0.6, w))));
      const pulseT: Node = smoothstep(0.55, 0.62, p1).mul(float(1).sub(smoothstep(0.88, 0.95, p1)));
      const kind: Node = (this.sinfoNode() as Node).x;
      const pulse: Node = mix(pulseP, pulseT, kind);
      // Black light profile across the strip: bright UV rims, dark core.
      const d: Node = abs(across.sub(0.5)).mul(2.0);
      const rims: Node = smoothstep(0.3, 0.62, d).mul(float(1).sub(smoothstep(0.82, 1.0, d)));
      const core: Node = float(1).sub(smoothstep(0.0, 0.35, d));
      const uvC = vec3(0.42, 0.16, 1.35);
      const hot = vec3(0.95, 0.85, 1.4);
      const base: Node = mix(0.05, 0.3, w);
      const lit: Node = pulse.mul(mix(0.25, 3.2, w));
      return uvC.mul(rims.mul(base.add(lit))).add(hot.mul(core.mul(lit).mul(0.35)));
    })();
  }

  private sinfoCache: Node | null = null;
  private sinfoNode(): Node {
    if (!this.sinfoCache) this.sinfoCache = attributeVec2('sinfo');
    return this.sinfoCache;
  }

  private surfaceNodes(): { rgb: Node; a: Node } {
    const out = Fn(() => {
      const q: Node = (uv() as Node).mul(2.0).sub(1.0);
      const r: Node = length(q);
      const ang: Node = atan(q.y, q.x);
      const w: Node = this.uAwake;
      const t: Node = this.uTime;
      // Posterised logarithmic swirl, drawn inward.
      const sw: Node = fract(ang.mul(5.0 / (Math.PI * 2)).add(log(r.add(0.03)).mul(1.7)).add(t.mul(mix(0.004, 0.09, w))));
      const band: Node = smoothstep(0.46, 0.5, sw).mul(float(1).sub(smoothstep(0.8, 0.84, sw)));
      const rim: Node = smoothstep(0.62, 0.99, r);
      const rimHot: Node = smoothstep(0.93, 0.995, r);
      const eye: Node = exp(abs(r.sub(0.13)).mul(-90.0));
      // Forms from the rim inward as the gate wakes.
      const formed: Node = smoothstep(r.sub(0.08), r, w.mul(1.25).sub(0.12)).max(rim.mul(0.35));
      const uvC = vec3(0.34, 0.1, 1.1);
      const col: Node = uvC
        .mul(rim.mul(mix(0.08, 0.9, w)))
        .add(vec3(0.9, 0.7, 1.6).mul(rimHot.mul(mix(0.12, 1.8, w))))
        .add(uvC.mul(band.mul(smoothstep(0.12, 0.9, r)).mul(mix(0.03, 0.45, w))))
        .add(vec3(0.8, 0.6, 1.4).mul(eye.mul(w).mul(1.2)));
      const inner: Node = pow(float(1).sub(r), 0.5);
      const a: Node = formed.mul(mix(0.18, 0.97, w)).mul(mix(1.0, inner.mul(0.3).add(0.7), 0.5)).clamp(0, 1);
      return vec4(col.mul(formed.max(rim.mul(0.5))), a);
    })();
    return { rgb: out.rgb, a: out.a };
  }

  private setAwakeT(t: number): void {
    this.awakeT = t;
    this.awake = smooth(0, 14, t);
  }

  debugSeek(t: number): void {
    if (!this.awakening) return;
    // Integrate the ring spin over the seek so the pose matches a live run.
    const step = 0.1;
    for (let s = this.awakeT; s < t; s += step) {
      this.setAwakeT(s);
      this.angleB += this.awake * 0.012 * step;
      this.angleC -= this.awake * 0.02 * step;
    }
    this.setAwakeT(t);
  }

  update(ctx: SetPieceFrame): void {
    if (!this.awakening && (this.startAwake || ctx.flags.has('nexus-awake'))) {
      this.awakening = true;
      if (this.startAwake) this.setAwakeT(14);
    }
    if (this.awakening) {
      this.setAwakeT(this.awakeT + ctx.dt);
      // The final surge as the black light closes over the aperture.
      if (this.awakeT > 9 && this.awakeT < 9.6) ctx.postFx.flash = Math.max(ctx.postFx.flash, 0.25 * (1 - (this.awakeT - 9) / 0.6));
    }
    this.angleB += this.awake * 0.012 * ctx.dt;
    this.angleC -= this.awake * 0.02 * ctx.dt;
    this.model.setArticulation('ringB', this.angleB);
    this.model.setArticulation('ringC', this.angleC);
    this.uTime.value = ctx.time;
    this.uAwake.value = this.awake;
    this.lights.update(ctx.time);
    this.lights.intensity.value = 0.35 + 0.65 * this.awake;
    if (ctx.playerPos.distanceTo(this.position) < this.reach) ctx.setFlag(`${this.tag}-reached`);
  }

  dispose(): void {
    this.lights.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
    for (const m of this.owned) m.dispose();
  }
}

function attributeVec2(name: string): Node {
  return tslAttribute(name, 'vec2');
}
