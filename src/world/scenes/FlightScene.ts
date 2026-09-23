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
import { WeaponVisuals } from '../WeaponVisuals';
import { StarSystemView, type GateInstance } from '../StarSystemView';
import { Hyperspace } from '../Hyperspace';
import { SpaceDust } from '../SpaceDust';
import { generateUniverse } from '@/universe/generate';
import type { Universe } from '@/universe/Universe';
import { FlightHud } from '@/ui/FlightHud';
import { StarMap } from '@/ui/StarMap';
import { postFx } from '@/render/post/PostFx';
import { MissionRunner, type MissionContext, type MissionDef } from '@/game/Missions';

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
type JumpPhase = 'none' | 'spool' | 'tunnel' | 'exit';
const SPOOL = 0.9;
const TUNNEL = 2.6;
const EXIT = 0.9;

interface Bandit {
  ship: ShipEntity;
  a: number;
  b: number;
  r: number;
  ph: number;
  deadFor: number;
  center: Vector3;
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
  private hud: FlightHud;
  readonly universe: Universe = generateUniverse(1994);
  private systemId: string;
  private view: StarSystemView;
  private starMap: StarMap;
  private hyperspace = new Hyperspace();
  private dust = new SpaceDust();
  private jumpPhase: JumpPhase = 'none';
  private jumpT = 0;
  private jumpTo = '';
  private gateSide = new Map<GateInstance, number>();
  private cathedral = assets.ship('choir-cathedral');
  private mission: MissionRunner | null = null;
  private tactical = false;
  private orderStatus = '';
  /** Current standing order for the wing (M13); the AI reads this. */
  wingOrder: 'formUp' | 'attackMyTarget' | 'engageAtWill' | 'coverMe' = 'formUp';
  private missionTime = 0;
  private jumps = 0;
  private kills = new Map<string, number>();
  private missionCtx: MissionContext = {
    time: 0,
    systemId: '',
    gateDistance: (to?: string) => {
      const g = to ? this.view.gateTo(to) : this.view.gates[0];
      return g ? g.center.distanceTo(this.player.flight.position) : Infinity;
    },
    kills: (f: string) => this.kills.get(f) ?? 0,
    jumps: 0,
    playerAlive: true,
    allyAlive: (name: string) => this.fleet.ships.some((s) => s.name === name && s.alive),
  };
  private cinematic = flags.demo;
  private wasBoosting = false;
  private lastCut = -10;
  private pendingMissileCam = false;
  private playerSubject: Subject;
  private missileSubject: Subject = { position: new Vector3(), velocity: new Vector3(), radius: 1.5 };
  private killSubject: Subject = { position: new Vector3(), velocity: new Vector3(), radius: 10 };

  constructor() {
    this.systemId = this.universe.start;
    this.view = new StarSystemView(this.universe.systems.get(this.systemId)!, this.scene, this.world.root);
    this.scene.add(this.hyperspace.mesh);
    this.scene.add(this.dust.object);
    this.world.root.add(this.cathedral.root);
    this.cathedral.setThrottle(0.5);

    // Start 2.6 km short of the first Lantern, flying at it.
    const gate0 = this.view.gates[0];
    const fwd = gate0.link.normal.clone();
    const ORIGIN = gate0.center.clone().addScaledVector(fwd, -2600).add(new Vector3(0, -60, 0));
    const GATE = gate0.center;
    this.player = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN, fwd, { isPlayer: true, name: 'Vanguard 1' });
    this.player.controls = input.state; // the player's controls ARE the input
    this.player.flight.velocity.copy(fwd).multiplyScalar(150);
    this.player.flight.throttle = 0.7;

    [new Vector3(-46, -7, -34), new Vector3(52, 6, -50)].forEach((slot, i) => {
      const ship = this.fleet.spawn('vf27-kestrel', 'concord', slot.clone().add(ORIGIN), fwd, { name: `Vanguard ${i + 2}` });
      this.wingmen.push({ ship, slot });
    });
    for (let i = 0; i < 3; i++) {
      const ship = this.fleet.spawn('choir-cantor', 'choir', GATE, fwd, { name: `Cantor ${i + 1}` });
      this.bandits.push({ ship, a: 0.11 + i * 0.023, b: 0.07 + i * 0.019, r: 700 + i * 260, ph: i * 2.1, deadFor: 0, center: GATE.clone() });
    }
    this.lock.target = this.bandits[0].ship;

