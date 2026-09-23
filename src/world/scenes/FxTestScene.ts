import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import { WorldSpace } from '@/core/WorldSpace';
import { assets } from '@/assets/AssetLibrary';
import type { ShipModel } from '@/assets/ShipBuilder';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { Particles } from '@/fx/Particles';
import { PAL } from '@/fx/kinds';
import { TRAIL_MISSILE, type TrailHandle } from '@/fx/Trails';

/**
 * Milestone 12 test bed: the compute particle engine ~3 000 km from the
 * universe origin (floating-origin honesty), with a deliberately tiny anchor
 * rebase distance so the orbiting camera triggers a GPU rebase every second
 * or so — any precision or rebase bug shows up as popping smoke.
 *
 *   · 40 missiles on spiralling Bézier paths ("Itano circus") laying puffy
 *     white trails, popping in small explosions on arrival and relaunching
 *   · a Choir Vesper taking laser impacts and magenta/cyan shield hits
 *   · periodic explosions from fighter (10 m) to capital-section (260 m) scale
 *   · debris bursts
 *
 *   ?scene=fx&t=2&hud=0      (key C cycles camera)
 */
const ORIGIN = new Vector3(2_300_000, 1_100_000, -1_600_000); // |ORIGIN| ≈ 3.0e6 m

const MISSILES = 40;

interface Missile {
  trail: TrailHandle;
  /** Launch time (scene seconds); NaN = waiting. */
  t0: number;
  flight: number;
  relaunchAt: number;
  p0: Vector3;
  c0: Vector3;
  c1: Vector3;
  p1: Vector3;
  /** Helix basis (unit, perpendicular to the launch → target line). */
  u: Vector3;
  w: Vector3;
  radius: number;
  turns: number;
  phase: number;
}

interface CamShot {
  name: string;
  fov: number;
  eye: (t: number, out: Vector3) => Vector3;
  look: Vector3;
}

const SHOTS: CamShot[] = [
  {
    name: 'WIDE',
    fov: 50,
    eye: (t, o) => o.set(230 + Math.sin(t * 0.15) * 40, 70 + Math.sin(t * 0.1) * 10, -330 + Math.cos(t * 0.15) * 20),
    look: new Vector3(0, 10, 60),
  },
  {
    name: 'CLOSE · TARGET',
    fov: 40,
    eye: (t, o) => o.set(110 + Math.sin(t * 0.2) * 20, 30, -150),
    look: new Vector3(0, 0, 0),
  },
  {
    name: 'CAPITAL BLAST',
    fov: 34,
    eye: (t, o) => o.set(-200 + Math.sin(t * 0.1) * 40, 120, -400),
    look: new Vector3(500, 250, 1600),
  },
];

/** ?fxdemo=blast — a single repeating explosion framed for its scale (?fxscale=40). */
type Demo = 'all' | 'blast' | 'trails';

let seed = 0x2468ace;
function rnd(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  return (seed >>> 0) / 4294967296;
}
const rr = (a: number, b: number) => a + (b - a) * rnd();

