import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { ControlState } from '@/core/Input';
import { WorldSpace } from '@/core/WorldSpace';
import { generateUniverse } from '@/universe/generate';
import { StarSystemView } from '@/world/StarSystemView';
import { HullCollisions } from '@/world/HullCollisions';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { stockFit } from '@/game/outfitting/fit';
import { applyFit } from '@/game/outfitting/apply';
import { ShipTurrets } from '@/game/outfitting/turrets';
import { CampaignSession, type FlightHostScene } from '@/game/CampaignSession';
import { CampaignRunner, type CampaignHost } from '@/game/CampaignRunner';
import { EscortGuidance } from '@/game/campaign/EscortGuidance';
import { MISSIONS } from '@/game/campaign/missions';
import type { CampaignMission } from '@/game/campaign/types';
import type { SetPiece, SetPieceFrame } from '@/world/setpieces';
import { postFx } from '@/render/post/PostFx';
import { flightNavigation } from '@/ui/FlightNavigation';
import { Fleet, emptyControls, faceAlong, type ShipEntity } from './Fleet';
import { Weapons } from './Weapons';
import { Missiles, type LockState } from './Missiles';
import { Capitals } from './Capitals';
import { gunOf, gunRange, leadSpeedOf } from './Combat';
import { issueOrder, setFormation, updateAI, type Order } from './ai';
import { StateHasher, hashWorld } from './StateHash';
import { REPLAY_HZ, REPLAY_VERSION, ReplayCursor, ReplayTake, copyControls, quantizeControls, type ReplayFile } from './Replay';
import { DEFAULT_HUD_PILOT, HudPilot, controlsFromDevices, type HudPilotOptions, type HudView, type WingKey } from './HudPilot';

/**
 * Headless campaign episodes (Episode 1, "The Long Dark", by default) flown
 * with ordinary player input.
 *
 * The world is the FlightScene's, built the same way without a renderer:
 * the Meridian start cast (player on a stock-fitted Kestrel, free-flight
 * wing, bandits, Cathedral and carrier), then `beginCampaign`'s move to
 * Anchorage, parking of that cast and EP01's stationary +Z start. The
 * production CampaignSession spawn / preStep / update and CampaignRunner run
 * the episode; set pieces are the real ones (their interaction radii count).
 * Each 60 Hz tick follows FlightScene.simStep's campaign branch: AI →
 * capitals → turrets → session.preStep → weapons.beginTick → fleet →
 * hulls (stations, capitals, fighters) → gate crossing → targeting and
 * missile salvo → weapons → missiles → session.update.
 *
 * The only thing that flies the player is HudPilot (what the HUD shows →
 * mouse/keyboard devices → the ControlState Input.sample builds), recorded
 * into a replay take. No flags, kills, positions, health or objectives are
 * written after the start. Presentation-only steps (particles, radio barks,
 * kill-cam, audio) and systems inert during an episode (traffic, contracts,
 * guilds, rivals, salvage, the parked wing's docking) are omitted.
 */
const DT = 1 / REPLAY_HZ;
const SEED = 1994;
// FlightScene's jump phases (s).
const SPOOL = 0.9;
const TUNNEL = 2.6;
const EXIT = 0.9;