    this.visuals = new WeaponVisuals(this.weapons, this.missiles);
    this.scene.add(this.visuals.group);

    this.chase.snap(this.player.flight);
    this.playerSubject = { position: this.player.flight.position, velocity: this.player.flight.velocity, radius: 9 };
    if (flags.demo) input.override = demoPilot(this);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.onKey(e.code);
    });
    window.addEventListener('wheel', (e) => {
      if (this.tactical) this.director.tacticalHeight = Math.min(12000, Math.max(600, this.director.tacticalHeight * (e.deltaY > 0 ? 1.12 : 0.89)));
    });
    // ?cam=1 padlock · ?cam=2 orbit target · ?cam=3 track target
    const t0 = this.bandits[0].ship.flight;
    const s0: Subject = { position: t0.position, velocity: t0.velocity, radius: 8 };
    if (flags.cam === 1) this.director.setBase('lock', s0);
    if (flags.cam === 2) this.director.cut('orbit', s0, Infinity);
    if (flags.cam === 3) this.director.cut('track', s0, Infinity);
    if (flags.cam === 4) {
      this.tactical = true;
      this.director.cut('tactical', null, Infinity);
    }
    this.hud = new FlightHud(document.getElementById('ui-root')!);
    this.starMap = new StarMap(document.getElementById('ui-root')!, this.universe, () => this.systemId);
    this.placeCapitals();
    // ?jump=1: start mid-spool at the first gate (captures of the transition).
    const q = new URLSearchParams(location.search);
    if (q.get('jump') === '1') this.beginJump(gate0.link.to);
    // ?map=tessaly: open the star map with a route plotted (captures).
    if (q.get('map')) {
      this.starMap.destination = q.get('map');
      this.starMap.toggle();
    }
    window.__VANGUARD__ = { ...window.__VANGUARD__, ready: false, frame: () => 0, backend: '', hooks: { ...window.__VANGUARD__?.hooks, scene: this } };
  }

  /** Choir space gets a Cathedral parked off a gate; elsewhere it's hidden. */
  private placeCapitals(): void {
    const sys = this.view.system;
    const show = sys.faction === 'choir' || sys.id === 'meridian';
    this.cathedral.root.visible = show;
    if (!show) return;
    const g = this.view.gates[this.view.gates.length - 1];
    this.cathedral.root.position.copy(g.center).add(new Vector3(-5200, 1400, 9000));
    this.cathedral.root.rotation.set(0.05, 2.2, 0.08);
  }

  update({ dt: realDt, time }: FrameContext): void {
    const c = this.player.controls;
    const pf = this.player.flight;
    // Tactical view runs the battle at quarter speed so orders can be given.
    const dt = this.tactical ? realDt * 0.25 : realDt;

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
      f.position.set(Math.sin(t * b.a * 6.28) * b.r, Math.sin(t * b.b * 6.28) * b.r * 0.35, Math.cos(t * b.a * 6.28) * b.r).add(b.center);
      if (dt > 0) f.velocity.subVectors(f.position, _v).divideScalar(dt);
      if (f.velocity.lengthSq() > 1) faceAlong(f.orientation, f.velocity);
      s.model.root.position.copy(f.position);
      s.model.root.quaternion.copy(f.orientation);
      s.model.setThrottle(1.1);
    }

    // 2b. Lanterns: crossing a gate plane inside the ring starts a jump.
    if (this.jumpPhase === 'none') this.checkGates();
    this.updateJump(dt);

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

    // 4b. Mission bookkeeping (kills by faction of the victim).
    for (const e of this.weapons.events) if (e.kind === 'kill' && e.ship) this.kills.set(e.ship.faction, (this.kills.get(e.ship.faction) ?? 0) + 1);
    if (this.mission) {
      this.missionTime += dt;
      const mc = this.missionCtx;
      mc.time = this.missionTime;
      mc.systemId = this.systemId;
      mc.jumps = this.jumps;
      mc.playerAlive = this.player.alive;
      this.mission.update(mc);
    }

    // 5. Cinematic cutaways (opt-in, K).
    if (this.cinematic) this.cutaways(time);
    this.wasBoosting = pf.boosting;

    // 6. Camera (the only thing allowed to lag), then rebase the world on it.
    const tgt = this.lock.target;
    const tgtSubject: Subject | null = tgt ? { position: tgt.flight.position, velocity: tgt.flight.velocity, radius: tgt.radius } : null;
    this.director.update(pf, tgtSubject, realDt);
    this.world.eye.copy(this.director.eye);
    this.world.sync(this.camera);

    this.view.backdrop.follow(this.camera);
    this.view.update(time);
    this.dust.update(this.world.eye, pf.velocity, dt);
    this.dust.object.visible = this.jumpPhase !== 'tunnel';

    // 7. Visuals + HUD in render space.
    this.visuals.update(this.world, dt);
    const cruiseK = pf.cruise === 'on' ? 0.55 : pf.cruise === 'spool' ? (pf.cruiseT / pf.spec.cruiseSpool) * 0.4 : 0;
    postFx.boost = Math.max(this.chase.boostAmount, cruiseK);
    postFx.speed = Math.min(1, pf.speed / pf.spec.boostSpeed);
    this.hyperspace.update(dt, this.jumpPhase === 'tunnel' ? Math.min(1, this.jumpT * 3, (TUNNEL - this.jumpT) * 3) : 0, 60, this.camera.quaternion);
    this.hud.update(pf, this.camera, this.world, time);
    if (this.tactical) {
      const markers = this.view.gates.map((g) => ({ label: `LANTERN → ${this.universe.systems.get(g.link.to)!.name.toUpperCase()}`, pos: g.center, radius: g.gate.radius }));
      this.hud.drawTactical(this.player, this.fleet, this.camera, this.world, this.orderStatus, markers);
    }
    else if (this.jumpPhase === 'none') {
      this.hud.drawTargets(this.player, this.fleet, this.lock, this.camera, this.world, time);
      const nav = this.navGate();
      if (nav) this.hud.drawNav(this.universe.systems.get(nav.link.to)!.name, nav.center, pf.position, this.camera, this.world, time);
    }
    this.hud.drawStatus(this.view.system.name, pf.cruise, this.jumpPhase !== 'none' ? `LANTERN TRANSIT → ${this.universe.systems.get(this.jumpTo)?.name ?? ''}` : '');
    if (this.mission) this.hud.drawObjectives(this.mission, time);
    this.starMap.draw(time);
  }

  startMission(def: MissionDef): void {
    this.mission = new MissionRunner(def);
    this.missionTime = 0;
    this.kills.clear();
    this.jumps = 0;
  }

  /** Next gate on the plotted route, else the nearest Lantern. */
  private navGate(): GateInstance | undefined {
    const r = this.starMap.route();
    if (r.length > 1) return this.view.gateTo(r[1]);
    const p = this.player.flight.position;
    let best: GateInstance | undefined;
    let bd = Infinity;
    for (const g of this.view.gates) {
      const d = g.center.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  private checkGates(): void {
    const p = this.player.flight.position;
    for (const g of this.view.gates) {
      _v.subVectors(p, g.center);
      const s = _v.dot(g.link.normal);
      const prev = this.gateSide.get(g) ?? s;
      this.gateSide.set(g, s);
      const lateral = _v.addScaledVector(g.link.normal, -s).length();
      if (prev < 0 && s >= 0 && lateral < g.gate.radius * 0.9) {
        this.beginJump(g.link.to);
        return;
      }
    }
  }

  private beginJump(to: string): void {
    this.jumpPhase = 'spool';
    this.jumpT = 0;
    this.jumpTo = to;
    this.player.flight.cruise = 'off';
  }

  /** Spool (stretch + white-out) → Lattice tunnel (new system loads) → exit flash. */
  private updateJump(dt: number): void {
    if (this.jumpPhase === 'none') {
      postFx.jump = 0;
      postFx.flash = Math.max(0, postFx.flash - dt * 2);
      return;
    }
    this.jumpT += dt;
    const t = this.jumpT;
    if (this.jumpPhase === 'spool') {
      postFx.jump = t / SPOOL;
      postFx.flash = Math.max(0, (t - SPOOL * 0.6) / (SPOOL * 0.4));
      if (t >= SPOOL) {
        this.jumpPhase = 'tunnel';
        this.jumpT = 0;
        this.setWorldVisible(false);
      }
    } else if (this.jumpPhase === 'tunnel') {
      postFx.jump = 0.6;
      postFx.flash = Math.max(0, 1 - t * 4) + Math.max(0, (t - (TUNNEL - 0.25)) * 4);
      if (t >= TUNNEL * 0.5 && this.view.system.id !== this.jumpTo) this.arrive();
      if (t >= TUNNEL) {
        this.jumpPhase = 'exit';
        this.jumpT = 0;
        this.setWorldVisible(true);
      }
    } else {
      postFx.jump = Math.max(0, 1 - t / EXIT) * 0.7;
      postFx.flash = Math.max(0, 1 - t / (EXIT * 0.6));
      if (t >= EXIT) this.jumpPhase = 'none';
    }
  }

  private setWorldVisible(v: boolean): void {
    this.view.group.visible = v;
    this.view.backdrop.group.visible = v;
    for (const s of this.fleet.ships) if (!s.isPlayer) s.model.root.visible = v && s.alive;
    if (v) this.placeCapitals();
    else this.cathedral.root.visible = false;
  }

  /** Swap star systems under cover of the tunnel; place the flight at the arrival Lantern. */
  private arrive(): void {
    const from = this.systemId;
    this.jumps++;
    this.view.dispose();
    this.systemId = this.jumpTo;
    this.view = new StarSystemView(this.universe.systems.get(this.systemId)!, this.scene, this.world.root);
    this.view.group.visible = false;
    this.view.backdrop.group.visible = false;
    this.gateSide.clear();
    const g = this.view.gateTo(from) ?? this.view.gates[0];
    const out = g.link.normal.clone().negate(); // exit away from the lane we came down
    const pf = this.player.flight;
    const speed = Math.max(220, pf.speed);
    pf.position.copy(g.center).addScaledVector(out, 40);
    faceAlong(pf.orientation, out);
    pf.velocity.copy(out).multiplyScalar(speed);
    for (const w of this.wingmen) {
      w.ship.flight.position.copy(_v.copy(w.slot).applyQuaternion(pf.orientation).add(pf.position));
      w.ship.flight.orientation.copy(pf.orientation);
    }
    const hostile = this.view.system.threat > 0.35;
    this.bandits.forEach((b, i) => {
      b.center.copy(g.center).addScaledVector(out, 3500 + i * 400);
      b.ship.alive = hostile;
      b.ship.hull = b.ship.hullMax;
      b.ship.shield = b.ship.shieldMax;
      b.deadFor = hostile ? 0 : -1e9;
    });
    if (this.starMap.destination === this.systemId) this.starMap.destination = null;
    this.chase.snap(pf);
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
    } else if (code === 'KeyM') {
      this.starMap.toggle();
    } else if (code === 'Tab') {
      this.tactical = !this.tactical;
      if (this.tactical) this.director.cut('tactical', null, Infinity);
      else this.director.cut('chase', null, Infinity);
    } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4') {
      const orders = ['formUp', 'attackMyTarget', 'engageAtWill', 'coverMe'] as const;
      const labels = ['FORM ON ME', 'ATTACK MY TARGET', 'ENGAGE AT WILL', 'COVER ME'];
      const i = Number(code.slice(5)) - 1;
      this.wingOrder = orders[i];
      this.orderStatus = `VANGUARD 1 → WING: "${labels[i]}"   · COPY, LEAD.`;
      this.onWingOrder?.(this.wingOrder);
    }
  }

  /** Set by the AI integration to receive wing orders. */
  onWingOrder: ((o: FlightScene['wingOrder']) => void) | null = null;

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
