import { PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { input, type ControlState } from '@/core/Input';
import { flags } from '@/core/Flags';
import { ChaseCamera } from '@/sim/ChaseCamera';
import { CameraDirector, type Subject } from '@/sim/CameraDirector';
import { Fleet, faceAlong, type ShipEntity } from '@/sim/Fleet';
import { Weapons } from '@/sim/Weapons';
import { Missiles, type LockState } from '@/sim/Missiles';
import { assets } from '@/assets/AssetLibrary';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { Planet, PLANETS } from '../Planet';
import { LanternGate } from '../LanternGate';
import { WeaponVisuals } from '../WeaponVisuals';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { FlightHud } from '@/ui/FlightHud';
import { postFx } from '@/render/post/PostFx';

/**
 * Milestones 4–6 + 10–11: one ship flying well, then shooting.
 *
 * Everything runs in float64 universe space ~2,600 km from the system origin
 * and renders camera-relative. The player is a ShipEntity whose controls ARE
 * the input state; wingmen and bandits are placeholders until the AI
 * milestone replaces their kinematic paths with brains writing controls.
 *
 * Frame order (deliberately flat):
 *   input (engine) → fleet flight → placeholders → targeting → weapons →
 *   missiles → cutaways → camera director → rebase → visuals → HUD
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000); // deliberately huge
const GATE = ORIGIN.clone().add(new Vector3(0, 60, 2600));

interface Bandit {
  ship: ShipEntity;
  a: number;
  b: number;
  r: number;
  ph: number;
  deadFor: number;
}

export class FlightScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.3, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly fleet = new Fleet(this.world.root);
  readonly weapons = new Weapons(this.fleet);
  readonly missiles = new Missiles(this.fleet);
  readonly player: ShipEntity;
  readonly chase = new ChaseCamera(this.camera);
  readonly director = new CameraDirector(this.camera, this.chase);
  readonly lock: LockState = { target: null, progress: 0, locked: false };
  private wingmen: { ship: ShipEntity; slot: Vector3 }[] = [];
  private bandits: Bandit[] = [];
  private visuals: WeaponVisuals;
  private backdrop = new Backdrop(BACKDROPS.meridian);
  private hud: FlightHud;
  private cinematic = flags.demo;
  private wasBoosting = false;
  private lastCut = -10;
  private pendingMissileCam = false;
  private playerSubject: Subject;
  private missileSubject: Subject = { position: new Vector3(), velocity: new Vector3(), radius: 1.5 };
  private killSubject: Subject = { position: new Vector3(), velocity: new Vector3(), radius: 10 };

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);

    const planet = new Planet(PLANETS.castellan);
    planet.group.position.copy(ORIGIN).add(new Vector3(150_000, -70_000, 290_000));
    planet.group.rotation.set(0.1, 0.4, 0.28);
    this.world.root.add(planet.group);

    const gate = new LanternGate(420);
    gate.group.position.copy(GATE);
    gate.group.rotation.y = 0.15;
    this.world.root.add(gate.group);

    const cathedral = assets.ship('choir-cathedral');
    cathedral.root.position.copy(ORIGIN).add(new Vector3(-5200, 1400, 11000));
    cathedral.root.rotation.set(0.05, 2.2, 0.08);
    cathedral.setThrottle(0.5);
    this.world.root.add(cathedral.root);

    const fwd = new Vector3(0, 0, 1);
    this.player = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN, fwd, { isPlayer: true, name: 'Vanguard 1' });
    this.player.controls = input.state; // the player's controls ARE the input
    this.player.flight.velocity.set(0, 0, 150);
    this.player.flight.throttle = 0.7;

    [new Vector3(-22, -4, -26), new Vector3(24, 3, -34)].forEach((slot, i) => {
      const ship = this.fleet.spawn('vf27-kestrel', 'concord', slot.clone().add(ORIGIN), fwd, { name: `Vanguard ${i + 2}` });
      this.wingmen.push({ ship, slot });
    });
    for (let i = 0; i < 3; i++) {
      const ship = this.fleet.spawn('choir-cantor', 'choir', GATE, fwd, { name: `Cantor ${i + 1}` });
      this.bandits.push({ ship, a: 0.11 + i * 0.023, b: 0.07 + i * 0.019, r: 700 + i * 260, ph: i * 2.1, deadFor: 0 });
    }
    this.lock.target = this.bandits[0].ship;

    this.visuals = new WeaponVisuals(this.weapons, this.missiles);
    this.scene.add(this.visuals.group);

    this.chase.snap(this.player.flight);
    this.playerSubject = { position: this.player.flight.position, velocity: this.player.flight.velocity, radius: 9 };
    if (flags.demo) input.override = demoPilot(this);
    window.addEventListener('keydown', (e) => this.onKey(e.code));
    // ?cam=1 padlock · ?cam=2 orbit target · ?cam=3 track target
    const t0 = this.bandits[0].ship.flight;
    const s0: Subject = { position: t0.position, velocity: t0.velocity, radius: 8 };
    if (flags.cam === 1) this.director.setBase('lock', s0);
    if (flags.cam === 2) this.director.cut('orbit', s0, Infinity);
    if (flags.cam === 3) this.director.cut('track', s0, Infinity);
    this.hud = new FlightHud(document.getElementById('ui-root')!);
  }

  update({ dt, time }: FrameContext): void {
    const c = this.player.controls;
    const pf = this.player.flight;

    // 1. Flight for every ship (player controls were sampled this frame).
    this.fleet.step(dt);

    // 2. Placeholders: kinematic wingmen formation + bandit orbits (→ M13/M14 AI).
    const k = 1 - Math.exp(-2.2 * dt);
    const kq = 1 - Math.exp(-3.5 * dt);
    for (const w of this.wingmen) {
      if (!w.ship.alive) continue;
      const f = w.ship.flight;
      f.position.lerp(_v.copy(w.slot).applyQuaternion(pf.orientation).add(pf.position), k);
      f.velocity.copy(pf.velocity);
      f.orientation.slerp(pf.orientation, kq);
      w.ship.model.root.position.copy(f.position);
      w.ship.model.root.quaternion.copy(f.orientation);
    }
    for (const b of this.bandits) {
      const s = b.ship;
      if (!s.alive) {
        b.deadFor += dt;
        if (b.deadFor > 5) this.respawn(b);
        continue;
      }
      const t = time + b.ph;
      const f = s.flight;
      _v.copy(f.position);
      f.position.set(Math.sin(t * b.a * 6.28) * b.r, Math.sin(t * b.b * 6.28) * b.r * 0.35, Math.cos(t * b.a * 6.28) * b.r).add(GATE);
      if (dt > 0) f.velocity.subVectors(f.position, _v).divideScalar(dt);
      if (f.velocity.lengthSq() > 1) faceAlong(f.orientation, f.velocity);
      s.model.root.position.copy(f.position);
      s.model.root.quaternion.copy(f.orientation);
      s.model.setThrottle(1.1);
    }

    // 3. Targeting + missile salvos.
    if (c.nextTarget || !this.lock.target?.alive) this.cycleTarget();
    Missiles.updateLock(this.lock, this.player, dt);
    if (c.missile && this.lock.locked && this.lock.target) {
      this.missiles.salvo(this.player, this.lock.target);
      if (this.cinematic) this.pendingMissileCam = true;
    }

    // 4. Weapons + missiles sim.
    this.weapons.step(dt);
    this.missiles.step(dt);

    // 5. Cinematic cutaways (opt-in, K).
    if (this.cinematic) this.cutaways(time);
    this.wasBoosting = pf.boosting;

    // 6. Camera (the only thing allowed to lag), then rebase the world on it.
    const tgt = this.lock.target;
    const tgtSubject: Subject | null = tgt ? { position: tgt.flight.position, velocity: tgt.flight.velocity, radius: tgt.radius } : null;
    this.director.update(pf, tgtSubject, dt);
    this.world.eye.copy(this.director.eye);
    this.world.sync(this.camera);
    this.backdrop.follow(this.camera);

    // 7. Visuals + HUD in render space.
    this.visuals.update(this.world, dt);
    postFx.boost = this.chase.boostAmount;
    postFx.speed = Math.min(1, pf.speed / pf.spec.boostSpeed);
    this.hud.update(pf, this.camera, this.world, time);
    this.hud.drawTargets(this.player, this.fleet, this.lock, this.camera, this.world, time);
  }

  private cutaways(time: number): void {
    const pf = this.player.flight;
    if (pf.boosting && !this.wasBoosting && time - this.lastCut > 6) {
      this.director.cut('flyby', this.playerSubject, 3.0, pf);
      this.lastCut = time;
    }
    for (const e of this.missiles.events) {
      if (e.kind === 'launch' && this.pendingMissileCam && e.shooter === this.player) {
        // Ride the first missile of the salvo for a beat.
        this.missileSubject.position = this.missiles.pos[e.index];
        this.missileSubject.velocity = this.missiles.vel[e.index];
        this.director.cut('track', this.missileSubject, 1.6);
        this.pendingMissileCam = false;
        this.lastCut = time;
      }
    }
    for (const e of this.weapons.events) {
      if (e.kind === 'kill' && e.shooter === this.player && e.ship) {
        this.killSubject.position.copy(e.ship.flight.position);
        this.director.cut('orbit', this.killSubject, 2.2);
        this.lastCut = time;
      }
    }
  }

  private cycleTarget(): void {
    const enemies = this.fleet.enemiesOf(this.player);
    if (!enemies.length) {
      this.lock.target = null;
      return;
    }
    const i = this.lock.target ? enemies.indexOf(this.lock.target) : -1;
    this.lock.target = enemies[(i + 1) % enemies.length];
    this.lock.progress = 0;
    this.lock.locked = false;
  }

  private respawn(b: Bandit): void {
    const s = b.ship;
    s.alive = true;
    s.hull = s.hullMax;
    s.shield = s.shieldMax;
    s.model.root.visible = true;
    b.deadFor = 0;
    b.ph += 3.7;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  cameraLabel(): string {
    const f = this.player.flight;
    return `${this.director.label()} · ${f.flightAssist ? 'FA ON' : 'FA OFF'}${this.cinematic ? ' · CINEMATIC' : ''}`;
  }

  /** V: cycle camera · K: cinematic auto-cutaways. (T / F go through input.) */
  private onKey(code: string): void {
    const t = this.lock.target;
    const target: Subject | null = t ? { position: t.flight.position, velocity: t.flight.velocity, radius: t.radius } : null;
    if (code === 'KeyV') {
      const order = ['chase', 'lock', 'orbit', 'flyby'] as const;
      const next = order[(order.indexOf(this.director.kind as (typeof order)[number]) + 1) % order.length];
      if (next === 'chase') {
        this.director.setBase('chase');
        this.director.cut('chase', null, Infinity);
      } else if (next === 'lock' && target) {
        this.director.setBase('lock', target);
        this.director.cut('lock', target, Infinity);
      } else if (next === 'orbit') this.director.cut('orbit', target ?? this.playerSubject, 4);
      else this.director.cut('flyby', this.playerSubject, 3, this.player.flight);
    } else if (code === 'KeyK') {
      this.cinematic = !this.cinematic;
    }
  }

  cycleCamera(): void {
    this.onKey('KeyV');
  }
}