export interface RouteOptions {
  seed?: number;
  /** Stop after this many simulated seconds even if the episode is running. */
  seconds?: number;
  /** Keep ticking this long after the outcome (FlightScene resolves the debrief after 5 s). */
  after?: number;
  pilot?: HudPilotOptions;
  record?: boolean;
  /** Fly the player from a take instead of the pilot. */
  replay?: ReplayFile;
  mission?: CampaignMission;
  /** Log every weapon event that lands on the player. */
  trace?: boolean;
  /**
   * DIAGNOSTIC counterfactuals only (e.g. a what-if wing order): called every
   * tick before the sim step. Results produced with it are not ordinary-input
   * evidence and the take is marked as such.
   */
  counterfactual?: { name: string; tick: (S: HeadlessFlight, runner: CampaignRunner) => void };
  /** Keep flying through Lantern jumps (default: a ring crossing ends the run). */
  allowJumps?: boolean;
  /**
   * What the objective text points at when the HUD has no mission marker or
   * dwell ring (e.g. EP10's "fly CAP over the Bastion"): objective id → a
   * visible ship or set-piece tag, optionally `tag:holdRadius` (default 800 m),
   * or '@gate' for "jump" objectives (the HUD's generic gate marker). Used
   * only while that objective is active and no hostile is within 3 km, unless
   * the entry ends in '!' (keep to the route under fire).
   */
  objectiveRoute?: Record<string, string>;
  /** Read-only per-tick observer (after the tick). */
  observe?: (S: HeadlessFlight, runner: CampaignRunner, log: (kind: string, detail: string) => void) => void;
  /** End the run early (checked after each tick). */
  stopWhen?: (S: HeadlessFlight, runner: CampaignRunner) => boolean;
}

export interface RouteEvent {
  tick: number;
  t: number;
  kind: string;
  detail: string;
}

export interface RouteResult {
  seed: number;
  outcome: 'running' | 'success' | 'failure';
  /** Tick at which the runner resolved (−1 if it did not). */
  outcomeTick: number;
  ticks: number;
  events: RouteEvent[];
  hashes: number[];
  take: ReplayFile | null;
  jumped: string | null;
  player: { hull: number; hullMax: number; shield: number; alive: boolean };
  stats: { shotsFired: number; missiles: number; playerKills: number; kills: Record<string, number>; hullContacts: number; minStationDistance: number; minGateLateralAtPlane: number };
  objectives: { id: string; state: string }[];
  flags: string[];
  /** Pieces the session built, for disposal checks. */
  pieces: number;
}

interface Bandit {
  ship: ShipEntity;
}

