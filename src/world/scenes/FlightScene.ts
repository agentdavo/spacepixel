import { Matrix4, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { input, type ControlState } from '@/core/Input';
import { flags } from '@/core/Flags';
import { FlightModel, KESTREL_SPEC } from '@/sim/FlightModel';
import { ChaseCamera } from '@/sim/ChaseCamera';
import { CameraDirector, type Subject } from '@/sim/CameraDirector';
import { assets } from '@/assets/AssetLibrary';
import type { ShipModel } from '@/assets/ShipBuilder';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { Planet, PLANETS } from '../Planet';
import { LanternGate } from '../LanternGate';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { FlightHud } from '@/ui/FlightHud';
import { postFx } from '@/render/post/PostFx';

/**
 * Milestones 4–5: one ship, flying well.
 *
 * The player Kestrel is simulated in float64 universe space far from the
 * system origin (to keep floating-origin honest) and rendered camera-relative.
 * Landmarks: a Lantern gate to fly through, the gas giant, a distant Choir
 * Cathedral, and two wingmen holding loose formation.
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000); // deliberately huge

export class FlightScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.3, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly flight = new FlightModel(KESTREL_SPEC);
  readonly chase = new ChaseCamera(this.camera);
  readonly director = new CameraDirector(this.camera, this.chase);
  /** Placeholder bandits on scripted paths (M14 replaces with AI). */
  readonly bandits: { model: ShipModel; subject: Subject; center: Vector3; a: number; b: number; r: number; ph: number }[] = [];
  private targetIndex = 0;
  private cinematic = flags.demo;
  private wasBoosting = false;
  private lastCut = -10;
  private playerSubject: Subject;
  readonly ship: ShipModel;
  readonly wingmen: { model: ShipModel; slot: Vector3; pos: Vector3; quat: Quaternion }[] = [];
  private backdrop = new Backdrop(BACKDROPS.meridian);
  private hud: FlightHud;

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);

    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(ORIGIN).add(new Vector3(150_000, -70_000, 290_000));
    planet.group.rotation.set(0.1, 0.4, 0.28);
    this.world.root.add(planet.group);

    const gate = new LanternGate(420);
    gate.group.position.copy(ORIGIN).add(new Vector3(0, 60, 2600));
    gate.group.rotation.y = 0.15;
    this.world.root.add(gate.group);

    const cathedral = assets.ship('choir-cathedral');
    cathedral.root.position.copy(ORIGIN).add(new Vector3(-5200, 1400, 11000));
    cathedral.root.rotation.set(0.05, 2.2, 0.08);
    cathedral.setThrottle(0.5);
    this.world.root.add(cathedral.root);

    this.ship = assets.ship('vf27-kestrel');
    this.world.root.add(this.ship.root);

    for (const slot of [new Vector3(-22, -4, -26), new Vector3(24, 3, -34)]) {
      const model = assets.ship('vf27-kestrel');
      this.world.root.add(model.root);
      this.wingmen.push({ model, slot, pos: new Vector3(), quat: new Quaternion() });
    }

    // Bandits circling the gate.
    for (let i = 0; i < 3; i++) {
      const model = assets.ship('choir-cantor');
      this.world.root.add(model.root);
      this.bandits.push({
        model,
        subject: { position: new Vector3(), velocity: new Vector3(), radius: 8 },
        center: ORIGIN.clone().add(new Vector3(0, 60, 2600)),
        a: 0.11 + i * 0.023,
        b: 0.07 + i * 0.019,
        r: 700 + i * 260,
        ph: i * 2.1,
      });
    }

    // Start on approach to the gate.
    this.flight.position.copy(ORIGIN);
    this.flight.velocity.set(0, 0, 150);
    this.flight.throttle = 0.7;
    for (const w of this.wingmen) w.pos.copy(w.slot).add(ORIGIN);
    this.chase.snap(this.flight);

    this.playerSubject = { position: this.flight.position, velocity: this.flight.velocity, radius: 9 };
    if (flags.demo) input.override = demoPilot;
    window.addEventListener('keydown', (e) => this.onKey(e.code));
    // ?cam=1 padlock on target · ?cam=2 orbit target · ?cam=3 missile-style track of a bandit
    const t0 = this.bandits[0].subject;
    if (flags.cam === 1) this.director.setBase('lock', t0);
    if (flags.cam === 2) this.director.cut('orbit', t0, Infinity);
    if (flags.cam === 3) this.director.cut('track', t0, Infinity);
    this.hud = new FlightHud(document.getElementById('ui-root')!);
  }

  update({ dt, time }: FrameContext): void {
    // 1. Sim — input was sampled by the engine this very frame.
    this.flight.step(input.state, dt);

    // 2. Ship visual follows the sim exactly (no smoothing on the player).
    this.ship.root.position.copy(this.flight.position);
    this.ship.root.quaternion.copy(this.flight.orientation);
    this.ship.setThrottle(this.flight.boosting ? 1.55 : 0.25 + this.flight.throttle * 0.9);

    // 3. Wingmen: critically-damped formation keeping (placeholder for M13 AI).
    const k = 1 - Math.exp(-2.2 * dt);
    const kq = 1 - Math.exp(-3.5 * dt);
    for (const w of this.wingmen) {
      const target = _v.copy(w.slot).applyQuaternion(this.flight.orientation).add(this.flight.position);
      w.pos.addScaledVector(this.flight.velocity, dt).lerp(target, k);
      w.quat.slerp(this.flight.orientation, kq);
      w.model.root.position.copy(w.pos);
      w.model.root.quaternion.copy(w.quat);
      w.model.setThrottle(this.flight.boosting ? 1.4 : 0.3 + this.flight.throttle * 0.8);
    }

    // 4. Bandits on scripted Lissajous paths.
    for (const b of this.bandits) {
      const t = time + b.ph;
      const p = b.subject.position;
      const prev = _v.copy(p);
      p.set(Math.sin(t * b.a * 6.28) * b.r, Math.sin(t * b.b * 6.28) * b.r * 0.35, Math.cos(t * b.a * 6.28) * b.r).add(b.center);
      if (dt > 0) b.subject.velocity.subVectors(p, prev).divideScalar(dt);
      b.model.root.position.copy(p);
      if (b.subject.velocity.lengthSq() > 1) faceAlong(b.model.root.quaternion, b.subject.velocity);
      b.model.setThrottle(1.1);
    }
    const target = this.bandits[this.targetIndex % this.bandits.length].subject;

    // 5. Cinematic auto-cutaways (opt-in, K): burner lights → flyby cut.
    if (this.cinematic && this.flight.boosting && !this.wasBoosting && time - this.lastCut > 6) {
      this.director.cut('flyby', this.playerSubject, 3.0, this.flight);
      this.lastCut = time;
    }
    this.wasBoosting = this.flight.boosting;

    // 6. Camera (the only thing allowed to lag), then rebase the world on it.
    this.director.update(this.flight, target, dt);
    this.world.eye.copy(this.director.eye);
    this.world.sync(this.camera);
    this.backdrop.follow(this.camera);

    postFx.boost = this.chase.boostAmount;
    postFx.speed = Math.min(1, this.flight.speed / this.flight.spec.boostSpeed);
    this.hud.update(this.flight, this.camera, this.world, time);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  cameraLabel(): string {
    return `${this.director.label()} · ${this.flight.flightAssist ? 'FA ON' : 'FA OFF'}${this.cinematic ? ' · CINEMATIC' : ''}`;
  }

  /** V: cycle camera · T: next target · K: cinematic auto-cutaways. */
  private onKey(code: string): void {
    const target = this.bandits[this.targetIndex % this.bandits.length].subject;
    if (code === 'KeyV') {
      const order = ['chase', 'lock', 'orbit', 'flyby'] as const;
      const next = order[(order.indexOf(this.director.kind as (typeof order)[number]) + 1) % order.length];
      if (next === 'chase' || next === 'lock') this.director.setBase(next, target);
      if (next === 'lock') this.director.cut('lock', target, Infinity);
      if (next === 'chase') this.director.cut('chase', null, Infinity);
      if (next === 'orbit') this.director.cut('orbit', target, 4);
      if (next === 'flyby') this.director.cut('flyby', this.playerSubject, 3, this.flight);
    } else if (code === 'KeyT') {
      this.targetIndex++;
    } else if (code === 'KeyK') {
      this.cinematic = !this.cinematic;
    }
  }

  cycleCamera(): void {
    this.onKey('KeyV');
  }
}

const _v = new Vector3();
const _m = new Matrix4();
const _o = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Orient a +Z-forward object along a direction. (Object3D.lookAt works in
 * render space, which is eye-relative under the floating origin — never feed
 * it universe positions.)
 */
function faceAlong(q: Quaternion, dir: Vector3): void {
  q.setFromRotationMatrix(_m.lookAt(dir, _o.set(0, 0, 0), UP));
}

/** Scripted pilot for demos and deterministic captures. */
function demoPilot(s: ControlState, t: number): void {
  s.pitch = Math.sin(t * 0.45) * 0.35;
  s.yaw = Math.sin(t * 0.3 + 1) * 0.25;
  s.roll = Math.sin(t * 0.6) * 0.5;
  s.throttleDelta = 0;
  s.throttleSet = 0.75;
  s.afterburner = (t % 12) > 4 && (t % 12) < 7.5;
}
