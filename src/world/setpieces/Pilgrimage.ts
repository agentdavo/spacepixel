import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Sphere,
  SphereGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  fract,
  max,
  mix,
  mod,
  mx_fractal_noise_float,
  normalize,
  positionGeometry,
  positionLocal,
  positionView,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  varyingProperty,
  vec3,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { inkMRT, noInkMRT } from '@/render/materials/InkChannels';
import { CelMaterial } from '@/render/materials/CelMaterial';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num } from './types';
import { LightPoints, LIGHT_STEADY } from './LightPoints';
import { fxMix } from './fxMix';
import { useBlendedMRT } from '../BlendedMRT';
import { smooth } from './util';

// ── timeline (seconds) ─────────────────────────────────────────────────
const T_HIDE = 3.4; // world hidden under the entry white-out
const T_FLIP = 14.6; // corridor turns from floor/ceiling to walls
const T_LAND = 26; // solarised landscapes
const T_JEWEL = 46; // jewels in the void
const T_ROOM = 58; // the white room
const T_BLACK = 70; // the sphere fills the eye
const T_STAR = 74; // a single star
const T_END = 80; // complete; world returns
const T_OUT = 81.5;

/** Cosine palette (posterised hue wheel), 2001 slit-scan colours. */
function palette(k: Node): Node {
  const a = k.mul(6.2832);
  return vec3(cos(a).mul(0.5).add(0.5), cos(a.sub(2.1)).mul(0.5).add(0.5), cos(a.sub(4.2)).mul(0.5).add(0.5));
}
function hash1(n: Node): Node {
  return fract(sin(n.mul(127.1).add(311.7)).mul(43758.5453));
}

/** Grade keyframes for the landscape section: [invert, solarize, hue]. */
const LAND_GRADES: [number, number, number][] = [
  [1, 0, 0.0],
  [0, 1, 2.1],
  [1, 0.5, 4.0],
  [0, 0.8, 1.0],
  [1, 0, 3.3],
  [0, 1, 5.2],
  [1, 0.3, 0.6],
  [0, 0.6, 2.8],
];

/**
 * The pilgrimage — Project Vanguard's 2001 sequence. When the player enters
 * `radius`, the set piece takes over the frame for ~80 s:
 *
 *   0–3.4    white-out + jump distortion; the world is hidden underneath
 *   3.4–26   the star gate: slit-scan planes of streaming colour (floor and
 *            ceiling, then — hard cut — the walls)
 *   26–46    solarised landscapes: faceted terrain in false colour, hard cuts
 *            between inverted / solarised / hue-rotated grades, "eye blinks"
 *   46–58    jewels: faceted crystals pulsing in the void
 *   58–70    the white room: glowing floor, panelled walls, a black sphere
 *            that the camera drifts into until it fills the eye
 *   70–74    black
 *   74–80    a single star
 *   80       `${tag}-complete`; the world fades back in
 *
 * Camera-locked: a rig in the Scene (eye-relative) that copies the camera's
 * orientation each frame. Skippable-safe: `abort()` (or the player leaving
 * `leaveRadius`, or `dispose()`) restores every postFx field it touched and
 * the visibility of every object it hid. `skip()` jumps to the final star.
 *
 * Params: `radius` (trigger, m, default 1500), `leaveRadius` (abort, m,
 * default 60 km). Exposes `active`, `progress` (0..1), `time`.
 */
export class Pilgrimage implements SetPiece {
  readonly kind: SetPieceKind = 'pilgrimage';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  active = false;
  complete = false;
  /** Seconds into the sequence (-1 before it starts). */
  time = -1;
  get progress(): number {
    return this.time < 0 ? 0 : Math.min(1, this.time / T_OUT);
  }