export class FxTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(52, 16 / 9, 0.5, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly fx = new Particles({ rebaseDistance: 25 });
  private readonly backdrop = new Backdrop(BACKDROPS.meridian);
  private readonly target: ShipModel;
  private readonly missiles: Missile[] = [];
  private shot = 0;
  private sceneTime = 0;
  private nextImpact = 0.05;
  private nextShield = 0.1;
  private nextBlast = 0;
  private blastIndex = 0;

  // scratch
  private readonly v = new Vector3();
  private readonly n = new Vector3();
  private readonly zero = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly launcher = new Vector3(210, -25, -60).add(ORIGIN);
  private readonly demo: Demo;
  private readonly speed: number;
  private readonly demoScale: number;

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);
    this.scene.add(this.fx.object);

    this.target = assets.ship('choir-vesper');
    this.target.root.position.copy(ORIGIN);
    this.target.root.rotation.set(0.1, 2.5, 0.15);
    this.target.setThrottle(0.6);
    this.world.root.add(this.target.root);

    for (let i = 0; i < MISSILES; i++) {
      const m: Missile = {
        trail: -1,
        t0: NaN,
        flight: 1,
        relaunchAt: i * 0.035,
        p0: new Vector3(),
        c0: new Vector3(),
        c1: new Vector3(),
        p1: new Vector3(),
        u: new Vector3(),
        w: new Vector3(),
        radius: 0,
        turns: 0,
        phase: 0,
      };
      this.missiles.push(m);
    }
    const q = new URLSearchParams(window.location.search);
    const demo = q.get('fxdemo');
    this.demo = demo === 'blast' || demo === 'trails' ? demo : 'all';
    this.speed = Number(q.get('fxspeed') ?? 1) || 1;
    this.demoScale = Number(q.get('fxscale') ?? 40) || 40;
    this.target.root.visible = this.demo !== 'blast';
    this.shot = Math.min(Number(q.get('cam') ?? 0) || 0, SHOTS.length - 1);
    this.camera.fov = SHOTS[this.shot].fov;
    this.camera.updateProjectionMatrix();
  }

  private launch(m: Missile, t: number): void {
    m.t0 = t;
    m.flight = rr(1.8, 3.2);
    // Launch from a spread-out "missile pod" cluster, fanning outward first.
    m.p0.copy(this.launcher).add(this.v.set(rr(-30, 30), rr(-20, 20), rr(-30, 30)));
    m.c0.copy(m.p0).add(this.v.set(rr(-350, 150), rr(-250, 350), rr(-150, 250)));
    const tr = this.target.radius || 20;
    m.p1.copy(ORIGIN).add(this.v.set(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize().multiplyScalar(tr * rr(0.9, 1.6)));
    m.c1.copy(m.p1).add(this.v.set(rr(-300, 300), rr(-200, 300), rr(-400, 100)));
    this.v.subVectors(m.p1, m.p0).normalize();
    m.u.set(0, 1, 0).cross(this.v).normalize();
    m.w.crossVectors(this.v, m.u);
    m.radius = rr(8, 45);
    m.turns = rr(0.6, 2.4) * (rnd() < 0.5 ? -1 : 1);
    m.phase = rr(0, Math.PI * 2);
    m.trail = this.fx.trails.create(TRAIL_MISSILE);
  }

  /** Cubic Bézier + a helical weave that vanishes at both ends. */
  private missilePos(m: Missile, s: number, out: Vector3): Vector3 {
    const a = 1 - s;
    out
      .copy(m.p0)
      .multiplyScalar(a * a * a)
      .addScaledVector(m.c0, 3 * a * a * s)
      .addScaledVector(m.c1, 3 * a * s * s)
      .addScaledVector(m.p1, s * s * s);
    const env = Math.sin(Math.PI * s) * m.radius;
    const ph = m.phase + s * m.turns * Math.PI * 2;
    return out.addScaledVector(m.u, Math.cos(ph) * env).addScaledVector(m.w, Math.sin(ph) * env);
  }

  update(ctx: FrameContext): void {
    // ?fxspeed=n runs the effects clock faster (lets slow software-GPU captures reach later stages).
    const dt = ctx.dt * this.speed;
    const t = (this.sceneTime += dt);
    const fx = this.fx;

    if (this.demo === 'blast') {
      this.updateBlastDemo(t, dt);
      return;
    }

    // ── missiles ──
    for (const m of this.missiles) {
      if (Number.isNaN(m.t0)) {
        if (t >= m.relaunchAt) this.launch(m, t);
        else continue;
      }
      const s = Math.min((t - m.t0) / m.flight, 1);
      // Ease-in: missiles accelerate off the rail.
      const se = s * s * (1.6 - 0.6 * s);
      this.missilePos(m, se, this.v);
      fx.trails.update(m.trail, this.v);
      if (s >= 1) {
        fx.explosion(this.v, this.zero, rr(4, 8));
        fx.trails.release(m.trail);
        m.trail = -1;
        m.t0 = NaN;
        m.relaunchAt = t + rr(0.6, 2.0);
      }
    }

    if (this.demo === 'trails') {
      this.finishFrame(t, dt);
      return;
    }

    // ── laser impacts & shield hits on the target ──
    const tr = this.target.radius || 20;
    if (t >= this.nextImpact) {
      this.nextImpact = t + rr(0.2, 0.45);
      this.n.set(rr(-1, 1), rr(-0.4, 1), rr(-1, -0.1)).normalize();
      this.v.copy(ORIGIN).addScaledVector(this.n, tr * 0.45);
      fx.impact(this.v, this.n, this.zero);
    }
    if (t >= this.nextShield) {
      this.nextShield = t + rr(0.3, 0.6);
      this.n.set(rr(-1, 1), rr(-0.5, 1), rr(-1, 0.2)).normalize();
      this.v.copy(ORIGIN).addScaledVector(this.n, tr * 1.25);
      fx.shieldHit(this.v, this.n, tr * rr(0.25, 0.4), undefined, rnd() < 0.5 ? PAL.MAGENTA : PAL.PLASMA);
    }

    // ── staged explosions of every scale ──
    if (t >= this.nextBlast) {
      const k = this.blastIndex++ % 6;
      switch (k) {
        case 0: // capital section, far
          fx.explosion(this.v.set(500, 250, 1600).add(ORIGIN), this.zero, 260);
          break;
        case 1: // frigate section
          fx.explosion(this.v.set(-150, 60, 240).add(ORIGIN), this.zero, 40);
          break;
        case 2: // fighter
          fx.explosion(this.v.set(80, -20, -60).add(ORIGIN), this.zero, 10);
          fx.debris(this.v, this.zero, 10);
          break;
        case 3: // plasma reactor pop
          fx.explosion(this.v.set(-40, -80, 300).add(ORIGIN), this.zero, 55, PAL.PLASMA);
          break;
        case 4:
          fx.explosion(this.v.set(150, 90, 200).add(ORIGIN), this.zero, 22);
          fx.debris(this.v, this.zero, 22, 14);
          break;
        default:
          fx.explosion(this.v.set(-300, 40, 700).add(ORIGIN), this.zero, 120);
          break;
      }
      this.nextBlast = t + (k === 5 ? 1.6 : 0.55);
    }

    this.finishFrame(t, dt);
  }

  private updateBlastDemo(t: number, dt: number): void {
    const s = this.demoScale;
    if (t >= this.nextBlast) {
      this.fx.explosion(this.v.copy(ORIGIN), this.zero, s);
      this.nextBlast = t + 4 * Math.pow(s / 10, 0.35);
    }
    this.world.eye.set(s * 2.2, s * 0.8, -s * 4.5).add(ORIGIN);
    this.lookAt.copy(ORIGIN);
    this.finishCamera(dt);
  }

  private finishFrame(t: number, dt: number): void {
    // ── camera (float64 universe → eye-relative render) ──
    const shot = SHOTS[this.shot];
    shot.eye(t, this.world.eye).add(ORIGIN);
    this.lookAt.copy(shot.look).add(ORIGIN);
    this.finishCamera(dt);
  }

  private finishCamera(dt: number): void {
    const fx = this.fx;
    this.world.sync(this.camera);
    this.world.toRender(this.lookAt, this.lookAt);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
    this.backdrop.follow(this.camera);

    // Particles last: after all emits and after the eye is final.
    fx.update(dt, this.world.eye);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cycleCamera(): void {
    this.shot = (this.shot + 1) % SHOTS.length;
    this.camera.fov = SHOTS[this.shot].fov;
    this.camera.updateProjectionMatrix();
  }

  cameraLabel(): string {
    return `FX · ${SHOTS[this.shot].name} · r${this.target.radius.toFixed(0)} · ${this.fx.liveCount} live · ${this.fx.trails.activeCount} trails`;
  }
}
