import { Group, Vector3 } from 'three';
import type { ControlState } from '@/core/Input';
import { Fleet, type ShipEntity } from '../Fleet';
import { DebugGuns } from './DebugGuns';
import { capitalCapsule, closestOnSegment, type Obstacle } from './Avoid';
import { slotWorld, issueOrder, setFormation } from './Squadron';
import { brainOf, PERSONALITIES, setPersonality, type FormationKind } from './state';
import { setAutopilot, updateAI } from './index';
import { createTurretSolution, turretAim, turretSelectTarget, TURRET_DEFAULTS, type TurretMount } from './Turret';
import { stationAvoidScenario, wingDockScenario } from './stationSim';
import { Weapons } from '../Weapons';
import { Missiles } from '../Missiles';
import { FighterCollisions } from '../FighterCollisions';
import { segmentSphere } from '../Combat';

/**
 * Headless AI scenarios (no renderer): FlightModel + AI at a fixed 60 Hz
 * step, with measurable pass/fail outcomes. Dogfights fly the real weapons
 * (Weapons + Missiles: faction guns, damage types, AI missile swarms) and
 * fighter–fighter collisions; the small behaviour tests keep the stand-in
 * DebugGuns (one flat laser) so they measure piloting, not loadouts.
 * Run with `node scripts/ai-sim.mjs` (loads this through Vite's SSR loader).
 */

const DT = 1 / 60;
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000); // far from 0, like the game

export interface Check {
  name: string;
  value: number;
  pass: boolean;
  rule: string;
  /** Informational only: reported, never fails the run. */
  info?: boolean;
}

export interface ScenarioResult {
  name: string;
  metrics: Record<string, number | string>;
  checks: Check[];
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).add(ORIGIN);
const FWD = new Vector3(0, 0, 1);
const BACK = new Vector3(0, 0, -1);

function check(name: string, value: number, rule: string, pass: boolean): Check {
  return { name, value: Math.round(value * 100) / 100, rule, pass };
}
function info(name: string, value: number, note: string): Check {
  return { name, value: Math.round(value * 100) / 100, rule: note, pass: true, info: true };
}

/**
 * Scripted leader (the "player"). `hard` = 1 is a stress profile: combined
 * nose rates up to ~0.58 rad/s, which at cruise needs ~90 m/s² of lateral
 * thrust — more than any ship has (70), so even the leader slides. The
 * standard profile (hard = 0.5) is brisk cruising with ±140° rolls.
 */
function scriptedLeader(c: ControlState, t: number, sprint: boolean, hard = 0.5): void {
  c.pitch = Math.sin(t * 0.35) * 0.22 * hard;
  c.yaw = Math.sin(t * 0.23 + 1) * 0.28 * hard;
  c.roll = Math.sin(t * 0.5) * 0.35;
  c.throttleDelta = 0;
  c.throttleSet = 0.72;
  c.afterburner = sprint && t % 20 > 12 && t % 20 < 14;
  c.fire = false;
  c.flightAssistToggle = false;
}

