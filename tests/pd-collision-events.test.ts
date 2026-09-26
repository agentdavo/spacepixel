import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Point Defence & Combat Verification: bounded headless regression for
 * (1) moving / crossing ordnance interception and nearest-reachable-threat
 * selection, and (2) exactly-once delivery of collision kill / subsystem
 * events to their per-tick consumers. Report: docs/PD-COLLISION-EVENTS-REGRESSION.md.
 *
 * Nothing here changes engine code. Consumers that need a DOM (CombatHud,
 * FlightRadio, KillCam) are represented by read-point probes placed exactly
 * where FlightScene reads `weapons.events`; the rest are the real classes.
 */

let server: ViteDevServer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: Record<string, any> = {};
const DT = 1 / 60;

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const load = (p: string) => server.ssrLoadModule(p);
  Object.assign(M, await load('three'));
  Object.assign(M, await load('/src/sim/Fleet.ts'));
  Object.assign(M, await load('/src/sim/Weapons.ts'));
  Object.assign(M, await load('/src/sim/Missiles.ts'));
  Object.assign(M, await load('/src/sim/Capitals.ts'));
  Object.assign(M, await load('/src/sim/CapitalCollisions.ts'));
  Object.assign(M, await load('/src/sim/Loadouts.ts'));
  Object.assign(M, await load('/src/sim/ai/Turret.ts'));
  Object.assign(M, await load('/src/sim/StateHash.ts'));
  Object.assign(M, await load('/src/world/EventTap.ts'));
  Object.assign(M, await load('/src/ui/CombatFeedback.ts'));
  Object.assign(M, await load('/src/game/CampaignRunner.ts'));
  Object.assign(M, await load('/src/game/campaign/missions.ts'));
  M.GameAudio = (await load('/src/audio/index.ts')).GameAudio;
  Object.assign(M, await load('/src/sim/ai/Pilot.ts'));
  M.determinism = await load('/src/sim/determinism.ts');
});
after(async () => { await server?.close(); });

// ── helpers ──────────────────────────────────────────────────────────────

/** Launch one torpedo from `owner` at `target` and return its pool index. */
function launch(missiles: any, owner: any, target: any, spec = M.MISSILES.torpedo): number {
  missiles.salvo(owner, target, spec);
  missiles.step(DT);
  const e = missiles.events.find((x: any) => x.kind === 'launch' && x.shooter === owner);
  assert.ok(e, 'torpedo launched');
  return e.index;
}

/** A free-floating PD mount (TurretMount) far from every hull, so bolts only meet ordnance. */
function mount(pos: any, opts: Partial<{ traverse: number; velocity: any; range: number; boltSpeed: number }> = {}): any {
  const { Vector3, TURRET_DEFAULTS, GUNS } = M;
  return {
    ...TURRET_DEFAULTS,
    position: pos.clone(),
    forward: new Vector3(0, 0, 1),
    up: new Vector3(0, 1, 0),
    velocity: opts.velocity ?? new Vector3(),
    traverse: opts.traverse ?? Math.PI,
    minElevation: -Math.PI / 2,
    maxElevation: Math.PI / 2,
    range: opts.range ?? 1400,
    boltSpeed: opts.boltSpeed ?? GUNS.flak.speed,
  };
}

function ordnanceWorld(seed: number) {
  const { Fleet, Weapons, Missiles, Group, Vector3 } = M;
  const fleet = new Fleet(new Group(), seed);
  const weapons = new Weapons(fleet);
  const missiles = new Missiles(fleet);
  const guard = fleet.spawn('ffc-lantern-guard', 'concord', new Vector3(), new Vector3(0, 0, 1));
  const bomber = fleet.spawn('sb9-warhorse', 'choir', new Vector3(0, 0, 60000), new Vector3(0, 0, -1));
  return { fleet, weapons, missiles, guard, bomber };
}

// ── 1. PD: moving / crossing interception ────────────────────────────────