/** The FlightScene world without a renderer, after `beginCampaign(mission)`. */
export class HeadlessFlight implements FlightHostScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly world = new WorldSpace(this.scene);
  readonly universe = generateUniverse(1994);
  readonly fleet: Fleet;
  readonly weapons: Weapons;
  readonly missiles: Missiles;
  readonly capitals: Capitals;
  readonly turrets: ShipTurrets;
  readonly hulls: HullCollisions;
  readonly lock: LockState = { target: null, progress: 0, locked: false };
  player: ShipEntity;
  view: StarSystemView;
  systemId: string;
  jumps = 0;
  simTick = 0;
  simTime = 0;
  campaign: CampaignSession | null = null;
  /** The lead's standing wing order (FlightScene.wingOrder). */
  wingOrder: Order = 'formUp';
  readonly wingmen: ShipEntity[] = [];
  private readonly wingSlots: Vector3[] = [];
  readonly bandits: Bandit[] = [];
  readonly cathedral: ShipEntity;
  readonly carrier: ShipEntity;
  private gateSide = new Map<unknown, number>();
  /** Set when the player crosses a Lantern ring (the scene would start a jump). */
  jumpedTo: string | null = null;

  constructor(seed = SEED) {
    this.fleet = new Fleet(this.world.root, seed);
    this.weapons = new Weapons(this.fleet);
    this.missiles = new Missiles(this.fleet);
    this.systemId = this.universe.start;
    this.view = new StarSystemView(this.universe.systems.get(this.systemId)!, this.scene, this.world.root);
    this.capitals = new Capitals(this.fleet, this.weapons);
    this.turrets = new ShipTurrets(this.fleet, this.weapons, this.capitals);
    // FlightScene's constructor cast, in its spawn order (entity ids match).
    const gate0 = this.view.gates[0];
    const fwd = gate0.link.normal.clone();
    const ORIGIN = gate0.center.clone().addScaledVector(fwd, -2600).add(new Vector3(0, -60, 0));
    const GATE = gate0.center;
    // A fresh career's hangar: a stock-fitted Kestrel (hangar.newHangar), flown by Outfitter.build.
    const k = CATALOG_BY_ID['vf27-kestrel'];
    this.player = this.fleet.spawn(k.blueprint, 'concord', ORIGIN, fwd, { isPlayer: true, name: 'Vanguard 1' });
    this.player.faction = 'concord';
    this.player.team = 'concord';
    applyFit(this.player, k, stockFit(k));
    this.player.controls = emptyControls();
    this.player.flight.velocity.copy(fwd).multiplyScalar(Math.min(150, this.player.flight.spec.maxSpeed * 0.7));
    this.player.flight.throttle = 0.7;
    const wingK = Math.max(1, this.player.model.length / 40);
    [new Vector3(-46, -7, -34), new Vector3(52, 6, -50)].forEach((slot, i) => {
      slot.multiplyScalar(wingK);
      this.wingSlots.push(slot);
      this.wingmen.push(this.fleet.spawn('vf27-kestrel', 'concord', slot.clone().add(ORIGIN), fwd, { name: `Vanguard ${i + 2}` }));
    });
    setFormation(this.wingmen, 'fingerFour', 40 * wingK);
    issueOrder(this.wingmen, 'formUp', this.player);
    for (let i = 0; i < 3; i++) {
      const pos = GATE.clone().add(new Vector3((i - 1) * 300, 80 * i, 600));
      this.bandits.push({ ship: this.fleet.spawn('choir-cantor', 'choir', pos, fwd.clone().negate(), { name: `Cantor ${i + 1}` }) });
    }
    this.lock.target = this.bandits[0].ship;
    this.cathedral = this.fleet.spawn('choir-cathedral', 'choir', GATE.clone().add(new Vector3(-5200, 1400, 9000)), new Vector3(-0.8, 0, -0.6).normalize(), { name: 'Cathedral Ascendant' });
    this.capitals.register(this.cathedral, { launchBlueprint: 'choir-cantor', maxFighters: 3 });
    this.carrier = this.fleet.spawn('cvs07-hesperus-dawn', 'concord', ORIGIN.clone().add(new Vector3(-2400, -500, -1800)), fwd, { name: 'Hesperus Dawn' });
    this.capitals.register(this.carrier, { launchBlueprint: 'vf27-kestrel', maxFighters: 2 });
    this.hulls = new HullCollisions(this.fleet, () => null, (s, amount, point, normal, other) => this.weapons.contactHit(s, amount, point, normal, other));
  }

  currentSystemId(): string {
    return this.systemId;
  }
  jumpCount(): number {
    return this.jumps;
  }
  gatePosition(i: number): Vector3 | null {
    return this.view.gates[i]?.center ?? null;
  }

  /** FlightScene.beginCampaign, minus presentation (audio, cinema, dock screen, chase camera). */
  beginCampaign(m: CampaignMission): CampaignSession {
    this.disposeCampaign();
    const sys = this.universe.systems.get(m.system)!;
    if (sys.id !== this.systemId) {
      this.view.dispose();
      this.fleet.destruction.clear();
      this.systemId = sys.id;
      this.view = new StarSystemView(sys, this.scene, this.world.root);
      this.gateSide.clear();
    }
    const park = (s: ShipEntity) => {
      s.alive = false;
      s.model.root.visible = false;
    };
    for (const w of this.wingmen) park(w);
    for (const b of this.bandits) park(b.ship);
    park(this.cathedral);
    park(this.carrier);
    this.cathedral.hull = this.carrier.hull = 0;
    const g = this.view.gates[0];
    const pf = this.player.flight;
    const fwd = g ? g.link.normal.clone() : new Vector3(0, 0, 1);
    pf.position.copy(g ? g.center : new Vector3()).addScaledVector(fwd, -2600);
    faceAlong(pf.orientation, fwd);
    pf.velocity.copy(fwd).multiplyScalar(160);
    pf.throttle = 0.7;
    if (m.id === 'ep01-the-long-dark') {
      faceAlong(pf.orientation, new Vector3(0, 0, 1));
      pf.velocity.set(0, 0, 0);
      pf.throttle = 0;
    }
    this.player.hull = this.player.hullMax;
    this.player.shield = this.player.shieldMax;
    this.player.alive = true;
    this.player.model.root.visible = true;
    this.lock.target = null;
    this.campaign = headlessSession(m, this);
    this.campaign.begin();
    return this.campaign;
  }

  disposeCampaign(): void {
    this.campaign?.dispose();
    this.campaign = null;
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

  private checkGates(): void {
    const p = this.player.flight.position;
    const v = new Vector3();
    for (const g of this.view.gates) {
      v.subVectors(p, g.center);
      const s = v.dot(g.link.normal);
      const prev = this.gateSide.get(g) ?? s;
      this.gateSide.set(g, s);
      const lateral = v.addScaledVector(g.link.normal, -s).length();
      if (prev < 0 && s >= 0 && lateral < g.gate.radius * 0.9) {
        this.jumpedTo ??= g.link.to;
        this.jumpPhase = 'spool';
        this.jumpT = 0;
        this.jumpTarget = g.link.to;
        return;
      }
    }
  }

  jumpPhase: 'none' | 'spool' | 'tunnel' | 'exit' = 'none';
  private jumpT = 0;
  /** Destination of the jump in progress. */
  jumpTarget = '';

  /** FlightScene.updateJump's state machine (no postFx / visibility). */
  private updateJump(dt: number): void {
    if (this.jumpPhase === 'none') return;
    this.jumpT += dt;
    const t = this.jumpT;
    if (this.jumpPhase === 'spool') {
      if (t >= SPOOL) {
        this.jumpPhase = 'tunnel';
        this.jumpT = 0;
      }
    } else if (this.jumpPhase === 'tunnel') {
      if (t >= TUNNEL * 0.5 && this.view.system.id !== this.jumpTarget) this.arrive();
      if (t >= TUNNEL) {
        this.jumpPhase = 'exit';
        this.jumpT = 0;
      }
    } else if (t >= EXIT) this.jumpPhase = 'none';
  }

  /** FlightScene.arrive: swap systems, place the flight at the arrival Lantern, park whoever stays behind. */
  private arrive(): void {
    const from = this.systemId;
    this.jumps++;
    this.view.dispose();
    this.fleet.destruction.clear();
    this.systemId = this.jumpTarget;
    this.view = new StarSystemView(this.universe.systems.get(this.systemId)!, this.scene, this.world.root);
    this.gateSide.clear();
    const g = this.view.gateTo(from) ?? this.view.gates[0];
    const out = g.link.normal.clone().negate();
    const pf = this.player.flight;
    const speed = Math.max(220, pf.speed);
    pf.position.copy(g.center).addScaledVector(out, 40);
    faceAlong(pf.orientation, out);
    pf.velocity.copy(out).multiplyScalar(speed);
    const v = new Vector3();
    this.wingmen.forEach((w, i) => {
      w.flight.position.copy(v.copy(this.wingSlots[i]).applyQuaternion(pf.orientation).add(pf.position));
      w.flight.orientation.copy(pf.orientation);
    });
    if (this.campaign) {
      let k = 0;
      for (const s of this.fleet.ships) {
        if (s === this.player || !s.alive) continue;
        if (s.team === this.player.team) {
          k++;
          s.flight.position.copy(pf.position).addScaledVector(out, -60 * k).add(v.set((k % 2 ? 1 : -1) * 50 * k, 8 * k, 0));
          s.flight.orientation.copy(pf.orientation);
          s.flight.velocity.copy(pf.velocity);
        } else {
          s.alive = false;
          s.model.root.visible = false;
        }
      }
    }
    for (const b of this.bandits) {
      b.ship.alive = false;
      b.ship.model.root.visible = false;
    }
    for (const w of this.wingmen) w.flight.velocity.copy(pf.velocity);
  }

  /** FlightScene.supercruiseScale (cruise drive only; the pilot never engages it). */
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

  /** FlightScene.simStep's campaign branch (no docking, no jump in progress). */
  /** FlightScene.simKey's wing-order branch (1–4): the parked free-flight wing and the episode's own wingmen. */
  simKey(code: string): void {
    const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
    if (i < 0) return;
    this.wingOrder = (['formUp', 'attackMyTarget', 'engageAtWill', 'coverMe'] as const)[i];
    issueOrder(this.wingmen, this.wingOrder, this.player);
    this.campaign?.orderWing(this.wingOrder);
  }

  simStep(): void {
    const dt = DT;
    const time = this.simTime;
    const c = this.player.controls;
    this.player.flight.cruiseScale = this.supercruiseScale();
    this.player.target = this.lock.target;
    if (this.jumpPhase === 'none') {
      updateAI(this.fleet, dt, time, this.hulls.obstacles);
      this.capitals.step(dt);
      this.turrets.step(dt, this.lock.target);
      this.campaign?.preStep(dt);
    }
    this.weapons.beginTick();
    this.fleet.step(dt);
    this.hulls.step(dt, this.view.stations, () => false, this.world.eye);
    this.hulls.stepFighters(dt, () => false, this.world.eye);
    if (this.jumpPhase === 'none') this.checkGates();
    this.updateJump(dt);
    if (c.nextTarget || !this.lock.target?.alive) this.cycleTarget();
    Missiles.updateLock(this.lock, this.player, dt);
    // Episodes are fleet-supplied: a fitted rack fires (FlightScene.takeMissile).
    if (c.missile && this.lock.locked && this.lock.target && this.player.combat.loadout.missiles.length) this.missiles.salvo(this.player, this.lock.target);
    this.weapons.step(dt, true);
    this.missiles.step(dt);
    this.campaign?.update(dt, time);
    this.simTick++;
    this.simTime += dt;
  }

  hudView(): HudView {
    return hudViewOf(this);
  }
}