// ── A: formation keeping ────────────────────────────────────────────────
export function formationScenario(kind: FormationKind, seconds = 45, sprint = false, hard = 0.5): ScenarioResult {
  const fleet = new Fleet(new Group());
  const lead = fleet.spawn('vf27-kestrel', 'concord', v(0, 0, 0), FWD, { isPlayer: true });
  const starts = [v(-260, 80, -420), v(300, -120, -300), v(120, 200, 150)];
  const wing = starts.map((p) => fleet.spawn('vf27-kestrel', 'concord', p, FWD));
  setFormation(wing, kind, 40);
  issueOrder(wing, 'formUp', lead);

  const bumps = new FighterCollisions();
  const settle = 15;
  let sum = 0;
  let n = 0;
  let max = 0;
  let converged = -1;
  let collisions = 0;
  const slot = new Vector3();
  for (let i = 0, steps = Math.round(seconds / DT); i < steps; i++) {
    const t = i * DT;
    scriptedLeader(lead.controls, t, sprint, hard);
    updateAI(fleet, DT, t);
    fleet.step(DT);
    bumps.step(fleet.ships, DT, (sh, d) => fleet.damage(sh, d));
    let worst = 0;
    for (const w of wing) {
      const e = slotWorld(brainOf(w), lead, slot).distanceTo(w.flight.position);
      worst = Math.max(worst, e);
      if (t >= settle) {
        sum += e;
        n++;
      }
    }
    if (t >= settle) max = Math.max(max, worst);
    if (converged < 0 && worst < 10) converged = t;
    collisions += countContacts(fleet.ships);
  }
  const mean = sum / Math.max(1, n);
  return {
    name: `formation ${kind}${sprint ? ' + leader burner sprints (stress)' : ''}${hard > 0.5 ? ' (stress: leader beyond thrust limits)' : ''}`,
    metrics: { meanSlotErr: mean.toFixed(2), maxSlotErr: max.toFixed(2), firstAllWithin10m: converged.toFixed(2), friendlyContacts: bumps.friendlyContacts },
    checks: [
      ...(sprint || hard > 0.5
        ? [info('mean slot error after 15 s (m)', mean, 'stress profile, informational')]
        : [
            check('mean slot error after 15 s (m)', mean, '< 10', mean < 10),
            check('converged (all < 10 m) by (s)', converged, '>= 0 && < 20', converged >= 0 && converged < 20),
          ]),
      check('collisions', collisions, '== 0', collisions === 0),
      check('friendly contacts (collision world)', bumps.friendlyContacts, '== 0', bumps.friendlyContacts === 0),
    ],
  };
}

// ── B: 4v4 dogfight around a capital ship ───────────────────────────────

/**
 * Real arms for a headless fight: faction guns (Weapons), AI missile swarms
 * (Missiles) and fighter–fighter collisions, with the counters the checks
 * read. Friendly fire can't happen in Weapons (bolts skip their own team),
 * so trigger discipline is measured as bolts that WOULD have hit a wingmate.
 */
class Arms {
  readonly weapons: Weapons;
  readonly missiles: Missiles;
  readonly bumps = new FighterCollisions();
  shots = 0;
  hits = 0;
  kills = 0;
  friendlyLine = 0;
  missileHits = 0;
  private flagged = new Float32Array(4096);
  private a = new Vector3();
  private d = new Vector3();

  constructor(private fleet: Fleet) {
    this.weapons = new Weapons(fleet);
    this.missiles = new Missiles(fleet);
    fleet.ordnance = this.missiles;
  }

  step(dt: number): void {
    const w = this.weapons;
    this.bumps.step(this.fleet.ships, dt, (s, d) => this.fleet.damage(s, d));
    w.step(dt);
    this.missiles.step(dt);
    for (const e of w.events) {
      if (e.kind === 'fire' && e.gun && !e.gun.beam) this.shots += e.gun.pellets;
      else if ((e.kind === 'hit' || e.kind === 'shield') && e.gun && !e.gun.beam) this.hits++;
      else if (e.kind === 'kill') this.kills++;
    }
    for (const e of this.missiles.events) if (e.kind === 'detonate' && !e.intercepted) this.missileHits++;
    // Would-be friendly hits: live bolts whose next step passes through a wingmate.
    const ships = this.fleet.ships;
    for (let i = 0; i < w.life.length; i++) {
      const life = w.life[i];
      if (life <= 0) continue;
      if (this.flagged[i] > 0 && life <= this.flagged[i]) continue; // already counted this bolt
      this.flagged[i] = 0;
      this.a.set(w.px[i], w.py[i], w.pz[i]);
      this.d.set(w.vx[i] * dt, w.vy[i] * dt, w.vz[i] * dt);
      for (const s of ships) {
        if (!s.alive || s.id === w.owner[i] || s.radius > 60) continue;
        const owner = ships.find((o) => o.id === w.owner[i]);
        if (!owner || owner.team !== s.team) continue;
        if (segmentSphere(this.a, this.d, s.flight.position, s.radius) <= 1) {
          this.friendlyLine++;
          this.flagged[i] = life;
          break;
        }
      }
    }
  }
}

