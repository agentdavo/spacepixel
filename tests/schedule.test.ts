import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { emptyWorld, fact, type WorldState } from '../src/game/world/WorldState.ts';
import { attitude, fastForward, priceOffset, type ReachInfo } from '../src/game/world/sim.ts';
import { stepWorld } from '../src/game/world/step.ts';
import {
  QUARTER,
  TRANSIT,
  WINDOW,
  breakEngagement,
  currentSchedule,
  engagementById,
  engagementStatus,
  flyAsOrdered,
  measureOf,
  scheduleContract,
  scheduleFor,
  scheduleVisible,
  takeable,
} from '../src/game/world/schedule.ts';
import { acceptContract, markReady, newBook, settleAt, type ReachMap } from '../src/game/contracts/contracts.ts';
import { buildOp } from '../src/game/contracts/ops.ts';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import { newLedger } from '../src/game/economy.ts';

const MAP: ReachMap = {
  systems: [
    {
      id: 'meridian',
      name: 'Meridian Prime',
      faction: 'concord',
      threat: 0.2,
      stations: [{ id: 'meridian-bastion-2', name: 'Meridian Lantern Watch', kind: 'bastion', faction: 'concord', pos: [9000, 0, -6000], axis: [1, 0, 0] }],
      gates: [{ to: 'lysowick', pos: [22_000, 0, 0], normal: [1, 0, 0] }],
    },
    {
      id: 'lysowick',
      name: 'Lysowick',
      faction: 'contested',
      threat: 0.66,
      stations: [{ id: 'lysowick-salvage-0', name: 'Lysowick Yard', kind: 'salvage', faction: 'rustwake', pos: [4000, 0, 3000], axis: [0, 0, 1] }],
      gates: [
        { to: 'meridian', pos: [-20_000, 0, 0], normal: [-1, 0, 0] },
        { to: 'zephacis', pos: [0, 0, 24_000], normal: [0, 0, 1] },
      ],
    },
    {
      id: 'zephacis',
      name: 'Zephacis',
      faction: 'contested',
      threat: 0.47,
      stations: [{ id: 'zephacis-freeport-0', name: 'Zephacis Free Port', kind: 'freeport', faction: 'rustwake', pos: [3000, 0, 2000], axis: [1, 0, 0] }],
      gates: [
        { to: 'lysowick', pos: [0, 0, -22_000], normal: [0, 0, -1] },
        { to: 'tessaly', pos: [21_000, 0, 0], normal: [1, 0, 0] },
      ],
    },
    {
      id: 'tessaly',
      name: 'Tessaly',
      faction: 'choir',
      threat: 0.99,
      stations: [{ id: 'tessaly-bastion-1', name: 'Treaty Line Watch', kind: 'bastion', faction: 'choir', pos: [5000, 0, 5000], axis: [1, 0, 0] }],
      gates: [{ to: 'zephacis', pos: [-21_000, 0, 0], normal: [-1, 0, 0] }],
    },
  ],
};
const REACH: ReachInfo = {
  seed: 1994,
  systems: MAP.systems.map((s) => ({ id: s.id, name: s.name, faction: s.faction, threat: s.threat, gates: s.gates.map((g) => g.to), stations: s.stations.map((st) => ({ id: st.id, name: st.name, kind: st.kind, faction: st.faction })) })),
};

test('the Schedule surfaces with Episode 8 and is suspended when read aloud', () => {
  assert.equal(scheduleVisible(fastForward(7)), false);
  assert.equal(currentSchedule(fastForward(7), REACH).length, 0);
  assert.equal(scheduleVisible(fastForward(8)), true);
  assert.ok(currentSchedule(fastForward(8), REACH).length >= 3);
  assert.equal(scheduleVisible(fastForward(18)), false);
});

test('generator: 3–5 engagements a quarter on the contested line, deterministic, numbered, 131 never posted', () => {
  const w = fastForward(8);
  const seen = new Set<number>();
  for (let q = 0; q < 12; q++) {
    const a = scheduleFor(w, REACH, q);
    assert.deepEqual(a, scheduleFor(w, REACH, q), 'same world, same Schedule');
    assert.ok(a.length >= 3 && a.length <= 5);
    for (let i = 0; i < a.length; i++) {
      const e = a[i];
      assert.ok(e.at - WINDOW >= q * QUARTER && e.at + WINDOW <= (q + 1) * QUARTER, `E${e.number} inside its quarter`);
      if (i) assert.ok(e.at >= a[i - 1].at);
      assert.ok(['lysowick', 'zephacis', 'tessaly'].includes(e.system));
      assert.ok(e.directorate >= 4 && e.hegemony >= 3 && e.ebon > 0);
      assert.notEqual(e.number, 131);
      assert.ok(!seen.has(e.number), `E${e.number} unique`);
      seen.add(e.number);
      assert.deepEqual(engagementById(w, REACH, e.id), e);
    }
  }
});

