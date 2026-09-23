import { AdditiveBlending, Color, DoubleSide, Group, IcosahedronGeometry, MathUtils, Mesh, Quaternion, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  dot,
  float,
  floor,
  mx_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { Blueprint, Part, Station } from '@/assets/Blueprint';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num } from './types';
import { LightPoints, LIGHT_FLICKER, LIGHT_STROBE, type LightSpec } from './LightPoints';
import { fxMix } from './fxMix';
import { useBlendedMRT } from '../BlendedMRT';
import { mulberry, ownHullMaterial, seedOf, smooth } from './util';
import type { CelMaterial } from '@/render/materials/CelMaterial';

/** Authoring units are hectometres; the hull runs z = -8 … +8.2. */
const FORE: Station[] = [
  { z: 0.55, w: 2.05, h: 2.3, c: 0.62 },
  { z: 2.4, w: 2.3, h: 2.5, c: 0.72, y: 0.05 },
  { z: 4.6, w: 1.85, h: 2.05, c: 0.62, y: 0.12 },
  { z: 6.6, w: 1.0, h: 1.25, c: 0.35, y: 0.25 },
  { z: 8.2, w: 0.16, h: 0.26, c: 0.05, y: 0.42 },
];
const AFT: Station[] = [
  { z: -8.0, w: 1.3, h: 1.55, c: 0.4 },
  { z: -7.0, w: 1.95, h: 2.25, c: 0.6 },
  { z: -4.0, w: 2.45, h: 2.65, c: 0.75 },
  { z: -0.75, w: 2.1, h: 2.4, c: 0.62 },
];
const HULL_LEN = 16.2;

