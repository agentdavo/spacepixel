import { Group, Vector3 } from 'three';
import type { ControlState } from '@/core/Input';
import { BLUEPRINTS } from '@/assets/blueprints';
import { generateUniverse } from '@/universe/generate';
import { piracy } from '@/universe/traffic';
import { SYSTEM_OFFSET, type StarSystemView } from '@/world/StarSystemView';
import { BAY_OFFSET } from '@/world/Station';
import { Traffic } from '@/world/Traffic';
import { ShipTurrets } from '@/game/outfitting/turrets';
import { Fleet, emptyControls, type ShipEntity } from './Fleet';
import { Weapons } from './Weapons';
import { Missiles, type LockState } from './Missiles';
import { Capitals } from './Capitals';
import { FighterCollisions } from './FighterCollisions';
import { issueOrder, setFormation, updateAI } from './ai';
import { Rng } from './Rng';
import { StateHasher, hashWorld, hex } from './StateHash';
import { REPLAY_HZ, REPLAY_VERSION, ReplayCursor, ReplayTake, copyControls, parseReplay, quantizeControls, type ReplayCommand, type ReplayFile } from './Replay';

/**
 * `npm run determinism` — MP-0's pass/fail: the same seed and the same
 * inputs give a bit-identical world, tick for tick.
 *
 * Three headless worlds, each flown by a scripted "player" (human-like stick,
 * trigger, missile, target-cycle and wing-order input) for N simulated
 * minutes at the fixed 60 Hz step:
 *
 *   dogfight   player + wing vs endless Cantor waves (guns, missiles,
 *              collisions, AI) beside a parked Cathedral
 *   capital    Hesperus Dawn vs a Cathedral (flak, lances, hangar launches,
 *              fitted turrets) with fighters on both sides
 *   traffic    a lawless system's timetable (haulers, patrols, raiders)
 *              with an ambush staged on the player
 *
 * For each: run A (recording the player's per-tick ControlState into a
 * replay take), run B (same seed, same script) and run C (same seed, input
 * from A's replay after a JSON round trip) must hash identically every
 * simulated second; run D (seed + 1) must not (the hash is sensitive).
 * The same frame order as FlightScene.tick: traffic → AI → capitals →
 * turrets → flight → collisions → targeting → weapons → missiles.
 */
const DT = 1 / REPLAY_HZ;
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);

export type ScenarioName = 'dogfight' | 'capital' | 'traffic';
export const SCENARIOS: ScenarioName[] = ['dogfight', 'capital', 'traffic'];

// ── scripted player ───────────────────────────────────────────────────────

/**
 * Human-like input from its own stream: stick segments of 0.25–1.6 s that
 * are either keyboard-style (−1 / 0 / 1) or mouse-style (smooth, continuous,
 * every tick different), trigger bursts, afterburner bursts, and one-tick
 * edges (missile salvo, next target, gun cycle, FA toggle). Quantised like
 * the live input path.
 */
export class ScriptedPilot {
  private rng: Rng;
  private segEnd = 0;
  private mouse = false;
  private tp = 0;
  private ty = 0;
  private tr = 0;
  private ph = 0;
  private fireEnd = 0;
  private burnEnd = 0;
  private nextMissile = 4;
  private nextTarget = 2;
  private nextGun = 30;
  private nextFa = 75;
  private faBack = -1;

  constructor(seed: number) {
    this.rng = new Rng(seed).fork('scripted-pilot');
  }

