import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, Quaternion, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, abs, attribute, float, smoothstep, uniform, vec3 } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { SetPieceKind } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { bool, num, str } from './types';
import { CloudCards } from './CloudCards';
import { LightPoints, LIGHT_PULSE, type LightSpec } from './LightPoints';
import { fxMix } from './fxMix';
import { useBlendedMRT } from '../BlendedMRT';
import { mulberry, seedOf, smooth } from './util';

const BOLT_SEGS = 48;
const BOLTS = 3;

/** Deterministic hash → [0,1). */
function h01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A dense nebula volume (default radius 40 km). From outside it's a towering
 * mass of opaque, two-tone cel cloud cards lit from within by lightning.
 * Inside, visibility collapses: depth fog (postFx.fog / fogColor / fogRange)
 * swallows everything past a few hundred metres, a camera-locked layer of
 * cloud cards drifts past, discharges crack nearby (flash + nav spikes) and
 * postFx.navNoise tells the HUD to glitch nav/radar.
 *
 * Params: `radius` (m), `colorA`/`colorB`/`shade` (cloud paint), `fog`
 * (fog colour), `density` (0..1 fog strength inside, default 0.9),
 * `lightning` (bool, default true), `flatten` (vertical squash, 0.55).
 * Flags: `${tag}-entered`, then `${tag}-exited`. Exposes `inside` 0..1.
 */
export class Nebula implements SetPiece {
  readonly kind: SetPieceKind = 'nebula';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius: number;
  /** 0 outside … 1 deep inside (smoothed across the boundary). */
  inside = 0;
  private entered = false;
  private exited = false;
  private readonly outer: CloudCards;
  private readonly gas: LightPoints;
  private readonly near: CloudCards;
  private readonly bolts: Mesh;
  private readonly boltPos: Float32Array;
  private readonly boltAttr: Float32BufferAttribute;
  private readonly boltLife: Float32Array;
  private readonly boltMat: MeshBasicNodeMaterial;
  private readonly uBolt: Node[] = [];
  private readonly fogColor: Color;
  private readonly density: number;
  private readonly lightning: boolean;
  private readonly wrap = 6000;
  private lastStrike = -1;
  private strikeFlash = 0;
  // scratch
  private readonly v = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly side = new Vector3();
  private readonly toCam = new Vector3();
  private readonly fwd = new Vector3();
  private readonly camQ = new Quaternion();
  private readonly eyeLocal = new Vector3();