function derelictBlueprint(seed: number): Blueprint {
  const r = mulberry(seed);
  const aft = { articulation: 'aft' } as const;
  const parts: Part[] = [
    // ── fore section: open (broken) at its aft end ──
    { name: 'fore-hull', paint: 'primary', group: 1, shape: { kind: 'loft', stations: FORE, capStart: false } },
    { name: 'fore-bulkhead', paint: 'dark', pos: [0, 0, 0.85], shape: { kind: 'box', w: 1.85, h: 2.1, d: 0.12, c: 0.55 } },
    { name: 'fore-deck', paint: 'metal', pos: [0, -0.35, 0.72], shape: { kind: 'box', w: 1.7, h: 0.08, d: 0.3 } },
    { name: 'fore-deck2', paint: 'metal', pos: [0, 0.4, 0.66], shape: { kind: 'box', w: 1.6, h: 0.06, d: 0.2 } },
    { name: 'prow-band', paint: 'accent', shape: { kind: 'loft', stations: [{ z: 5.9, w: 1.52, h: 1.72, c: 0.5, y: 0.19 }, { z: 6.15, w: 1.45, h: 1.64, c: 0.48, y: 0.2 }] } },
    { name: 'eye', paint: 'glass', pos: [0, 0.78, 5.2], shape: { kind: 'dome', radius: 0.42, segments: 16, scale: [1, 0.55, 2.2] } },
    { name: 'eye-brow', paint: 'secondary', pos: [0, 0.98, 5.0], shape: { kind: 'box', w: 0.9, h: 0.08, d: 1.4, c: 0.03 } },
    // Collars — the "gill" hoops of the old builders (verdigris), one broken.
    { name: 'collar', paint: 'secondary', pos: [0, 0.1, 3.2], shape: { kind: 'rib', radius: 1.52, thickness: 0.16, depth: 0.3, arc: 360, segments: 40, c: 0.04 }, repeat: { count: 3, step: [0, 0, -0.75] } },
    { name: 'hoop', paint: 'accent', pos: [0, 0.2, 4.0], shape: { kind: 'rib', radius: 2.3, thickness: 0.12, depth: 0.22, arc: 150, start: 15, segments: 28, c: 0.03 } },
    { name: 'hoop-broken', paint: 'accent', pos: [0, 0.2, 1.5], shape: { kind: 'rib', radius: 2.45, thickness: 0.12, depth: 0.22, arc: 95, start: 25, segments: 20, c: 0.03 } },
    // Dorsal crescent sail and ventral keel.
    { name: 'sail', paint: 'primary', pos: [0, 1.05, 3.4], rot: [0, 0, 90], shape: { kind: 'wing', root: 4.6, tip: 0.5, span: 2.6, sweep: 3.2, thickness: 0.14, bevel: 1 } },
    { name: 'sail-edge', paint: 'accent', pos: [0, 1.05, 3.45], rot: [0, 0, 90], shape: { kind: 'wing', root: 0.25, tip: 0.1, span: 2.62, sweep: 3.35, thickness: 0.18, bevel: 1 } },
    { name: 'keel', paint: 'secondary', pos: [0, -1.05, 2.8], rot: [0, 0, -90], shape: { kind: 'wing', root: 3.4, tip: 0.6, span: 1.1, sweep: 1.8, thickness: 0.12, bevel: 1 } },
    { name: 'spine-greeble', paint: 'secondary', trim: 'accent', pos: [0, 1.12, 1.9], shape: { kind: 'greeble', w: 0.9, d: 2.2, count: 22, seed: seed & 255, size: [0.06, 0.22], height: [0.04, 0.14] } },
    // Torn plating around the breach (fore side).
    ...Array.from({ length: 7 }, (_, i): Part => {
      const a = (i / 7) * 360 + r() * 30;
      const rad = MathUtils.degToRad(a);
      return {
        name: `shard-f${i}`,
        paint: i % 3 === 0 ? 'metal' : 'primary',
        pos: [Math.cos(rad) * 1.05, Math.sin(rad) * 1.12, 0.35 - r() * 0.2],
        rot: [r() * 40 - 20, r() * 40 - 20, a + 90],
        shape: { kind: 'box', w: 0.5 + r() * 0.5, h: 0.05, d: 0.35 + r() * 0.4, c: 0.01 },
      };
    }),
    // Exposed frames in the gap.
    { name: 'frame', paint: 'metal', pos: [0, 0, 0.3], shape: { kind: 'rib', radius: 1.05, thickness: 0.08, depth: 0.1, arc: 230, start: 40, segments: 24 } },
    { name: 'frame2', paint: 'metal', pos: [0, 0, -0.1], shape: { kind: 'rib', radius: 1.08, thickness: 0.08, depth: 0.1, arc: 120, start: 200, segments: 16 }, ...aft },
    { name: 'keelbeam', paint: 'metal', pos: [0.2, -0.85, 0.0], rot: [4, 8, 0], shape: { kind: 'box', w: 0.14, h: 0.14, d: 1.6, c: 0.03 } },
    // ── aft section: cracked off and drifting a few degrees ──
    { name: 'aft-hull', paint: 'primary', group: 2, shape: { kind: 'loft', stations: AFT, capEnd: false }, ...aft },
    { name: 'aft-bulkhead', paint: 'dark', pos: [0, 0, -1.05], shape: { kind: 'box', w: 1.95, h: 2.2, d: 0.12, c: 0.58 }, ...aft },
    { name: 'aft-deck', paint: 'metal', pos: [0, -0.3, -0.9], shape: { kind: 'box', w: 1.8, h: 0.08, d: 0.3 }, ...aft },
    ...Array.from({ length: 6 }, (_, i): Part => {
      const a = (i / 6) * 360 + 20 + r() * 30;
      const rad = MathUtils.degToRad(a);
      return {
        name: `shard-a${i}`,
        paint: i % 2 ? 'metal' : 'primary',
        pos: [Math.cos(rad) * 1.12, Math.sin(rad) * 1.2, -0.55 + r() * 0.2],
        rot: [r() * 40 - 20, r() * 40 - 20, a + 90],
        shape: { kind: 'box', w: 0.45 + r() * 0.5, h: 0.05, d: 0.3 + r() * 0.4, c: 0.01 },
        ...aft,
      };
    }),
    { name: 'aft-collar', paint: 'secondary', pos: [0, 0, -3.0], shape: { kind: 'rib', radius: 1.58, thickness: 0.16, depth: 0.3, arc: 360, segments: 40, c: 0.04 }, repeat: { count: 2, step: [0, 0, -0.8] }, ...aft },
    { name: 'aft-hoop', paint: 'accent', pos: [0, 0.2, -2.2], shape: { kind: 'rib', radius: 2.4, thickness: 0.12, depth: 0.22, arc: 150, start: 15, segments: 28, c: 0.03 }, ...aft },
    { name: 'vane', paint: 'primary', mirror: true, pos: [1.0, 0.1, -5.2], rot: [0, 0, -12], shape: { kind: 'wing', root: 2.8, tip: 0.35, span: 3.6, sweep: 3.1, thickness: 0.12, bevel: 1 }, ...aft },
    { name: 'vane-edge', paint: 'accent', mirror: true, pos: [1.0, 0.1, -5.15], rot: [0, 0, -12], shape: { kind: 'wing', root: 0.2, tip: 0.08, span: 3.62, sweep: 3.2, thickness: 0.16, bevel: 1 }, ...aft },
    { name: 'tailfin', paint: 'secondary', pos: [0, 1.0, -5.6], rot: [0, 0, 90], shape: { kind: 'wing', root: 2.4, tip: 0.4, span: 1.5, sweep: 1.9, thickness: 0.12, bevel: 1 }, ...aft },
    {
      name: 'drive',
      paint: 'dark',
      pos: [0, 0, -8.0],
      shape: { kind: 'lathe', profile: [[0.2, -1.1], [0.62, -0.85], [0.7, -0.2], [0.52, 0.05]], segments: 14 },
      ...aft,
    },
    { name: 'drive-ring', paint: 'accent', pos: [0, 0, -8.5], shape: { kind: 'rib', radius: 0.7, thickness: 0.07, depth: 0.14, arc: 360, segments: 24 }, ...aft },
  ];
  return {
    id: 'setpiece-derelict',
    name: 'Ghost Vessel',
    designation: 'PRE-SHATTERING HULL · UNKNOWN',
    faction: 'rustwake',
    shipClass: 'dreadnought',
    scale: 1,
    ramp: 'dramatic',
    parts,
    engines: [],
    articulations: [{ id: 'aft', pivot: [0, 0, -0.3], axis: [0.35, 1, 0.2], range: [-30, 30], rest: 7, mirror: false }],
    livery: {
      primary: '#b7ab93',
      secondary: '#4d6a61',
      accent: '#9d7440',
      dark: '#15151b',
      metal: '#77746c',
      glass: '#2f4a4b',
      glow: '#d9b36a',
      plumeCore: '#fff2d0',
    },
  };
}