  next(tick: number, c: ControlState): ControlState {
    const r = this.rng;
    const t = tick * DT;
    if (t >= this.segEnd) {
      this.segEnd = t + r.range(0.25, 1.6);
      this.mouse = r.next() < 0.5;
      const key = () => (r.next() < 0.3 ? 0 : r.next() < 0.5 ? -1 : 1);
      this.tp = this.mouse ? r.range(-0.8, 0.8) : key();
      this.ty = this.mouse ? r.range(-0.8, 0.8) : key();
      this.tr = r.next() < 0.6 ? 0 : key();
      this.ph = r.range(0, 6.28);
    }
    const wob = this.mouse ? Math.sin(t * 3.1 + this.ph) * 0.15 : 0;
    c.pitch = this.tp + wob;
    c.yaw = this.ty - wob * 0.7;
    c.roll = this.tr;
    c.throttleDelta = 0;
    c.throttleSet = tick % 600 === 0 ? r.range(0.5, 1) : null;
    if (t >= this.fireEnd + 0.6 && r.next() < 0.02) this.fireEnd = t + r.range(0.3, 2.2);
    c.fire = t < this.fireEnd;
    if (t >= this.burnEnd + 5 && r.next() < 0.004) this.burnEnd = t + r.range(0.5, 2.5);
    c.afterburner = t < this.burnEnd;
    c.missile = t >= this.nextMissile;
    if (c.missile) this.nextMissile = t + r.range(3, 9);
    c.nextTarget = t >= this.nextTarget;
    if (c.nextTarget) this.nextTarget = t + r.range(6, 16);
    c.cycleGun = t >= this.nextGun;
    if (c.cycleGun) this.nextGun = t + r.range(25, 60);
    c.flightAssistToggle = t >= this.nextFa || (this.faBack > 0 && t >= this.faBack);
    if (t >= this.nextFa) {
      this.nextFa = t + r.range(60, 120);
      this.faBack = t + r.range(2, 6);
    } else if (this.faBack > 0 && t >= this.faBack) this.faBack = -1;
    c.cruise = false;
    c.cycleMissile = false;
    // Sub-targeting on a fixed cadence (no dice: the script's stream stays as it was).
    c.cycleSub = tick % 420 === 210;
    c.cycleSubBack = tick % 1260 === 630;
    c.pickSub = tick % 900 === 450;
    return quantizeControls(c);
  }
}

// ── worlds ────────────────────────────────────────────────────────────────

interface World {
  fleet: Fleet;
  weapons: Weapons;
  missiles: Missiles;
  capitals: Capitals;
  turrets: ShipTurrets | null;
  bumps: FighterCollisions;
  traffic: Traffic | null;
  player: ShipEntity;
  wing: ShipEntity[];
  lock: LockState;
  /** Per-scenario upkeep each tick (respawns, waves). */
  upkeep: (tick: number) => void;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).add(ORIGIN);

function baseWorld(seed: number): Omit<World, 'player' | 'wing' | 'upkeep' | 'traffic' | 'turrets'> {
  const fleet = new Fleet(new Group(), seed);
  const weapons = new Weapons(fleet);
  const missiles = new Missiles(fleet);
  const capitals = new Capitals(fleet, weapons);
  return { fleet, weapons, missiles, capitals, bumps: new FighterCollisions(), lock: { target: null, progress: 0, locked: false } };
}

function revive(s: ShipEntity, pos: Vector3, facing: Vector3, speed: number): void {
  const f = s.flight;
  f.position.copy(pos);
  f.velocity.copy(facing).normalize().multiplyScalar(speed);
  f.orientation.setFromUnitVectors(new Vector3(0, 0, 1), facing.clone().normalize());
  f.bodyRates.set(0, 0, 0);
  s.alive = true;
  s.hull = s.hullMax;
  s.shield = s.shieldMax;
  s.model.root.visible = true;
}

/** Player + two wingmen, the player's controls come from outside. */
function spawnFlight(w: ReturnType<typeof baseWorld>, at: Vector3, fwd: Vector3): { player: ShipEntity; wing: ShipEntity[] } {
  const player = w.fleet.spawn('vf27-kestrel', 'concord', at, fwd, { isPlayer: true, name: 'Vanguard 1' });
  player.controls = emptyControls();
  const wing = [new Vector3(-46, -7, -34), new Vector3(52, 6, -50)].map((o, i) => w.fleet.spawn('vf27-kestrel', 'concord', at.clone().add(o), fwd, { name: `Vanguard ${i + 2}` }));
  setFormation(wing, 'fingerFour', 40);
  issueOrder(wing, 'formUp', player);
  return { player, wing };
}

