import { PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { input, type ControlState } from '@/core/Input';
import { flags } from '@/core/Flags';
import { FlightModel, KESTREL_SPEC } from '@/sim/FlightModel';
import { ChaseCamera } from '@/sim/ChaseCamera';
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

    // Start on approach to the gate.
    this.flight.position.copy(ORIGIN);
    this.flight.velocity.set(0, 0, 150);
    this.flight.throttle = 0.7;
    for (const w of this.wingmen) w.pos.copy(w.slot).add(ORIGIN);
    this.chase.snap(this.flight);

    if (flags.demo) input.override = demoPilot;
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

    // 4. Camera (the only thing allowed to lag), then rebase the world on it.
    this.chase.update(this.flight, dt);
    this.world.eye.copy(this.chase.eye);
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
    return `FLIGHT TEST · ${this.flight.flightAssist ? 'FA ON' : 'FA OFF'}`;
  }
}

const _v = new Vector3();

/** Scripted pilot for demos and deterministic captures. */
function demoPilot(s: ControlState, t: number): void {
  s.pitch = Math.sin(t * 0.45) * 0.35;
  s.yaw = Math.sin(t * 0.3 + 1) * 0.25;
  s.roll = Math.sin(t * 0.6) * 0.5;
  s.throttleDelta = 0;
  s.throttleSet = 0.75;
  s.afterburner = (t % 12) > 4 && (t % 12) < 7.5;
}