test('PD lead solution intercepts crossing torpedoes (swept bolt vs moving missile), and a no-lead shot misses', () => {
  const { Vector3, turretSelectThreat, createTurretSolution } = M;
  const P = new Vector3(0, 30000, 0); // far above every hull
  const rows: any[] = [];
  // [crossing speed m/s, mount velocity, lateral offset]: stationary and moving mounts, torpedo-speed and faster-than-torpedo crossings.
  const cases: [number, [number, number, number]][] = [
    [150, [0, 0, 0]], [300, [0, 0, 0]], [430, [0, 0, 0]], [900, [0, 0, 0]],
    [430, [0, 0, 120]], [430, [250, 0, 0]], [430, [-250, 0, 0]],
  ];
  for (const lead of [true, false]) for (const [speed, mv] of cases) {
    const w = ordnanceWorld(31);
    const i = launch(w.missiles, w.bomber, w.guard);
    const mvel = new Vector3(...mv);
    const m = mount(P, { velocity: mvel });
    // Crossing left→right 800 m ahead, 60 m above the mount plane: no closing component.
    w.missiles.pos[i].copy(P).add(new Vector3(-500, 60, 800));
    w.missiles.vel[i].set(speed, 0, 0);
    w.missiles.target[i] = null;
    const sol = createTurretSolution();
    assert.equal(turretSelectThreat(m, 'concord', w.missiles, 1400, sol), true, 'crossing torpedo is a reachable threat');
    const dir = lead ? sol.aimDir.clone() : w.missiles.pos[i].clone().sub(P).normalize();
    const v = dir.multiplyScalar(m.boltSpeed).add(mvel); // GUN.inheritVelocity
    w.weapons.spawnBolt(P, v, 3, 1000, w.guard, M.GUNS.flak);
    let hitTick = -1;
    for (let t = 0; t < 180 && hitTick < 0; t++) {
      w.weapons.step(DT);
      if (w.missiles.hp[i] < 0) hitTick = t;
      w.missiles.pos[i].addScaledVector(w.missiles.vel[i], DT); // missiles move after weapons, as in the scene
    }
    rows.push({ lead, speed, mountVel: mv, predicted: +sol.time.toFixed(3), hitTick });
    if (lead) {
      assert.ok(hitTick >= 0, `lead shot intercepts a ${speed} m/s crossing torpedo (mount v=${mv})`);
      assert.ok(Math.abs(hitTick * DT - sol.time) <= 2 * DT, 'interception happens at the predicted time of flight');
    } else if (speed >= 300) assert.equal(hitTick, -1, `no-lead control misses a ${speed} m/s crossing (test is sensitive)`);
  }
  console.log(JSON.stringify({ pdCrossingKinematic: rows }));
});

test('PD in the real loop engages and intercepts torpedoes crossing the Lantern Guard bow (seeded, deterministic)', () => {
  const { Fleet, Weapons, Missiles, Capitals, Group, Vector3 } = M;
  /**
   * `pass` = distance of the crossing line ahead of the guard (m). `noScatter`
   * is a test-side control only: it zeroes this capital's fire-control dice
   * (rng.centered) so any residual miss would be a lead / slew / gate error.
   */
  function run(seed: number, moving: boolean, pass: number, noScatter: boolean) {
    const fleet = new Fleet(new Group(), seed);
    const weapons = new Weapons(fleet);
    const missiles = new Missiles(fleet);
    const capitals = new Capitals(fleet, weapons);
    const guard = fleet.spawn('ffc-lantern-guard', 'concord', new Vector3(), new Vector3(0, 0, 1));
    // The torpedoes are aimed at an unregistered (gunless) ally, so they cross the guard's bow instead of closing on it.
    const ally = fleet.spawn('ffc-lantern-guard', 'concord', new Vector3(2500, 150, pass), new Vector3(0, 0, 1));
    const bomber = fleet.spawn('sb9-warhorse', 'choir', new Vector3(-4000, 150, pass), new Vector3(1, 0, 0));
    for (const s of [guard, ally, bomber]) s.flight.velocity.set(0, 0, 0);
    capitals.register(guard);
    if (noScatter) capitals.list[0].rng.centered = () => 0;
    const launches = [0, 2, 4, 6, 8, 10].map((s) => Math.round(s / DT));
    const fate = new Map<number, string>();
    let crossingPdTicks = 0;
    for (let t = 0; t < 40 / DT; t++) {
      if (launches.includes(t)) missiles.salvo(bomber, ally, M.MISSILES.torpedo);
      capitals.step(DT);
      for (const g of capitals.list[0].guns) if (g.aim === 'pd') {
        // Is a live threat crossing (lateral speed dominates closing speed toward the guard)?
        for (let i = 0; i < M.MISSILE_CAPACITY; i++) {
          if (!missiles.alive[i] || missiles.hp[i] <= 0) continue;
          const to = guard.flight.position.clone().sub(missiles.pos[i]).normalize();
          if (Math.abs(missiles.vel[i].dot(to)) < 0.5 * missiles.vel[i].length()) { crossingPdTicks++; break; }
        }
      }
      if (moving) fleet.step(DT); // capitals.step sets a slow cruise: the guard (and its mounts) move
      weapons.step(DT);
      missiles.step(DT);
      for (const e of missiles.events) {
        if (e.kind === 'launch') fate.set(e.index, 'flying');
        else if ((e.kind === 'detonate' || e.kind === 'expire') && fate.get(e.index) === 'flying') fate.set(e.index, e.kind === 'expire' ? 'expired' : e.intercepted ? 'intercepted' : 'hit');
      }
    }
    const outcomes = [...fate.values()];
    return { outcomes, crossingPdTicks, guardMoved: +guard.flight.position.length().toFixed(1) };
  }
  const rows: any[] = [];
  const seeds = [31, 47, 59, 73, 89, 97];
  const variants: [number, boolean][] = [[900, false], [400, false], [900, true]];
  for (const [pass, noScatter] of variants)
    for (const moving of [false, true]) for (const seed of seeds) {
      const a = run(seed, moving, pass, noScatter), b = run(seed, moving, pass, noScatter);
      assert.deepEqual(a, b, `seed ${seed}: repeat run is identical`);
      assert.equal(a.outcomes.length, 6, 'six torpedoes launched');
      assert.ok(a.outcomes.every((o: string) => o !== 'flying'), 'every torpedo resolves');
      assert.ok(a.crossingPdTicks > 0, `seed ${seed}: PD lays on a crossing torpedo`);
      rows.push({ pass, noScatter, moving, seed, intercepted: a.outcomes.filter((o: string) => o === 'intercepted').length, outcomes: a.outcomes.map((o: string) => o[0].toUpperCase()).join(''), crossingPdTicks: a.crossingPdTicks, guardMoved: a.guardMoved });
    }
  console.log(JSON.stringify({ pdCrossingLoop: rows }));
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((n, r) => n + r.intercepted, 0);
  // Without fire-control scatter every crossing torpedo is intercepted: lead, slew and fire gate are sound.
  for (const moving of [false, true]) assert.equal(sum((r) => r.noScatter && r.moving === moving), 36, `zero-scatter control intercepts all crossing torpedoes (moving: ${moving})`);
  // With live scatter, a close crossing is mostly intercepted; the 900 m rate is recorded, not asserted (dispersion, see report).
  for (const moving of [false, true]) assert.ok(sum((r) => !r.noScatter && r.pass === 400 && r.moving === moving) >= 18, `400 m crossing: at least half intercepted (moving: ${moving})`);
});