test('status follows the clock; unflown engagements are fought as scheduled and release Ebon', () => {
  let w = fastForward(8);
  const e = currentSchedule(w, REACH)[0];
  assert.equal(engagementStatus(w, e), 'upcoming');
  assert.equal(engagementStatus({ ...w, clock: e.at }, e), 'open');
  assert.equal(takeable({ ...w, clock: e.at }, e), true);
  w = stepWorld(w, e.at + WINDOW + 1, REACH).w;
  assert.equal(engagementStatus(w, e), 'fought');
  const taken = stepWorld({ ...fastForward(8), facts: { ...fastForward(8).facts, [`schedule.taken.${e.id}`]: true } }, e.at + WINDOW + 1, REACH).w;
  assert.ok(!taken.log.some((x) => x.kind === 'schedule.fought' && x.data!.id === e.id), 'a taken engagement waits for the pilot');
  assert.equal(takeable(w, e), false);
  const fought = w.log.find((x) => x.kind === 'schedule.fought' && x.data!.id === e.id);
  assert.ok(fought, 'recorded');
  // Ebon released to market — held at the floor.
  assert.ok(priceOffset(w, 'meridian', 'meridian-bastion-2', 'ebon') >= -0.05);
  assert.ok(priceOffset(w, e.system, 'x', 'munitions') > 0);
});

test('flown as ordered: Continuity warms, the fact is kept; breaking it: prices spike, Continuity turns, next quarter changes', () => {
  const w0 = fastForward(9);
  const [e] = currentSchedule(w0, REACH);
  const flown = flyAsOrdered(w0, e);
  assert.equal(fact(flown, `schedule.flown.${e.id}`), true);
  assert.equal(engagementStatus(flown, e), 'flown');
  const bastion = { id: 'meridian-bastion-2', faction: 'concord', kind: 'bastion' };
  assert.ok(attitude(flown, bastion, 'meridian') > attitude(w0, bastion, 'meridian'));
  assert.equal(breakEngagement(flown, e, 'protected') === flown, false, 'a flown one can still be recorded broken only once');

  const broken = breakEngagement(w0, e, 'protected');
  assert.equal(fact(broken, `schedule.broken.${e.id}`), 'protected');
  assert.equal(fact(broken, 'continuity.hostile'), true);
  assert.equal(engagementStatus(broken, e), 'broken');
  assert.ok(priceOffset(broken, 'meridian', 'meridian-bastion-2', 'ebon') > 0.2, 'Ebon spikes');
  assert.ok(attitude(broken, bastion, 'meridian') < -0.5, 'Continuity desks turn cold');
  assert.equal(broken.log.at(-1)?.kind, 'schedule.broken');
  // This quarter's Schedule stands; the next one owes a correction at the same field.
  assert.deepEqual(scheduleFor(broken, REACH, e.quarter), scheduleFor(w0, REACH, e.quarter));
  const next = scheduleFor(broken, REACH, e.quarter + 1);
  assert.notDeepEqual(next, scheduleFor(w0, REACH, e.quarter + 1));
  const corr = next.find((x) => x.correction)!;
  assert.equal(corr.system, e.system);
  assert.ok(corr.directorate + corr.hegemony > 10);
  assert.equal(breakEngagement(broken, e, 'refused'), broken, 'once');
  // It wears off, slowly: a day on the Ebon spike is gone, Continuity still remembers.
  const later = stepWorld(broken, 12 * 3600, { ...REACH, systems: [] }).w;
  assert.ok(priceOffset(later, 'meridian', 'meridian-bastion-2', 'ebon') < 0.05);
  assert.ok(attitude(later, bastion, 'meridian') < -0.4);
});

// ── the op ───────────────────────────────────────────────────────────

interface FakeShip {
  alive: boolean;
  hull: number;
  hullMax: number;
  faction: string;
  tag?: string;
  flight: { position: Vector3 };
}