function dogfightWorld(seed: number): World {
  const w = baseWorld(seed);
  const fwd = new Vector3(0, 0, 1);
  const cathedral = w.fleet.spawn('choir-cathedral', 'choir', v(1400, -200, 2600), new Vector3(1, 0, 0.3), { name: 'Cathedral' });
  cathedral.flight.throttle = 0;
  cathedral.flight.velocity.set(0, 0, 0);
  const { player, wing } = spawnFlight(w, v(0, 0, 0), fwd);
  const waves: ShipEntity[] = [];
  let dead = 0;
  let wave = 0;
  const spawnWave = () => {
    wave++;
    const a = wave * 2.39;
    const c = player.flight.position.clone().add(new Vector3(Math.cos(a) * 2800, Math.sin(a * 1.3) * 400, Math.sin(a) * 2800));
    const to = player.flight.position.clone().sub(c).normalize();
    const n = 3 + (wave % 2);
    for (let i = 0; i < n; i++) {
      const pos = c.clone().add(new Vector3((i - 1) * 60, i * 12, -i * 40));
      const reuse = waves.find((s) => !s.alive);
      if (reuse) {
        revive(reuse, pos, to, 180);
        reuse.target = null;
      } else waves.push(w.fleet.spawn('choir-cantor', 'choir', pos, to, { name: `Cantor ${waves.length + 1}` }));
    }
  };
  spawnWave();
  return {
    ...w,
    turrets: null,
    traffic: null,
    player,
    wing,
    upkeep: (tick) => {
      if (!waves.some((s) => s.alive)) spawnWave();
      if (tick % 1800 === 900) issueOrder(wing, wave % 2 ? 'engageAtWill' : 'coverMe', player);
      for (const s of [player, ...wing]) {
        if (s.alive) continue;
        if (++dead % 240 === 0) revive(s, player.alive ? player.flight.position.clone().add(new Vector3(0, 200, -600)) : v(0, 0, 0), fwd, 150);
      }
    },
  };
}

function capitalWorld(seed: number): World {
  const w = baseWorld(seed);
  const turrets = new ShipTurrets(w.fleet, w.weapons, w.capitals);
  const fwd = new Vector3(0, 0, 1);
  const carrier = w.fleet.spawn('cvs07-hesperus-dawn', 'concord', v(-1800, -300, -1200), fwd, { name: 'Hesperus Dawn' });
  w.capitals.register(carrier, { launchBlueprint: 'vf27-kestrel', maxFighters: 3 });
  const cathedral = w.fleet.spawn('choir-cathedral', 'choir', v(900, 600, 7200), new Vector3(-0.3, 0, -1), { name: 'Cathedral Ascendant' });
  w.capitals.register(cathedral, { launchBlueprint: 'choir-cantor', maxFighters: 4 });
  const { player, wing } = spawnFlight(w, v(0, 0, 0), fwd);
  issueOrder(wing, 'engageAtWill', player);
  let dead = 0;
  return {
    ...w,
    turrets,
    traffic: null,
    player,
    wing,
    upkeep: (tick) => {
      if (tick % 3600 === 1800) issueOrder(wing, 'attackMyTarget', player);
      // Whoever sinks, a fresh hull warps in: the battle never ends inside the test.
      for (const cap of [carrier, cathedral]) {
        if (cap.alive) continue;
        if (++dead % 600 === 0) revive(cap, cap === carrier ? v(-1800, -300, -1200) : v(900, 600, 7200), cap === carrier ? fwd : new Vector3(-0.3, 0, -1), 10);
      }
      if (!player.alive && tick % 300 === 0) revive(player, carrier.flight.position.clone().add(new Vector3(0, 400, 900)), fwd, 150);
    },
  };
}