// ── 2. PD: nearest reachable threat with moving candidates ───────────────

test('PD picks the nearest threat whose moving lead solution is reachable, independent of enumeration order', () => {
  const { Vector3, turretSelectThreat, createTurretSolution, turretCanPoint, leadPoint } = M;
  const P = new Vector3(0, 30000, 0);
  const w = ordnanceWorld(47);
  const friend = w.fleet.spawn('vf27-kestrel', 'concord', new Vector3(0, 0, 70000), new Vector3(0, 0, -1));
  const neutral = w.fleet.spawn('vf27-kestrel', 'neutral', new Vector3(0, 0, 80000), new Vector3(0, 0, -1));
  const far = launch(w.missiles, w.bomber, w.guard); // enumerated first
  const near = launch(w.missiles, w.bomber, w.guard);
  const own = launch(w.missiles, friend, w.bomber);
  const neu = launch(w.missiles, neutral, w.bomber);
  for (const i of [far, near, own, neu]) w.missiles.target[i] = null;
  const m = mount(P, { traverse: Math.PI / 4 }); // ±45° about +Z
  const sol = createTurretSolution();
  const leadOf = (i: number) => { const o = new Vector3(); leadPoint(P, m.velocity, w.missiles.pos[i], w.missiles.vel[i], null, o, m.boltSpeed); return o; };
  const place = (i: number, off: [number, number, number], vel: [number, number, number]) => { w.missiles.pos[i].copy(P).add(new Vector3(...off)); w.missiles.vel[i].set(...vel); };
  const pick = () => (turretSelectThreat(m, 'concord', w.missiles, 1400, sol) ? sol : null);

  // (a) Both inbound and reachable; the far one is enumerated first → the near one wins.
  place(far, [0, 50, 1000], [0, 0, -300]);
  place(near, [0, 50, 500], [0, 0, -300]);
  place(own, [0, 10, 100], [0, 0, -300]); // friendly ordnance, nearest of all
  place(neu, [0, 10, 150], [0, 0, -300]); // neutral ordnance
  assert.ok(pick());
  assert.ok(sol.aimPoint.distanceTo(leadOf(near)) < 1e-6, 'nearest reachable hostile, not first enumerated, not friendly/neutral');
  // (b) Near one is inside the arc now but crossing out fast: its lead point is outside ±45°.
  place(near, [330, 50, 400], [900, 0, 0]);
  const nowDir = w.missiles.pos[near].clone().sub(P).normalize();
  assert.equal(turretCanPoint(m, nowDir), true, 'currently in arc');
  assert.equal(turretCanPoint(m, leadOf(near).sub(P).normalize()), false, 'lead point leaves the arc');
  assert.ok(pick());
  assert.ok(sol.aimPoint.distanceTo(leadOf(far)) < 1e-6, 'a nearer threat crossing out of arc must not mask a reachable one');
  // (c) Near one is outside the arc now but crossing in: its lead point is inside → it is the nearest reachable threat.
  place(near, [-470, 50, 400], [900, 0, 0]);
  assert.equal(turretCanPoint(m, w.missiles.pos[near].clone().sub(P).normalize()), false, 'currently out of arc');
  assert.equal(turretCanPoint(m, leadOf(near).sub(P).normalize()), true, 'lead point inside arc');
  assert.ok(pick());
  assert.ok(sol.aimPoint.distanceTo(leadOf(near)) < 1e-6, 'crossing-in threat is engaged on its lead');
  // (d) Receding faster than the round: unreachable (no intercept) even though nearest and in arc.
  place(near, [0, 50, 300], [0, 0, 2000]);
  assert.ok(pick());
  assert.ok(sol.aimPoint.distanceTo(leadOf(far)) < 1e-6, 'outrunning threat does not mask the reachable one');
  // (e) Range gate uses current distance; nothing reachable → false, solution not claimed.
  place(near, [0, 50, 1500], [0, 0, -300]);
  place(far, [0, 50, 1600], [0, 0, -300]);
  assert.equal(pick(), null, 'beyond PD range');
  // (f) Once the nearer one is shot down this tick, the next pick moves to the other immediately.
  place(near, [0, 50, 400], [0, 0, -300]);
  place(far, [0, 50, 900], [0, 0, -300]);
  assert.ok(pick());
  assert.ok(sol.aimPoint.distanceTo(leadOf(near)) < 1e-6);
  const p = w.missiles.pos[near];
  assert.equal(w.missiles.shoot(p.x, p.y - 10, p.z, 0, 20, 0, 'concord', 1000, DT), true);
  assert.ok(pick());
  assert.ok(sol.aimPoint.distanceTo(leadOf(far)) < 1e-6, 'a dying missile is no longer a candidate');
});