/**
 * A pre-Shattering ghost vessel (~1.6 km): ivory, verdigris and bronze, all
 * long curves and hoops — alien, yet shaped by hands. Broken behind the
 * collars, its aft section cracked a few degrees off true, tumbling very
 * slowly. Dead running lights stutter; something in the breach still glows.
 * It sits inside a radiation belt: a faint green-gold haze shell full of
 * sparkling hits, and postFx.radiation while the player is inside it.
 *
 * Params: `length` (m, default 1600), `belt` (belt radius m, default 1.5 ×
 * length), `tumble` (deg/s, default 0.25).
 * Flag: `${tag}-scanned` after 5 s (cumulative) within 300 m of the hull.
 * `scanProgress` 0..1 for the HUD.
 */
export class Derelict implements SetPiece {
  readonly kind: SetPieceKind = 'derelict';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  /** 0..1 cumulative scan hold. */
  scanProgress = 0;
  /** Player's current distance to the hull surface (m). */
  hullDistance = Infinity;
  /** True while the player is inside the radiation belt. */
  inBelt = false;
  private readonly model: ShipModel;
  private readonly scale: number;
  private readonly belt: number;
  private readonly tumble: number;
  private readonly lightsFore: LightPoints;
  private readonly lightsAft: LightPoints;
  private readonly sparkle: LightPoints;
  private readonly shell: Mesh;
  private readonly uTime: Node = uniform(0);
  private readonly uInside: Node = uniform(0);
  private readonly shellMat: MeshBasicNodeMaterial;
  private readonly hullMat: CelMaterial;
  private readonly local = new Vector3();
  private readonly qInv = new Quaternion();
  private readonly baseQuat = new Quaternion();
  private readonly spinQuat = new Quaternion();
  private readonly spinAxis = new Vector3(0.3, 0.8, 0.52).normalize();

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:derelict:${tag}`;
    const length = num(params, 'length', 1600);
    this.scale = length / HULL_LEN;
    this.belt = num(params, 'belt', length * 1.5);
    this.radius = this.belt;
    this.tumble = MathUtils.degToRad(num(params, 'tumble', 0.25));
    const seed = seedOf(tag);
    const rand = mulberry(seed + 17);
    this.baseQuat.setFromAxisAngle(new Vector3(0.1, 0.25, 1).normalize(), 0.35);

    this.model = buildShip({ ...derelictBlueprint(seed), scale: this.scale });
    this.hullMat = ownHullMaterial(this.model.meshes, { ramp: 'dramatic', rimWidth: 0.6, haze: 0.6, inkId: 7600, weather: 1, weatherScale: 1 / (this.scale * 1.6) });
    this.group.add(this.model.root);

    // ── dead running lights (weak, stuttering) ───────────────────────
    const s = this.scale;
    const fore: LightSpec[] = [];
    const aft: LightSpec[] = [];
    const side = (st: Station, x: number) => new Vector3(x * (st.w / 2 + 0.02), (st.y ?? 0) + 0.2, st.z).multiplyScalar(s);
    for (const st of FORE.slice(0, 4)) {
      fore.push({ pos: side(st, 1), color: '#7dffb0', size: 2.5, mode: LIGHT_FLICKER, rate: 0.6 + rand(), phase: rand(), gain: 0.9 });
      fore.push({ pos: side(st, -1), color: '#ff6a4a', size: 2.5, mode: LIGHT_FLICKER, rate: 0.6 + rand(), phase: rand(), gain: 0.9 });
    }
    fore.push({ pos: new Vector3(0, 3.7, 1.0).multiplyScalar(s), color: '#ffd9a0', size: 3, mode: LIGHT_STROBE, rate: 0.23, duty: 0.04, gain: 0.8 });
    // Something in the breach still burns.
    for (let i = 0; i < 5; i++) {
      fore.push({
        pos: new Vector3((rand() - 0.5) * 1.4, (rand() - 0.5) * 1.4, 0.55 + rand() * 0.2).multiplyScalar(s),
        color: i % 2 ? '#ffb45a' : '#ffe6a0',
        size: 4 + rand() * 6,
        mode: LIGHT_FLICKER,
        rate: 1.5 + rand() * 2,
        phase: rand(),
        gain: 1.2,
      });
    }
    for (const st of AFT.slice(1)) {
      aft.push({ pos: side(st, 1).setZ((st.z + 0.3) * s), color: '#7dffb0', size: 2.5, mode: LIGHT_FLICKER, rate: 0.5 + rand(), phase: rand(), gain: 0.7 });
      aft.push({ pos: side(st, -1).setZ((st.z + 0.3) * s), color: '#ff6a4a', size: 2.5, mode: LIGHT_FLICKER, rate: 0.5 + rand(), phase: rand(), gain: 0.7 });
    }
    this.lightsFore = new LightPoints(fore, { minPixels: 1.4, glint: 0.5 });
    this.model.root.add(this.lightsFore.mesh);
    this.lightsAft = new LightPoints(aft, { minPixels: 1.4, glint: 0.5 });
    const aftNode = this.model.articulations.get('aft')?.node ?? this.model.root;
    // Joint nodes sit at the pivot: lights are authored in ship space.
    this.lightsAft.mesh.position.set(0, 0, 0.3 * s);
    aftNode.add(this.lightsAft.mesh);

    // ── radiation belt: haze shell + sparkling hits ───────────────────
    this.shellMat = this.makeShellMaterial();
    this.shell = new Mesh(new IcosahedronGeometry(1, 5), this.shellMat);
    this.shell.scale.setScalar(this.belt);
    this.shell.renderOrder = 6;
    useBlendedMRT(this.shell);
    this.group.add(this.shell);

    const sp: LightSpec[] = [];
    for (let i = 0; i < 420; i++) {
      const d = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      const rr = this.belt * (0.35 + 0.65 * Math.cbrt(rand()));
      sp.push({
        pos: d.multiplyScalar(rr),
        color: rand() < 0.7 ? '#d8f07a' : '#fff0b0',
        size: 1.5 + rand() * 3,
        mode: LIGHT_STROBE,
        rate: 0.15 + rand() * 0.5,
        duty: 0.05,
        phase: rand(),
        gain: 1.4,
      });
    }
    this.sparkle = new LightPoints(sp, { minPixels: 1.1, glint: 1.0, fadeFar: this.belt * 3.2 });
    this.group.add(this.sparkle.mesh);
  }

  private makeShellMaterial(): MeshBasicNodeMaterial {
    const m = new MeshBasicNodeMaterial();
    m.name = 'RadiationBelt';
    m.transparent = true;
    m.depthWrite = false;
    m.blending = AdditiveBlending;
    m.side = DoubleSide;
    const tint: Node = uniform(new Color('#b8d85a'));
    const gold: Node = uniform(new Color('#ffcf6a'));
    m.colorNode = Fn(() => {
      const N: Node = normalize(normalWorld);
      const V: Node = normalize(cameraPosition.sub(positionWorld));
      const f: Node = float(1).sub(abs(dot(N, V)));
      // Posterised aurora sheets drifting across the shell.
      const n: Node = mx_noise_float(positionLocal.mul(vec3(2.2, 5.5, 2.2)).add(vec3(0, this.uTime.mul(0.03), 0)));
      const sheet: Node = floor(smoothstep(0.05, 0.6, n).mul(3.0)).div(3.0);
      const edge: Node = pow(f, 3.0);
      const outside: Node = edge.mul(0.16).add(sheet.mul(edge).mul(0.1));
      const inside: Node = sheet.mul(0.035).add(0.012);
      const k: Node = outside.mul(float(1).sub(this.uInside)).add(inside.mul(this.uInside));
      return tint.mul(k).add(gold.mul(sheet.mul(edge).mul(0.05)));
    })();
    m.mrtNode = noInkMRT();
    return m;
  }

  /** Distance from a universe point to the hull (capsule chain along the spine). */
  hullDistanceTo(p: Vector3): number {
    this.local.subVectors(p, this.position).applyQuaternion(this.qInv.copy(this.group.quaternion).invert());
    const s = this.scale;
    const lz = this.local.z / s;
    const zc = Math.min(8.2, Math.max(-8, lz));
    const st = lz >= 0 ? FORE : AFT;
    let w = 1.0;
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i];
      const b = st[i + 1];
      if (zc >= a.z && zc <= b.z) {
        const f = (zc - a.z) / (b.z - a.z);
        w = MathUtils.lerp(Math.max(a.w, a.h), Math.max(b.w, b.h), f) / 2;
      }
    }
    const dx = this.local.x / s;
    const dy = this.local.y / s;
    const dz = lz - zc;
    return Math.max(0, (Math.sqrt(dx * dx + dy * dy + dz * dz) - w) * s);
  }

  update(ctx: SetPieceFrame): void {
    const t = ctx.time;
    this.spinQuat.setFromAxisAngle(this.spinAxis, t * this.tumble);
    this.group.quaternion.copy(this.baseQuat).multiply(this.spinQuat);
    this.lightsFore.update(t);
    this.lightsAft.update(t);
    this.sparkle.update(t);
    this.uTime.value = t;

    const d = ctx.playerPos.distanceTo(this.position);
    this.inBelt = d < this.belt;
    const eyeIn = ctx.eye.distanceTo(this.position) < this.belt ? 1 : 0;
    this.uInside.value = eyeIn;
    // Subtle warning: ramps in across the belt edge, stronger nearer the hull.
    const rad = smooth(this.belt * 1.02, this.belt * 0.8, d) * (0.45 + 0.35 * smooth(this.belt * 0.8, this.belt * 0.2, d));
    fxMix.set(this, 'radiation', rad);
    fxMix.set(this, 'navNoise', rad * 0.35);

    this.hullDistance = this.hullDistanceTo(ctx.playerPos);
    if (this.scanProgress < 1 && this.hullDistance < 300) {
      this.scanProgress = Math.min(1, this.scanProgress + ctx.dt / 5);
      if (this.scanProgress >= 1) ctx.setFlag(`${this.tag}-scanned`);
    }
  }

  dispose(): void {
    fxMix.release(this);
    this.lightsFore.dispose();
    this.lightsAft.dispose();
    this.sparkle.dispose();
    this.shellMat.dispose();
    this.hullMat.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
