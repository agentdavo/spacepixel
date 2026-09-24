import { BufferGeometry, Float32BufferAttribute, Group, InstancedBufferGeometry, Mesh, Vector3, type Object3D } from 'three';
import { MeshBasicNodeMaterial, StorageBufferAttribute, StorageInstancedBufferAttribute, type Renderer } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  cos,
  cross,
  exp,
  float,
  hash,
  instanceIndex,
  max,
  mix,
  normalize,
  select,
  sin,
  sqrt,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { useBlendedMRT } from '@/world/BlendedMRT';
import { PAL, PK, type ParticlePalette } from './kinds';
import { createParticleMaterials, type ParticleGpu } from './ParticleMaterials';
import { Trails } from './Trails';
import * as presets from './presets';
import type { SpawnDesc } from './spawn';

export { makeSpawn, resetSpawn, type SpawnDesc } from './spawn';

export interface ParticleOptions {
  /** Ring-buffer size, power of two. Default 131 072 (8 MB of particle state). */
  capacity?: number;
  /** Max spawn requests per frame. Default 2048. */
  maxRequests?: number;
  /** Move the particle anchor once the eye is this far from it (m). Default 2 000. */
  rebaseDistance?: number;
  /**
   * Force the backend decision instead of detecting it at first render
   * (false → the system is a no-op; e.g. pass `info.isWebGPU`).
   */
  webgpu?: boolean;
}

/** Floats per request in the spawn queue (8 × vec4). */
const REQ_VEC4 = 8;
/** Frame batches tracked for the live window. */
const BATCHES = 1024;

/**
 * Milestone 12 — GPU compute particle engine (90s cel-animation effects).
 *
 * ── Storage ──────────────────────────────────────────────────────────────
 * A fixed-capacity ring buffer of particles in four vec4 storage buffers:
 *   P  pos.xyz (anchor-relative, m) · age (s, negative = still delayed)
 *   V  vel.xyz (m/s; plane normal for RING/SHIELD) · life (s)
 *   B  base vel.xyz (drag target, inherited from the emitter) · kind + 16·palette
 *   S  size0 · size1 · seed · drag
 * Particles are written in spawn order, so the ring is chronological and the
 * only live particles are those in the window [tail, head). The CPU tracks
 * per-frame batches with their expiry times, and both the compute dispatch and
 * the instanced draws cover only that window — cost scales with live
 * particles, not capacity.
 *
 * ── Spawning (no per-particle CPU work, no readbacks) ────────────────────
 * `emit()` appends one 128-byte request to a CPU staging array. update()
 * uploads just the used range (one writeBuffer). The single compute pass
 * runs over window ∪ newly-claimed slots; a thread whose slot lies in this
 * frame's claimed range [head, head+spawn) binary-searches the request table
 * (prefix sums in q0.w, log2(maxRequests)+1 = 12 steps) and initialises its particle from hashed
 * randoms; every other thread integrates its particle. One dispatch per frame.
 *
 * ── Floating origin ──────────────────────────────────────────────────────
 * Positions are float32 relative to a float64 `anchor` that follows the eye.
 * When the eye drifts more than `rebaseDistance` from the anchor, the anchor
 * jumps to the eye and that frame's compute pass subtracts the (float64-
 * computed) delta from every live particle. Spawn positions are converted
 * universe → anchor-relative in float64 on the CPU at update() time. The draw
 * adds `anchor − eye` (small, computed in float64) to each particle, so
 * everything the GPU sees is within a few km of the camera: millimetre
 * precision anywhere in the universe.
 *
 * ── Drawing ──────────────────────────────────────────────────────────────
 * Two instanced-quad draws over the window: an opaque alpha-tested cel pass
 * (fire, smoke, missile puffs, debris — writes a fake-sphere normal + depth +
 * ink channels so the ink pass outlines smoke like cel paint) and an additive
 * glow pass (sparks, flashes, rings, shield hexes, glints — no ink).
 *
 * ── Wiring ───────────────────────────────────────────────────────────────
 *   const fx = new Particles();
 *   scene.add(fx.object);                      // Scene, not WorldSpace.root
 *   fx.explosion(universePos, vel, 30);        // any time during update
 *   fx.update(dt, world.eye);                  // once per frame, after the eye is final
 * The compute dispatch happens automatically just before the scene draws.
 *
 * ── Fallback ─────────────────────────────────────────────────────────────
 * Without the WebGPU backend (WebGL2 fallback) the system disables itself on
 * the first frame: meshes stay hidden and emit() is a cheap no-op.
 */