/** The flight-scene fields the HUD draws from (FlightScene and HeadlessFlight both have them). */
export interface HudSource {
  player: ShipEntity;
  readonly lock: LockState;
  readonly fleet: Fleet;
  campaign: { runner: CampaignRunner } | null;
}

/**
 * What the flight HUD shows this frame: the mission marker (the same
 * flightNavigation call FlightScene.update makes), the selected target box
 * and lead pip inputs, the lock ring and the shield/hull/boost bars. The
 * native capture harness calls this on the live FlightScene.
 */
export function hudViewOf(S: HudSource): HudView {
  const p = S.player;
  const pf = p.flight;
  const nav = flightNavigation(S.campaign?.runner);
  const t = S.lock.target;
  const enemies = S.fleet.enemiesOf(p);
  const hostile = !!t && t.alive && enemies.includes(t);
  const gun = gunOf(p);
  return {
    position: pf.position,
    velocity: pf.velocity,
    orientation: pf.orientation,
    throttle: pf.throttle,
    boostGauge: pf.boostGauge,
    shield: p.shieldMax > 0 ? p.shield / p.shieldMax : 0,
    hull: p.hull / p.hullMax,
    marker: nav ? nav.position : null,
    target: hostile ? { position: t!.flight.position, velocity: t!.flight.velocity } : null,
    targetFriendly: !!t && t.alive && !hostile,
    hostilesPresent: enemies.length > 0,
    locked: S.lock.locked,
    leadSpeed: leadSpeedOf(p),
    gunRange: gun ? gunRange(gun) : 1500,
  };
}