const _v = new Vector3();
const _to = new Vector3();
const _fw = new Vector3();
const _q = new Quaternion();

/**
 * Scripted pilot for demos and deterministic captures: steers at the current
 * target with a crude proportional stick, fires when it's on the nose, and
 * ripples a missile salvo whenever a lock is achieved.
 */
function demoPilot(scene: FlightScene) {
  let lastSalvo = -10;
  return (s: ControlState, t: number): void => {
    const p = scene.player.flight;
    const tgt = scene.lock.target;
    s.throttleDelta = 0;
    s.throttleSet = 0.8;
    s.afterburner = t % 14 > 4 && t % 14 < 6.5;
    s.pitch = s.yaw = s.roll = 0;
    s.fire = false;
    s.missile = false;
    if (!tgt) return;
    _to.subVectors(tgt.flight.position, p.position).normalize();
    _v.copy(_to).applyQuaternion(_q.copy(p.orientation).invert()); // body frame
    s.yaw = clamp(-_v.x * 3, -1, 1); // ship right is -X
    s.pitch = clamp(_v.y * 3, -1, 1);
    s.roll = clamp(-_v.x * 1.5, -1, 1) * 0.6;
    p.forward(_fw);
    const dist = tgt.flight.position.distanceTo(p.position);
    s.fire = _fw.dot(_to) > 0.985 && dist < 1800;
    if (scene.lock.locked && t - lastSalvo > 4) {
      s.missile = true;
      lastSalvo = t;
    }
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