export class Particles {
  readonly object: Object3D = new Group();
  readonly capacity: number;
  readonly maxRequests: number;
  readonly rebaseDistance: number;
  readonly trails: Trails;
  /** Universe position of the particle anchor (float64). */
  readonly anchor = new Vector3();
  /** False once a non-WebGPU backend has been detected. */
  enabled = true;
  /** Live window size last frame (particles simulated + drawn). */
  liveCount = 0;
  /** Particles spawned last frame. */
  spawnedCount = 0;

  private readonly attrP: StorageInstancedBufferAttribute;
  private readonly attrV: StorageInstancedBufferAttribute;
  private readonly attrB: StorageInstancedBufferAttribute;
  private readonly attrS: StorageInstancedBufferAttribute;
  private readonly attrReq: StorageBufferAttribute;
  private readonly reqF32: Float32Array;
  /** Universe positions of queued requests (float64): p0.xyz, p1.xyz. */
  private readonly reqPos: Float64Array;
  private reqCount = 0;
  private spawnQueued = 0;
  private frameMaxLife = 0;

  private readonly uHead: Node = uniform(0, 'uint');
  private readonly uTail: Node = uniform(0, 'uint');
  private readonly uSpawn: Node = uniform(0, 'uint');
  private readonly uReqCount: Node = uniform(0, 'uint');
  private readonly uSalt: Node = uniform(0, 'uint');
  private readonly uDt: Node = uniform(0);
  private readonly uShift: Node = uniform(new Vector3());
  private readonly uAnchorOffset: Node = uniform(new Vector3());
  private readonly computeNode: Node;

  private readonly opaqueMesh: Mesh;
  private readonly glowMesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly driver: Mesh;

  private headCounter = 0;
  private readonly batchStart = new Float64Array(BATCHES);
  private readonly batchExpire = new Float64Array(BATCHES);
  private batchFront = 0;
  private batchLen = 0;
  private clock = 0;
  private frame = 0;
  private anchorSet = false;
  private updateId = 0;
  private dispatchedId = 0;
  private backendChecked = false;
  private hasWork = false;
  /** dt passed to the last update() (trails use it to stagger puff ages). */
  lastDt = 1 / 60;