/**
 * hudViewOf plus the other destinations the flight HUD or objective text
 * gives when a mission has no authored marker: dwell rings (hud.drawDwell),
 * the objective's named subject (`objectiveRoute`), and the generic gate
 * marker FlightScene shows for missions without authored navigation.
 * Missions with authored navigation (EP01) see exactly hudViewOf.
 */
export function pilotView(S: HeadlessFlight, runner: CampaignRunner, objectiveRoute?: Record<string, string>): HudView {
  const v = hudViewOf(S);
  if (v.marker) return v;
  if (runner.mission.objectives.some((o) => o.navigation || o.navTag)) return v;
  const ring = runner.dwells.find((d) => d.progress < 1);
  if (ring) return { ...v, marker: ring.position, markerHold: ring.radius };
  const range = v.target ? v.target.position.distanceTo(v.position) : Infinity;
  const active = runner.mission.objectives.find((o, k) => runner.state[k] === 'active' && !o.optional && !o.hidden);
  const raw = active && objectiveRoute?.[active.id];
  if (!raw) return v;
  // A trailing '!' keeps to the route even with hostiles close (e.g. "Jump" under fire).
  const entry = raw.replace(/!$/, '');
  if (entry === raw && range <= 3000) return v;
  if (entry === '@gate') {
    // "Jump": the generic gate marker FlightScene shows (navGate, no plotted route: the nearest Lantern).
    let best: Vector3 | null = null;
    for (const g of S.view.gates) if (!best || g.center.distanceTo(v.position) < best.distanceTo(v.position)) best = g.center;
    return best ? { ...v, marker: best } : v;
  }
  const [tag, hold] = entry.split(':');
  const at = runner.resolve({ at: 'tag', tag, offset: [0, 0, 0] });
  return at ? { ...v, marker: at, markerHold: Number(hold ?? 800) } : v;
}