// ── 3. Collision kill / subsystem events: exactly once per consumer ──────

/**
 * One tick in FlightScene order (FlightScene.simStep; determinism.ts tick):
 *   [prior-tick consumers: Traffic.update reads last tick's events]
 *   weapons.beginTick → fleet.step → capital contacts (Weapons.contactHit)
 *   → weapons.step(dt, true) → missiles.step
 *   → 4a CampaignSession/ContractDesk: runner.onKill per 'kill'
 *   → 4b mission bookkeeping (kills by victim faction)
 *   → 4c presentation: CombatHud (kill feed / impacts), FlightRadio barks,
 *        frame EventTap → GameAudio, KillCam per-tick tap.
 * Real classes: Fleet, Weapons, Missiles, CapitalCollisions, CampaignRunner,
 * CombatFeedback (the HUD impact layer), EventTap, GameAudio. DOM-bound
 * CombatHud / FlightRadio / KillCam are read-point probes at their exact
 * position in the tick.
 */
/** Consequence events whose delivery must be exactly once (the collision owner's kill / subsystem contract, plus facing collapse). */
const TRACKED = new Set(['kill', 'subsystem', 'shield-down', 'reactor-critical']);

function eventWorld(seed: number) {
  const { Fleet, Weapons, Missiles, CapitalCollisions, Group, Vector3, EventTap, CombatFeedback, CampaignRunner, MISSIONS, GameAudio } = M;
  const fleet = new Fleet(new Group(), seed);
  const weapons = new Weapons(fleet);
  const missiles = new Missiles(fleet);
  const solver = new CapitalCollisions();
  const host: any = { playerPosition: new Vector3(), playerAlive: true, playerHull: 1, systemId: 'x', jumps: 0, ships: [], gatePosition: () => null, spawnShip: () => { throw new Error('no spawns'); }, spawnSetPiece: () => ({ tag: '', position: new Vector3(), radius: 1 }), playChatter: () => {}, unlockCodex: () => {}, command: () => {} };
  const runner = new CampaignRunner(MISSIONS[0], host);
  const feedback = new CombatFeedback();
  const frameTap = new EventTap();
  const audio = new GameAudio({ unlockTarget: null });
  const heard: string[] = [];
  audio.sfx.audibility = () => 1;
  audio.sfx.playAtRaw = (name: string) => { heard.push(name); };
  audio.sfx.playRaw = audio.sfx.impact = audio.sfx.weapon = () => {};
  const onKill = fleet.destruction.onKill.bind(fleet.destruction);
  const wrecked = new Map<number, number>();
  fleet.destruction.onKill = (s: any, cause: any, by: any) => { wrecked.set(s.id, (wrecked.get(s.id) ?? 0) + 1); onKill(s, cause, by); };
  /** consumer → delivered [tick, kind, shipId, subId] */
  const seen: Record<string, [number, string, number, string | null][]> = { traffic: [], runner: [], bookkeeping: [], hud: [], barks: [], audioTap: [], killcam: [] };
  const note = (who: string, tick: number, evs: readonly any[]) => {
    for (const e of evs) if (TRACKED.has(e.kind) && e.ship) seen[who].push([tick, e.kind, e.ship.id, e.sub?.id ?? (e.kind === 'shield-down' ? `facing${e.facing}` : null)]);
  };
  const killcam: any[] = [];
  let tick = 0;
  const w = {
    fleet, weapons, missiles, solver, runner, feedback, audio, heard, wrecked, seen, killcam,
    /** set in a test to act inside the contact phase (before weapons.step) */
    onContact: null as null | ((s: any, other: any) => void),
    contacts: 0,
    afterBeginTick: -1,
    step() {
      note('traffic', tick - 1, weapons.events); // Traffic.update(dt, player, weapons.events): previous tick's window
      weapons.beginTick();
      w.afterBeginTick = weapons.events.length;
      fleet.step(DT);
      solver.step(fleet.ships, DT, (s: any, amount: number, point: any, normal: any, other: any) => {
        w.contacts++;
        w.onContact?.(s, other);
        weapons.contactHit(s, amount, point, normal, other);
      });
      weapons.step(DT, true);
      missiles.step(DT);
      for (const e of weapons.events) if (e.kind === 'kill' && e.ship) runner.onKill(e.ship); // CampaignSession.update
      note('runner', tick, weapons.events);
      note('bookkeeping', tick, weapons.events); // FlightScene 4b kills map / reputation
      feedback.consume(weapons.events, missiles.events, tick * DT); // CombatHud.impacts
      note('hud', tick, weapons.events); // CombatHud.consume kill feed
      note('barks', tick, weapons.events); // FlightRadio.update({ events })
      frameTap.capture(weapons.events, missiles.events); // FlightScene.frameEvents
      const tap = new EventTap(96); tap.capture(weapons.events, missiles.events); killcam.push(tap); // KillCam.record
      note('killcam', tick, tap.weapons);
      if (tick % 2 === 1) { // two sim ticks per rendered frame: audio drains the tap once
        note('audioTap', tick, frameTap.weapons);
        audio.weaponEvents(frameTap.weapons, new Vector3(), tick * DT);
        frameTap.clear();
      }
      tick++;
    },
    get tick() { return tick; },
  };
  return w;
}