  constructor(opts: ParticleOptions = {}) {
    const capacity = opts.capacity ?? 1 << 17;
    if ((capacity & (capacity - 1)) !== 0) throw new Error('Particles: capacity must be a power of two');
    this.capacity = capacity;
    this.maxRequests = opts.maxRequests ?? 2048;
    this.rebaseDistance = opts.rebaseDistance ?? 2000;
    if (opts.webgpu === false) this.enabled = false;
    this.object.name = 'fx-particles';

    const mk = () => new StorageInstancedBufferAttribute(capacity, 4);
    this.attrP = mk();
    this.attrV = mk();
    this.attrB = mk();
    this.attrS = mk();
    // All particles start dead: age 0, life 0.
    this.reqF32 = new Float32Array(this.maxRequests * REQ_VEC4 * 4);
    this.attrReq = new StorageBufferAttribute(this.reqF32, 4);
    this.reqPos = new Float64Array(this.maxRequests * 6);

    this.computeNode = this.buildCompute();

    const gpu: ParticleGpu = {
      attrP: this.attrP,
      attrV: this.attrV,
      attrB: this.attrB,
      attrS: this.attrS,
      capacity,
      uTail: this.uTail,
      uAnchorOffset: this.uAnchorOffset,
    };
    const mats = createParticleMaterials(gpu);

    // One unit quad (−1..1) instanced over the live window.
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.instanceCount = 0;

    this.opaqueMesh = new Mesh(this.geo, mats.opaque);
    this.opaqueMesh.name = 'fx-cel';
    this.glowMesh = new Mesh(this.geo, mats.glow);
    this.glowMesh.name = 'fx-glow';
    this.glowMesh.renderOrder = 20;
    useBlendedMRT(this.glowMesh);
    for (const m of [this.opaqueMesh, this.glowMesh]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.visible = false; // shown after the first successful WebGPU dispatch
      this.object.add(m);
    }

    // Draws one degenerate triangle (no fragments). Its onBeforeRender runs
    // the compute pass once per frame — the compute is submitted before the
    // scene pass's command buffer, so the particle draws always see this
    // frame's state — and detects the backend on first use.
    const dg = new BufferGeometry();
    dg.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const dm = new MeshBasicNodeMaterial();
    dm.colorWrite = false;
    dm.depthWrite = false;
    this.driver = new Mesh(dg, dm);
    this.driver.name = 'fx-compute-driver';
    this.driver.frustumCulled = false;
    this.driver.renderOrder = -1e6;
    this.driver.onBeforeRender = (renderer) => this.dispatch(renderer as unknown as Renderer);
    this.object.add(this.driver);

    this.trails = new Trails(this);
    // Scene teardown (core/dispose.ts) finds this and releases the compute pipeline.
    this.object.userData.dispose = () => this.dispose();
  }

  /** Release the compute pass (its pipeline and bindings pin the storage buffers). */
  dispose(): void {
    (this.computeNode as unknown as { dispose?(): void }).dispose?.();
  }

  // ── public API ───────────────────────────────────────────────────────

  /** Queue a spawn request. Returns the number of particles queued (0 if full / disabled). */
  emit(d: SpawnDesc): number {
    if (!this.enabled || d.count <= 0) return 0;
    if (this.reqCount >= this.maxRequests) return 0;
    const count = Math.min(Math.floor(d.count), this.capacity - this.spawnQueued);
    if (count <= 0) return 0;
    const i = this.reqCount++;
    const f = this.reqF32;
    const o = i * REQ_VEC4 * 4;
    const pp = i * 6;
    const to = d.to ?? d.pos;
    this.reqPos[pp] = d.pos.x;
    this.reqPos[pp + 1] = d.pos.y;
    this.reqPos[pp + 2] = d.pos.z;
    this.reqPos[pp + 3] = to.x;
    this.reqPos[pp + 4] = to.y;
    this.reqPos[pp + 5] = to.z;
    // q0: p0 (filled in update) · start
    f[o + 3] = this.spawnQueued;
    // q1: segment (filled in update) · kindPacked
    f[o + 7] = d.kind + d.palette * 16;
    // q2: base vel · drag
    f[o + 8] = d.baseVel.x;
    f[o + 9] = d.baseVel.y;
    f[o + 10] = d.baseVel.z;
    f[o + 11] = d.drag;
    // q3: dir · spread
    f[o + 12] = d.dir.x;
    f[o + 13] = d.dir.y;
    f[o + 14] = d.dir.z;
    f[o + 15] = d.spread;
    // q4: speed · life ranges
    f[o + 16] = d.speedMin;
    f[o + 17] = d.speedMax;
    f[o + 18] = d.lifeMin;
    f[o + 19] = d.lifeMax;
    // q5: size0 · size1 · delay · jitter
    f[o + 20] = d.size0;
    f[o + 21] = d.size1;
    f[o + 22] = d.delay;
    f[o + 23] = d.jitter;
    // q6: ageA · ageB · (unused) · count
    f[o + 24] = d.ageA;
    f[o + 25] = d.ageB;
    f[o + 26] = 0;
    f[o + 27] = count;
    // q7: radial · sizeJitter
    f[o + 28] = d.radial ? 1 : 0;
    f[o + 29] = d.sizeJitter;
    f[o + 30] = 0;
    f[o + 31] = 0;
    this.spawnQueued += count;
    this.frameMaxLife = Math.max(this.frameMaxLife, d.lifeMax + d.delay);
    return count;
  }