  private readonly leaveRadius: number;
  private readonly rig = new Group();
  private hidden: Object3D[] = [];
  private scene: Object3D | null = null;
  private readonly owned: { dispose(): void }[] = [];
  private readonly uT: Node = uniform(0);
  // corridor
  private readonly corridor = new Group();
  private readonly uCorr: Node = uniform(0);
  // landscape
  private readonly land = new Group();
  private readonly uLand: Node = uniform(0);
  // jewels
  private readonly jewels: Mesh;
  private readonly uJewel: Node = uniform(0);
  // room
  private readonly room = new Group();
  private readonly roomSphere: Mesh;
  private readonly uRoom: Node = uniform(0);
  // star
  private readonly star: LightPoints;

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:pilgrimage:${tag}`;
    this.radius = num(params, 'radius', 1500);
    this.leaveRadius = num(params, 'leaveRadius', 60_000);
    this.rig.name = 'pilgrimage-rig';
    this.rig.visible = false;

    this.buildCorridor();
    this.buildLandscape();
    this.jewels = this.buildJewels();
    this.roomSphere = this.buildRoom();
    this.star = new LightPoints([{ pos: new Vector3(0, 0, -5000), color: '#e8f0ff', size: 4, mode: LIGHT_STEADY, gain: 3 }], { minPixels: 2, glint: 1.6 });
    this.star.mesh.renderOrder = 50;
    this.star.mesh.visible = false;
    this.rig.add(this.star.mesh);
    this.owned.push(this.star);
  }

  // ── builders ─────────────────────────────────────────────────────────
  private buildCorridor(): void {
    const L = 7000;
    const W = 900;
    const H = 26;
    const mat = new MeshBasicNodeMaterial();
    mat.name = 'StarGate';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.side = DoubleSide;
    mat.colorNode = Fn(() => {
      const u: Node = (uv() as Node).x;
      const v: Node = (uv() as Node).y;
      const zM: Node = v.mul(L);
      const s: Node = zM.add(this.uT.mul(1100.0));
      const lanes = 56;
      const lane: Node = floor(u.mul(lanes));
      const h1: Node = hash1(lane);
      const h2: Node = hash1(lane.add(17.0));
      const segLen: Node = h1.mul(900.0).add(260.0);
      const seg: Node = fract(s.div(segLen).add(h2));
      const on: Node = smoothstep(0.0, 0.03, seg).mul(float(1).sub(smoothstep(h1.mul(0.35).add(0.45), 0.92, seg)));
      const head: Node = smoothstep(0.0, 0.03, seg).mul(float(1).sub(smoothstep(0.03, 0.1, seg)));
      const gap: Node = smoothstep(0.02, 0.12, fract(u.mul(lanes))).mul(float(1).sub(smoothstep(0.88, 0.98, fract(u.mul(lanes)))));
      const k: Node = floor(fract(h2.mul(3.7).add(s.div(6000.0)).add(this.uT.mul(0.03))).mul(6.0)).div(6.0);
      const col: Node = palette(k);
      // Cross-bars: occasional lattice pulses racing past.
      const bar: Node = step(0.93, fract(s.div(1700.0))).mul(0.6);
      const near: Node = smoothstep(0.0, 0.02, v);
      const far: Node = exp(zM.div(-2600.0));
      const center: Node = float(1).sub(smoothstep(0.3, 0.5, abs(u.sub(0.5))));
      const lum: Node = on.mul(gap).mul(1.3).add(head.mul(gap).mul(2.5)).add(bar);
      return col.mul(lum).mul(near).mul(far.mul(0.8).add(0.2)).mul(center.mul(0.5).add(0.5)).mul(this.uCorr);
    })();
    mat.mrtNode = noInkMRT();
    this.owned.push(mat);
    for (const sgn of [-1, 1]) {
      const g = new PlaneGeometry(W, L, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, sgn * H, -L / 2 + 40);
      const m = new Mesh(g, mat);
      m.frustumCulled = false;
      m.renderOrder = 10;
      useBlendedMRT(m);
      this.corridor.add(m);
    }
    // The vanishing point: a white-hot slit far ahead.
    const glowMat = new MeshBasicNodeMaterial();
    glowMat.transparent = true;
    glowMat.depthWrite = false;
    glowMat.blending = AdditiveBlending;
    glowMat.colorNode = Fn(() => {
      const q: Node = (uv() as Node).sub(0.5).mul(2.0);
      const slit: Node = exp(abs(q.y).mul(-28.0)).mul(exp(abs(q.x).mul(-2.0)));
      return vec3(1.2, 1.1, 1.3).mul(slit).mul(this.uCorr);
    })();
    glowMat.mrtNode = noInkMRT();
    this.owned.push(glowMat);
    const glow = new Mesh(new PlaneGeometry(1800, 260), glowMat);
    glow.position.set(0, 0, -6800);
    glow.renderOrder = 11;
    useBlendedMRT(glow);
    this.corridor.add(glow);
    this.corridor.visible = false;
    this.rig.add(this.corridor);
  }

  private buildLandscape(): void {
    const S = 12000;
    const g = new PlaneGeometry(S, S, 160, 160);
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute('normal');
    const geo = g.toNonIndexed();
    g.dispose();
    const vH: Node = varyingProperty('float', 'vLandH');
    const speed = 520;
    const height = (x: Node, z: Node): Node => {
      const n: Node = mx_fractal_noise_float(vec3(x.mul(0.00045), 0.0, z.mul(0.00045)), 5, 2.0, 0.5);
      const ridge: Node = float(1).sub(abs(n.mul(1.6)));
      return pow(max(ridge, 0.0), 2.2);
    };
    const mat = new CelMaterial({
      ramp: 'dramatic',
      rimWidth: 2,
      gloss: 0,
      inkWeight: 0.8,
      haze: 0,
      paintNode: Fn(() => {
        const k: Node = floor(vH.mul(7.0)).div(7.0);
        return mix(palette(k.mul(0.8).add(0.55)), vec3(1.0, 0.95, 0.8), step(0.86, vH));
      })(),
      regionNode: floor(vH.mul(7.0)).add(40),
    });
    mat.positionNode = Fn(() => {
      const p: Node = positionLocal;
      const zz: Node = p.z.sub(this.uT.mul(speed));
      const h: Node = height(p.x, zz);
      vH.assign(h);
      return vec3(p.x, h.mul(430.0), p.z);
    })();
    this.owned.push(mat);
    const ground = new Mesh(geo, mat);
    ground.position.set(0, -560, -S / 2 + 400);
    ground.frustumCulled = false;
    this.land.add(ground);
    // Sky: banded false-colour gradient with a low hard sun.
    const skyMat = new MeshBasicNodeMaterial();
    skyMat.side = BackSide;
    skyMat.depthWrite = false;
    skyMat.colorNode = Fn(() => {
      const d: Node = normalize(positionLocal);
      const k: Node = floor(smoothstep(-0.05, 0.6, d.y).mul(5.0)).div(5.0);
      const sunD: Node = dot(d, normalize(vec3(0.25, 0.12, -1.0)));
      const sun: Node = step(0.9975, sunD).mul(3.0).add(smoothstep(0.97, 0.9975, sunD).mul(0.4));
      return mix(vec3(1.0, 0.55, 0.2), vec3(0.08, 0.1, 0.35), k).add(vec3(sun)).mul(this.uLand);
    })();
    skyMat.mrtNode = inkMRT(0, 0, 0);
    this.owned.push(skyMat);
    const sky = new Mesh(new SphereGeometry(20_000, 32, 16), skyMat);
    sky.renderOrder = -900;
    sky.frustumCulled = false;
    this.land.add(sky);
    this.land.visible = false;
    this.rig.add(this.land);
  }

  private buildJewels(): Mesh {
    const N = 34;
    const base = new OctahedronGeometry(1, 0).toNonIndexed();
    base.deleteAttribute('normal');
    base.deleteAttribute('uv');
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    const iPos = new Float32Array(N * 4);
    const iSpin = new Float32Array(N * 4);
    let s = 91;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2;
      const rad = 30 + r() * 200;
      iPos.set([Math.cos(a) * rad, Math.sin(a) * rad * 0.7, r() * 1600, 6 + r() * 22], i * 4);
      const ax = new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      iSpin.set([ax.x, ax.y, ax.z, r()], i * 4);
    }
    geo.setAttribute('iPos', new InstancedBufferAttribute(iPos, 4));
    geo.setAttribute('iSpin', new InstancedBufferAttribute(iSpin, 4));
    geo.instanceCount = N;
    geo.boundingSphere = new Sphere(new Vector3(), 5000);
    const vSeed: Node = varyingProperty('float', 'vJewelSeed');
    const vNear: Node = varyingProperty('float', 'vJewelNear');
    const mat = new MeshBasicNodeMaterial();
    mat.name = 'Jewels';
    mat.positionNode = Fn(() => {
      const p: Node = attribute('iPos', 'vec4');
      const sp: Node = attribute('iSpin', 'vec4');
      const local: Node = positionGeometry.mul(vec3(1.0, 1.6, 1.0));
      const ang: Node = this.uT.mul(sp.w.mul(1.2).add(0.3));
      const c = ang.cos();
      const sn = ang.sin();
      const k: Node = sp.xyz;
      const rot: Node = local.mul(c).add(cross(k, local).mul(sn)).add(k.mul(k.dot(local).mul(float(1).sub(c))));
      const z: Node = mod(p.z.add(this.uT.mul(95.0)), 1600.0).sub(1650.0);
      vSeed.assign(sp.w);
      vNear.assign(smoothstep(-1650.0, -1300.0, z).mul(float(1).sub(smoothstep(-160.0, -40.0, z))));
      return rot.mul(p.w).add(vec3(p.x, p.y, z));
    })();
    mat.colorNode = Fn(() => {
      const n: Node = normalize(cross(dFdx(positionView), dFdy(positionView)));
      const facet: Node = floor(dot(n, vec3(0.3, 0.8, 0.5)).mul(3.0).add(3.0)).div(6.0);
      const col: Node = palette(fract(facet.mul(0.6).add(vSeed).add(this.uT.mul(0.05))));
      const pulse: Node = pow(sin(this.uT.mul(2.4).add(vSeed.mul(40.0))).mul(0.5).add(0.5), 5.0);
      const edge: Node = pow(float(1).sub(abs(n.z)), 3.0);
      return col.mul(facet.mul(0.8).add(0.4)).add(vec3(1.0).mul(edge.mul(1.5))).mul(pulse.mul(2.4).add(0.6)).mul(vNear).mul(this.uJewel);
    })();
    mat.mrtNode = inkMRT(0, 0, 0);
    this.owned.push(mat);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.rig.add(mesh);
    base.dispose();
    return mesh;
  }

  private buildRoom(): Mesh {
    const W = 34;
    const H = 13;
    const D = 110;
    // Walls & ceiling: white cel with neoclassical panel lining (ink from region ids).
    const walls = new CelMaterial({
      color: '#f2efe8',
      ramp: 'classic',
      rimWidth: 2,
      gloss: 0,
      inkWeight: 0.9,
      haze: 0,
      emissive: '#fffaf0',
      emissiveStrength: 0.18,
      doubleSided: true,
      regionNode: Fn(() => {
        const p: Node = positionLocal;
        return floor(p.x.div(5.5)).add(floor(p.y.div(4.4)).mul(7.0)).add(floor(p.z.div(9.0)).mul(13.0)).add(500);
      })(),
    });
    this.owned.push(walls);
    const box = new Mesh(new BoxGeometry(W, H, D), walls);
    box.position.set(0, H / 2 - 4, -D / 2 + 8);
    this.room.add(box);
    // Floor of glowing panels.
    const floorMat = new MeshBasicNodeMaterial();
    floorMat.name = 'WhiteRoomFloor';
    floorMat.colorNode = Fn(() => {
      const q: Node = positionLocal.xy.div(3.4);
      const f: Node = fract(q);
      const seam: Node = step(0.04, f.x).mul(step(f.x, 0.96)).mul(step(0.04, f.y)).mul(step(f.y, 0.96));
      const tile: Node = hash1(floor(q.x).add(floor(q.y).mul(31.0))).mul(0.18).add(1.25);
      return mix(vec3(0.55, 0.53, 0.5), vec3(1.0, 0.98, 0.94).mul(tile), seam).mul(this.uRoom);
    })();
    floorMat.mrtNode = inkMRT(0.5, floor(positionLocal.x.div(3.4)).add(floor(positionLocal.y.div(3.4)).mul(41.0)).add(900), 0);
    this.owned.push(floorMat);
    const floorM = new Mesh(new PlaneGeometry(W - 0.05, D - 0.05), floorMat);
    floorM.rotation.x = -Math.PI / 2;
    floorM.position.set(0, -3.98, -D / 2 + 8);
    this.room.add(floorM);
    // The black sphere.
    const sMat = new MeshBasicNodeMaterial();
    sMat.name = 'WhiteRoomSphere';
    sMat.colorNode = vec3(0.004, 0.003, 0.008);
    sMat.mrtNode = inkMRT(1, 777, 0);
    this.owned.push(sMat);
    const sphere = new Mesh(new SphereGeometry(2.2, 48, 24), sMat);
    sphere.position.set(0, 1.4, -D + 30);
    this.room.add(sphere);
    this.room.visible = false;
    this.rig.add(this.room);
    return sphere;
  }

  // ── control ──────────────────────────────────────────────────────────
  private start(ctx: SetPieceFrame): void {
    this.active = true;
    this.time = 0;
    this.scene = ctx.scene;
    ctx.scene.add(this.rig);
  }

  private hideWorld(): void {
    if (!this.scene || this.hidden.length) return;
    for (const o of this.scene.children) {
      if (o === this.rig || !o.visible) continue;
      o.visible = false;
      this.hidden.push(o);
    }
  }

  private showWorld(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
  }

  /** Jump to the final star (the ending still plays and completes). */
  skip(): void {
    if (this.active && this.time < T_STAR) this.time = T_STAR;
  }

  /** Stop without completing; restore everything. */
  abort(): void {
    this.finish();
  }

  private finish(): void {
    this.showWorld();
    this.rig.removeFromParent();
    this.rig.visible = false;
    fxMix.release(this);
    this.active = false;
  }

  debugSeek(t: number): void {
    if (this.active) this.time = Math.max(0, t);
  }

  update(ctx: SetPieceFrame): void {
    const dPlayer = ctx.playerPos.distanceTo(this.position);
    if (!this.active) {
      if (!this.complete && this.time < 0 && dPlayer < this.radius) this.start(ctx);
      if (!this.active) return;
    } else {
      this.time += ctx.dt;
    }
    if (dPlayer > this.leaveRadius) {
      this.abort();
      return;
    }
    const t = this.time;
    this.uT.value = t;
    this.rig.visible = true;
    this.rig.position.set(0, 0, 0);
    this.rig.quaternion.copy(ctx.camera.quaternion);

    // World visibility: hidden from the entry white-out until the end.
    if (t >= T_HIDE && t < T_END) this.hideWorld();
    else this.showWorld();

    // Section visibility / intensity.
    const corr = t >= T_HIDE && t < T_LAND ? smooth(T_HIDE, T_HIDE + 1.5, t) * (1 - smooth(T_LAND - 1.2, T_LAND - 0.2, t)) : 0;
    this.corridor.visible = corr > 0;
    this.uCorr.value = corr;
    this.corridor.rotation.z = t >= T_FLIP ? Math.PI / 2 : 0;
    const land = t >= T_LAND && t < T_JEWEL ? smooth(T_LAND, T_LAND + 0.6, t) * (1 - smooth(T_JEWEL - 0.8, T_JEWEL, t)) : 0;
    this.land.visible = land > 0;
    this.uLand.value = land;
    const jewel = t >= T_JEWEL && t < T_ROOM ? smooth(T_JEWEL, T_JEWEL + 2, t) * (1 - smooth(T_ROOM - 1, T_ROOM - 0.3, t)) : 0;
    this.jewels.visible = jewel > 0;
    this.uJewel.value = jewel;
    const roomOn = t >= T_ROOM && t < T_BLACK + 0.5;
    this.room.visible = roomOn;
    this.uRoom.value = smooth(T_ROOM, T_ROOM + 0.8, t);
    if (roomOn) {
      // Drift down the room into the sphere until it fills the eye.
      const k = smooth(T_ROOM, T_BLACK, t);
      this.room.position.set(0, -1.4 * k, 70 * Math.pow(k, 1.15));
      this.roomSphere.scale.setScalar(1);
    }
    const starOn = t >= T_STAR && t < T_OUT;
    this.star.mesh.visible = starOn;
    if (starOn) {
      const k = smooth(T_STAR, T_END - 1, t);
      this.star.intensity.value = k * (1 - smooth(T_END, T_OUT, t));
      // The star approaches out of the dark: 5 km → 150 m.
      this.star.mesh.position.set(0, 0, 4850 * k * k);
      this.star.update(t);
    }

    // ── grade ──────────────────────────────────────────────────────────
    let flash = 0;
    let jump = 0;
    let fade = 0;
    let hue = 0;
    let invert = 0;
    let solar = 0;
    if (t < T_HIDE + 1.2) {
      flash = t < T_HIDE ? smooth(0.4, T_HIDE, t) : 1 - smooth(T_HIDE, T_HIDE + 1.2, t);
      jump = smooth(0, T_HIDE, t) * 0.8;
    }
    if (t >= T_HIDE && t < T_LAND) {
      jump = Math.max(jump, 0.28);
      hue = (t - T_HIDE) * 0.12;
      // The flip: a hard white cut.
      if (t >= T_FLIP - 0.1 && t < T_FLIP + 0.5) flash = Math.max(flash, 1 - smooth(T_FLIP, T_FLIP + 0.5, t));
      if (t > T_LAND - 1) flash = Math.max(flash, smooth(T_LAND - 1, T_LAND - 0.2, t));
    }
    if (t >= T_LAND && t < T_JEWEL) {
      flash = Math.max(flash, 1 - smooth(T_LAND, T_LAND + 0.4, t));
      const seg = Math.floor((t - T_LAND) / 2.5);
      const g = LAND_GRADES[seg % LAND_GRADES.length];
      const inSeg = (t - T_LAND) % 2.5;
      invert = g[0];
      solar = g[1];
      hue = g[2] + (t - T_LAND) * 0.05;
      // Eye-blink cut between grades.
      if (inSeg < 0.1) fade = 1;
      jump = 0.08;
      if (t > T_JEWEL - 0.8) fade = Math.max(fade, smooth(T_JEWEL - 0.8, T_JEWEL, t));
    }
    if (t >= T_JEWEL && t < T_ROOM) {
      fade = 1 - smooth(T_JEWEL, T_JEWEL + 0.8, t);
      hue = (t - T_JEWEL) * 0.25;
      jump = 0.12;
      if (t > T_ROOM - 0.8) flash = smooth(T_ROOM - 0.8, T_ROOM, t);
    }
    if (t >= T_ROOM && t < T_BLACK) {
      // Silent, overexposed.
      flash = Math.max(1 - smooth(T_ROOM, T_ROOM + 1.5, t), 0.12);
    }
    if (t >= T_BLACK && t < T_STAR) fade = 1;
    if (t >= T_STAR && t < T_END) fade = 1 - smooth(T_STAR, T_STAR + 0.2, t);
    if (t >= T_END) {
      // The world returns out of black.
      fade = 1 - smooth(T_END, T_OUT, t);
    }
    fxMix.set(this, 'fade', fade);
    fxMix.set(this, 'hue', hue);
    fxMix.set(this, 'invert', invert);
    fxMix.set(this, 'solarize', solar);
    fxMix.set(this, 'navNoise', t < T_END ? 1 : 0);
    fxMix.raise('flash', flash);
    fxMix.raise('jump', jump);

    if (t >= T_END && !this.complete) {
      this.complete = true;
      this.showWorld();
      ctx.setFlag(`${this.tag}-complete`);
    }
    if (t >= T_OUT) this.finish();
  }

  dispose(): void {
    this.finish();
    this.rig.traverse((o) => (o as Mesh).geometry?.dispose());
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }
}
