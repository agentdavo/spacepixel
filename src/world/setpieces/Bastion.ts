import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Plane,
  Quaternion,
  Sphere,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraProjectionMatrix,
  cross,
  exp,
  float,
  fract,
  length,
  mix,
  modelViewMatrix,
  mx_noise_float,
  normalize,
  positionGeometry,
  smoothstep,
  step,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { assets } from '@/assets/AssetLibrary';
import { BLUEPRINTS } from '@/assets/blueprints';
import type { ShipModel } from '@/assets/ShipBuilder';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { num, str } from './types';
import { LightPoints, LIGHT_STEADY, LIGHT_STROBE, type LightSpec } from './LightPoints';
import { fxMix } from './fxMix';
import { useBlendedMRT } from '../BlendedMRT';
import { mulberry, seedOf, splitGeometry, smooth } from './util';

interface Chunk {
  mesh: Mesh;
  /** Rest offset of the chunk centre in ship space. */
  centre: Vector3;
  vel: Vector3;
  axis: Vector3;
  spin: number;
}

interface FleetShip {
  model: ShipModel;
  /** Formation slot (group-local). */
  home: Vector3;
  heading: Quaternion;
  chunks: Chunk[];
  breakAt: number;
  lights: [number, number];
  broken: boolean;
  radius: number;
}

interface Blast {
  pos: Vector3;
  t0: number;
  dur: number;
  size: number;
  kind: number; // 0 hull flash, 1 fireball, 2 shock ring, 3 final flash
}

interface Beam {
  from: Vector3;
  to: Vector3;
  t0: number;
  dur: number;
  width: number;
}

const MAX_BLASTS = 160;
const MAX_BEAMS = 24;

/**
 * The Directorate home fleet — one carrier, a battleship and a screen of
 * corvettes holding formation with running lights and idling drives.
 *
 * When flag `bastion-attack` is set (or `debugSeek`), a ~26 s scripted
 * catastrophe plays out, fully deterministic in time (seekable): beams lance
 * in from beyond visual range, hulls flash in chains along their length,
 * ships break into drifting, tumbling sections (their real hulls, split),
 * lights die ship by ship, and the carrier goes last in a white reactor
 * flash (postFx.flash). Then `${tag}-destroyed`.
 *
 * Params: `escorts` (corvettes, 2–5, default 4), `carrier`/`battleship`/
 * `escort` (blueprint ids), `beamColor` (default black-light violet),
 * `attackFrom` ('left' | 'right' | 'above', default 'right').
 * Exposes `attackTime` (s since the attack began, -1 before), `destroyed`.
 */