  /** Fireball + shock ring + sparks + delayed smoke + flash. `scale` ≈ radius of the blast in metres (10 fighter … 300 capital). */
  explosion(pos: Vector3, vel: Vector3, scale: number, palette: ParticlePalette = PAL.WARM): void {
    presets.explosion(this, pos, vel, scale, palette);
  }

  /** Tumbling angular hull chunks with a hot edge. */
  debris(pos: Vector3, vel: Vector3, scale: number, count?: number): void {
    presets.debris(this, pos, vel, scale, count);
  }

  /** Laser hit on a hull: spark cone along `normal` + small flash. */
  impact(pos: Vector3, normal: Vector3, vel: Vector3, palette: ParticlePalette = PAL.WARM): void {
    presets.impact(this, pos, normal, vel, palette);
  }

  /** Hexagon ripple flash on a shield bubble (plane perpendicular to `normal`). */
  shieldHit(pos: Vector3, normal: Vector3, radius = 14, vel?: Vector3, palette: ParticlePalette = PAL.PLASMA): void {
    presets.shieldHit(this, pos, normal, radius, vel, palette);
  }

  /**
   * Per-frame: call once after all emits and after the eye is final.
   * @param dt  frame time (s)
   * @param eye universe position of the eye (float64)
   */
  update(dt: number, eye: Vector3): void {
    this.lastDt = dt;
    this.clock += dt;
    this.frame++;
    this.updateId++;

    // 1. Anchor / rebase (float64).
    const shift = this.uShift.value as Vector3;
    if (!this.anchorSet) {
      this.anchor.copy(eye);
      this.anchorSet = true;
      shift.set(0, 0, 0);
    } else if (this.anchor.distanceToSquared(eye) > this.rebaseDistance * this.rebaseDistance) {
      shift.subVectors(eye, this.anchor);
      this.anchor.copy(eye);
    } else {
      shift.set(0, 0, 0);
    }
    (this.uAnchorOffset.value as Vector3).subVectors(this.anchor, eye);

    // 2. Spawn queue → anchor-relative float32, upload used range only.
    const spawn = this.enabled ? this.spawnQueued : 0;
    const cap = this.capacity;
    if (spawn > 0) {
      const f = this.reqF32;
      const ax = this.anchor.x;
      const ay = this.anchor.y;
      const az = this.anchor.z;
      for (let i = 0; i < this.reqCount; i++) {
        const o = i * REQ_VEC4 * 4;
        const pp = i * 6;
        const x0 = this.reqPos[pp];
        const y0 = this.reqPos[pp + 1];
        const z0 = this.reqPos[pp + 2];
        f[o] = x0 - ax;
        f[o + 1] = y0 - ay;
        f[o + 2] = z0 - az;
        f[o + 4] = this.reqPos[pp + 3] - x0;
        f[o + 5] = this.reqPos[pp + 4] - y0;
        f[o + 6] = this.reqPos[pp + 5] - z0;
      }
      this.attrReq.clearUpdateRanges();
      this.attrReq.addUpdateRange(0, this.reqCount * REQ_VEC4 * 4);
      this.attrReq.needsUpdate = true;
    }

    // 3. Live window bookkeeping (chronological ring).
    const headSlot = this.headCounter % cap;
    if (spawn > 0) {
      const expire = this.clock + this.frameMaxLife + 0.1;
      if (this.batchLen < BATCHES) {
        const bi = (this.batchFront + this.batchLen) % BATCHES;
        this.batchStart[bi] = this.headCounter;
        this.batchExpire[bi] = expire;
        this.batchLen++;
      } else {
        const bi = (this.batchFront + this.batchLen - 1) % BATCHES;
        this.batchExpire[bi] = Math.max(this.batchExpire[bi], expire);
      }
      this.headCounter += spawn;
    }
    while (this.batchLen > 0 && this.batchExpire[this.batchFront] <= this.clock) {
      this.batchFront = (this.batchFront + 1) % BATCHES;
      this.batchLen--;
    }
    let tail = this.batchLen > 0 ? this.batchStart[this.batchFront] : this.headCounter;
    tail = Math.max(tail, this.headCounter - cap);
    const window = this.headCounter - tail;

    this.uHead.value = headSlot;
    this.uTail.value = tail % cap;
    this.uSpawn.value = spawn;
    this.uReqCount.value = this.reqCount;
    this.uSalt.value = (Math.imul(this.frame, 0x9e3779b1) >>> 0) & 0xfffffff0;
    this.uDt.value = dt;
    this.computeNode.count = Math.max(window, 1);
    this.geo.instanceCount = window;
    this.liveCount = window;
    this.spawnedCount = spawn;
    const show = this.enabled && this.backendChecked && window > 0;
    this.opaqueMesh.visible = show;
    this.glowMesh.visible = show;

    this.reqCount = 0;
    this.spawnQueued = 0;
    this.frameMaxLife = 0;
    this.hasWork = window > 0;
  }