/** Each (kind, ship, sub) key delivered to every consumer exactly once. */
function assertExactlyOnce(w: any, label: string) {
  const keys = (rows: any[]) => rows.map((r) => `${r[1]}:${r[2]}:${r[3]}`);
  const ref = keys(w.seen.runner);
  assert.ok(ref.length > 0, `${label}: events were produced`);
  assert.equal(new Set(ref).size, ref.length, `${label}: no duplicate kill/subsystem event in the reference stream`);
  for (const who of Object.keys(w.seen)) {
    assert.deepEqual([...keys(w.seen[who])].sort(), [...ref].sort(), `${label}: ${who} receives each kill/subsystem event exactly once`);
  }
  // Traffic reads one tick later; every other consumer reads on the emitting tick.
  for (const r of w.seen.runner) {
    for (const who of ['bookkeeping', 'hud', 'barks', 'killcam']) assert.ok(w.seen[who].some((x: any) => x[0] === r[0] && x[1] === r[1] && x[2] === r[2] && x[3] === r[3]), `${label}: ${who} same tick`);
    assert.ok(w.seen.traffic.some((x: any) => x[0] === r[0] && x[1] === r[1] && x[2] === r[2]), `${label}: traffic sees it at the start of the next tick`);
  }
}

function indomitables(w: any, speed: number, opts: { shields?: boolean; stern?: boolean; gap?: number } = {}) {
  const { Vector3 } = M;
  const a = w.fleet.spawn('bb-indomitable', 'concord', new Vector3(0, 0, -3000), new Vector3(0, 0, 1));
  const b = w.fleet.spawn('bb-indomitable', 'choir', new Vector3(0, 0, 3000), new Vector3(0, 0, -1));
  if (opts.stern) b.flight.orientation.identity(); // a's bow into b's engine deck
  if (opts.shields === false) for (const s of [a, b]) { s.shield = 0; s.combat.dmg.facings.fill(0); }
  const gap = opts.gap ?? 100;
  a.flight.position.z = -w.solver.bodyFor(a).shape.radius - gap;
  b.flight.position.z = w.solver.bodyFor(b).shape.radius + gap;
  a.flight.velocity.z = speed; b.flight.velocity.z = -speed;
  for (const s of [a, b]) { s.flight.flightAssist = false; s.flight.throttle = 0; s.controls.throttleSet = 0; }
  return { a, b };
}