function trafficWorld(seed: number): World {
  const w = baseWorld(seed);
  const uni = generateUniverse(1994);
  // A lawless system (raiders on the lanes), stations and gates to sail between.
  const sys = [...uni.systems.values()].filter((s) => piracy(s) > 0 && s.stations.length > 0 && s.gates.length > 1).sort((a, b) => piracy(b) - piracy(a))[0];
  const traffic = new Traffic(w.fleet, null, (id) => id in BLUEPRINTS, uni.seed);
  // The traffic system reads only the system data and the stations' bay frames from its view.
  const stations = sys.stations.map((site) => {
    const center = site.position.clone().add(SYSTEM_OFFSET);
    const axis = site.axis.clone().normalize();
    return { site, center, axis, bay: center.clone().addScaledVector(axis, BAY_OFFSET) };
  });
  traffic.setSystem({ system: sys, stations } as unknown as StarSystemView);
  traffic.clock = 86_400;
  const fwd = new Vector3(0, 0, 1);
  const { player, wing } = spawnFlight(w, v(0, 0, 0), fwd);
  traffic.stageArrival(player, sys.gates[0].to);
  for (const [i, s] of wing.entries()) s.flight.position.copy(player.flight.position).add(new Vector3(i ? 52 : -46, i ? 6 : -7, i ? -50 : -34));
  traffic.stageAmbush(player);
  issueOrder(wing, 'engageAtWill', player);
  return {
    ...w,
    turrets: null,
    traffic,
    player,
    wing,
    upkeep: (tick) => {
      if (tick % 7200 === 3600) traffic.stageAmbush(player);
      if (!player.alive && tick % 300 === 0) revive(player, player.flight.position.clone().add(new Vector3(0, 800, 0)), fwd, 150);
    },
  };
}

const WORLDS: Record<ScenarioName, (seed: number) => World> = { dogfight: dogfightWorld, capital: capitalWorld, traffic: trafficWorld };

// ── one tick (FlightScene order) ─────────────────────────────────────────

function cycleTarget(w: World): void {
  const enemies = w.fleet.enemiesOf(w.player);
  if (!enemies.length) {
    w.lock.target = null;
    return;
  }
  const i = w.lock.target ? enemies.indexOf(w.lock.target) : -1;
  w.lock.target = enemies[(i + 1) % enemies.length];
  w.lock.progress = 0;
  w.lock.locked = false;
}

function applyCommand(w: World, cmd: ReplayCommand): void {
  if (cmd.c === 'wing') issueOrder(w.wing, cmd.a as 'formUp' | 'attackMyTarget' | 'engageAtWill' | 'coverMe', w.player);
}

function tick(w: World, i: number): void {
  const t = i * DT;
  const c = w.player.controls;
  w.player.target = w.lock.target;
  if (w.traffic) w.traffic.update(DT, w.player, w.weapons.events);
  updateAI(w.fleet, DT, t);
  w.capitals.step(DT);
  w.turrets?.step(DT, w.lock.target);
  w.fleet.step(DT);
  w.bumps.step(w.fleet.ships, DT, (s, d) => w.fleet.damage(s, d));
  if (w.player.alive) {
    if (c.nextTarget || !w.lock.target?.alive) cycleTarget(w);
    Missiles.updateLock(w.lock, w.player, DT);
    if (c.missile && w.lock.locked && w.lock.target) w.missiles.salvo(w.player, w.lock.target);
  }
  w.weapons.step(DT);
  w.missiles.step(DT);
  w.upkeep(i);
}

// ── runs ─────────────────────────────────────────────────────────────────

export interface RunResult {
  scenario: ScenarioName;
  seed: number;
  ticks: number;
  /** World hash after every simulated second. */
  hashes: number[];
  take: ReplayTake | null;
  ms: number;
  stats: { ships: number; kills: number; shots: number; missiles: number };
}

export interface RunOptions {
  seconds: number;
  /** Record the player's input (and commands) into a replay take. */
  record?: boolean;
  /** Fly the player from a recorded replay instead of the script. */
  replay?: ReplayFile;
}

