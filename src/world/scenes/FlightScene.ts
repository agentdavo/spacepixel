import { PerspectiveCamera, Scene, Vector3 } from 'three';
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
import { Capitals } from '@/sim/Capitals';
import { loadProfile } from '@/game/Profile';
import { WeaponVisuals } from '../WeaponVisuals';
import { CombatFx } from '../CombatFx';
import { StarSystemView, type GateInstance } from '../StarSystemView';
import { Hyperspace } from '../Hyperspace';
import { SpaceDust } from '../SpaceDust';
import { MultiplaneSky } from '../MultiplaneSky';
import { generateUniverse, specialSystem } from '@/universe/generate';
import { CampaignSession, type FlightHostScene } from '@/game/CampaignSession';
import { SYSTEM_FALLBACK } from '@/game/campaign/missions';
import { getAudio, combatIntensity, type AudioFrame } from '@/audio';
import type { CampaignMission } from '@/game/campaign/types';
import type { StarSystem } from '@/universe/Universe';
import type { Universe } from '@/universe/Universe';
import { FlightHud } from '@/ui/FlightHud';
import { StarMap } from '@/ui/StarMap';
import { postFx } from '@/render/post/PostFx';
import { MissionRunner, type MissionContext, type MissionDef } from '@/game/Missions';
import { updateAI, issueOrder, setFormation, setAutopilot, brainOf } from '@/sim/ai';

/**
 * Milestones 4–6 + 10–11: one ship flying well, then shooting.
 *
 * Everything runs in float64 universe space ~2,600 km from the system origin
 * and renders camera-relative. The player is a ShipEntity whose controls ARE
 * the input state; wingmen and bandits are AI brains writing the same
 * ControlState into the same FlightModel (src/sim/ai).
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
  deadFor: number;
  /** Where reinforcements come from (arrival gate). */
  center: Vector3;
}

export class FlightScene implements GameScene, FlightHostScene {
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
  private combatFx: CombatFx;
  /** ?fx=0 disables particle FX (A/B checks). */
  private fxOn = new URLSearchParams(location.search).get('fx') !== '0';
  private hud: FlightHud;
  readonly universe: Universe = generateUniverse(1994);
  private systemId: string;
  private view: StarSystemView;
  private starMap: StarMap;
  private hyperspace = new Hyperspace();
  private dust = new SpaceDust();
  /** ?planes=N km strata (default 16, 0 = off). */
  private planes: MultiplaneSky | null = (() => {
    const n = Number(new URLSearchParams(location.search).get('planes') ?? 16);
    return n > 0 ? new MultiplaneSky({ layers: Math.min(64, n) }) : null;
  })();
  private jumpPhase: JumpPhase = 'none';
  private jumpT = 0;
  private jumpTo = '';
  private gateSide = new Map<GateInstance, number>();
  readonly capitals: Capitals;
  private cathedral!: ShipEntity;
  private carrier!: ShipEntity;
  private mission: MissionRunner | null = null;
  /** Active campaign episode (story missions), if any. */
  campaign: CampaignSession | null = null;
  private campaignDone: ((r: { outcome: 'success' | 'failure'; codex: string[] }) => void) | null = null;
  private audio = getAudio();
  private audioFrame!: AudioFrame;
  private lastOutcome = 'running';
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
    this.paintPlanes();
    this.scene.add(this.hyperspace.mesh);
    this.scene.add(this.dust.object);
    if (this.planes) {
      this.scene.add(this.planes.mesh);
      this.paintPlanes();
    }
    this.capitals = new Capitals(this.fleet, this.weapons);

    // Start 2.6 km short of the first Lantern, flying at it.
    const gate0 = this.view.gates[0];
    const fwd = gate0.link.normal.clone();
    const ORIGIN = gate0.center.clone().addScaledVector(fwd, -2600).add(new Vector3(0, -60, 0));
    const GATE = gate0.center;
    const profile = loadProfile();
    this.player = this.fleet.spawn('vf27-kestrel', 'concord', ORIGIN, fwd, { isPlayer: true, name: 'Vanguard 1' }, profile.livery);
    this.player.controls = input.state; // the player's controls ARE the input
    this.player.flight.velocity.copy(fwd).multiplyScalar(150);
    this.player.flight.throttle = 0.7;