test('collision kills and shield/subsystem consequences reach every consumer exactly once and clear next tick', () => {
  const rows: any[] = [];
  for (const seed of [1994, 7, 31]) {
    const w = eventWorld(seed);
    const { a, b } = indomitables(w, 180);
    let contactTick = -1;
    for (let t = 0; t < 600 && (contactTick < 0 || w.tick < contactTick + 120); t++) {
      const before = w.contacts;
      w.step();
      if (contactTick < 0 && w.contacts > before) {
        contactTick = w.tick - 1;
        const kills = w.weapons.events.filter((e: any) => e.kind === 'kill');
        assert.deepEqual(kills.map((e: any) => e.ship.id).sort(), [a.id, b.id].sort(), 'both hulls die on the contact tick');
        assert.ok(kills.every((e: any) => e.cause === 'structural'));
        assert.deepEqual(kills.map((e: any) => e.shooter?.id).sort(), [a.id, b.id].sort(), 'each kill is credited to the other hull');
        // Next tick: the window restarts before anything can re-deliver.
        w.step();
        assert.equal(w.afterBeginTick, 0, 'beginTick empties the window');
        assert.equal(w.weapons.events.filter((e: any) => (e.kind === 'kill' || e.kind === 'subsystem') && (e.ship === a || e.ship === b)).length, 0, 'contact kill/subsystem events do not survive into the next tick');
      }
    }
    assert.ok(contactTick >= 0, 'hulls met');
    assertExactlyOnce(w, `seed ${seed}`);
    assert.equal(w.seen.runner.filter((r: any) => r[1] === 'shield-down').length, 2, 'each fore facing collapse is delivered');
    assert.equal(w.wrecked.get(a.id), 1, 'breakup (salvage wrecks) runs once per hull');
    assert.equal(w.wrecked.get(b.id), 1);
    const runnerKills = Object.fromEntries(w.runner.snapshot().kills);
    assert.deepEqual(runnerKills, { concord: 1, choir: 1 }, 'mission kill predicates count each collision death once');
    assert.equal(w.heard.filter((x: string) => x === 'hullCrunch').length, 2, 'audio plays one structural break-up per collision kill');
    assert.ok(w.feedback.get(a, contactTick * DT) || w.feedback.get(b, contactTick * DT), 'HUD impact cue recorded for the contact');
    rows.push({ seed, contactTick, delivered: w.seen.runner.map((r: any) => r.slice(1).join(':')) });
  }
  console.log(JSON.stringify({ collisionKillDelivery: rows }));
});

test('collision subsystem destruction (engine deck, shields down) is delivered once with no kill, and clears', () => {
  const w = eventWorld(1994);
  const { a, b } = indomitables(w, 60, { shields: false, stern: true });
  let contactTick = -1;
  for (let t = 0; t < 900 && (contactTick < 0 || w.tick < contactTick + 120); t++) {
    const before = w.contacts;
    w.step();
    if (contactTick < 0 && w.contacts > before) contactTick = w.tick - 1;
  }
  assert.ok(contactTick >= 0, 'hulls met');
  assert.ok(a.alive && b.alive, 'a 60 m/s stern contact is not lethal');
  const subs = w.seen.runner.filter((r: any) => r[1] === 'subsystem');
  assert.ok(subs.some((r: any) => r[2] === b.id && String(r[3]).startsWith('engine-')), 'engine destroyed through ordinary subsystem routing');
  assert.equal(w.seen.runner.filter((r: any) => r[1] === 'kill').length, 0);
  assertExactlyOnce(w, 'engine contact');
  const mount = w.heard.filter((x: string) => x === 'mountBlast').length;
  assert.equal(mount, subs.length, 'audio: one mount blast per delivered subsystem event');
  console.log(JSON.stringify({ collisionSubsystemDelivery: { contactTick, subsystems: subs.map((r: any) => r.slice(1).join(':')), contacts: w.contacts } }));
});

