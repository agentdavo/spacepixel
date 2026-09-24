import { Color, PerspectiveCamera, Scene, Vector3 } from 'three';
import { SIM_DT, type FrameContext, type TickContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { WorldSpace } from '@/core/WorldSpace';
import { input, type ControlState } from '@/core/Input';
import { flags } from '@/core/Flags';
import { ChaseCamera } from '@/sim/ChaseCamera';
import { CameraDirector, type Subject } from '@/sim/CameraDirector';
import { Fleet, faceAlong, type ShipEntity } from '@/sim/Fleet';
import { FlightModel } from '@/sim/FlightModel';
import { DEFAULT_WORLD_SEED } from '@/sim/Rng';
import { hashWorld, StateHasher } from '@/sim/StateHash';
import type { ReplayCommand } from '@/sim/Replay';
import { ReplayDirector, worldSeedFor } from '@/game/ReplayDirector';
import { MISSIONS as EPISODES } from '@/game/campaign/missions';
import { FIRST_LIGHT } from '@/game/Missions';
import type { Hangar } from '@/game/outfitting/hangar';
import { normaliseBook, type ContractBook } from '@/game/contracts/contracts';
import { KillCam } from '../KillCam';
import { EventTap } from '../EventTap';
import { Weapons } from '@/sim/Weapons';
import { Missiles, type LockState } from '@/sim/Missiles';
import { Capitals } from '@/sim/Capitals';
import { loadProfile } from '@/game/Profile';
import { WeaponVisuals } from '../WeaponVisuals';
import { CombatFx } from '../CombatFx';
import { StarSystemView, type GateInstance } from '../StarSystemView';
import { Hyperspace } from '../Hyperspace';
import { SpaceDust } from '../SpaceDust';
import { bayDust } from '../BayDust';
import { MultiplaneSky } from '../MultiplaneSky';
import { generateUniverse, specialSystem } from '@/universe/generate';
import { CampaignSession, type FlightHostScene } from '@/game/CampaignSession';
import { SYSTEM_FALLBACK } from '@/game/campaign/missions';
import { getAudio, combatIntensity, type AudioFrame } from '@/audio';
import type { CampaignMission } from '@/game/campaign/types';
import type { FactionId } from '@/assets/Blueprint';
import type { StarSystem } from '@/universe/Universe';
import type { Universe } from '@/universe/Universe';
import { FlightHud } from '@/ui/FlightHud';
import { CombatHud } from '@/ui/CombatHud';
import { StarMap } from '@/ui/StarMap';
import { postFx } from '@/render/post/PostFx';
import { MissionRunner, type MissionContext, type MissionDef } from '@/game/Missions';
import { updateAI, issueOrder, setFormation, setAutopilot, brainOf } from '@/sim/ai';
import { DockingController, berth, type Dockable } from '../Docking';
import { stageReach } from '../ReachStage';
import { Traffic, type TrafficEvent } from '../Traffic';
import { hudLabels } from '@/ui/HudLabels';
import { ReachHud } from '@/ui/ReachHud';
import { ambushReward } from '@/universe/traffic';
import { BLUEPRINTS } from '@/assets/blueprints';
import { DockScreen, DockCinema } from '@/ui/DockScreen';
import { HullCollisions } from '../HullCollisions';
import { WingDocking } from '../WingDocking';
import { PlanetaryPorts } from '../surface/PlanetaryPorts';
import '@/ui/Concourse'; // registers the CONCOURSE dock tab (people, conversations)
import { FlightRadio } from '@/dialog/FlightRadio';
import { loadLedger, saveLedger } from '@/game/Profile';
import { MISSILE_MAX, cargoUsed, dockingClearance, reputationForKill, type EconFaction, type TradeLedger } from '@/game/economy';
import { ContractDesk, type PriorityInfo } from '@/game/contracts/ContractDesk';
import { Outfitter, bindOutfitter } from '@/game/outfitting/Outfitter';
import { ShipTurrets } from '@/game/outfitting/turrets';
import '@/ui/ShipyardTab'; // registers the SHIPYARD dock tab (hulls, your hangar)
import '@/ui/OutfittingTab'; // registers the OUTFITTING dock tab (slots, items, power)

/**
 * Milestones 4–6 + 10–11: one ship flying well, then shooting.
 *
 * Everything runs in float64 universe space ~2,600 km from the system origin
 * and renders camera-relative. The player is a ShipEntity whose controls ARE
 * the input state; wingmen and bandits are AI brains writing the same
 * ControlState into the same FlightModel (src/sim/ai).
 *
 * Fixed step (MP-0): `fixedUpdate` is one 1/60 s sim tick, run 0..4 times
 * a frame by the Engine with the player's controls loaded from this frame's
 * input; `update` is presentation only, once per frame.
 *
 * Tick order (deliberately flat; src/sim/determinism.ts flies the same):
 *   replay (commands, controls) → traffic → AI → capitals → turrets →
 *   fleet flight → docking → hull contacts → gates / jump → targeting →
 *   weapons → missiles → campaign / contracts → bookkeeping → per-tick
 *   presentation feeds (particles, flashes, barks, cutaways, kill-cam
 *   history, the audio tap) → replay checkpoint
 * Frame order:
 *   render prediction (ships `alpha` of a tick ahead) → camera director →
 *   rebase → sky / dust → audio → visuals → HUD
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
  /** The world seed: a tape's, else ?seed=, else the Reach's (every sim stream forks from it). */
  readonly seed = worldSeedFor(DEFAULT_WORLD_SEED);
  readonly fleet = new Fleet(this.world.root, this.seed);
  readonly weapons = new Weapons(this.fleet);
  readonly missiles = new Missiles(this.fleet);
  /** The pilot's ship; replaced when the shipyard swaps hulls (see swapPlayer). */
  player: ShipEntity;
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
  /** Weapons, target shield facings / subsystems, sub-target bracket (src/ui/CombatHud.ts). */
  private combatHud: CombatHud;
  /** Ambient traffic: haulers, patrols, raiders on the lanes (world/Traffic.ts). */
  readonly traffic: Traffic;
  private reachHud: ReachHud;
  private reachTime = 0;
  private planesBase = 1;
  /** ?traffic=0 disables ambient traffic (A/B perf checks). */
  private trafficOn = new URLSearchParams(location.search).get('traffic') !== '0';
  readonly universe: Universe = generateUniverse(1994);
  private systemId: string;
  private view: StarSystemView;
  readonly starMap: StarMap;
  private hyperspace = new Hyperspace();
  private dust = new SpaceDust();
  /** `?dust=0` hides the space dust (captures: isolate what draws over a scene). */
  private dustOn = new URLSearchParams(location.search).get('dust') !== '0';
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
  /** Docking & trade: stations, friendly carriers, orbital ports (G). */
  readonly docking: DockingController;
  private dockScreen: DockScreen;
  private cinema: DockCinema;
  /** Combat barks + traffic hails (voiced, subtitled, rate-limited). */
  private radio = new FlightRadio(document.getElementById('ui-root')!);
  /**
   * Hook for the campaign (or anything else) when the player berths:
   * receives the station id (`meridian-orbital-0`, `carrier:Hesperus Dawn`).
   * The active CampaignRunner also gets `onDocked(id)` (sets flags).
   */
  onDocked: ((stationId: string) => void) | null = null;
  /** Hull collisions (stations, capitals) + the same shapes as AI obstacles. */
  private hulls: HullCollisions;
  /** Wingmen hold off the corridor while the lead docks. */
  private wingDock = new WingDocking();
  /** Free-roam contracts: board, accepted jobs, live operations (src/game/contracts). */
  readonly contracts: ContractDesk;
  /** Shipyard & outfitting: owned hulls, fits, the active ship (src/game/outfitting). */
  readonly outfit = new Outfitter();
  /** Fitted turrets, point defence and hangar complements on non-capital hulls. */
  readonly turrets: ShipTurrets;
  /** Planetary ports: landing corridors, the surface layer, pads (src/world/surface). */
  readonly ports: PlanetaryPorts;

  // ── fixed step, replays, kill-cam (MP-0) ──────────────────────────
  /** Sim ticks completed since the scene was built (the replay clock). */
  simTick = 0;
  /** Sim time (s): the start time plus ticks · SIM_DT — what AI, campaign and contracts read. */
  simTime = flags.startTime;
  /** True while a tick runs (replays record outside-the-sim changes only from outside ticks). */
  inTick = false;
  /** A replay seek: skip per-tick presentation (particles, barks, cutaways, history). */
  fastForward = false;
  /** ?killcam=<t>[&kcat=<s>][&warp=N]: captures — the nearest bandit downs the player at t s (reached N× fast), the kill-cam opens s seconds in. */
  private stageKillCam = (() => {
    const q = new URLSearchParams(location.search);
    const t = Number(q.get('killcam'));
    return t > 0 ? { at: t, skip: Number(q.get('kcat') ?? 0) || 0, fired: -1, killer: null as ShipEntity | null, warp: Math.max(1, Math.min(16, Number(q.get('warp')) || 1)) } : null;
  })();
  /** Records every session; plays tapes back (?replay=). */
  readonly replay: ReplayDirector = new ReplayDirector(this, this.seed);
  /** Last seconds, visually, for the kill-cam. */
  private killCam!: KillCam;
  /** Per-tick events gathered for per-frame readers (audio). */
  private frameEvents = new EventTap();
  /** Render prediction scratch: a ship's flight state carried `alpha` of a tick ahead. */
  private predict = new FlightModel();
  /** The player's predicted flight state (the camera follows this). */
  private viewFlight = new FlightModel();
  private hasher = new StateHasher();
  private _ledger: TradeLedger = loadLedger();

  /** Shares, cargo, standing, missile rails — persisted by Profile.ts. */
  get ledger(): TradeLedger {
    return this._ledger;
  }
  set ledger(l: TradeLedger) {
    this._ledger = l;
    // A change from outside a tick (the dock screen, the shop) is part of the tape.
    this.replay.note('ledger', l);
  }

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
    this.turrets = new ShipTurrets(this.fleet, this.weapons, this.capitals);

    // Start 2.6 km short of the first Lantern, flying at it.
    const gate0 = this.view.gates[0];
    const fwd = gate0.link.normal.clone();
    const ORIGIN = gate0.center.clone().addScaledVector(fwd, -2600).add(new Vector3(0, -60, 0));
    const GATE = gate0.center;
    const profile = loadProfile();
    // The active hull from the hangar with its fit (old saves: a stock Kestrel).
    this.player = this.outfit.spawn(this.fleet, ORIGIN, fwd, profile.livery, { isPlayer: true, name: 'Vanguard 1' });
    this.player.controls = input.state; // the player's controls ARE the input
    this.player.flight.velocity.copy(fwd).multiplyScalar(Math.min(150, this.player.flight.spec.maxSpeed * 0.7));
    this.player.flight.throttle = 0.7;
    const wingK = Math.max(1, this.player.model.length / 40);

    [new Vector3(-46, -7, -34), new Vector3(52, 6, -50)].forEach((slot, i) => {
      slot.multiplyScalar(wingK);
      const ship = this.fleet.spawn('vf27-kestrel', 'concord', slot.clone().add(ORIGIN), fwd, { name: `Vanguard ${i + 2}` });
      this.wingmen.push({ ship, slot });
    });
    setFormation(this.wingmen.map((w) => w.ship), 'fingerFour', 40 * wingK);
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
    this.hulls = new HullCollisions(this.fleet, () => (this.fxOn ? this.combatFx.fx : null));
    // The timetable clock runs from a settled point (+1 day) so lanes are already busy.
    this.traffic = new Traffic(this.fleet, this.fxOn ? this.combatFx.fx : null, (id) => id in BLUEPRINTS, this.universe.seed);
    this.traffic.clock = 86_400 + this.ledger.clock;
    this.traffic.onEvent = (e) => this.onTrafficEvent(e);
    this.traffic.setSystem(this.view);

    this.outfit.frame(this.player, this.chase, this.camera);
    this.chase.snap(this.player.flight);
    this.playerSubject = { position: this.player.flight.position, velocity: this.player.flight.velocity, radius: Math.max(9, this.player.radius) };
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
    this.combatHud = new CombatHud(document.getElementById('ui-root')!);
    this.reachHud = new ReachHud(this.hud.context);
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
    this.docking = new DockingController(() => this.view, this.fleet, this.player);
    this.dockScreen = new DockScreen(document.getElementById('ui-root')!);
    this.cinema = new DockCinema(document.getElementById('ui-root')!);
    this.docking.onDocked = (d) => this.berthed(d);
    this.docking.attach(this.world.root);
    this.ports = new PlanetaryPorts({
      scene: this.scene,
      root: this.world.root,
      universe: this.universe,
      docking: this.docking,
      view: () => this.view,
      player: () => this.player,
      ships: () => this.fleet.ships,
      warpTo: (id) => this.warpTo(id),
      quiet: () => this.quiet(),
      placePlayer: (p, d, s) => this.placePlayer(p, d, s),
      closeDockScreen: () => this.dockScreen.close(),
      setSpaceVisible: (v) => {
        this.view.group.visible = v;
        this.view.backdrop.group.visible = v;
      },
      systemLight: () => this.view.system.light,
    });
    window.addEventListener('pagehide', () => saveLedger(this.ledger));
    this.docking.onLaunched = () => {
      this.hulls.fighters.immune(this.player); // off the catapult clean
      this.cinema.hide();
      this.director.cut('chase', null, Infinity);
      this.chase.snap(this.player.flight);
    };
    // ?jump=1: start mid-spool at the first gate (captures of the transition).
    const q = new URLSearchParams(location.search);
    if (q.get('jump') === '1') this.beginJump(gate0.link.to);
    // ?map=tessaly: open the star map with a route plotted (captures).
    if (q.get('map')) {
      this.starMap.destination = q.get('map');
      this.starMap.toggle();
    }
    this.contracts = new ContractDesk(this);
    this.outfit.bind(this);
    bindOutfitter(this.outfit);
    this.outfit.settle(); // hold size, hangar complement
    // Shop results (shipyard, outfitting) change the flying ship: part of the tape.
    const commit = this.outfit.commit.bind(this.outfit);
    this.outfit.commit = (r) => void this.replay.external('outfit', { hangar: r.hangar, ledger: r.ledger, error: r.error }, () => commit(r));
    // ?dock=approach|auto|docked|launch [&station=<id|index>] [&cargo=demo]: docking captures.
    if (q.get('dock')) this.dockFlag(q.get('dock')!, q.get('station') ?? '', q.get('cargo') === 'demo');
    // ?descent=corridor|entry|clouds|below|glide|final|pad|docked|liftoff|climb|orbit [&port=<id>] [&dockt=S]
    if (q.get('descent')) {
      setAutopilot(this.player, false);
      input.override = null;
      this.cinematic = false;
      this.ports.stage(q.get('descent')!, q);
    }
    // ?contract=<kind>&cphase=board|op|pay|map: contract captures.
    this.contracts.stageFromQuery();
    if (q.get('dockui') === '0') this.dockScreen.close();
    // ?reach=body|ring|lane|ambush [&sys=<id>] …: living-Reach captures (world/ReachStage.ts).
    if (q.get('reach')) this.reachFlag(q.get('reach')!, q);
    this.killCam = new KillCam(document.getElementById('ui-root')!, this.fleet, this.visuals, this.fxOn ? this.combatFx : null);
    this.killCam.onEnd = () => this.chase.snap(this.player.flight);
    this.replay.booting = false;
    window.__VANGUARD__ = { ...window.__VANGUARD__, ready: false, frame: () => 0, backend: '', hooks: { ...window.__VANGUARD__?.hooks, scene: this, replay: this.replay.api() } };
  }

  // ── fixed step ─────────────────────────────────────────────────────

  /** Sim speed: berthed or kill-cam 0, tactical ¼, a tape's own pause / speed / seek. */
  timeScale(): number {
    if (this.killCam?.active) return 0;
    const base = this.docking.frozen ? 0 : this.tactical ? 0.25 : 1;
    // ?killcam= captures run the sim ahead to the kill at ?warp=N× (1 frame = N ticks).
    const kc = this.stageKillCam;
    const warp = kc && (kc.fired < 0 || this.simTick < kc.fired + 45) ? kc.warp : 1;
    return base * warp * this.replay.timeScale();
  }

  /** Engine: one fixed tick. */
  fixedUpdate(_t: TickContext): void {
    this.simStep();
  }

  /** Bit-exact hash of the combat world (replay checkpoints). */
  worldHash(): number {
    return hashWorld(this.fleet, this.weapons, this.missiles, this.hasher);
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

  /**
   * One 1/60 s tick of everything that is world state. Runs from the
   * Engine's accumulator (fixedUpdate) or from a replay seek (fast-forward).
   */
  simStep(): void {
    const dt = SIM_DT;
    const time = this.simTime;
    this.inTick = true;
    // Replay: due commands, then the player's controls for this tick (recorded, or from the tape).
    this.replay.beforeTick();
    const c = this.player.controls;
    const pf = this.player.flight;
    // Docking sequences own the ship: no guns, no drive, no target cycling.
    if (this.docking.busy) {
      c.fire = c.missile = c.cruise = c.nextTarget = c.afterburner = false;
      this.tactical = false;
    }
    this.ledger.clock += dt;
    // Story episodes keep their pacing: no docking unless the mission allows it.
    this.docking.lockout = this.campaign && !this.campaign.mission.allowDocking ? 'DOCKING UNAVAILABLE — EPISODE IN PROGRESS' : null;

    // 0. Supercruise: cruise speed scales with distance to the nearest mass
    //    (planet, Lantern, great set piece) and locks to 1× near hostiles.
    pf.cruiseScale = this.supercruiseScale();

    // 1. AI writes controls for every non-player ship (and the player on
    //    autopilot), then one flight step for everyone — same physics.
    this.player.target = this.lock.target; // "attack my target" reads this
    this.reachTime = time;
    this.traffic.setSystem(this.view);
    if (this.jumpPhase === 'none') {
      // Traffic writes its haulers' controls (and scripts raiders) before the fighter AI.
      this.traffic.enabled = !this.campaign && this.trafficOn;
      this.traffic.update(dt, this.player, this.weapons.events);
      updateAI(this.fleet, dt, time, this.hulls.obstacles);
      this.wingDock.update(dt, this.docking, this.player, this.fleet, this.hulls.obstacles, this.wingOrder);
      this.capitals.step(dt);
      this.turrets.step(dt, this.lock.target);
      this.campaign?.preStep(dt);
      this.contracts.preStep(dt);
    }
    this.fleet.step(dt);
    this.docking.update(dt);
    // Hulls are solid: bounce / scrape off stations and capitals (not while guidance owns the ship).
    this.hulls.step(dt, this.view.stations, (s) => s.isPlayer && this.docking.busy, this.world.eye);
    this.hulls.stepFighters(dt, (s) => s.isPlayer && this.docking.busy, this.world.eye);
    for (const b of this.bandits) {
      if (b.ship.alive || b.deadFor < 0) continue;
      b.deadFor += dt;
      // Station space is patrolled: reinforcements don't jump you on the approach.
      if (b.deadFor > 6 && !this.nearStation(20_000) && !this.ports.active) this.respawn(b);
    }

    // 2b. Lanterns: crossing a gate plane inside the ring starts a jump.
    if (this.jumpPhase === 'none') this.checkGates();
    this.updateJump(dt);

    // 3. Targeting + missile salvos.
    if (c.nextTarget || !this.lock.target?.alive) this.cycleTarget();
    Missiles.updateLock(this.lock, this.player, dt);
    if (c.missile && this.lock.locked && this.lock.target && this.takeMissile()) {
      this.missiles.salvo(this.player, this.lock.target);
      if (this.cinematic) this.pendingMissileCam = true;
    }

    // 4. Weapons + missiles sim.
    this.weapons.step(dt);
    this.missiles.step(dt);

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
    this.contracts.update(dt, time);

    // 4b. Mission bookkeeping (kills by faction of the victim).
    for (const e of this.weapons.events) if (e.kind === 'kill' && e.ship) this.kills.set(e.ship.faction, (this.kills.get(e.ship.faction) ?? 0) + 1);
    // Free-roam: shooting a faction's ships costs standing with its stations.
    if (!this.campaign) for (const e of this.weapons.events) if (e.kind === 'kill' && e.ship && e.shooter === this.player && !this.contracts.owns(e.ship) && e.ship.team !== 'renegade') this.ledger = reputationForKill(this.ledger, e.ship.faction as EconFaction);
    if (this.mission) {
      this.missionTime += dt;
      const mc = this.missionCtx;
      mc.time = this.missionTime;
      mc.systemId = this.systemId;
      mc.jumps = this.jumps;
      mc.playerAlive = this.player.alive;
      this.mission.update(mc);
    }
    this.wasBoosting = pf.boosting;

    // 4b'. Capture staging (?killcam=<t>): 3 s before t the nearest bandit is
    //      put on the player's six, guns hot; at t it gets the kill.
    const kc = this.stageKillCam;
    if (kc && kc.fired < 0 && this.player.alive && time >= kc.at - 3) {
      if (!kc.killer || !kc.killer.alive) {
        let bd = Infinity;
        for (const o of this.fleet.enemiesOf(this.player)) {
          const d = o.flight.position.distanceTo(pf.position);
          if (d < bd && o.radius < 60) {
            bd = d;
            kc.killer = o;
          }
        }
        const k = kc.killer;
        if (k) {
          const kf = k.flight;
          kf.position.copy(pf.position).addScaledVector(pf.forward(_to), -380).addScaledVector(pf.up(_v), 22);
          faceAlong(kf.orientation, _to.subVectors(pf.position, kf.position).normalize());
          kf.velocity.copy(pf.velocity);
          k.target = this.player;
        }
      }
      if (kc.killer && time >= kc.at) {
        kc.fired = this.simTick;
        this.player.plotArmour = false;
        this.fleet.hit(this.player, 1e9, 'laser', pf.position, _v.subVectors(kc.killer.flight.position, pf.position).normalize(), kc.killer);
      }
    }

    // 4c. Per-tick presentation feeds: this tick's events → particles,
    //     flashes, radio barks, cutaways, the kill-cam's history and the
    //     audio tap. Visual only; skipped while a replay seeks.
    if (!this.fastForward) {
      if (this.fxOn) this.combatFx.consume(dt);
      this.visuals.consume();
      this.radio.update(dt, {
        player: this.player,
        ships: this.fleet.ships,
        events: this.weapons.events,
        missileIncoming: this.audioFrame.player.incomingMissile,
        story: this.campaign?.comms ?? null,
        quiet: this.docking.busy || this.jumpPhase !== 'none' || this.contracts.rescue.active,
        systemName: this.view.system.name,
      });
      const dk = this.docking.target;
      this.radio.dock(this.docking.phase, dk, dk ? berth(dk) : '', dt);
      if (this.cinematic) this.cutaways(time);
      this.frameEvents.capture(this.weapons.events, this.missiles.events);
      this.killCam.record(this.simTick, this.weapons, this.missiles, pf.position);
      for (const e of this.weapons.events) {
        if (e.kind !== 'kill' || !e.ship) continue;
        if (e.ship === this.player) {
          this.killCam.propose('death', e.shooter, e.ship, this.simTick);
          this.replay.autosave();
        } else if (e.shooter === this.player && (e.ship.radius > 60 || this.contracts.owns(e.ship))) this.killCam.propose('kill', this.player, e.ship, this.simTick);
      }
    }

    this.simTick++;
    this.simTime += dt;
    this.replay.afterTick();
    this.inTick = false;
  }

  /**
   * Presentation, once per frame: predict every ship `alpha` of a tick past
   * the last sim state (so motion is smooth at any refresh rate and the
   * player's fresh input shows this frame even between ticks), then camera,
   * sky, audio, visuals and HUD.
   */
  update({ dt: realDt, time, alpha }: FrameContext): void {
    const pf = this.player.flight;
    // Presentation dt follows the sim's speed (tactical slow-mo, berthed, kill-cam, tape pause).
    const dt = realDt * this.timeScale();
    this.replay.present(realDt);
    this.killCam.tickOffer(realDt);
    const kc = this.stageKillCam;
    if (kc && kc.fired >= 0 && this.simTick >= kc.fired + 45 && this.killCam.offered) {
      this.killCam.accept();
      this.killCam.skipTo(kc.skip);
    }

    if (this.killCam.active) {
      // Kill-cam: the history poses the ships and flies the camera; the world holds still.
      this.hud.clear();
      this.combatHud.clear();
      this.killCam.present(realDt, this.camera, this.world);
      this.world.sync(this.camera);
      this.view.backdrop.follow(this.camera);
      this.view.update(time, this.world.eye);
      this.dust.update(this.world.eye, pf.velocity, 0);
      this.visuals.update(this.world, realDt, 0);
      this.combatFx.update(realDt, this.world.eye);
      this.frameEvents.clear();
      return;
    }

    // Render prediction: the ships' poses `alpha` of a tick ahead of the sim.
    const lead = this.fastForward || this.replay.seeking ? 0 : alpha * SIM_DT * this.timeScale();
    this.presentShips(lead);
    const view = this.viewFlight;

    // 6. Camera (the only thing allowed to lag), then rebase the world on it.
    const tgt = this.lock.target;
    const tgtSubject: Subject | null = tgt ? { position: tgt.model.root.position, velocity: tgt.flight.velocity, radius: tgt.radius } : null;
    this.director.update(view, tgtSubject, realDt);
    this.world.eye.copy(this.director.eye).add(this.hulls.shake);
    this.docking.camera(this.world.eye, this.camera, realDt);
    this.world.sync(this.camera);

    this.view.backdrop.follow(this.camera);
    this.view.update(time, this.world.eye);
    this.ports.update(time);
    // No dust in a hangar: it fades out down the bay corridor and streaks in the host's frame (BayDust.ts).
    this.dust.intensity = bayDust(this.world.eye, pf.velocity, [this.docking.target, this.docking.nearest], _dustVel);
    this.dust.update(this.world.eye, _dustVel, dt);
    this.dust.object.visible = this.jumpPhase !== 'tunnel' && !this.ports.active && this.dustOn;
    if (this.planes) {
      this.planes.update(this.world.eye, pf.speed);
      // A world filling the sky clears the km strata off its face.
      const nb = this.view.nearestBody(this.world.eye);
      const ang = nb ? Math.asin(Math.min(1, nb.body.radius / (nb.altitude + nb.body.radius))) : 0;
      const k = Math.min(1, Math.max(0, (ang - 0.05) / 0.3));
      this.planes.setDensity(this.planesBase * (1 - 0.8 * k * k * (3 - 2 * k)));
      this.planes.mesh.visible = this.jumpPhase !== 'tunnel' && !this.ports.active;
    }

    // 6b. Audio: one frame of facts (this frame's ticks' events), read by the audio façade.
    this.updateAudio(realDt);
    this.frameEvents.clear();

    // 7. Visuals + HUD in render space.
    this.visuals.update(this.world, dt, lead);
    this.combatFx.update(dt, this.world.eye);
    const cruiseK = pf.cruise === 'on' ? 0.55 : pf.cruise === 'spool' ? (pf.cruiseT / pf.spec.cruiseSpool) * 0.4 : 0;
    postFx.boost = Math.max(this.chase.boostAmount, cruiseK);
    postFx.speed = Math.min(1, pf.speed / pf.spec.boostSpeed);
    this.hyperspace.update(dt, this.jumpPhase === 'tunnel' ? Math.min(1, this.jumpT * 3, (TUNNEL - this.jumpT) * 3) : 0, 60, this.camera.quaternion);
    this.hud.navNoise = Math.max(postFx.navNoise, this.campaign?.mission.modifiers?.navDegraded ? 0.55 : 0);
    this.contracts.draw(time, !this.docking.busy && !this.tactical && this.jumpPhase === 'none');
    if (this.docking.busy || this.contracts.rescue.active) {
      // Cutaway (docking, or the salvage tow after a free-flight death): the frame belongs to the cinematography.
      this.hud.clear();
      this.combatHud.clear();
      hudLabels.discard();
      this.updateCinema();
      this.starMap.draw(time);
      return;
    }
    this.hud.update(view, this.camera, this.world, time);
    if (this.tactical) {
      const markers = this.view.gates.map((g) => ({ label: `LANTERN → ${this.universe.systems.get(g.link.to)!.name.toUpperCase()}`, pos: g.center, radius: g.gate.radius }));
      this.hud.drawTactical(this.player, this.fleet, this.camera, this.world, this.orderStatus, markers);
    }
    else if (this.jumpPhase === 'none') {
      this.hud.drawTargets(this.player, this.fleet, this.lock, this.camera, this.world, time);
      const nav = this.docking.phase === 'cleared' ? undefined : this.navGate();
      if (nav) this.hud.drawNav(this.universe.systems.get(nav.link.to)!.name, nav.center, view.position, this.camera, this.world, time);
    }
    this.combatHud.turrets = this.turrets.status(this.player);
    this.combatHud.hangar = this.turrets.hangarStatus(this.player);
    this.combatHud.draw(this.player, this.lock.target, this.camera, this.world, time, !this.tactical && this.jumpPhase === 'none');
    this.hud.drawStatus(this.view.system.name, pf.cruise, this.jumpPhase !== 'none' ? `LANTERN TRANSIT → ${this.universe.systems.get(this.jumpTo)?.name ?? ''}` : '');
    if (this.jumpPhase === 'none' && !this.tactical) this.drawDockHud(time);
    this.drawReachHud(time);
    if (this.mission) this.hud.drawObjectives(this.mission, time);
    if (this.campaign) {
      const m = this.campaign.mission;
      this.hud.drawCampaign(`EP ${String(m.episode).padStart(2, '0')} · ${m.title}`, this.campaign.visibleObjectives(), this.campaign.runner.outcome, time);
      for (const d of this.campaign.runner.dwells) this.hud.drawDwell(d.position, d.radius, d.progress, this.camera, this.world);
    }
    // World-space labels from every layer, decluttered in one pass (src/ui/HudLabels.ts).
    hudLabels.flush(this.hud.context, window.innerWidth, window.innerHeight, time);
    this.starMap.draw(time);
  }

  /**
   * Render prediction. Each live ship's model is posed where its flight
   * state will be `lead` seconds past the last tick: a scratch FlightModel
   * copies the state and steps it with the ship's current controls — for
   * the player, this frame's fresh input (the latency rule: a stick
   * movement shows on the frame it arrives even when no tick ran). Visual
   * only; the sim never reads it. `viewFlight` holds the player's
   * prediction for the camera and HUD.
   */
  private presentShips(lead: number): void {
    const P = this.predict;
    const own = this.replay.playing ? this.player.controls : input.latest;
    for (const s of this.fleet.ships) {
      if (!s.alive) continue;
      const f = s.flight;
      const r = s.model.root;
      if (lead <= 0 || this.docking.busy && s === this.player) {
        r.position.copy(f.position);
        r.quaternion.copy(f.orientation);
        if (s === this.player) copyFlight(f, this.viewFlight);
        continue;
      }
      copyFlight(f, P);
      P.step(s === this.player ? own : s.controls, lead);
      r.position.copy(P.position);
      r.quaternion.copy(P.orientation);
      if (s === this.player) copyFlight(P, this.viewFlight);
    }
    if (!this.player.alive) copyFlight(this.player.flight, this.viewFlight);
  }

  private supercruiseScale(): number {
    const p = this.player.flight.position;
    let d = Infinity;
    for (const m of this.view.masses) d = Math.min(d, p.distanceTo(m.position) - m.radius);
    for (const g of this.view.gates) d = Math.min(d, p.distanceTo(g.center));
    for (const st of this.view.stations) d = Math.min(d, p.distanceTo(st.center) - st.radius);
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
    if (!this.planes) return;
    const sys = this.view.system;
    const neb = sys.backdrop.nebula;
    const at = (x: number) => new Color(neb.reduce((best, s) => (Math.abs(s.at - x) < Math.abs(best.at - x) ? s : best)).color);
    // Tame the sky's colours: strata are painted scenery, never the loudest thing in frame.
    const tame = (c: Color, sMax: number, lMax: number) => {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      return c.setHSL(hsl.h, Math.min(hsl.s, sMax), Math.min(hsl.l, lMax));
    };
    const a = tame(at(0.77), 0.55, 0.42);
    const b = tame(new Color(sys.backdrop.wisp).lerp(a, 0.55), 0.5, 0.42);
    this.planes.setPalette(a, b, tame(at(0.5), 0.6, 0.2));
    // Special skies (Dead Zone, Anchor, Nexus) belong to their set pieces.
    this.planesBase = sys.id === 'monolith' ? 0 : sys.faction === 'unknown' ? 0.35 : 1;
    this.planes.setDensity(this.planesBase);
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
    return this.replay.external('episode', m.id, () => this.beginCampaign(m)) ?? new Promise(() => {});
  }

  private beginCampaign(m: CampaignMission): Promise<{ outcome: 'success' | 'failure'; codex: string[] }> {
    this.campaign?.dispose();
    this.docking.reset();
    this.dockScreen.close();
    this.cinema.hide();
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
    this.outfit.settle(true); // episodes fly a fighter: a big active hull stays in the hangar
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
    if (!this.replay.external('mission', def.id, () => true)) return;
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

  // ── Docking & trade ────────────────────────────────────────────────

  private requestDock(): void {
    this.docking.request((d) => dockingClearance(this.ledger, d.faction));
  }

  /** True if any station in this system is within `r` metres of the player. */
  private nearStation(r: number): boolean {
    const p = this.player.flight.position;
    return this.view.stations.some((st) => st.center.distanceTo(p) < r);
  }

  /** Free-roam missiles come off the rails (restock when docked); story episodes are fleet-supplied. */
  private takeMissile(): boolean {
    if (!this.player.combat.loadout.missiles.length) {
      this.docking.say('NO MISSILE RACKS FITTED', '#ff5f7a', 2);
      return false;
    }
    if (this.campaign) return true;
    if (this.ledger.missiles <= 0) {
      this.docking.say('RAILS EMPTY — REARM AT A STATION OR CARRIER', '#ff5f7a', 3);
      return false;
    }
    this.ledger.missiles--;
    return true;
  }

  /** Every station in the Reach, for the ticker's price tips. */
  private allMarkets() {
    return [...[...this.universe.systems.values()].flatMap((s) => s.stations), ...this.ports.markets()];
  }

  /** Berthed: save, notify hooks, open the dock screen. */
  private berthed(d: Dockable): void {
    this.ledger.lastDock = d.id;
    saveLedger(this.ledger);
    this.cinema.hide();
    this.onDocked?.(d.id);
    this.campaign?.runner.onDocked(d.id);
    const notices = this.campaign ? [] : this.contracts.onDocked(d.id);
    const port = d.cls === 'descent' ? this.ports.markets().find((p) => p.id === d.id) : undefined;
    if (port) notices.unshift({ text: `${port.description.toUpperCase()}`, cls: '' });
    else if (d.cls === 'mooring') notices.unshift({ text: 'MOORED OFF THE PYLON · LIGHTER RUNNING THE CREW ACROSS', cls: 'ok' });
    else if (d.cls === 'clamp') notices.unshift({ text: `${d.label ?? 'CLAMP BERTH'} · CLAMPS MADE FAST · UMBILICALS CONNECTED`, cls: 'ok' });
    this.lock.target = null;
    this.turrets.recall(this.player);
    if (this.replay.playing) {
      // A tape: the dock screen's choices are already on it (ledger, shop, contracts, launch).
      this.cinema.show('BERTHED // REPLAY', d.name.toUpperCase(), 'DOCK SCREEN — THE PILOT’S CHOICES PLAY FROM THE TAPE');
      return;
    }
    this.dockScreen.open({
      notices,
      station: d,
      systemName: this.view.system.name,
      berth: berth(d),
      berthMode: d.cls,
      markets: this.allMarkets(),
      ledger: () => this.ledger,
      setLedger: (l) => {
        this.ledger = l;
        saveLedger(l);
      },
      hull: () => this.player.hull / this.player.hullMax,
      setHull: (h) => void this.replay.external('hull', h, () => (this.player.hull = h * this.player.hullMax)),
      hullSize: () => Math.sqrt(Math.max(1, this.player.hullMax / 110)),
      onLaunch: () =>
        void this.replay.external('launch', undefined, () => {
          saveLedger(this.ledger);
          this.docking.launch();
        }),
    });
    this.audio.music.setMood('briefing', 2);
  }

  /** Letterbox, caption and iris for the docking / launch cutaways. */
  private updateCinema(): void {
    const d = this.docking.target;
    if (!d) return;
    const ph = this.docking.phase;
    const seq = this.docking.caption();
    if (seq) {
      this.cinema.show(seq.title, d.name.toUpperCase(), seq.sub);
      this.cinema.timecode(this.docking.t);
      this.cinema.setIris(seq.iris);
    } else if (ph === 'auto') {
      this.cinema.show('DOCKING SEQUENCE // AUTO-GUIDANCE', d.name.toUpperCase(), `BERTH ${berth(d)} · ${d.kind === 'orbital' ? 'PLANETARY LANDING CORRIDOR' : d.kind === 'carrier' ? 'HANGAR DECK' : 'APPROACH CORRIDOR'} · SEALS STANDING BY`);
      this.cinema.timecode(this.docking.t);
      // Iris closes over the last beat as she slides into the dark.
      this.cinema.setIris(this.docking.t > 6.1 ? 1 - (this.docking.t - 6.1) / 0.9 : 1);
    } else if (ph === 'launch') {
      this.cinema.show('LAUNCH // CATAPULT HOT', d.name.toUpperCase(), 'GOOD HUNTING, VANGUARD');
      this.cinema.timecode(this.docking.t);
      this.cinema.setIris(Math.min(1, this.docking.t / 0.6));
    } else this.cinema.hide();
  }

  /** Station markers, the approach corridor, the dock prompt and the loadout line. */
  private drawDockHud(time: number): void {
    const pf = this.player.flight;
    const dk = this.docking;
    const list = dk.dockables();
    const hot = dk.target?.name ?? dk.nearest?.name ?? null;
    this.hud.drawStations(
      list.filter((d) => d.station || d === dk.nearest || d === dk.target).map((d) => ({ name: d.name, pos: d.station ? d.center : d.bay, faction: d.faction, kind: d.kind === 'orbital' ? 'orbital port' : d.kind })),
      pf.position,
      hot,
      this.camera,
      this.world,
    );
    if (dk.phase === 'cleared' && dk.target) {
      const d = dk.target;
      _to.subVectors(pf.velocity, d.velocity);
      this.hud.drawDockCorridor(d.bay, d.axis, d.up, pf.position, _to, d.name, this.camera, this.world, time, d.profile?.corridorScale ?? 1);
    }
    const nd = dk.nearest;
    if (dk.message) this.hud.drawDockMessage(dk.message, dk.messageColor);
    else if (dk.phase === 'free' && nd) {
      const km = ((nd.rangeTo ? nd.rangeTo(pf.position) : nd.bay.distanceTo(pf.position)) / 1000).toFixed(1);
      this.hud.drawDockMessage(nd.cls === 'descent' ? `[G] REQUEST DESCENT · ${nd.name.toUpperCase()} · LANDING CORRIDOR ${km} km` : `[G] REQUEST DOCKING · ${nd.name.toUpperCase()}${nd.label ? ` · ${nd.label}` : ''} · ${km} km`, '#6fe6ff');
    }
    if (!this.campaign) this.hud.drawLoadout(this.ledger.missiles, MISSILE_MAX, this.ledger.credits, cargoUsed(this.ledger), this.ledger.capacity);
  }

  /** Jump straight to a system (no transit effect) — captures and dev flags. */
  private warpTo(id: string): void {
    if (id === this.systemId || !this.universe.systems.has(id)) return;
    this.view.dispose();
    this.systemId = id;
    this.view = new StarSystemView(this.universe.systems.get(id)!, this.scene, this.world.root);
    this.paintPlanes();
    this.gateSide.clear();
    this.placeCapitals();
  }

  /** Planet / moon markers, traffic tags, distress calls, hail card. */
  private drawReachHud(time: number): void {
    if (this.jumpPhase !== 'none' || this.tactical) return;
    const nav = this.navGate();
    this.reachHud.navNoise = this.hud.navNoise;
    this.reachHud.draw({
      time,
      cam: this.camera,
      world: this.world,
      player: this.player,
      bodies: this.view.bodies,
      traffic: this.traffic,
      navGate: nav ? { to: nav.link.to, name: this.universe.systems.get(nav.link.to)?.name ?? nav.link.to, center: nav.center } : null,
      ringDensity: this.view.ringDebris.density,
    });
  }

  /** Traffic events → banners, and the standing reward hook for broken ambushes. */
  private onTrafficEvent(e: TrafficEvent): void {
    const t = this.reachTime;
    if (e.kind === 'ambush') {
      const v = e.ambush.victim;
      this.reachHud.flash('DISTRESS CALL', `${v.manifest.name.toUpperCase()} (${v.manifest.registry}) · ${e.ambush.band.toUpperCase()} RAIDERS ON THE LANE`, '#ff5f7a', t, 4);
      this.audio.stinger('lock');
    } else if (e.kind === 'repelled' || e.kind === 'lost') {
      const a = e.ambush;
      const saved = e.kind === 'repelled';
      if (a.playerJoined && !this.campaign) {
        const r = ambushReward(this.ledger, a.victim.flag, a.playerKills, saved);
        this.ledger = r.ledger;
        saveLedger(this.ledger);
        this.reachHud.flash(saved ? 'AMBUSH BROKEN' : 'HAULER LOST', `BOUNTY +${r.credits.toLocaleString('en-US')} sh · ${a.victim.flag.toUpperCase()} STANDING ${r.rep >= 0 ? '+' : ''}${r.rep.toFixed(1)}`, saved ? '#7dffb2' : '#ffc46b', t, 5);
      } else if (a.position.distanceTo(this.player.flight.position) < 30_000) {
        this.reachHud.flash(saved ? 'RAIDERS DRIVEN OFF' : 'HAULER LOST', `${a.victim.manifest.name.toUpperCase()} · ${saved ? 'the patrol got there first' : `${a.band} took her`}`, saved ? '#7dffb2' : '#ffc46b', t, 4);
      }
    }
  }

  /** Living-Reach capture staging: quiet the free-flight cast, warp, place. */
  private reachFlag(mode: string, q: URLSearchParams): void {
    setAutopilot(this.player, false);
    input.override = null;
    this.cinematic = false;
    if (q.get('sys')) this.warpTo(q.get('sys')!);
    for (const b of this.bandits) {
      b.ship.alive = false;
      b.ship.model.root.visible = false;
      b.deadFor = -1e9;
    }
    this.cathedral.alive = this.carrier.alive = false;
    this.cathedral.model.root.visible = this.carrier.model.root.visible = false;
    this.cathedral.hull = this.carrier.hull = 0;
    this.lock.target = null;
    this.traffic.setSystem(this.view);
    if (mode === 'ambush') this.traffic.stageAmbush(this.player);
    else if (mode === 'lane') this.traffic.stageArrival(this.player, this.view.gates[0]?.link.to ?? '');
    else stageReach(mode, q, { view: this.view, player: this.player, wingmen: this.wingmen.map((w) => w.ship) });
    // &hail=1: open the hail card on whatever is under the nose (captures).
    if (q.get('hail')) this.reachHud.hail(this.traffic.hailTarget(this.player, 12_000, 0.6), this.reachTime);
    this.chase.snap(this.player.flight);
  }

  /**
   * ?dock=approach — on the corridor 2.4 km out, cleared, flying in.
   * ?dock=auto — at 900 m, guidance engaged (cutaway).
   * ?dock=docked — berthed, dock screen open. ?dock=launch — launching.
   * &station=<station id | index in the current system> (default: nearest to
   * the start). &cargo=demo fills the hold and purse for a livelier screen.
   */
  private dockFlag(mode: string, sel: string, demoCargo: boolean): void {
    setAutopilot(this.player, false);
    input.override = null;
    this.cinematic = false;
    const owner = [...this.universe.systems.values()].find((s) => s.stations.some((st) => st.id === sel));
    if (owner) this.warpTo(owner.id);
    this.quiet();
    const list = this.docking.dockables();
    const p0 = this.player.flight.position;
    const d =
      list.find((x) => x.id === sel) ??
      (sel && /^\d+$/.test(sel) ? list[Number(sel)] : undefined) ??
      [...list].filter((x) => x.station).sort((a, b) => a.bay.distanceTo(p0) - b.bay.distanceTo(p0))[0];
    if (!d) return;
    if (demoCargo) this.ledger = { ...this.ledger, credits: 18_450, cargo: { ebon: 4, relics: 3, rations: 2, medical: 1 }, missiles: 3, rep: { concord: 34, choir: -22, rustwake: 12 } };
    const pf = this.player.flight;
    const place = (out: number, lat: number) => {
      const right = _v.crossVectors(d.up, d.axis);
      pf.position.copy(d.bay).addScaledVector(d.axis, out).addScaledVector(right, lat).addScaledVector(d.up, Math.abs(lat) * 0.35);
      // Nose a little off the bay so the chase camera sees the station past the ship.
      _to.copy(d.bay).addScaledVector(right, lat * 2.2).addScaledVector(d.up, -Math.abs(lat) * 0.5).sub(pf.position).normalize();
      faceAlong(pf.orientation, _to);
      pf.velocity.copy(_to).multiplyScalar(110);
      pf.throttle = 0.5;
      // Wingmen hold off the corridor.
      this.wingmen.forEach((w, i) => {
        w.ship.flight.position.copy(pf.position).addScaledVector(d.axis, 260 + i * 90).add(_v.set(i ? 120 : -120, 40, 0));
        w.ship.flight.orientation.copy(pf.orientation);
        w.ship.flight.velocity.copy(pf.velocity);
      });
      this.chase.snap(pf);
    };
    if (mode === 'approach') {
      place(1900, -130);
      this.docking.clear(d);
    } else if (mode === 'auto') {
      place(900, 40);
      this.docking.clear(d);
      this.docking.skipTo = Number(new URLSearchParams(location.search).get('dockt') ?? 0) || 0;
    } else if (mode === 'docked' || mode === 'launch' || mode === 'berth') {
      place(900, 0);
      this.player.hull = this.player.hullMax * 0.62;
      this.docking.berth(d);
      if (mode === 'berth') this.dockScreen.close(); // berthed, no dock screen: the berth cutaway (big hulls)
      if (mode === 'launch') {
        this.dockScreen.close();
        this.docking.launch();
        this.docking.t = Number(new URLSearchParams(location.search).get('dockt') ?? 0) || 0;
      }
    }
  }

  /** A quiet sky: the free-flight bandits and the Cathedral stand down (captures, free-flight starts). */
  quiet(): void {
    for (const b of this.bandits) {
      b.ship.alive = false;
      b.ship.model.root.visible = false;
      b.deadFor = -1e9;
    }
    this.cathedral.alive = false;
    this.cathedral.model.root.visible = false;
    this.cathedral.hull = 0;
    this.lock.target = null;
  }

  /** Put the player (and the wing, in slot) at a universe point, flying along `dir`. */
  placePlayer(pos: Vector3, dir: Vector3, speed: number): void {
    const pf = this.player.flight;
    pf.position.copy(pos);
    faceAlong(pf.orientation, dir);
    pf.velocity.copy(dir).multiplyScalar(speed);
    pf.throttle = 0.6;
    for (const w of this.wingmen) {
      w.ship.flight.position.copy(_v.copy(w.slot).applyQuaternion(pf.orientation).add(pf.position));
      w.ship.flight.orientation.copy(pf.orientation);
      w.ship.flight.velocity.copy(pf.velocity);
    }
    this.chase.snap(pf);
  }

  /**
   * Berth at a station anywhere in the Reach (free-flight starts, salvage
   * tows, captures): switch systems without a transit, revive the airframe
   * at `hull` (0..1) and open the dock screen.
   */
  berthAt(stationId: string, hull = 1): boolean {
    if (this.ports.markets().some((p) => p.id === stationId)) {
      this.docking.reset();
      this.dockScreen.close();
      this.cinema.hide();
      this.quiet();
      const p = this.player;
      p.alive = true;
      p.hull = Math.max(0.05, Math.min(1, hull)) * p.hullMax;
      p.shield = p.shieldMax;
      return this.ports.berthAt(stationId);
    }
    const owner = [...this.universe.systems.values()].find((s) => s.stations.some((st) => st.id === stationId));
    if (!owner) return false;
    this.docking.reset();
    this.dockScreen.close();
    this.cinema.hide();
    if (owner.id !== this.systemId) {
      this.warpTo(owner.id);
      this.quiet();
    }
    const d = this.docking.dockables().find((x) => x.id === stationId);
    if (!d) return false;
    const p = this.player;
    p.alive = true;
    p.hull = Math.max(0.05, Math.min(1, hull)) * p.hullMax;
    p.shield = p.shieldMax;
    const pos = _to.copy(d.bay).addScaledVector(d.axis, 900);
    this.placePlayer(pos.clone(), d.axis.clone().negate(), 60);
    this.docking.berth(d);
    return true;
  }

  /**
   * Free flight between episodes (the career loop): the story is put away,
   * the wing re-forms, and the pilot starts berthed at `stationId`. Resolves
   * when priority orders are accepted at a Directorate station; with no
   * episode pending the Reach simply stays open.
   */
  startFreeRoam(stationId: string, priority: PriorityInfo | null): Promise<void> {
    return this.replay.external('free', { station: stationId, priority }, () => this.beginFreeRoam(stationId, priority)) ?? new Promise(() => {});
  }

  private beginFreeRoam(stationId: string, priority: PriorityInfo | null): Promise<void> {
    this.campaign?.dispose();
    this.campaign = null;
    this.campaignDone = null;
    this.lastOutcome = 'running';
    // Park everything the episode left in the sky; the free-flight wing comes back.
    const keep = new Set<ShipEntity>([this.player, ...this.wingmen.map((w) => w.ship)]);
    for (const s of this.fleet.ships) {
      if (keep.has(s)) continue;
      s.alive = false;
      s.model.root.visible = false;
    }
    for (const b of this.bandits) b.deadFor = -1e9;
    this.cathedral.hull = this.carrier.hull = 0;
    for (const w of this.wingmen) {
      const s = w.ship;
      s.alive = true;
      s.hull = s.hullMax;
      s.shield = s.shieldMax;
      s.team = this.player.team;
      s.model.root.visible = true;
    }
    setFormation(this.wingmen.map((w) => w.ship), 'fingerFour', 40);
    issueOrder(this.wingmen.map((w) => w.ship), 'formUp', this.player);
    this.audio.autoMood = true;
    this.audio.music.setMood('cruise', 3);
    this.outfit.settle(false); // back into the active hull
    if (!this.berthAt(stationId)) this.berthAt(this.contracts.homeStation());
    this.contracts.priority = priority;
    return new Promise((resolve) => {
      this.contracts.onPriority = () => {
        this.contracts.onPriority = null;
        this.contracts.priority = null;
        this.dockScreen.close();
        resolve();
      };
    });
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
    this.combatHud.resize(w, h);
  }

  cameraLabel(): string {
    const f = this.player.flight;
    return `${this.director.label()} · ${f.flightAssist ? 'FA ON' : 'FA OFF'}${this.cinematic ? ' · CINEMATIC' : ''}`;
  }

  /** Keys that change the world (dock request, turret mode, tactical slow-mo, wing orders): recorded on the tape. */
  private static readonly SIM_KEYS = new Set(['KeyG', 'KeyU', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4']);

  /** V: cycle camera · K: cinematic auto-cutaways. (T / F go through input.) */
  private onKey(code: string): void {
    if (this.killCam?.active) return;
    if (FlightScene.SIM_KEYS.has(code)) {
      // Recorded before it acts; a tape's own copy runs at its tick (live keys are ignored on playback).
      this.replay.external('key', code, () => this.simKey(code));
      return;
    }
    this.simKey(code);
  }

  private simKey(code: string): void {
    const t = this.lock.target;
    const target: Subject | null = t ? { position: t.flight.position, velocity: t.flight.velocity, radius: t.radius } : null;
    if (code === 'KeyG') return this.requestDock();
    if (this.docking.busy && code !== 'KeyM') return; // the dock screen / cutaway owns the keys
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
    } else if (code === 'KeyH') {
      this.reachHud.hail(this.traffic.hailTarget(this.player), this.reachTime);
    } else if (code === 'KeyU') {
      if (this.turrets.status(this.player)) {
        const m = this.turrets.cycleMode();
        this.docking.say(`TURRETS: ${m === 'free' ? 'FREE — ENGAGE ANY HOSTILE IN ARC' : m === 'target' ? 'MY TARGET ONLY' : 'HOLD FIRE'}`, m === 'hold' ? '#ffc46b' : '#7dffb2', 2.5);
      }
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

  /**
   * A hire joins the free-flight wing (src/game/crew.ts): spawned in the next
   * formation slot — or, while berthed, at a hold point off the approach —
   * and flown on the standing wing order. Story episodes park it with the
   * rest of the free-flight wing.
   */
  addWingman(blueprint: string, name: string, faction: FactionId): ShipEntity {
    if (this.inTick || this.replay.booting) return this.hireWingman(blueprint, name, faction);
    // A hire from the concourse: on the tape (a live call during playback is ignored — the tape hires).
    return this.replay.external('hire', { blueprint, name, faction }, () => this.hireWingman(blueprint, name, faction)) ?? this.player;
  }

  private hireWingman(blueprint: string, name: string, faction: FactionId): ShipEntity {
    const pf = this.player.flight;
    const n = this.wingmen.length;
    const slot = new Vector3((n % 2 ? 1 : -1) * (46 + 40 * n), -7 + 6 * n, -34 - 30 * n);
    const pos = slot.clone().applyQuaternion(pf.orientation).add(pf.position);
    const d = this.docking.target;
    if (d && this.docking.phase !== 'free') this.docking.toWorld(d, WingDocking.slot(n, d.interior.hw, _v), pos);
    const ship = this.fleet.spawn(blueprint, faction, pos, pf.forward(new Vector3()), { name, team: this.player.team });
    ship.flight.velocity.copy(d && this.docking.phase !== 'free' ? d.velocity : pf.velocity);
    this.wingmen.push({ ship, slot });
    const wing = this.wingmen.map((w) => w.ship).filter((s) => s.alive);
    setFormation(wing, 'fingerFour', 40);
    issueOrder(wing, this.wingOrder, this.player);
    this.wingDock.adopt(ship);
    if (this.campaign) {
      ship.alive = false;
      ship.model.root.visible = false;
    }
    return ship;
  }

  /** Set by the AI integration to receive wing orders. */
  onWingOrder: ((o: FlightScene['wingOrder']) => void) | null = null;

  // ── Shipyard (OutfitHost) ──────────────────────────────────────────
  inEpisode(): boolean {
    return !!this.campaign;
  }

  /** Put a freshly built hull in the pilot's seat at the old one's pose (shipyard purchase / transfer). */
  swapPlayer(next: ShipEntity): void {
    const old = this.player;
    if (old === next) return;
    const pf = old.flight;
    const nf = next.flight;
    nf.position.copy(pf.position);
    nf.orientation.copy(pf.orientation);
    nf.velocity.copy(pf.velocity);
    nf.throttle = pf.throttle;
    next.isPlayer = true;
    next.controls = input.state;
    next.model.root.visible = old.model.root.visible;
    this.turrets.drop(old);
    old.alive = false;
    old.isPlayer = false;
    old.model.root.removeFromParent();
    const i = this.fleet.ships.indexOf(old);
    if (i >= 0) this.fleet.ships.splice(i, 1);
    this.player = next;
    this.docking.setPlayer(next);
    if (flags.demo) setAutopilot(next, true);
    this.playerSubject = { position: nf.position, velocity: nf.velocity, radius: Math.max(9, next.radius) };
    this.audioFrame.player.position = nf.position;
    this.audioFrame.player.velocity = nf.velocity;
    this.lock.target = null;
    const k = Math.max(1, next.model.length / 40);
    for (const w of this.wingmen) w.slot.normalize().multiplyScalar(60 * k);
    setFormation(this.wingmen.map((w) => w.ship), 'fingerFour', 40 * k);
    issueOrder(this.wingmen.map((w) => w.ship), this.wingOrder, next);
    this.chase.snap(nf);
  }

  cycleCamera(): void {
    this.onKey('KeyV');
  }

  /** A tape's command, at its tick (see ReplayDirector: the same entry points the live game recorded). */
  applyReplayCommand(cmd: ReplayCommand): void {
    const a = cmd.a as Record<string, unknown> | string | number | undefined;
    switch (cmd.c) {
      case 'key':
        this.simKey(a as string);
        break;
      case 'episode': {
        const m = EPISODES.find((x) => x.id === a);
        if (m) void this.startCampaign(m);
        break;
      }
      case 'free': {
        const f = a as { station: string; priority: PriorityInfo | null };
        void this.startFreeRoam(f.station, f.priority);
        break;
      }
      case 'mission':
        if (a === FIRST_LIGHT.id) this.startMission(FIRST_LIGHT);
        break;
      case 'ledger':
        this.ledger = a as unknown as TradeLedger;
        break;
      case 'hull':
        this.player.hull = (a as number) * this.player.hullMax;
        break;
      case 'outfit': {
        const o = a as { hangar: Hangar; ledger: TradeLedger; error?: string };
        this.outfit.commit({ hangar: o.hangar, ledger: o.ledger, error: o.error } as Parameters<Outfitter['commit']>[0]);
        break;
      }
      case 'hire': {
        const h = a as { blueprint: string; name: string; faction: FactionId };
        this.addWingman(h.blueprint, h.name, h.faction);
        break;
      }
      case 'book':
        this.contracts.replaceBook(normaliseBook(a as unknown as ContractBook));
        break;
      case 'launch':
        this.docking.launch();
        break;
      default:
        console.warn(`[replay] unknown command ${cmd.c}`);
    }
  }
}

/** Copy the flight state a prediction needs (spec shared: it's read-only). */
function copyFlight(from: FlightModel, to: FlightModel): void {
  to.spec = from.spec;
  to.position.copy(from.position);
  to.velocity.copy(from.velocity);
  to.orientation.copy(from.orientation);
  to.bodyRates.copy(from.bodyRates);
  to.bodyAccel.copy(from.bodyAccel);
  to.throttle = from.throttle;
  to.flightAssist = from.flightAssist;
  to.boosting = from.boosting;
  to.boostGauge = from.boostGauge;
  to.boostLocked = from.boostLocked;
  to.cruise = from.cruise;
  to.cruiseT = from.cruiseT;
  to.cruiseScale = from.cruiseScale;
}

const _v = new Vector3();
const _to = new Vector3();
const _dustVel = new Vector3();

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