    [new Vector3(-46, -7, -34), new Vector3(52, 6, -50)].forEach((slot, i) => {
      const ship = this.fleet.spawn('vf27-kestrel', 'concord', slot.clone().add(ORIGIN), fwd, { name: `Vanguard ${i + 2}` });
      this.wingmen.push({ ship, slot });
    });
    setFormation(this.wingmen.map((w) => w.ship), 'fingerFour', 40);
    issueOrder(this.wingmen.map((w) => w.ship), 'formUp', this.player);
    for (let i = 0; i < 3; i++) {
      const pos = GATE.clone().add(new Vector3((i - 1) * 300, 80 * i, 600));
      const ship = this.fleet.spawn('choir-cantor', 'choir', pos, fwd.clone().negate(), { name: `Cantor ${i + 1}` });
      this.bandits.push({ ship, deadFor: 0, center: GATE.clone() });
    }
    this.lock.target = this.bandits[0].ship;

    // Capital ships are fleet combatants: flak, lances, hangars.
    this.cathedral = this.fleet.spawn('choir-cathedral', 'choir', GATE.clone().add(new Vector3(-5200, 1400, 9000)), new Vector3(-0.8, 0, -0.6).normalize(), { name: 'Cathedral Ascendant' });
    this.capitals.register(this.cathedral, { launchBlueprint: 'choir-cantor', maxFighters: 3 });
    this.carrier = this.fleet.spawn('cvs07-hesperus-dawn', 'concord', ORIGIN.clone().add(new Vector3(-2400, -500, -1800)), fwd, { name: 'Hesperus Dawn' });
    this.capitals.register(this.carrier, { launchBlueprint: 'vf27-kestrel', maxFighters: 2 });
    this.onWingOrder = (o) => issueOrder(this.wingmen.map((w) => w.ship), o, this.player);

    this.visuals = new WeaponVisuals(this.weapons, this.missiles);
    this.scene.add(this.visuals.group);
    this.combatFx = new CombatFx(this.weapons, this.missiles);
    this.scene.add(this.combatFx.fx.object);

    this.chase.snap(this.player.flight);
    this.playerSubject = { position: this.player.flight.position, velocity: this.player.flight.velocity, radius: 9 };
    if (flags.demo) {
      setAutopilot(this.player, true);
      input.override = demoMissiles(this);
    }
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
    const pf0 = this.player.flight;
    this.audioFrame = {
      dt: 0,
      eye: this.world.eye,
      camera: this.camera.quaternion,
      player: { position: pf0.position, velocity: pf0.velocity, throttle: 0, boosting: false, cruise: 'off', lockProgress: 0, locked: false, incomingMissile: false, alive: true },
      weaponEvents: this.weapons.events,
      missileEvents: this.missiles.events,
      jumpPhase: 'none',
      combatIntensity: 0,
    };
    this.audio.music.setMood('cruise', 3);
    window.addEventListener('keydown', (e) => e.code === 'KeyN' && this.audio.toggleMute());
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

  /**
   * Zenith space gets a Cathedral holding a far Lantern; Directorate space
   * keeps the Hesperus Dawn near the arrival point. Capitals not present in
   * this system are parked (dead + hidden) rather than destroyed.
   */
  private placeCapitals(): void {
    const sys = this.view.system;
    const park = (s: ShipEntity, on: boolean) => {
      s.alive = on && s.hull > 0;
      s.model.root.visible = s.alive;
    };
    const zenith = sys.faction === 'choir' || sys.id === 'meridian';
    park(this.cathedral, zenith);
    if (zenith) {
      const g = this.view.gates[this.view.gates.length - 1];
      this.cathedral.flight.position.copy(g.center).add(_v.set(-5200, 1400, 9000));
    }
    const home = sys.faction === 'concord';
    park(this.carrier, home);
    if (home) this.carrier.flight.position.copy(this.player.flight.position).add(_v.set(-2400, -500, -1800));
  }