/**
 * The production CampaignSession for a headless host: its own spawn,
 * set-piece, preStep, update and dispose methods, with the DOM-backed radio
 * and codex replaced by silent stand-ins (chatter still fires in the runner).
 */
export function headlessSession(mission: CampaignMission, host: FlightHostScene): CampaignSession {
  const session = Object.create(CampaignSession.prototype) as CampaignSession;
  const p = host.player;
  const played: string[] = [];
  const runnerHost: CampaignHost = {
    get playerPosition() {
      return p.flight.position;
    },
    get playerAlive() {
      return p.alive;
    },
    get playerHull() {
      return p.hull / p.hullMax;
    },
    get systemId() {
      return host.currentSystemId();
    },
    get jumps() {
      return host.jumpCount();
    },
    ships: host.fleet.ships,
    gatePosition: (i) => host.gatePosition(i),
    spawnShip: (spec, i, pos) => (session as unknown as { spawn: CampaignHost['spawnShip'] }).spawn(spec, i, pos),
    spawnSetPiece: (spec, pos) => (session as unknown as { buildPiece: CampaignHost['spawnSetPiece'] }).buildPiece(spec, pos),
    playChatter: (beat) => played.push(beat.id),
    unlockCodex: () => {},
    command: (verb, ships) => (session as unknown as { command: NonNullable<CampaignHost['command']> }).command(verb, ships),
  };
  const runner = new CampaignRunner(mission, runnerHost);
  const frame: SetPieceFrame = {
    dt: 0,
    time: 0,
    eye: host.world.eye,
    playerPos: p.flight.position,
    playerVel: p.flight.velocity,
    flags: runner.flags,
    setFlag: (f) => runner.setFlag(f),
    postFx,
    camera: host.camera,
    scene: host.scene,
  };
  Object.assign(session, {
    mission,
    host,
    runner,
    comms: { update() {}, destroy() {}, play() {} },
    codex: { destroy() {}, unlock: () => false },
    pieces: [] as SetPiece[],
    statics: [] as ShipEntity[],
    wing: [] as ShipEntity[],
    engage: [] as { ship: ShipEntity; flag: string }[],
    stationary: new WeakSet<ShipEntity>(),
    departing: [],
    frame,
    unlockedTitles: [],
    outcomeAt: -1,
    escortGuidance: new EscortGuidance(mission),
    chatterPlayed: played,
  });
  return session;
}

/** Built set pieces of a session (for disposal checks). */
export function sessionPieces(session: CampaignSession): SetPiece[] {
  return (session as unknown as { pieces: SetPiece[] }).pieces;
}