interface DogfightRun {
  aliveC: number;
  aliveB: number;
  seconds: number;
  arms: Arms;
  contactT: number;
  collisions: number;
  capitalIntrusions: number;
  minSep: number;
  avgDist: number;
  hist: Record<string, number>;
}

/**
 * Four Kestrels (an ace lead on autopilot + three veterans) against four
 * Cantors (Choir zealots), merging head-on beside a parked Cathedral.
 * `stopOnWipe` ends the run when one side is gone (balance sweeps).
 */
function flyDogfight(seed: number, seconds: number, stopOnWipe: boolean): DogfightRun {
  const fleet = new Fleet(new Group(), seed); // world seed: AI, gun spread, missile dice
  const arms = new Arms(fleet);
  const jit = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 120;

  // A Choir Cathedral parked just off the merge point (an obstacle: its turrets are not registered).
  const cathedral = fleet.spawn('choir-cathedral', 'choir', v(1400 + jit(9), -200, 2200), new Vector3(1, 0, 0.3));
  cathedral.flight.throttle = 0;
  cathedral.flight.velocity.set(0, 0, 0);

  const lead = fleet.spawn('vf27-kestrel', 'concord', v(jit(1), 0, 0), FWD, { isPlayer: true });
  setAutopilot(lead, true);
  setPersonality(lead, PERSONALITIES.ace);
  const wing = [v(-40, 0, -32), v(40, 4, -32), v(80, 0, -64)].map((p, i) => {
    const s = fleet.spawn('vf27-kestrel', 'concord', p.add(new Vector3(jit(2 + i) * 0.1, 0, 0)), FWD);
    setPersonality(s, PERSONALITIES.veteran);
    return s;
  });
  setFormation(wing, 'fingerFour', 40);
  issueOrder(wing, 'formUp', lead);

  const bLead = fleet.spawn('choir-cantor', 'choir', v(jit(3), 150, 4200), BACK);
  const bWing = [v(-40, 150, 4232), v(40, 154, 4232), v(80, 150, 4264)].map((p) => fleet.spawn('choir-cantor', 'choir', p, BACK));
  setFormation(bWing, 'fingerFour', 40);
  issueOrder(bWing, 'formUp', bLead);
  const sideC = [lead, ...wing];
  const sideB = [bLead, ...bWing];

  let engaged = false;
  let collisions = 0;
  let capitalIntrusions = 0;
  let minSep = Infinity;
  let distSum = 0;
  let distN = 0;
  let contactT = -1;
  const inside = new Set<number>();
  const cp = new Vector3();
  const fighters = fleet.ships.filter((s) => s !== cathedral);
  const hist: Record<string, number> = {};
  contacts.clear();

  let t = 0;
  for (let i = 0, steps = Math.round(seconds / DT); i < steps; i++) {
    t = i * DT;
    // Merge: both flights break and attack once in visual range.
    if (!engaged && lead.flight.position.distanceTo(bLead.flight.position) < 2600) {
      engaged = true;
      contactT = t;
      issueOrder(wing, 'breakAndAttack', lead);
      issueOrder(bWing, 'breakAndAttack', bLead);
    }
    updateAI(fleet, DT, t);
    fleet.step(DT);
    arms.step(DT);
    if (stopOnWipe) {
      if (!sideC.some((s) => s.alive) || !sideB.some((s) => s.alive)) break;
      continue;
    }

    collisions += countContacts(fighters);
    const cap = capitalCapsule(cathedral);
    for (const s of fighters) {
      if (!s.alive) continue;
      closestOnSegment(cap.a, cap.b, s.flight.position, cp);
      const d = cp.distanceTo(s.flight.position);
      if (d < cap.radius + s.radius) {
        if (!inside.has(s.id)) capitalIntrusions++;
        inside.add(s.id);
      } else inside.delete(s.id);
      if (engaged) {
        const m = brainOf(s).maneuver;
        hist[m] = (hist[m] ?? 0) + DT;
      }
      if (engaged && s.target && s.target.alive) {
        distSum += s.flight.position.distanceTo(s.target.flight.position);
        distN++;
      }
    }
    for (let a = 0; a < fighters.length; a++)
      for (let b = a + 1; b < fighters.length; b++) {
        const A = fighters[a];
        const B = fighters[b];
        if (A.alive && B.alive) minSep = Math.min(minSep, A.flight.position.distanceTo(B.flight.position) - A.radius - B.radius);
      }
  }
  return {
    aliveC: sideC.filter((s) => s.alive).length,
    aliveB: sideB.filter((s) => s.alive).length,
    seconds: t,
    arms,
    contactT,
    collisions,
    capitalIntrusions,
    minSep,
    avgDist: distSum / Math.max(1, distN),
    hist,
  };
}