  update({ dt: realDt, time }: FrameContext): void {
    const c = this.player.controls;
    const pf = this.player.flight;
    // Tactical view runs the battle at quarter speed so orders can be given.
    const dt = this.tactical ? realDt * 0.25 : realDt;

    // 0. Supercruise: cruise speed scales with distance to the nearest mass
    //    (planet, Lantern, great set piece) and locks to 1× near hostiles.
    pf.cruiseScale = this.supercruiseScale();

    // 1. AI writes controls for every non-player ship (and the player on
    //    autopilot), then one flight step for everyone — same physics.
    this.player.target = this.lock.target; // "attack my target" reads this
    if (this.jumpPhase === 'none') {
      updateAI(this.fleet, dt, time);
      this.capitals.step(dt);
      this.campaign?.preStep(dt);
    }
    this.fleet.step(dt);
    for (const b of this.bandits) {
      if (b.ship.alive || b.deadFor < 0) continue;
      b.deadFor += dt;
      if (b.deadFor > 6) this.respawn(b);
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

    // 4.5 Particles from this frame's events (emits are universe-space).
    if (this.fxOn) this.combatFx.consume(dt);

    // 4a. Campaign episode: runner, set pieces, chatter.
    if (this.campaign) {
      this.campaign.update(dt, time);
      const since = this.campaign.sinceOutcome(time);
      if (since > 5 && this.campaignDone) {
        const done = this.campaignDone;
        this.campaignDone = null;
        done({ outcome: this.campaign.runner.outcome as 'success' | 'failure', codex: [...this.campaign.unlockedTitles] });
      }
    }

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
    if (this.planes) {
      this.planes.update(this.world.eye, pf.speed);
      this.planes.mesh.visible = this.jumpPhase !== 'tunnel';
    }

    // 6b. Audio: one frame of facts, read by the audio façade.
    this.updateAudio(realDt);

    // 7. Visuals + HUD in render space.
    this.visuals.update(this.world, dt);
    this.combatFx.update(dt, this.world.eye);
    const cruiseK = pf.cruise === 'on' ? 0.55 : pf.cruise === 'spool' ? (pf.cruiseT / pf.spec.cruiseSpool) * 0.4 : 0;
    postFx.boost = Math.max(this.chase.boostAmount, cruiseK);
    postFx.speed = Math.min(1, pf.speed / pf.spec.boostSpeed);
    this.hyperspace.update(dt, this.jumpPhase === 'tunnel' ? Math.min(1, this.jumpT * 3, (TUNNEL - this.jumpT) * 3) : 0, 60, this.camera.quaternion);
    this.hud.navNoise = Math.max(postFx.navNoise, this.campaign?.mission.modifiers?.navDegraded ? 0.55 : 0);
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
    if (this.campaign) {
      const m = this.campaign.mission;
      this.hud.drawCampaign(`EP ${String(m.episode).padStart(2, '0')} · ${m.title}`, this.campaign.visibleObjectives(), this.campaign.runner.outcome, time);
      for (const d of this.campaign.runner.dwells) this.hud.drawDwell(d.position, d.radius, d.progress, this.camera, this.world);
    }
    this.starMap.draw(time);
  }

  private supercruiseScale(): number {
    const p = this.player.flight.position;
    let d = Infinity;
    for (const m of this.view.masses) d = Math.min(d, p.distanceTo(m.position) - m.radius);
    for (const g of this.view.gates) d = Math.min(d, p.distanceTo(g.center));
    for (const m of this.campaign?.masses() ?? []) d = Math.min(d, p.distanceTo(m.position) - m.radius);
    for (const s of this.fleet.ships) {
      if (s.alive && s !== this.player && s.team !== this.player.team && s.team !== 'neutral' && s.flight.position.distanceTo(p) < 10_000) return 1;
    }
    return Math.min(150, Math.max(1, d / 15_000));
  }

  private updateAudio(dt: number): void {
    const pf = this.player.flight;
    const a = this.audioFrame;
    a.dt = dt;
    const p = a.player;
    p.throttle = pf.throttle;
    p.boosting = pf.boosting;
    p.cruise = pf.cruise;
    p.lockProgress = this.lock.progress;
    p.locked = this.lock.locked;
    p.alive = this.player.alive;
    a.jumpPhase = this.jumpPhase;
    let incoming = false;
    const m = this.missiles;
    for (let i = 0; i < m.alive.length && !incoming; i++) incoming = !!m.alive[i] && m.target[i] === this.player;
    p.incomingMissile = incoming;
    let nearest = Infinity;
    let near = 0;
    for (const s of this.fleet.ships) {
      if (!s.alive || s.team === this.player.team || s.team === 'neutral') continue;
      const d = s.flight.position.distanceTo(pf.position);
      nearest = Math.min(nearest, d);
      if (d < 3000) near++;
    }
    a.combatIntensity = combatIntensity(nearest, near, this.player.sinceHit);
    this.audio.update(a);
    // Episode outcome stingers.
    const outcome = this.campaign?.runner.outcome ?? 'running';
    if (outcome !== this.lastOutcome) {
      if (outcome === 'success') this.audio.music.setMood('victory', 0);
      else if (outcome === 'failure') this.audio.music.setMood('defeat', 0);
      this.lastOutcome = outcome;
    }
  }

  /** Strata take the current system's nebula colours. */
  private paintPlanes(): void {
    const neb = this.view.system.backdrop.nebula;
    const at = (x: number) => neb.reduce((best, s) => (Math.abs(s.at - x) < Math.abs(best.at - x) ? s : best)).color;
    this.planes?.setPalette(at(0.77), this.view.system.backdrop.wisp, at(0.5));
  }

  // ── FlightHostScene ────────────────────────────────────────────────
  currentSystemId(): string {
    return this.systemId;
  }
  jumpCount(): number {
    return this.jumps;
  }
  gatePosition(i: number): Vector3 | null {
    return this.view.gates[i]?.center ?? null;
  }

  private systemFor(id: string): StarSystem {
    return this.universe.systems.get(id) ?? specialSystem(id) ?? this.universe.systems.get(SYSTEM_FALLBACK[id] ?? '') ?? this.universe.systems.get('meridian')!;
  }

  /**
   * Begin a story episode: move to its system (no jump effect), clear the
   * free-flight cast, and hand the scene to a CampaignSession. Resolves when
   * the episode succeeds or fails.
   */
  startCampaign(m: CampaignMission): Promise<{ outcome: 'success' | 'failure'; codex: string[] }> {
    this.campaign?.dispose();
    const sys = this.systemFor(m.system);
    if (sys.id !== this.systemId) {
      this.view.dispose();
      this.systemId = sys.id;
      this.view = new StarSystemView(sys, this.scene, this.world.root);
      this.paintPlanes();
      this.gateSide.clear();
    }
    // Clear the free-flight cast: missions bring their own squad and enemies.
    const park = (s: ShipEntity) => {
      s.alive = false;
      s.model.root.visible = false;
    };
    for (const w of this.wingmen) park(w.ship);
    for (const b of this.bandits) {
      park(b.ship);
      b.deadFor = -1e9;
    }
    park(this.cathedral);
    park(this.carrier);
    this.cathedral.hull = this.carrier.hull = 0; // keep placeCapitals from reviving them
    // Player: 2.6 km short of the first Lantern (or at the origin of an off-map system).
    const g = this.view.gates[0];
    const pf = this.player.flight;
    const fwd = g ? g.link.normal.clone() : new Vector3(0, 0, 1);
    pf.position.copy(g ? g.center : new Vector3()).addScaledVector(fwd, -2600);
    faceAlong(pf.orientation, fwd);
    pf.velocity.copy(fwd).multiplyScalar(160);
    pf.throttle = 0.7;
    this.player.hull = this.player.hullMax;
    this.player.shield = this.player.shieldMax;
    this.player.alive = true;
    this.player.model.root.visible = true;
    this.chase.snap(pf);
    this.lock.target = null;

    this.lastOutcome = 'running';
    const amb = m.modifiers?.ambience;
    this.audio.autoMood = amb !== 'sublime' && amb !== 'dread';
    this.audio.music.setMood(amb === 'sublime' ? 'sublime' : amb === 'dread' ? 'dread' : amb === 'battle' ? 'combat' : 'cruise', 3);
    this.campaign = new CampaignSession(m, this, document.getElementById('ui-root')!);
    this.campaign.begin();
    return new Promise((resolve) => (this.campaignDone = resolve));
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
    this.audio.stinger('jump');
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
  }

  /** Swap star systems under cover of the tunnel; place the flight at the arrival Lantern. */
  private arrive(): void {
    const from = this.systemId;
    this.jumps++;
    this.view.dispose();
    this.systemId = this.jumpTo;
    this.view = new StarSystemView(this.universe.systems.get(this.systemId)!, this.scene, this.world.root);
    this.paintPlanes();
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
    if (this.campaign) {
      // The squad jumps with you; everyone else stays in the old system.
      let k = 0;
      for (const s of this.fleet.ships) {
        if (s === this.player || !s.alive) continue;
        if (s.team === this.player.team) {
          k++;
          s.flight.position.copy(pf.position).addScaledVector(out, -60 * k).add(_v.set((k % 2 ? 1 : -1) * 50 * k, 8 * k, 0));
          s.flight.orientation.copy(pf.orientation);
          s.flight.velocity.copy(pf.velocity);
        } else {
          s.alive = false;
          s.model.root.visible = false;
        }
      }
    }
    const hostile = !this.campaign && this.view.system.threat > 0.35;
    this.bandits.forEach((b, i) => {
      b.center.copy(g.center).addScaledVector(out, 3500 + i * 400);
      if (hostile) this.respawn(b);
      else {
        b.ship.alive = false;
        b.ship.model.root.visible = false;
        b.deadFor = -1e9; // quiet system: no reinforcements
      }
    });
    for (const w of this.wingmen) w.ship.flight.velocity.copy(pf.velocity);
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

  /** Bring a bandit back 2–3 km out on the gate side, inbound. */
  private respawn(b: Bandit): void {
    const s = b.ship;
    const f = s.flight;
    const pp = this.player.flight.position;
    const a = s.id * 2.39 + this.fleet.ships.length;
    _v.subVectors(b.center, pp).normalize().multiplyScalar(2600).add(pp).add(_to.set(Math.cos(a) * 500, Math.sin(a) * 300, Math.sin(a * 1.3) * 500));
    f.position.copy(_v);
    faceAlong(f.orientation, _to.subVectors(pp, _v).normalize());
    f.velocity.copy(_to).multiplyScalar(f.spec.maxSpeed * 0.7);
    f.bodyRates.set(0, 0, 0);
    s.alive = true;
    s.hull = s.hullMax;
    s.shield = s.shieldMax;
    s.target = null;
    s.model.root.visible = true;
    brainOf(s).nextThink = 0;
    b.deadFor = 0;
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

/**
 * Demo/capture mode: the AI flies the player (autopilot); this only adds a
 * missile salvo whenever a lock is achieved, so captures show the swarm.
 */
function demoMissiles(scene: FlightScene) {
  let lastSalvo = -10;
  return (s: ControlState, t: number): void => {
    s.missile = scene.lock.locked && t - lastSalvo > 4;
    if (s.missile) lastSalvo = t;
  };
}