/**
 * The boot query a native replay of this take uses (the objective-navigation
 * capture harness's default, with this seed): fresh profile, no traffic.
 * The episode itself starts from the take's tick-0 `episode` command.
 */
export function nativeBoot(seed: number): string {
  return `scene=flight&record=30&demo=0&hud=1&quality=high&dynres=0&traffic=0&planes=0&seed=${seed}&score=nexus&voice=off`;
}

/** Fly `mission` (default EP01) from a fresh world. */
export function runEpisode(o: RouteOptions = {}): RouteResult {
  const seed = o.seed ?? SEED;
  const mission = o.mission ?? MISSIONS[0];
  const S = new HeadlessFlight(seed);
  const session = S.beginCampaign(mission);
  const runner = session.runner;
  const pilot = new HudPilot(o.pilot ?? DEFAULT_HUD_PILOT);
  const cursor = o.replay ? new ReplayCursor(o.replay) : null;
  const take = o.record
    ? new ReplayTake({ v: REPLAY_VERSION, game: 'vanguard', hz: REPLAY_HZ, seed, scene: `headless:${mission.id}`, boot: nativeBoot(seed), storage: {}, created: '1970-01-01T00:00:00.000Z', note: `${mission.id} · HudPilot ${JSON.stringify(o.pilot ?? DEFAULT_HUD_PILOT)}${o.counterfactual ? ` · COUNTERFACTUAL ${o.counterfactual.name} (not ordinary-input evidence)` : ''}` })
    : null;
  take?.command('episode', mission.id);
  const H = new StateHasher();
  const hashes: number[] = [];
  const events: RouteEvent[] = [];
  const log = (kind: string, detail: string) => events.push({ tick: S.simTick, t: +S.simTime.toFixed(3), kind, detail });
  const scratch = emptyControls();
  let devices = pilot.decide(pilotView(S, runner, o.objectiveRoute), 0);
  const limit = Math.round((o.seconds ?? 600) * REPLAY_HZ);
  const after = Math.round((o.after ?? 5.5) * REPLAY_HZ);
  let outcomeTick = -1;
  const stateSeen = runner.state.map((s) => s);
  const flagsSeen = new Set<string>();
  let mode = pilot.mode;
  let lastPhase = S.jumpPhase;
  let jumpsSeen = 0;
  const stats = { shotsFired: 0, missiles: 0, playerKills: 0, kills: {} as Record<string, number>, hullContacts: 0, minStationDistance: Infinity, minGateLateralAtPlane: Infinity };
  for (let i = 0; i < limit; i++) {
    const c: ControlState = S.player.controls;
    if (cursor) {
      if (cursor.done) break;
      // The tape's sim keys (wing orders) run before their tick, as FlightScene's ReplayDirector plays them.
      for (const cmd of cursor.due()) if (cmd.c === 'key' && typeof cmd.a === 'string') S.simKey(cmd.a);
      cursor.next(c);
    } else {
      // The HUD frame is sampled every second tick (30 Hz); edges fire on its first tick only.
      const first = i % 2 === 0;
      if (first && i > 0) devices = pilot.decide(pilotView(S, runner, o.objectiveRoute), S.simTime);
      // A wing key is a keydown: recorded on the tape (FlightScene's replay.external('key')) and applied before the tick.
      if (first)
        for (const k of devices.keys)
          if (k.startsWith('Digit')) {
            take?.command('key', k as WingKey);
            S.simKey(k);
          }
      copyControls(quantizeControls(controlsFromDevices(devices, first, scratch)), c);
    }
    take?.input.push(c);
    o.counterfactual?.tick(S, runner);
    S.simStep();
    // ── observation only ──
    for (const e of S.weapons.events) {
      if (e.kind === 'fire' && e.shooter === S.player) stats.shotsFired++;
      if (o.trace && e.ship === S.player && e.kind !== 'fire')
        log('player-' + e.kind, `${(e as { amount?: number }).amount?.toFixed?.(1) ?? ''} ${e.type ?? ''} by ${e.shooter?.name ?? '-'} at ${e.shooter ? e.shooter.flight.position.distanceTo(S.player.flight.position).toFixed(0) : '-'} m · hull ${S.player.hull.toFixed(1)} shield ${S.player.shield.toFixed(1)}`);
      if (e.kind === 'kill' && e.ship) {
        stats.kills[e.ship.faction] = (stats.kills[e.ship.faction] ?? 0) + 1;
        if (e.shooter === S.player) stats.playerKills++;
        log('kill', `${e.ship.name} (${e.ship.faction}) by ${e.shooter?.name ?? 'unknown'}`);
      }
    }
    for (const e of S.missiles.events) {
      if (e.kind === 'launch' && e.shooter === S.player) stats.missiles++;
      if (o.trace && e.target === S.player) log('missile-' + e.kind, `${e.spec.id} by ${e.shooter?.name ?? '-'} · hull ${S.player.hull.toFixed(1)} shield ${S.player.shield.toFixed(1)}`);
    }
    stats.hullContacts += S.hulls.events.length + S.hulls.fighters.events.filter((e) => e.a.isPlayer || e.b.isPlayer).length;
    for (const st of S.view.stations) stats.minStationDistance = Math.min(stats.minStationDistance, st.center.distanceTo(S.player.flight.position));
    for (const g of S.view.gates) {
      const v = S.player.flight.position.clone().sub(g.center);
      const s = v.dot(g.link.normal);
      if (Math.abs(s) < 50) stats.minGateLateralAtPlane = Math.min(stats.minGateLateralAtPlane, v.addScaledVector(g.link.normal, -s).length());
    }
    runner.state.forEach((st, k) => {
      if (st !== stateSeen[k]) {
        log('objective', `${mission.objectives[k].id}: ${stateSeen[k]} → ${st}`);
        stateSeen[k] = st;
      }
    });
    for (const f of runner.flags) if (!flagsSeen.has(f)) (flagsSeen.add(f), log('flag', f));
    if (pilot.mode !== mode && !cursor) (log('pilot', `${mode} → ${pilot.mode}`), (mode = pilot.mode));
    if (S.jumpPhase === 'spool' && lastPhase === 'none') log('jump', `crossed Lantern ring to ${S.jumpTarget}`);
    if (S.jumps !== jumpsSeen) (log('arrive', `${S.systemId} (jump ${S.jumps})`), (jumpsSeen = S.jumps));
    lastPhase = S.jumpPhase;
    o.observe?.(S, runner, log);
    // Without allowJumps a ring crossing ends the run (EP01: leaving the system is a route failure).
    if (S.jumpedTo && !o.allowJumps) break;
    if (o.stopWhen?.(S, runner)) {
      log('stop', 'stopWhen');
      break;
    }
    if ((S.simTick % REPLAY_HZ) === 0) {
      const h = hashWorld(S.fleet, S.weapons, S.missiles, H);
      hashes.push(h);
      take?.checks.push([S.simTick, h]);
    }
    if (runner.outcome !== 'running' && outcomeTick < 0) {
      outcomeTick = S.simTick;
      log('outcome', `${runner.outcome} · hull ${(S.player.hull / S.player.hullMax * 100).toFixed(1)}%`);
    }
    if (outcomeTick >= 0 && S.simTick >= outcomeTick + after) break;
  }
  const result: RouteResult = {
    seed,
    outcome: runner.outcome,
    outcomeTick,
    ticks: S.simTick,
    events,
    hashes,
    take: take ? take.file() : null,
    jumped: S.jumpedTo,
    player: { hull: S.player.hull, hullMax: S.player.hullMax, shield: S.player.shield, alive: S.player.alive },
    stats,
    objectives: mission.objectives.map((ob, k) => ({ id: ob.id, state: runner.state[k] })),
    flags: [...runner.flags],
    pieces: sessionPieces(session).length,
  };
  S.disposeCampaign();
  S.view.dispose();
  return result;
}