  // ── GPU ─────────────────────────────────────────────────────────────

  private dispatch(renderer: Renderer): void {
    if (this.dispatchedId === this.updateId) return;
    this.dispatchedId = this.updateId;
    if (!this.backendChecked) {
      this.backendChecked = true;
      const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
      if (backend.isWebGPUBackend !== true) {
        this.enabled = false;
        console.info('[fx] compute particles need the WebGPU backend — particle effects disabled');
      }
    }
    if (!this.enabled) {
      this.opaqueMesh.visible = this.glowMesh.visible = false;
      return;
    }
    if (this.hasWork) renderer.compute(this.computeNode);
  }

  private buildCompute(): Node {
    const cap = this.capacity;
    const mask = cap - 1;
    const P: Node = storage(this.attrP, 'vec4', cap);
    const V: Node = storage(this.attrV, 'vec4', cap);
    const B: Node = storage(this.attrB, 'vec4', cap);
    const S: Node = storage(this.attrS, 'vec4', cap);
    const R: Node = storage(this.attrReq, 'vec4', this.maxRequests * REQ_VEC4).toReadOnly();
    const searchSteps = Math.ceil(Math.log2(this.maxRequests)) + 1;

    const uHead = this.uHead;
    const uTail = this.uTail;
    const uSpawn = this.uSpawn;
    const uReqCount = this.uReqCount;
    const uSalt = this.uSalt;
    const uDt = this.uDt;
    const uShift = this.uShift;

    const isOriented = (kp: Node): Node => {
      const k = kp.add(0.5).mod(16).floor();
      return k.equal(PK.RING).or(k.equal(PK.SHIELD));
    };

    return Fn(() => {
      const slot = uTail.add(instanceIndex).bitAnd(uint(mask)).toVar('slot');
      const k = slot.add(uint(cap)).sub(uHead).bitAnd(uint(mask)).toVar('k');

      If(k.lessThan(uSpawn), () => {
        // ── spawn: find the request that owns spawn index k ──
        const kf = float(k).toVar('kf');
        const lo = uint(0).toVar('lo');
        const hi = uint(uReqCount).toVar('hi');
        Loop(searchSteps, () => {
          const mid = lo.add(hi).shiftRight(uint(1)).toVar();
          If(R.element(mid.mul(uint(REQ_VEC4))).w.lessThanEqual(kf), () => {
            lo.assign(mid);
          }).Else(() => {
            hi.assign(mid);
          });
        });
        const base = lo.mul(uint(REQ_VEC4)).toVar('qBase');
        const q = (n: number): Node => R.element(base.add(uint(n)));
        const q0 = q(0).toVar('q0');
        const q1 = q(1).toVar('q1');
        const q2 = q(2).toVar('q2');
        const q3 = q(3).toVar('q3');
        const q4 = q(4).toVar('q4');
        const q5 = q(5).toVar('q5');
        const q6 = q(6).toVar('q6');
        const q7 = q(7).toVar('q7');

        const j = kf.sub(q0.w);
        const cnt = q6.w;
        const f = select(cnt.greaterThan(1.5), j.div(max(cnt.sub(1), 1)), float(0)).toVar('f');

        const hb = k.mul(uint(16)).add(uSalt).toVar('hb');
        const u = (n: number): Node => hash(hb.add(uint(n)));

        // Random unit vector (uniform sphere) for the position offset.
        const cz = u(0).mul(2).sub(1);
        const ph = u(1).mul(6.2831853);
        const sr = sqrt(max(float(1).sub(cz.mul(cz)), 0));
        const jd = vec3(sr.mul(cos(ph)), sr.mul(sin(ph)), cz).toVar('jd');
        const jr = q5.w.mul(sqrt(u(2)));
        const pos: Node = q0.xyz.add(q1.xyz.mul(f)).add(jd.mul(jr));

        // Cone around dir.
        const dLen = q3.xyz.length();
        const dir = select(dLen.greaterThan(1e-4), q3.xyz.div(max(dLen, 1e-4)), vec3(0, 0, 1)).toVar('dir');
        const spread = select(dLen.greaterThan(1e-4), q3.w, float(1));
        const ct = float(1).sub(u(3).mul(2).mul(spread));
        const st = sqrt(max(float(1).sub(ct.mul(ct)), 0));
        const ph2 = u(4).mul(6.2831853);
        const helper = select(abs(dir.y).lessThan(0.95), vec3(0, 1, 0), vec3(1, 0, 0));
        const t1 = normalize(cross(dir, helper));
        const t2 = cross(dir, t1);
        const coneDir = t1.mul(st.mul(cos(ph2))).add(t2.mul(st.mul(sin(ph2)))).add(dir.mul(ct));
        const vdir = select(q7.x.greaterThan(0.5), jd, coneDir);
        const speed = mix(q4.x, q4.y, u(5));
        const vel: Node = q2.xyz.add(vdir.mul(speed));

        const life: Node = mix(q4.z, q4.w, u(6));
        const age = mix(q6.x, q6.y, f).sub(q5.z.mul(u(7)));
        const sj = float(1).add(u(8).sub(0.5).mul(2).mul(q7.y));
        const oriented: Node = isOriented(q1.w);

        P.element(slot).assign(vec4(pos, age));
        V.element(slot).assign(vec4(select(oriented, q3.xyz, vel), life));
        B.element(slot).assign(vec4(q2.xyz, q1.w));
        S.element(slot).assign(vec4(q5.x.mul(sj), q5.y.mul(sj), u(9), q2.w));
      }).Else(() => {
        // ── integrate ──
        const p = P.element(slot).toVar('p');
        const v = V.element(slot).toVar('v');
        const b = B.element(slot).toVar('b');
        const drag = S.element(slot).w;
        const oriented = isOriented(b.w);
        const nv = b.xyz.add(v.xyz.sub(b.xyz).mul(exp(drag.negate().mul(uDt)))).toVar('nv');
        const move = select(oriented, b.xyz, nv);
        P.element(slot).assign(vec4(p.xyz.sub(uShift).add(move.mul(uDt)), p.w.add(uDt)));
        If(oriented.not(), () => {
          V.element(slot).assign(vec4(nv, v.w));
        });
      });
    })().compute(cap, [64]);
  }
}