export function dogfightScenario(seed: number, seconds = 120): ScenarioResult {
  const r = flyDogfight(seed, seconds, false);
  const a = r.arms;
  const hitRate = a.hits / Math.max(1, a.shots);
  const hist = r.hist;
  return {
    name: `4v4 dogfight seed ${seed} (real weapons + missiles)`,
    metrics: {
      contactAt: r.contactT.toFixed(1),
      shots: a.shots,
      hits: a.hits,
      hitRate: `${(hitRate * 100).toFixed(1)}%`,
      friendlyLine: a.friendlyLine,
      missileHits: a.missileHits,
      kills: a.kills,
      survivors: `concord ${r.aliveC}/4 · choir ${r.aliveB}/4`,
      avgDistToTarget: r.avgDist.toFixed(0),
      minSeparation: r.minSep.toFixed(1),
      maneuverSeconds: Object.entries(hist)
        .sort((x, y) => y[1] - x[1])
        .map(([k, s]) => `${k}:${s.toFixed(0)}`)
        .join(' '),
    },
    checks: [
      check('collisions (fighter-fighter)', r.collisions, '== 0', r.collisions === 0),
      check('friendly contacts (collision world)', a.bumps.friendlyContacts, '== 0', a.bumps.friendlyContacts === 0),
      check('capital hull intrusions', r.capitalIntrusions, '== 0', r.capitalIntrusions === 0),
      check('shots fired', a.shots, '>= 200', a.shots >= 200),
      check('hit rate (%)', hitRate * 100, '5..40', hitRate >= 0.05 && hitRate <= 0.4),
      check('distinct maneuvers used', Object.keys(hist).length, '>= 7', Object.keys(hist).length >= 7),
      check('bolts through a wingmate (would-be friendly hits)', a.friendlyLine, '<= 2% of hits', a.friendlyLine <= Math.max(1, a.hits * 0.02)),
      check('avg distance to target (m)', r.avgDist, '< 1200', r.avgDist < 1200),
      check('kills', a.kills, '>= 1', a.kills >= 1),
    ],
  };
}

/**
 * Evenly matched 4v4s across many seeds: the side that wins (more survivors
 * when one side is wiped out or the clock runs out) must not win more than
 * 75 % of the decided fights. Each fight stops at the wipe.
 *
 * 96 seeds: each seed is now a whole world (AI, gun spread and missile dice
 * all fork from it — src/sim/Rng.ts), and 24 fights carried ±9 % of pure
 * sampling noise around a ~70 % Concord share (24 seeds read 58 % on the
 * old fixed dice, 83 % on the seeded ones; 96 read 72 %). ±4.6 % now.
 */
export function dogfightBalanceScenario(seeds = 96, seconds = 120): ScenarioResult {
  let winC = 0;
  let winB = 0;
  let draws = 0;
  const per: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const r = flyDogfight(seed, seconds, true);
    if (r.aliveC > r.aliveB) winC++;
    else if (r.aliveB > r.aliveC) winB++;
    else draws++;
    per.push(`${r.aliveC}-${r.aliveB}`);
  }
  const decided = Math.max(1, winC + winB);
  const shareC = winC / decided;
  return {
    name: `4v4 balance sweep (${seeds} seeds, Kestrels vs Cantors)`,
    metrics: { concordWins: winC, choirWins: winB, draws, concordShare: `${(shareC * 100).toFixed(0)}%`, survivorsBySeed: per.join(' ') },
    checks: [
      check('Concord share of decided fights (%)', shareC * 100, '25..75', shareC >= 0.25 && shareC <= 0.75),
      info('draws (both sides left standing)', draws, 'informational'),
    ],
  };
}