export function runScenario(scenario: ScenarioName, seed: number, o: RunOptions): RunResult {
  const t0 = performance.now();
  const w = WORLDS[scenario](seed);
  const pilot = new ScriptedPilot(seed);
  const cursor = o.replay ? new ReplayCursor(o.replay) : null;
  const take = o.record
    ? new ReplayTake({ v: REPLAY_VERSION, game: 'vanguard', hz: REPLAY_HZ, seed, scene: `headless:${scenario}`, boot: '', storage: {}, created: '1970-01-01T00:00:00.000Z' })
    : null;
  const H = new StateHasher();
  const hashes: number[] = [];
  const due: ReplayCommand[] = [];
  const scratch = emptyControls();
  const stats = { ships: 0, kills: 0, shots: 0, missiles: 0 };
  const ticks = Math.round(o.seconds * REPLAY_HZ);
  for (let i = 0; i < ticks; i++) {
    // Commands first (a wing order every 2.5 min from the script; replays carry them).
    if (cursor) for (const cmd of cursor.due(due)) applyCommand(w, cmd);
    else if (i > 0 && i % 9000 === 4500) {
      const order = (['engageAtWill', 'coverMe', 'attackMyTarget', 'formUp'] as const)[(i / 9000) % 4 | 0];
      take?.command('wing', order);
      applyCommand(w, { t: i, c: 'wing', a: order });
    }
    // The player's controls for this tick: the script, or the recorded stream.
    if (cursor) cursor.next(w.player.controls);
    else copyControls(pilot.next(i, scratch), w.player.controls);
    take?.input.push(w.player.controls);
    tick(w, i);
    for (const e of w.weapons.events) {
      if (e.kind === 'kill') stats.kills++;
      else if (e.kind === 'fire') stats.shots++;
    }
    for (const e of w.missiles.events) if (e.kind === 'launch') stats.missiles++;
    if ((i + 1) % REPLAY_HZ === 0) {
      const h = hashWorld(w.fleet, w.weapons, w.missiles, H);
      hashes.push(h);
      take?.checks.push([i + 1, h]);
    }
  }
  stats.ships = w.fleet.ships.length;
  return { scenario, seed, ticks, hashes, take, ms: performance.now() - t0, stats };
}

export interface DeterminismReport {
  scenario: ScenarioName;
  minutes: number;
  checkpoints: number;
  sameSeed: { matched: number; firstMismatch: number };
  replay: { matched: number; firstMismatch: number; bytes: number; kbPerMin: number; commands: number };
  otherSeedDiffers: boolean;
  final: string;
  msPerRun: number;
  stats: RunResult['stats'];
  pass: boolean;
}

function compare(a: number[], b: number[]): { matched: number; firstMismatch: number } {
  let matched = 0;
  let firstMismatch = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) matched++;
    else if (firstMismatch < 0) firstMismatch = i + 1;
  }
  return { matched, firstMismatch };
}

/** The full MP-0 check for one scenario. */
export function checkScenario(scenario: ScenarioName, minutes: number, seed = 7): DeterminismReport {
  const seconds = minutes * 60;
  const A = runScenario(scenario, seed, { seconds, record: true });
  const B = runScenario(scenario, seed, { seconds });
  const file = parseReplay(JSON.stringify(A.take!.file()));
  const C = runScenario(scenario, seed, { seconds, replay: file });
  const D = runScenario(scenario, seed + 1, { seconds: Math.min(seconds, 30) });
  const same = compare(A.hashes, B.hashes);
  const rep = compare(A.hashes, C.hashes);
  const otherSeedDiffers = D.hashes[D.hashes.length - 1] !== A.hashes[D.hashes.length - 1];
  const bytes = file.input.length; // base64 in the file
  return {
    scenario,
    minutes,
    checkpoints: A.hashes.length,
    sameSeed: same,
    replay: { ...rep, bytes, kbPerMin: +(bytes / 1024 / minutes).toFixed(2), commands: file.commands.length },
    otherSeedDiffers,
    final: hex(A.hashes[A.hashes.length - 1] ?? 0),
    msPerRun: Math.round((A.ms + B.ms + C.ms) / 3),
    stats: A.stats,
    pass: same.firstMismatch < 0 && rep.firstMismatch < 0 && otherSeedDiffers && A.hashes.length === seconds,
  };
}