test('contact, bolt and missile kills in one tick: ordered once per consumer (contact, then bolt, then missile)', () => {
  const { Vector3 } = M;
  const w = eventWorld(1994);
  const { a, b } = indomitables(w, 180);
  const gunner = w.fleet.spawn('vf27-kestrel', 'concord', new Vector3(100000, 0, -100), new Vector3(0, 0, 1));
  const cantor = w.fleet.spawn('choir-cantor', 'choir', new Vector3(100000, 0, 0), new Vector3(0, 0, 1));
  const bomber = w.fleet.spawn('sb9-warhorse', 'concord', new Vector3(-100000, 0, -5000), new Vector3(0, 0, 1));
  const victim = w.fleet.spawn('vf27-kestrel', 'choir', new Vector3(-100000, 0, 0), new Vector3(0, 0, 1));
  for (const s of [gunner, cantor, bomber, victim]) { s.flight.velocity.set(0, 0, 0); s.flight.flightAssist = false; }
  victim.shield = 0; victim.combat.dmg.facings.fill(0); victim.hull = 1;
  const i = launch(w.missiles, bomber, victim);
  w.missiles.target[i] = null; w.missiles.vel[i].set(0, 0, 0); // parked until the contact tick
  let armed = false;
  w.onContact = () => {
    if (armed) return;
    armed = true;
    w.weapons.spawnBolt(new Vector3(100000, 0, -50), new Vector3(0, 0, 6000), 1, 10000, gunner);
    w.missiles.target[i] = victim;
    w.missiles.pos[i].copy(victim.flight.position).add(new Vector3(0, 0, -20)); // inside this tick's fuze sweep
    w.missiles.vel[i].set(0, 0, 400).add(victim.flight.velocity);
  };
  let contactTick = -1;
  for (let t = 0; t < 600 && (contactTick < 0 || w.tick < contactTick + 60); t++) {
    const before = w.contacts;
    w.step();
    if (contactTick < 0 && w.contacts > before) {
      contactTick = w.tick - 1;
      const kills = w.weapons.events.filter((e: any) => e.kind === 'kill').map((e: any) => e.ship.id);
      assert.deepEqual(kills.slice(0, 2).sort(), [a.id, b.id].sort(), 'contact deaths first');
      assert.deepEqual(kills.slice(2), [cantor.id, victim.id], 'then the bolt death, then the missile death');
    }
  }
  assert.ok(!victim.alive && !cantor.alive && !a.alive && !b.alive);
  assertExactlyOnce(w, 'mixed tick');
  const kills = w.seen.runner.filter((r: any) => r[1] === 'kill');
  assert.equal(kills.length, 4);
  assert.ok(kills.every((r: any) => r[0] === contactTick), 'all four deaths are delivered on the same tick');
});

// ── 4. Default (standalone) callers ─────────────────────────────────────

test('default caller behaviour: weapons.step(dt) keeps its own window; beginTick + step(dt, true) is identical when nothing emits before it', () => {
  const { Fleet, Weapons, Missiles, Group, Vector3, hashWorld } = M;
  function duel(seed: number, windowed: boolean) {
    const fleet = new Fleet(new Group(), seed);
    const weapons = new Weapons(fleet);
    const missiles = new Missiles(fleet);
    const a = fleet.spawn('vf27-kestrel', 'concord', new Vector3(0, 0, -600), new Vector3(0, 0, 1));
    const b = fleet.spawn('choir-cantor', 'choir', new Vector3(0, 0, 600), new Vector3(0, 0, -1));
    a.target = b; b.target = a;
    const log: string[] = [];
    const hashes: number[] = [];
    for (let t = 0; t < 600; t++) {
      a.controls.fire = b.controls.fire = t % 3 === 0;
      if (t === 30) missiles.salvo(a, b, M.MISSILES.micro);
      if (windowed) weapons.beginTick();
      fleet.step(DT);
      if (windowed) weapons.step(DT, true); else weapons.step(DT);
      missiles.step(DT);
      log.push(weapons.events.map((e: any) => `${e.kind}:${e.ship?.id ?? '-'}`).join(','));
      if (t % 60 === 59) hashes.push(hashWorld(fleet, weapons, missiles));
    }
    return { log, hashes, alive: [a.alive, b.alive] };
  }
  for (const seed of [7, 31]) {
    const legacy = duel(seed, false), windowed = duel(seed, true);
    assert.ok(legacy.log.some((l) => l.includes('hit') || l.includes('shield')), 'the duel produces impacts');
    assert.deepEqual(windowed, legacy, `seed ${seed}: identical events and world hashes`);
  }
  // Standalone step(dt) still clears whatever was emitted before it (documented legacy window).
  const fleet = new Fleet(new Group(), 7);
  const weapons = new Weapons(fleet);
  const s = fleet.spawn('bb-indomitable', 'concord', new Vector3(), new Vector3(0, 0, 1));
  const o = fleet.spawn('bb-indomitable', 'choir', new Vector3(0, 0, 9000), new Vector3(0, 0, 1));
  weapons.contactHit(s, 50, s.flight.position.clone().add(new Vector3(0, 0, 400)), new Vector3(0, 0, 1), o);
  assert.equal(weapons.events.length, 1, 'contactHit emits one layer event');
  weapons.step(DT);
  assert.equal(weapons.events.length, 0, 'step(dt) without keepEvents starts a fresh window');
});