// ── C: coverMe — wingman clears a bandit off the leader's tail ───────────
export function coverMeScenario(seconds = 40): ScenarioResult {
  const fleet = new Fleet(new Group());
  const guns = new DebugGuns();
  const lead = fleet.spawn('vf27-kestrel', 'concord', v(0, 0, 0), FWD, { isPlayer: true });
  const wingman = fleet.spawn('vf27-kestrel', 'concord', v(-40, 0, -32), FWD);
  setPersonality(wingman, PERSONALITIES.veteran);
  setFormation([wingman], 'fingerFour', 40);
  issueOrder([wingman], 'coverMe', lead);
  const bandit = fleet.spawn('choir-cantor', 'choir', v(60, 30, -900), FWD);
  bandit.target = lead;
  brainOf(bandit).order = 'engageAtWill';

  let acquiredAt = -1;
  let tailTime = 0;
  let wingHits = 0;
  guns.onHit = (target, shooter) => {
    if (shooter === wingman && target === bandit) wingHits++;
  };
  const rel = new Vector3();
  const fwd = new Vector3();
  for (let i = 0, steps = Math.round(seconds / DT); i < steps; i++) {
    const t = i * DT;
    scriptedLeader(lead.controls, t, false);
    updateAI(fleet, DT, t);
    fleet.step(DT);
    guns.step(fleet, DT);
    if (acquiredAt < 0 && wingman.target === bandit) acquiredAt = t;
    if (bandit.alive && acquiredAt >= 0) {
      rel.subVectors(lead.flight.position, bandit.flight.position);
      const d = rel.length();
      const onTail = d < 900 && bandit.flight.forward(fwd).dot(rel.divideScalar(d)) > 0.9;
      if (onTail && t > seconds * 0.5) tailTime += DT;
    }
  }
  return {
    name: 'coverMe',
    metrics: { acquiredAt: acquiredAt.toFixed(2), wingmanHitsOnBandit: wingHits, banditAlive: String(bandit.alive), banditOnTailLateHalf: tailTime.toFixed(1) },
    checks: [
      check('wingman targets the chaser within (s)', acquiredAt, '>= 0 && < 1.5', acquiredAt >= 0 && acquiredAt < 1.5),
      check('wingman hits on chaser', wingHits, '>= 5', wingHits >= 5),
      check('chaser on leader tail in 2nd half (s)', tailTime, '< 5', tailTime < 5),
    ],
  };
}

// ── D: head-on joust — fire, pass, no collision ─────────────────────────
export function headOnScenario(seconds = 30): ScenarioResult {
  const fleet = new Fleet(new Group());
  const guns = new DebugGuns();
  const a = fleet.spawn('vf27-kestrel', 'concord', v(0, 0, 0), FWD);
  const b = fleet.spawn('choir-cantor', 'choir', v(0, 5, 3000), BACK);
  setPersonality(a, PERSONALITIES.ace);
  let collisions = 0;
  let minSep = Infinity;
  let headOnSeen = 0;
  for (let i = 0, steps = Math.round(seconds / DT); i < steps; i++) {
    const t = i * DT;
    updateAI(fleet, DT, t);
    fleet.step(DT);
    guns.step(fleet, DT);
    if (brainOf(a).maneuver === 'headOn' || brainOf(b).maneuver === 'headOn') headOnSeen = 1;
    collisions += countContacts(fleet.ships);
    if (a.alive && b.alive) minSep = Math.min(minSep, a.flight.position.distanceTo(b.flight.position) - a.radius - b.radius);
  }
  return {
    name: 'head-on joust',
    metrics: { shots: guns.shots, hits: guns.hits, minSeparation: minSep.toFixed(1) },
    checks: [
      check('entered headOn maneuver', headOnSeen, '== 1', headOnSeen === 1),
      check('collisions', collisions, '== 0', collisions === 0),
      check('shots fired', guns.shots, '>= 20', guns.shots >= 20),
    ],
  };
}