export class Bastion implements SetPiece {
  readonly kind: SetPieceKind = 'bastion';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  attackTime = -1;
  destroyed = false;
  private readonly ships: FleetShip[] = [];
  private readonly lights: LightPoints;
  private readonly baseGain: number[];
  private readonly blasts: Blast[] = [];
  private readonly beams: Beam[] = [];
  private readonly fxMesh: Mesh;
  private readonly beamMesh: Mesh;
  private readonly uT: Node = uniform(-1);
  private readonly owned: MeshBasicNodeMaterial[] = [];
  private readonly q = new Quaternion();
  private readonly v = new Vector3();

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:bastion:${tag}`;
    const rand = mulberry(seedOf(tag) + 99);
    const pick = (key: string, def: string, fallback: string) => {
      const id = str(params, key, def);
      return BLUEPRINTS[id] ? id : BLUEPRINTS[def] ? def : fallback;
    };
    const carrierId = pick('carrier', 'cvs07-hesperus-dawn', 'vf27-kestrel');
    const bbId = pick('battleship', 'bb-indomitable', 'vf27-kestrel');
    const escortId = pick('escort', 'ffc-lantern-guard', 'vf27-kestrel');
    const nEsc = Math.max(2, Math.min(5, Math.floor(num(params, 'escorts', 4))));

    // ── formation (heading +Z) ───────────────────────────────────────
    const lightSpecs: LightSpec[] = [];
    const addShip = (id: string, home: Vector3, yaw: number, breakAt: number, scaleFix = 1) => {
      const model = assets.ship(id);
      if (scaleFix !== 1) model.root.scale.setScalar(scaleFix);
      model.setThrottle(0.35);
      const heading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      model.root.position.copy(home);
      model.root.quaternion.copy(heading);
      this.group.add(model.root);
      const r = model.radius * scaleFix;
      const len = model.length * scaleFix;
      // Running lights (group space, formation pose): red port, green starboard, white strobes, hull lamps.
      const l0 = lightSpecs.length;
      const put = (x: number, y: number, z: number, color: string, mode: number, rate: number, size: number, gain: number) => {
        lightSpecs.push({ pos: new Vector3(x, y, z).multiplyScalar(scaleFix).applyQuaternion(heading).add(home), color, size, mode, rate, phase: rand(), duty: 0.08, gain });
      };
      const bb = model.hull.geometry.boundingBox!;
      const w = (bb.max.x - bb.min.x) / 2;
      const top = bb.max.y;
      put(-w, 0, 0, '#ff4a3a', LIGHT_STEADY, 1, len * 0.006, 1.4);
      put(w, 0, 0, '#4aff8a', LIGHT_STEADY, 1, len * 0.006, 1.4);
      put(0, top, bb.max.z * 0.2, '#ffffff', LIGHT_STROBE, 0.9, len * 0.008, 3);
      put(0, bb.min.y, bb.min.z * 0.5, '#ffffff', LIGHT_STROBE, 0.9, len * 0.008, 3);
      for (let i = 0; i < 6; i++) {
        const z = bb.min.z + (bb.max.z - bb.min.z) * (0.1 + 0.8 * rand());
        put((rand() < 0.5 ? -1 : 1) * w * 0.9, (rand() - 0.3) * top, z, rand() < 0.5 ? '#ffd9a0' : '#9fe8ff', LIGHT_STEADY, 1, len * 0.003, 1.2);
      }
      // Pre-split the hull for the break: a slanted cut across the back plus a lengthwise crack on big hulls.
      const planes = [new Plane(new Vector3(0.25 * (rand() - 0.5), 0.35 * (rand() - 0.5), 1).normalize(), -(bb.min.z + (bb.max.z - bb.min.z) * (0.35 + rand() * 0.3)))];
      if (len > 600) planes.push(new Plane(new Vector3(1, 0.4 * (rand() - 0.5), 0.15).normalize(), 0));
      const pieces = splitGeometry(model.hull.geometry, planes, 30);
      const chunks: Chunk[] = pieces.map((p) => {
        const mesh = new Mesh(p.geometry, model.hull.material);
        mesh.visible = false;
        mesh.scale.setScalar(scaleFix);
        this.group.add(mesh);
        const out = p.centre.clone().normalize();
        return {
          mesh,
          centre: p.centre.clone().multiplyScalar(scaleFix),
          vel: out.multiplyScalar(len * (0.006 + rand() * 0.008)).add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(len * 0.004)),
          axis: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
          spin: (0.012 + rand() * 0.03) * (rand() < 0.5 ? -1 : 1) * (600 / Math.max(300, len)),
        };
      });
      this.ships.push({ model, home: home.clone(), heading, chunks, breakAt, lights: [l0, lightSpecs.length], broken: false, radius: r });
    };

    const escTimes = [1.6, 5.2, 6.4, 8.6, 9.4];
    addShip(carrierId, new Vector3(0, 0, 0), 0, 21.5);
    addShip(bbId, new Vector3(-1300, 260, -500), 0.02, 13.0);
    const slots = [
      new Vector3(1100, -150, 900),
      new Vector3(-700, -260, 1500),
      new Vector3(900, 320, -1100),
      new Vector3(-1900, -80, 700),
      new Vector3(1700, 120, -200),
    ];
    for (let i = 0; i < nEsc; i++) addShip(escortId, slots[i], (rand() - 0.5) * 0.06, escTimes[i]);
    this.radius = 3500;

    this.lights = new LightPoints(lightSpecs, { minPixels: 1.6, glint: 0.8 });
    this.baseGain = lightSpecs.map((l) => l.gain ?? 1);
    this.group.add(this.lights.mesh);

    // ── scripted attack (all times relative to the attack start) ────
    const side = str(params, 'attackFrom', 'right');
    const from = side === 'left' ? new Vector3(-1, 0.15, 0.3) : side === 'above' ? new Vector3(0.2, 1, -0.2) : new Vector3(1, 0.12, -0.35);
    from.normalize();
    const beamFrom = (to: Vector3) =>
      to
        .clone()
        .addScaledVector(from, 60_000)
        .add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(9000));
    const hullPoint = (s: FleetShip, spread = 0.9) => {
      const pos = s.model.hull.geometry.getAttribute('position');
      const i = Math.floor(rand() * pos.count);
      return this.v
        .fromBufferAttribute(pos, i)
        .multiplyScalar(spread)
        .applyQuaternion(s.heading)
        .add(s.home)
        .clone();
    };
    const strike = (s: FleetShip, t: number, n: number, dur = 1.1) => {
      for (let k = 0; k < n; k++) {
        const to = hullPoint(s);
        const t0 = t + k * 0.35 + rand() * 0.2;
        this.beams.push({ from: beamFrom(to), to, t0, dur, width: 22 + s.radius * 0.03 });
        this.blasts.push({ pos: to, t0: t0 + 0.05, dur: 0.6, size: s.radius * 0.18, kind: 0 });
      }
    };
    const chain = (s: FleetShip, t0: number, t1: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const t = t0 + ((t1 - t0) * k) / n + rand() * 0.2;
        this.blasts.push({ pos: hullPoint(s, 1.0), t0: t, dur: 0.5 + rand() * 0.4, size: s.radius * (0.08 + rand() * 0.1), kind: rand() < 0.6 ? 0 : 1 });
      }
    };
    const breakUp = (s: FleetShip) => {
      const c = s.home.clone();
      this.blasts.push({ pos: c, t0: s.breakAt, dur: 2.4, size: s.radius * 0.62, kind: 1 });
      for (let k = 0; k < 3; k++) this.blasts.push({ pos: hullPoint(s, 0.7), t0: s.breakAt + 0.1 + k * 0.25, dur: 1.8, size: s.radius * (0.3 + rand() * 0.15), kind: 1 });
      this.blasts.push({ pos: c, t0: s.breakAt + 0.05, dur: 2.6, size: s.radius * 1.8, kind: 2 });
      for (const ch of s.chunks) {
        this.blasts.push({ pos: ch.centre.clone().applyQuaternion(s.heading).add(s.home), t0: s.breakAt + 0.2 + rand() * 0.8, dur: 1.4, size: s.radius * 0.35, kind: 1 });
      }
    };
    const [carrier, bb, ...esc] = this.ships;
    esc.forEach((s, i) => {
      strike(s, s.breakAt - 1.4 - (i === 0 ? 0 : 0.6), i === 0 ? 1 : 2);
      chain(s, s.breakAt - 1.0, s.breakAt, 4);
      breakUp(s);
    });
    strike(bb, 7.2, 3);
    strike(bb, 10.2, 3);
    chain(bb, 7.6, 13.0, 18);
    breakUp(bb);
    strike(carrier, 14.0, 4, 1.4);
    strike(carrier, 16.8, 4, 1.4);
    chain(carrier, 14.4, 21.5, 30);
    breakUp(carrier);
    // The reactor: a white sun that swallows the frame, then a vast ring.
    this.blasts.push({ pos: carrier.home.clone(), t0: 22.4, dur: 4.5, size: carrier.radius * 3.2, kind: 3 });
    this.blasts.push({ pos: carrier.home.clone(), t0: 22.5, dur: 6.0, size: carrier.radius * 7.0, kind: 2 });
    this.blasts.length = Math.min(this.blasts.length, MAX_BLASTS);
    this.beams.length = Math.min(this.beams.length, MAX_BEAMS);

    this.fxMesh = this.makeBlastMesh();
    this.group.add(this.fxMesh);
    this.beamMesh = this.makeBeamMesh(new Color(str(params, 'beamColor', '#a57bff')));
    this.group.add(this.beamMesh);
  }

  /** All blasts preloaded as instances; the shader evaluates each from its age. No per-frame uploads. */
  private makeBlastMesh(): Mesh {
    const n = this.blasts.length;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    this.blasts.forEach((bl, i) => {
      a.set([bl.pos.x, bl.pos.y, bl.pos.z, bl.size], i * 4);
      b.set([bl.t0, bl.dur, bl.kind, (i * 0.618) % 1], i * 4);
    });
    geo.setAttribute('bPos', new InstancedBufferAttribute(a, 4));
    geo.setAttribute('bTime', new InstancedBufferAttribute(b, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new Sphere(new Vector3(), 1e6);
    const vUV: Node = varyingProperty('vec2', 'vBlastUV');
    const vAge: Node = varyingProperty('float', 'vBlastAge');
    const vKind: Node = varyingProperty('float', 'vBlastKind');
    const vSeed: Node = varyingProperty('float', 'vBlastSeed');
    const mat = new MeshBasicNodeMaterial();
    mat.name = 'BastionBlasts';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.vertexNode = Fn(() => {
      const p: Node = attribute('bPos', 'vec4');
      const tt: Node = attribute('bTime', 'vec4');
      const age: Node = this.uT.sub(tt.x).div(tt.y);
      const alive: Node = step(0.0, age).mul(step(age, 1.0));
      // Fireballs swell fast then slow; rings keep expanding.
      const grow: Node = mix(float(1).sub(exp(age.mul(-5.0))).mul(1.1).add(0.15), age.mul(1.0).add(0.05), step(1.5, tt.z).mul(step(tt.z, 2.5)));
      const r: Node = p.w.mul(grow).mul(alive);
      const view: Node = modelViewMatrix.mul(vec4(p.xyz, 1));
      // Pull toward the camera so the billboard isn't clipped by the hull it sits on.
      const pull: Node = normalize(view.xyz).mul(r.mul(0.6).min(view.xyz.length().mul(0.5)));
      vUV.assign(positionGeometry.xy);
      vAge.assign(age);
      vKind.assign(tt.z);
      vSeed.assign(tt.w);
      const corner: Node = vec3((positionGeometry as Node).xy.mul(r), 0);
      return cameraProjectionMatrix.mul(vec4(view.xyz.sub(pull).add(corner), 1));
    })();
    mat.colorNode = Fn(() => {
      const q: Node = vUV;
      const d: Node = length(q);
      const age: Node = vAge.clamp(0, 1);
      // Cel fireball: ragged noise silhouette, hard tone steps (white → yellow → orange → crimson
      // rim), burning out into holes as it ages. (No atan: atan2(0, 0) is NaN in WGSL.)
      const nq: Node = vec3(q.x.mul(2.3), q.y.mul(2.3), vSeed.mul(13.0).add(age.mul(0.9)));
      const n1: Node = mx_noise_float(nq);
      const n2: Node = mx_noise_float(nq.mul(2.4).add(5.0));
      const edge: Node = float(0.74).add(n1.mul(0.22)).add(n2.mul(0.07)).sub(age.mul(0.12));
      const body: Node = step(d, edge);
      const hot: Node = step(d, edge.mul(mix(0.62, -0.1, age)));
      const mid: Node = step(d, edge.mul(mix(0.84, 0.25, age)));
      const rim: Node = step(edge.mul(0.9).sub(age.mul(0.1)), d);
      const holes: Node = step(age.mul(1.3).sub(0.45), n2.mul(0.5).add(0.5));
      const col: Node = mix(vec3(1.6, 0.45, 0.14), vec3(2.4, 1.35, 0.35), mid).toVar();
      col.assign(mix(col, vec3(0.7, 0.1, 0.12), rim));
      col.assign(mix(col, vec3(4.0, 3.8, 3.4), hot));
      const fade: Node = float(1).sub(smoothstep(0.6, 1.0, age)).mul(holes);
      const fire: Node = col.mul(body).mul(fade);
      // Hull flash: a star-glint, over in a blink.
      const ax: Node = abs(q.x);
      const ay: Node = abs(q.y);
      const glint: Node = exp(ax.mul(-26.0))
        .mul(float(1).sub(ay))
        .add(exp(ay.mul(-26.0)).mul(float(1).sub(ax)))
        .add(exp(d.mul(-6.0)).mul(1.5))
        .mul(float(1).sub(age))
        .mul(3.0);
      // Shock ring: a thin bright hoop.
      const ring: Node = exp(abs(d.sub(0.9)).mul(-40.0)).mul(float(1).sub(age)).mul(1.6);
      // Final flash: blinding disc with a soft corona.
      const sun: Node = step(d, 0.55).mul(6.0).add(exp(d.mul(-3.0)).mul(2.0)).mul(float(1).sub(smoothstep(0.4, 1.0, age)));
      const k: Node = vKind;
      const w0: Node = step(k, 0.5);
      const w1: Node = step(0.5, k).mul(step(k, 1.5));
      const w2: Node = step(1.5, k).mul(step(k, 2.5));
      const w3: Node = step(2.5, k);
      return vec3(glint)
        .mul(vec3(0.9, 0.85, 1.0))
        .mul(w0)
        .add(fire.mul(w1))
        .add(vec3(1.0, 0.9, 1.2).mul(ring).mul(w2))
        .add(vec3(1.0, 0.97, 0.9).mul(sun).mul(w3))
        .mul(step(d, 1.0));
    })();
    mat.mrtNode = noInkMRT();
    this.owned.push(mat);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    useBlendedMRT(mesh);
    return mesh;
  }

  /** Beams as camera-facing ribbons expanded in view space from start/end instances. */
  private makeBeamMesh(color: Color): Mesh {
    const n = this.beams.length;
    const geo = new InstancedBufferGeometry();
    // x: along (0 = from, 1 = to), y: side (-1, 1)
    geo.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    const c = new Float32Array(n * 4);
    this.beams.forEach((bm, i) => {
      a.set([bm.from.x, bm.from.y, bm.from.z, bm.width], i * 4);
      b.set([bm.to.x, bm.to.y, bm.to.z, 0], i * 4);
      c.set([bm.t0, bm.dur, 0, 0], i * 4);
    });
    geo.setAttribute('bFrom', new InstancedBufferAttribute(a, 4));
    geo.setAttribute('bTo', new InstancedBufferAttribute(b, 4));
    geo.setAttribute('bTime', new InstancedBufferAttribute(c, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new Sphere(new Vector3(), 1e6);
    const vUV: Node = varyingProperty('vec2', 'vBeamUV');
    const vK: Node = varyingProperty('float', 'vBeamK');
    const tint: Node = uniform(color);
    const mat = new MeshBasicNodeMaterial();
    mat.name = 'BastionBeams';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.side = DoubleSide;
    mat.vertexNode = Fn(() => {
      const f: Node = attribute('bFrom', 'vec4');
      const t: Node = attribute('bTo', 'vec4');
      const tm: Node = attribute('bTime', 'vec4');
      const age: Node = this.uT.sub(tm.x).div(tm.y);
      const alive: Node = step(0.0, age).mul(step(age, 1.0));
      // Width envelope: snap on, hold, taper off (anime beam).
      const env: Node = smoothstep(0.0, 0.06, age).mul(float(1).sub(smoothstep(0.6, 1.0, age))).mul(alive);
      const A: Node = modelViewMatrix.mul(vec4(f.xyz, 1)).xyz;
      const B: Node = modelViewMatrix.mul(vec4(t.xyz, 1)).xyz;
      const P: Node = mix(A, B, positionGeometry.x);
      const dir: Node = normalize(B.sub(A));
      const toP: Node = normalize(P);
      const sideV: Node = normalize((cross as (a: Node, b: Node) => Node)(dir, toP));
      const w: Node = f.w.mul(env).mul(mix(1.6, 1.0, positionGeometry.x));
      vUV.assign(vec2(positionGeometry.x, positionGeometry.y));
      vK.assign(env);
      return cameraProjectionMatrix.mul(vec4(P.add(sideV.mul(positionGeometry.y.mul(w))), 1));
    })();
    mat.colorNode = Fn(() => {
      const d: Node = abs(vUV.y);
      const core: Node = float(1).sub(smoothstep(0.15, 0.35, d));
      const sheath: Node = float(1).sub(smoothstep(0.35, 1.0, d));
      // Energy crawling down the beam.
      const crawl: Node = fract(vUV.x.mul(60.0).sub(this.uT.mul(9.0)));
      const pulse: Node = mix(0.8, 1.2, step(0.5, crawl));
      return vec3(tint).mul(sheath.mul(1.6)).add(vec3(3.0, 2.8, 3.2).mul(core)).mul(pulse).mul(vK);
    })();
    mat.mrtNode = noInkMRT();
    this.owned.push(mat);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 31;
    useBlendedMRT(mesh);
    return mesh;
  }

  debugSeek(t: number): void {
    this.attackTime = t;
  }

  update(ctx: SetPieceFrame): void {
    const time = ctx.time;
    this.lights.update(time);
    if (this.attackTime < 0 && ctx.flags.has('bastion-attack')) this.attackTime = 0;
    else if (this.attackTime >= 0) this.attackTime += ctx.dt;
    const at = this.attackTime;
    this.uT.value = at;

    for (let si = 0; si < this.ships.length; si++) {
      const s = this.ships[si];
      const broken = at >= s.breakAt;
      // Idle station-keeping: a slow heave.
      this.v.set(0, Math.sin(time * 0.07 + si) * 6, 0);
      if (!broken) {
        s.model.root.visible = true;
        s.model.root.position.copy(s.home).add(this.v);
        for (const c of s.chunks) c.mesh.visible = false;
        // Lights stutter in the seconds before a ship dies.
        const dying = at >= 0 ? smooth(s.breakAt - 2.5, s.breakAt, at) : 0;
        for (let i = s.lights[0]; i < s.lights[1]; i++) this.lights.setGain(i, dying > 0.7 ? (i % 3 === 0 ? this.baseGain[i] * 0.25 : 0) : this.baseGain[i] * (1 - dying));
        s.model.setThrottle(0.35 * (1 - dying));
      } else {
        s.model.root.visible = false;
        if (!s.broken) for (let i = s.lights[0]; i < s.lights[1]; i++) this.lights.setGain(i, 0);
        const age = at - s.breakAt;
        for (const c of s.chunks) {
          c.mesh.visible = true;
          this.q.setFromAxisAngle(c.axis, c.spin * age);
          c.mesh.quaternion.copy(s.heading).multiply(this.q);
          c.mesh.position
            .copy(c.centre)
            .applyQuaternion(s.heading)
            .add(s.home)
            .add(this.v)
            .addScaledVector(c.vel, age);
          // Chunk geometry is centred on its own centroid.
        }
      }
      s.broken = broken;
    }

    // The reactor flash.
    if (at >= 0) {
      const f = at >= 22.4 ? Math.max(0, 1 - (at - 22.4) / 2.8) : 0;
      const peak = at >= 22.4 && at < 22.75 ? 1 : f * f;
      fxMix.raise('flash', peak);
      // Small concussion flickers on each ship death.
      for (const s of this.ships) {
        const d = at - s.breakAt;
        if (d >= 0 && d < 0.25) fxMix.raise('flash', 0.22 * (1 - d / 0.25) * (s === this.ships[0] ? 0 : 1));
      }
      if (!this.destroyed && at >= 25) {
        this.destroyed = true;
        ctx.setFlag(`${this.tag}-destroyed`);
      }
    }
  }

  dispose(): void {
    fxMix.release(this);
    this.lights.dispose();
    for (const m of this.owned) m.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