  constructor(
    readonly tag: string,
    anchor: Vector3,
    params?: SetPieceParams,
  ) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:nebula:${tag}`;
    const R = num(params, 'radius', 40_000);
    this.radius = R;
    this.density = num(params, 'density', 0.9);
    this.lightning = bool(params, 'lightning', true);
    this.fogColor = new Color(str(params, 'fog', '#4a3470'));
    const flatten = num(params, 'flatten', 0.55);
    const seed = seedOf(tag);
    const rand = mulberry(seed);
    const colors: [string, string] = [str(params, 'colorA', '#7a3aa8'), str(params, 'colorB', '#2f6f96')];
    const shade = str(params, 'shade', '#1d1030');

    // ── the volume: big cards filling a squashed ellipsoid ────────────
    const N = 200;
    const puffs = new Float32Array(N * 4);
    // Anisotropic mass with a few towering columns (the anime "cumulus wall").
    const cols = [0, 1, 2, 3].map(() => new Vector3((rand() - 0.5) * R, 0, (rand() - 0.5) * R));
    for (let i = 0; i < N; i++) {
      const d = this.v;
      if (i % 5 === 0) {
        const c = cols[i % cols.length];
        d.set(c.x + (rand() - 0.5) * R * 0.2, (rand() - 0.3) * R * 0.95, c.z + (rand() - 0.5) * R * 0.2);
      } else {
        d.set(rand() * 2 - 1, (rand() * 2 - 1) * flatten, rand() * 2 - 1);
        if (d.length() > 1) d.multiplyScalar(1 / d.length());
        d.multiplyScalar(R * 0.95 * Math.pow(rand(), 0.6)).multiply(this.b.set(1.25, 1, 0.95));
      }
      const core = 1 - Math.min(1, d.length() / R);
      const size = R * (0.13 + 0.26 * rand()) * (0.75 + 0.6 * core);
      puffs.set([d.x, d.y, d.z, size], i * 4);
    }
    this.outer = new CloudCards({ seed: seed % 1000, puffs, colors, shade, near: [0.3, 1.1], lining: str(params, 'lining', '#e0c8ff'), glow: str(params, 'glow', '#3a1450') });
    this.outer.flashRadius.value = R * 0.25;
    this.group.add(this.outer.mesh);

    // Gas: huge soft additive glows lit from within, so the mass reads as a nebula, not a rock pile.
    const glows: LightSpec[] = [];
    for (let i = 0; i < 9; i++) {
      glows.push({
        pos: new Vector3((rand() - 0.5) * R * 1.4, (rand() - 0.4) * R * 0.7, (rand() - 0.5) * R * 1.2),
        color: i % 3 === 0 ? str(params, 'colorB', '#3b7fa6') : str(params, 'gasColor', '#b04fd8'),
        size: R * (0.55 + rand() * 0.5),
        mode: LIGHT_PULSE,
        rate: 0.03 + rand() * 0.03,
        phase: rand(),
        gain: 0.16,
      });
    }
    this.gas = new LightPoints(glows, { minPixels: 0, glint: 0, soft: true });
    this.gas.mesh.renderOrder = 4;
    // Gas veils over the cards too (additive, no depth test) — the mass glows from within.
    (this.gas.mesh.material as MeshBasicNodeMaterial).depthTest = false;
    this.group.add(this.gas.mesh);

    // ── the drifting layer around the camera (inside only) ────────────
    const M = 70;
    const nearP = new Float32Array(M * 4);
    for (let i = 0; i < M; i++) {
      nearP.set([(rand() - 0.5) * this.wrap, (rand() - 0.5) * this.wrap * 0.7, (rand() - 0.5) * this.wrap, 180 + rand() * 520], i * 4);
    }
    this.near = new CloudCards({ seed: (seed % 1000) + 7, puffs: nearP, colors: [colors[0], '#6a5a9a'], shade, wrap: this.wrap, near: [0.6, 1.6] });
    this.near.flashRadius.value = 2500;
    this.near.mesh.visible = false;
    this.group.add(this.near.mesh);

    // ── lightning: a few jagged ribbons, rebuilt in place on each strike ─
    this.boltPos = new Float32Array(BOLTS * BOLT_SEGS * 2 * 3 * 2);
    this.boltLife = new Float32Array(BOLTS);
    const geo = new BufferGeometry();
    this.boltAttr = new Float32BufferAttribute(this.boltPos, 3);
    this.boltAttr.setUsage(35048); // DynamicDrawUsage
    geo.setAttribute('position', this.boltAttr);
    const across = new Float32Array(BOLTS * BOLT_SEGS * 2 * 2);
    const which = new Float32Array(BOLTS * BOLT_SEGS * 2 * 2);
    const idx: number[] = [];
    for (let k = 0; k < BOLTS; k++) {
      for (let i = 0; i < BOLT_SEGS * 2; i++) {
        const v0 = (k * BOLT_SEGS * 2 + i) * 2;
        across[v0] = 0;
        across[v0 + 1] = 1;
        which[v0] = which[v0 + 1] = k;
        if (i % 2 === 0) idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
      }
    }
    geo.setAttribute('across', new Float32BufferAttribute(across, 1));
    geo.setAttribute('bolt', new Float32BufferAttribute(which, 1));
    geo.setIndex(idx);
    this.boltMat = new MeshBasicNodeMaterial();
    this.boltMat.name = 'NebulaLightning';
    this.boltMat.transparent = true;
    this.boltMat.depthWrite = false;
    this.boltMat.blending = AdditiveBlending;
    this.boltMat.side = DoubleSide;
    for (let k = 0; k < BOLTS; k++) this.uBolt.push(uniform(0));
    this.boltMat.colorNode = Fn(() => {
      const ac: Node = attribute('across', 'float');
      const w: Node = attribute('bolt', 'float');
      const d: Node = abs(ac.sub(0.5)).mul(2.0);
      const core: Node = float(1).sub(smoothstep(0.1, 0.35, d));
      const sheath: Node = float(1).sub(smoothstep(0.3, 1.0, d));
      const k0: Node = this.uBolt[0].mul(float(1).sub(w.min(1)));
      const k1: Node = this.uBolt[1].mul(float(1).sub(abs(w.sub(1)).min(1)));
      const k2: Node = this.uBolt[2].mul(float(1).sub(abs(w.sub(2)).min(1)));
      const k: Node = k0.add(k1).add(k2);
      return vec3(0.75, 0.55, 1.4).mul(sheath.mul(1.2)).add(vec3(2.4, 2.3, 2.6).mul(core)).mul(k);
    })();
    this.boltMat.mrtNode = noInkMRT();
    this.bolts = new Mesh(geo, this.boltMat);
    this.bolts.frustumCulled = false;
    this.bolts.renderOrder = 14;
    useBlendedMRT(this.bolts);
    this.group.add(this.bolts);
  }

  /** Build bolt k from a → b (mesh-local) as a camera-facing jagged ribbon with one fork. */
  private buildBolt(k: number, seed: number, width: number, eyeLocal: Vector3): void {
    const r = mulberry(seed);
    const base = k * BOLT_SEGS * 2 * 2 * 3;
    const main = Math.floor(BOLT_SEGS * 0.7);
    const len = this.a.distanceTo(this.b);
    const pts: Vector3[] = [];
    // Main channel (midpoint-displaced path), then a fork from its middle.
    let prev = this.v.copy(this.a);
    const put = (i: number, p: Vector3, q: Vector3, wdt: number) => {
      this.side.subVectors(q, p);
      this.toCam.subVectors(eyeLocal, p);
      this.side.cross(this.toCam).normalize().multiplyScalar(wdt);
      const o = base + i * 12;
      this.boltPos[o] = p.x - this.side.x;
      this.boltPos[o + 1] = p.y - this.side.y;
      this.boltPos[o + 2] = p.z - this.side.z;
      this.boltPos[o + 3] = p.x + this.side.x;
      this.boltPos[o + 4] = p.y + this.side.y;
      this.boltPos[o + 5] = p.z + this.side.z;
      this.boltPos[o + 6] = q.x - this.side.x;
      this.boltPos[o + 7] = q.y - this.side.y;
      this.boltPos[o + 8] = q.z - this.side.z;
      this.boltPos[o + 9] = q.x + this.side.x;
      this.boltPos[o + 10] = q.y + this.side.y;
      this.boltPos[o + 11] = q.z + this.side.z;
    };
    const step = new Vector3().subVectors(this.b, this.a).divideScalar(main);
    for (let i = 0; i < main; i++) {
      const q = new Vector3()
        .copy(this.a)
        .addScaledVector(step, i + 1)
        .add(new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(len * 0.07));
      if (i === main - 1) q.copy(this.b);
      put(i, prev, q, width * (1 - (i / main) * 0.6));
      pts.push(q);
      prev = q;
    }
    const fork = pts[Math.floor(main * 0.45)];
    const dir = new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().add(step.clone().normalize()).normalize().multiplyScalar(len * 0.5 / (BOLT_SEGS - main));
    prev = fork;
    for (let i = main; i < BOLT_SEGS; i++) {
      const q = prev.clone().add(dir).add(new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(len * 0.05));
      put(i, prev, q, width * 0.45);
      prev = q;
    }
    this.boltAttr.needsUpdate = true;
  }

  update(ctx: SetPieceFrame): void {
    const t = ctx.time;
    const R = this.radius;
    this.eyeLocal.subVectors(ctx.eye, this.position);
    const dEye = this.eyeLocal.length();
    const dPlayer = ctx.playerPos.distanceTo(this.position);
    this.inside = smooth(R * 1.02, R * 0.85, dEye);

    // Flags.
    if (!this.entered && dPlayer < R) {
      this.entered = true;
      ctx.setFlag(`${this.tag}-entered`);
    }
    if (this.entered && !this.exited && dPlayer > R * 1.02) {
      this.exited = true;
      ctx.setFlag(`${this.tag}-exited`);
    }

    // Camera-locked drifting layer: mesh sits on the eye, puffs wrap around it.
    this.near.mesh.visible = this.inside > 0.01;
    if (this.near.mesh.visible) {
      this.near.mesh.position.copy(this.eyeLocal);
      const w = this.wrap;
      const m = (x: number) => ((x % w) + w) % w;
      // Slow drift of the whole layer (currents in the gas).
      (this.near.eyeMod.value as Vector3).set(m(ctx.eye.x - t * 14), m(ctx.eye.y + t * 3), m(ctx.eye.z - t * 6));
      this.near.erode.value = 1 - this.inside;
    }

    this.gas.update(t);
    this.gas.intensity.value = 1 - 0.85 * this.inside;
    // Lightning: deterministic strike schedule (seekable), 3 bolt slots.
    let flashNear = 0;
    if (this.lightning) {
      const period = this.inside > 0.5 ? 2.2 : 3.4;
      const slot = Math.floor(t / period);
      if (slot !== this.lastStrike) {
        this.lastStrike = slot;
        const hs = h01(slot * 1.37 + (seedOf(this.tag) % 97));
        if (hs < 0.8) {
          const k = slot % BOLTS;
          this.boltLife[k] = 0.001;
          // Inside: strike somewhere ahead of the camera, 1.5–5 km out. Outside: deep in the volume.
          if (this.inside > 0.5) {
            this.camQ.copy(ctx.camera.quaternion);
            this.fwd.set((hs - 0.4) * 1.6, (h01(slot + 4.1) - 0.5) * 0.6, -1).normalize().applyQuaternion(this.camQ);
            const dist = 1500 + h01(slot + 2.2) * 3500;
            this.a.copy(this.eyeLocal).addScaledVector(this.fwd, dist).add(this.v.set(0, 700 + h01(slot + 5.5) * 600, 0));
            this.b.copy(this.a).add(this.v.set((h01(slot + 8.8) - 0.5) * 1500, -1400 - h01(slot + 1.9) * 1200, (h01(slot + 3.3) - 0.5) * 1500));
            this.buildBolt(k, slot * 31 + 5, 8 + dist * 0.004, this.eyeLocal);
          } else {
            this.a.set((hs - 0.5) * R, (h01(slot + 1.1) - 0.2) * R * 0.4, (h01(slot + 2.1) - 0.5) * R);
            this.b.copy(this.a).add(this.v.set((h01(slot + 4.4) - 0.5) * R * 0.3, -R * (0.12 + h01(slot + 7.7) * 0.15), (h01(slot + 6.6) - 0.5) * R * 0.3));
            this.buildBolt(k, slot * 31 + 5, 30 + dEye * 0.0012, this.eyeLocal);
          }
          this.v.addVectors(this.a, this.b).multiplyScalar(0.5);
          (this.outer.flashPos.value as Vector3).copy(this.v);
          this.v.sub(this.eyeLocal);
          (this.near.flashPos.value as Vector3).copy(this.v);
          this.strikeFlash = this.inside > 0.5 ? smooth(7000, 1500, this.v.length()) : 0;
        }
      }
      let glow = 0;
      for (let k = 0; k < BOLTS; k++) {
        if (this.boltLife[k] <= 0) {
          this.uBolt[k].value = 0;
          continue;
        }
        const age = (this.boltLife[k] += ctx.dt);
        // Double-strike flicker, then gone.
        const on = age < 0.07 ? 1 : age < 0.12 ? 0.25 : age < 0.2 ? 0.9 : age < 0.38 ? 0.5 * (1 - (age - 0.2) / 0.18) : 0;
        this.uBolt[k].value = on;
        glow = Math.max(glow, on);
        if (age > 0.4) this.boltLife[k] = 0;
      }
      this.outer.flash.value = glow;
      this.near.flash.value = glow;
      flashNear = glow * this.strikeFlash;
      if (flashNear > 0) fxMix.raise('flash', flashNear * 0.16);
    }

    // Visibility collapse + nav interference.
    const fog = this.inside * this.density;
    fxMix.fogColor(this, this.fogColor);
    fxMix.set(this, 'fog', fog);
    if (fog > 0) ctx.postFx.fogRange = 3.5 - 2.7 * this.inside;
    fxMix.set(this, 'navNoise', Math.min(1, this.inside * 0.75 + flashNear * 0.6));
  }

  dispose(): void {
    fxMix.release(this);
    this.outer.dispose();
    this.gas.dispose();
    this.near.dispose();
    this.bolts.geometry.dispose();
    this.boltMat.dispose();
    this.group.removeFromParent();
  }
}