// ── E: capital avoidance — chase straight across a dreadnought ──────────
export function capitalScenario(seconds = 40): ScenarioResult {
  const fleet = new Fleet(new Group());
  const cathedral = fleet.spawn('choir-cathedral', 'choir', v(0, 0, 3000), new Vector3(1, 0, 0));
  cathedral.flight.throttle = 0;
  cathedral.flight.velocity.set(0, 0, 0);
  // A bandit on the far side and fighters pointed straight at the hull.
  const bandit = fleet.spawn('choir-cantor', 'choir', v(0, 0, 6500), FWD);
  bandit.flight.throttle = 0.5;
  const hunters = [v(0, 0, 0), v(200, 300, 200), v(-300, -100, 400)].map((p) => fleet.spawn('vf27-kestrel', 'concord', p, FWD));
  const obstacles: Obstacle[] = [];
  let intrusions = 0;
  const inside = new Set<number>();
  const cp = new Vector3();
  for (let i = 0, steps = Math.round(seconds / DT); i < steps; i++) {
    const t = i * DT;
    updateAI(fleet, DT, t, obstacles);
    // Bandit flies straight away (it's bait).
    bandit.controls.pitch = bandit.controls.yaw = bandit.controls.roll = 0;
    bandit.controls.fire = false;
    fleet.step(DT);
    const cap = capitalCapsule(cathedral);
    for (const s of hunters) {
      closestOnSegment(cap.a, cap.b, s.flight.position, cp);
      if (cp.distanceTo(s.flight.position) < cap.radius + s.radius) {
        if (!inside.has(s.id)) intrusions++;
        inside.add(s.id);
      } else inside.delete(s.id);
    }
  }
  return {
    name: 'capital-ship avoidance',
    metrics: { intrusions },
    checks: [check('capital hull intrusions', intrusions, '== 0', intrusions === 0)],
  };
}

// ── F: defensive — break / jink / reversal vs. a bandit on your six ──────
function sixRun(evade: boolean, seconds: number): { hits: number; used: Set<string> } {
  const fleet = new Fleet(new Group());
  const guns = new DebugGuns(512, 8, 0.001); // near-zero damage: count hits, nobody dies
  const defender = fleet.spawn('vf27-kestrel', 'concord', v(0, 0, 0), FWD, { isPlayer: !evade });
  const bandit = fleet.spawn('choir-cantor', 'choir', v(30, 20, -450), FWD);
  setPersonality(bandit, PERSONALITIES.ace);
  setPersonality(defender, PERSONALITIES.veteran);
  bandit.target = defender;
  let hits = 0;
  guns.onHit = (t) => {
    if (t === defender) hits++;
  };
  const used = new Set<string>();
  for (let i = 0, steps = Math.round(seconds / DT); i < steps; i++) {
    const t = i * DT;
    if (!evade) scriptedLeader(defender.controls, t, false);
    updateAI(fleet, DT, t);
    if (evade) used.add(brainOf(defender).maneuver);
    fleet.step(DT);
    guns.step(fleet, DT);
  }
  return { hits, used };
}

export function defensiveScenario(seconds = 25): ScenarioResult {
  const base = sixRun(false, seconds);
  const ai = sixRun(true, seconds);
  const defensive = ['break', 'jink', 'barrelRoll', 'splitS', 'immelmann'].filter((m) => ai.used.has(m));
  return {
    name: 'defensive (bandit on your six)',
    metrics: { hitsTakenNoEvasion: base.hits, hitsTakenWithAI: ai.hits, maneuvers: [...ai.used].join(' ') },
    checks: [
      check('hits taken vs. non-evading baseline', ai.hits / Math.max(1, base.hits), '< 0.6', ai.hits < base.hits * 0.6),
      check('defensive maneuvers used', defensive.length, '>= 2', defensive.length >= 2),
    ],
  };
}