test('default caller behaviour: a missile kill after a standalone weapons.step is visible once, cleared by the next step', () => {
  const { Vector3 } = M;
  const w = ordnanceWorld(59);
  const victim = w.fleet.spawn('vf27-kestrel', 'choir', new Vector3(-100000, 0, 0), new Vector3(0, 0, 1));
  const shooter = w.fleet.spawn('sb9-warhorse', 'concord', new Vector3(-100000, 0, -5000), new Vector3(0, 0, 1));
  victim.shield = 0; victim.combat.dmg.facings.fill(0); victim.hull = 1;
  const i = launch(w.missiles, shooter, victim);
  w.missiles.age[i] = 1;
  w.missiles.pos[i].set(-100000, 0, -60);
  w.missiles.vel[i].set(0, 0, 400);
  let seen = 0;
  for (let t = 0; t < 10; t++) {
    w.weapons.step(DT);
    assert.equal(w.weapons.events.filter((e: any) => e.kind === 'kill').length, 0, 'the previous kill never survives the next step(dt)');
    w.missiles.step(DT);
    seen += w.weapons.events.filter((e: any) => e.kind === 'kill' && e.ship === victim).length;
  }
  assert.equal(seen, 1);
  assert.equal(victim.alive, false);
});

// ── 5. Event-window capacity ─────────────────────────────────────────────

test('event window headroom in the standard headless scenarios (peak events per tick vs pool of 384)', () => {
  const { Weapons } = M;
  const proto = Weapons.prototype;
  const original = proto.beginTick;
  let peak = 0;
  proto.beginTick = function (this: any) { peak = Math.max(peak, this.events.length); original.call(this); };
  const rows: any[] = [];
  try {
    for (const scenario of M.determinism.SCENARIOS) {
      peak = 0;
      const r = M.determinism.runScenario(scenario, 7, { seconds: 60 });
      rows.push({ scenario, seed: 7, seconds: 60, peakEventsPerTick: peak, kills: r.stats.kills });
    }
  } finally { proto.beginTick = original; }
  console.log(JSON.stringify({ eventWindowPeak: rows }));
  for (const r of rows) assert.ok(r.peakEventsPerTick < 384, `${r.scenario}: below the pool`);
});

test('a kill emitted after the per-tick event pool is full still reaches consumers', { todo: 'Weapons.emit returns null at EVENT_POOL (384): a kill emitted after saturation is silently dropped (ship dies and breaks up, but runner.onKill / HUD / audio never see it). Latent: the standard headless scenarios peak far below the cap (see report).' }, () => {
  const { Fleet, Weapons, Group, Vector3 } = M;
  const fleet = new Fleet(new Group(), 7);
  const weapons = new Weapons(fleet);
  const shooter = fleet.spawn('vf27-kestrel', 'concord', new Vector3(0, 0, -400), new Vector3(0, 0, 1));
  const tank = fleet.spawn('bb-indomitable', 'choir', new Vector3(0, 0, 3000), new Vector3(0, 0, 1));
  const victim = fleet.spawn('vf27-kestrel', 'choir', new Vector3(5000, 0, 0), new Vector3(0, 0, 1));
  victim.shield = 0; victim.combat.dmg.facings.fill(0); victim.hull = 1;
  weapons.beginTick();
  // Fill the window with ordinary absorbed impacts on the dreadnought (400 x 1 damage).
  for (let k = 0; k < 400; k++) weapons.contactHit(tank, 1, tank.flight.position.clone().add(new Vector3(0, 0, -2000)), new Vector3(0, 0, -1), shooter);
  assert.ok(weapons.events.length >= 384, 'window saturated');
  const killed = fleet.hit(victim, 1000, 'laser', victim.flight.position, new Vector3(0, 1, 0), shooter).killed;
  assert.equal(killed, true, 'the victim dies');
  assert.equal(weapons.events.filter((e: any) => e.kind === 'kill' && e.ship === victim).length, 1, 'its kill event is delivered');
});