function fly(e: ReturnType<typeof scheduleFor>[number]) {
  const k = scheduleContract(e, MAP, 100, e.at - 600)!;
  const b = buildOp({ ...k, state: 'active' }, [0, 0, 0], { stage: true })!;
  const ships: FakeShip[] = [];
  const line = new Vector3(...k.op!.center);
  const h = {
    playerPosition: line.clone().add(new Vector3(0, 0, -5000)),
    playerAlive: true,
    playerHull: 1,
    systemId: e.system,
    jumps: 0,
    ships,
    gatePosition: () => null,
    spawnShip: (s: { faction: string; tag?: string }, _i: number, p: Vector3) => {
      const x: FakeShip = { faction: s.faction, tag: s.tag, alive: true, hull: 100, hullMax: 100, flight: { position: p.clone() } };
      ships.push(x);
      return x;
    },
    spawnSetPiece: (s: { tag: string }, p: Vector3) => ({ tag: s.tag, position: p, radius: 10 }),
    playChatter: () => {},
    unlockCodex: () => {},
  };
  const r = new CampaignRunner(b.mission, h as unknown as CampaignHost);
  r.begin();
  const run = (secs: number) => {
    for (let t = 0; t < secs; t += 0.5) r.update(0.5);
  };
  const kill = (tag: string, n: number) => {
    for (const s of r.shipsTagged(tag).filter((x) => x.alive).slice(0, n)) {
      s.alive = false;
      r.onKill(s);
    }
  };
  return { k, b, r, h, line, run, kill };
}

test('op: fly it as ordered — take station, the Measure expends its quota, withdraw on order', () => {
  const e = scheduleFor(fastForward(8), REACH, 0)[0];
  const { k, r, h, line, run, kill } = fly(e);
  assert.equal(k.kind, 'sortie');
  assert.equal(k.schedule!.id, e.id);
  assert.equal(k.payAt, 'meridian-bastion-2', 'Continuity pays at the nearest Directorate berth');
  assert.equal(k.op!.system, e.system);
  run(2);
  assert.ok(!r.flags.has('on-station'));
  h.playerPosition.copy(line);
  run(6);
  assert.ok(r.flags.has('on-station'));
  assert.equal(r.ctx.aliveCount('measure'), measureOf(e).measure);
  assert.equal(r.ctx.aliveCount('protected'), 1);
  kill('measure', k.schedule!.quota);
  run(1);
  assert.ok(r.flags.has('expended') && r.flags.has('depart:measure') && r.flags.has('depart:protected'));
  h.playerPosition.copy(line).add(new Vector3(7000, 0, 0));
  run(1);
  assert.equal(r.outcome, 'success');
  assert.ok(!r.flags.has('decisive'));
  // Paid in shares on docking at the paying berth.
  const a = acceptContract({ ...newBook(), clock: 100 }, newLedger(), k);
  assert.ok(!a.error, a.error);
  const paid = settleAt(markReady(a.book, k.id), a.ledger, k.payAt);
  assert.equal(paid.ledger.credits, a.ledger.credits + k.reward);
  assert.ok(k.reward >= 1500);
});

test('op: break it — kill the protected conductor, or refuse the withdrawal', () => {
  const e = scheduleFor(fastForward(8), REACH, 0)[1];
  {
    const { r, h, line, run, kill } = fly(e);
    h.playerPosition.copy(line);
    run(6);
    kill('protected', 1);
    run(1);
    assert.ok(r.flags.has('broken:protected') && r.flags.has('decisive'));
    assert.equal(r.outcome, 'success', 'the op ends; the desk voids the pay and tells the world');
  }
  {
    const { k, r, h, line, run, kill } = fly(e);
    h.playerPosition.copy(line);
    run(6);
    kill('measure', k.schedule!.quota);
    run(20);
    assert.ok(!r.flags.has('decisive'), 'still time to go');
    run(25);
    assert.ok(r.flags.has('broken:refused') && r.flags.has('decisive'));
    assert.ok(!r.flags.has('broken:protected'));
    assert.equal(r.outcome, 'success');
  }
});

test('a lapsed engagement cannot be taken; the contract carries its window', () => {
  const w: WorldState = { ...fastForward(8), clock: 0 };
  const e = currentSchedule(w, REACH)[0];
  const k = scheduleContract(e, MAP, 1000, w.clock)!;
  assert.ok(Math.abs(k.duration - (e.at + WINDOW + TRANSIT)) < 1);
  assert.equal(k.expires, 1000 + k.duration);
  assert.equal(takeable({ ...w, clock: e.at + WINDOW + 1 }, e), false);
  assert.equal(emptyWorld().clock, 0);
});