// ── G: turret solver — lead accuracy and arc limits ──────────────────────
export function turretScenario(): ScenarioResult {
  const fleet = new Fleet(new Group());
  const targets = [
    fleet.spawn('vf27-kestrel', 'concord', v(600, 300, 900), new Vector3(1, 0, 0)),
    fleet.spawn('vf27-kestrel', 'concord', v(-900, 200, 400), new Vector3(0, 0.3, 1)),
    fleet.spawn('vf27-kestrel', 'concord', v(100, -800, -200), new Vector3(-1, 0, 0)), // below the mount plane
  ];
  targets[0].flight.velocity.set(220, 0, 0);
  targets[1].flight.velocity.set(0, 60, 200);
  const mount: TurretMount = {
    position: v(0, 0, 0),
    forward: new Vector3(0, 0, 1),
    up: new Vector3(0, 1, 0),
    velocity: new Vector3(0, 0, 40), // the carrier is moving
    ...TURRET_DEFAULTS,
  };
  const sol = createTurretSolution();
  let worstMiss = 0;
  for (const t of targets.slice(0, 2)) {
    if (!turretAim(mount, t, sol)) {
      worstMiss = Infinity;
      continue;
    }
    // Fly the bolt and the target forward by the solved time of flight.
    const boltV = sol.aimDir.clone().multiplyScalar(mount.boltSpeed).add(mount.velocity);
    const bolt = mount.position.clone().addScaledVector(boltV, sol.time);
    const tp = t.flight.position.clone().addScaledVector(t.flight.velocity, sol.time);
    worstMiss = Math.max(worstMiss, bolt.distanceTo(tp));
  }
  const belowRejected = !turretAim(mount, targets[2], sol);
  const picked = turretSelectTarget(mount, 'choir', fleet.ships, null, sol);
  return {
    name: 'turret targeting',
    metrics: { worstLeadMiss: worstMiss.toFixed(3), picked: picked ? (sol.target?.name ?? '-') : 'none' },
    checks: [
      check('lead solution miss distance (m)', worstMiss, '< 0.5', worstMiss < 0.5),
      check('target below elevation limit rejected', belowRejected ? 1 : 0, '== 1', belowRejected),
      check('selects an in-arc target', picked && sol.target !== targets[2] ? 1 : 0, '== 1', picked && sol.target !== targets[2]),
    ],
  };
}

function countContacts(ships: readonly ShipEntity[]): number {
  let n = 0;
  for (let a = 0; a < ships.length; a++)
    for (let b = a + 1; b < ships.length; b++) {
      const A = ships[a];
      const B = ships[b];
      if (!A.alive || !B.alive || A.radius > 60 || B.radius > 60) continue;
      const touching = A.flight.position.distanceTo(B.flight.position) < A.radius + B.radius;
      const key = A.id * 4096 + B.id;
      if (touching && !contacts.has(key)) n++;
      if (touching) contacts.add(key);
      else contacts.delete(key);
    }
  return n;
}
const contacts = new Set<number>();

const SCENARIOS: [string, () => ScenarioResult][] = [
  ['formation fingerFour', () => formationScenario('fingerFour')],
  ['formation echelonRight', () => formationScenario('echelonRight')],
  ['formation lineAbreast', () => formationScenario('lineAbreast')],
  ['formation fingerFour sprint', () => formationScenario('fingerFour', 45, true)],
  ['formation stress', () => formationScenario('fingerFour', 45, false, 1)],
  ['head-on', () => headOnScenario()],
  ['coverMe', () => coverMeScenario()],
  ['capital', () => capitalScenario()],
  ['station avoid', () => stationAvoidScenario()],
  ['wing dock', () => wingDockScenario()],
  ['defensive', () => defensiveScenario()],
  ['turret', () => turretScenario()],
  ['dogfight 1', () => dogfightScenario(1)],
  ['dogfight 2', () => dogfightScenario(2)],
  ['dogfight 3', () => dogfightScenario(3)],
  ['dogfight balance', () => dogfightBalanceScenario()],
];

export function runAll(filter = ''): ScenarioResult[] {
  return SCENARIOS.filter(([n]) => n.includes(filter)).map(([, run]) => run());
}
