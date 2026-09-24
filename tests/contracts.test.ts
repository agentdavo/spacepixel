import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { COMMODITIES, newLedger } from '../src/game/economy.ts';
import {
  BOARD_PERIOD,
  CLIENTS,
  MAX_ACTIVE,
  REWARD_BASE,
  TIER_MUL,
  abandonContract,
  acceptContract,
  contractFee,
  declineContract,
  generateBoard,
  markReady,
  newBook,
  normaliseBook,
  openOffers,
  settleAt,
  shipTier,
  tickBook,
  type BoardInput,
  type Contract,
  type ContractKind,
  type ReachMap,
  type Tier,
} from '../src/game/contracts/contracts.ts';
import { buildOp } from '../src/game/contracts/ops.ts';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';

// ── A small Reach: two Directorate systems, the Belt, a contested border, Tessaly.
const REACH: ReachMap = {
  systems: [
    {
      id: 'meridian',
      name: 'Meridian Prime',
      faction: 'concord',
      threat: 0.1,
      stations: [
        { id: 'meridian-orbital-0', name: 'Castellan Highport', kind: 'orbital', faction: 'concord', pos: [200_000, 0, 60_000], axis: [1, 0, 0], planet: 0 },
        { id: 'meridian-refinery-1', name: 'Tey Refinery', kind: 'refinery', faction: 'concord', pos: [190_000, 5000, 70_000], axis: [1, 0, 0], planet: 0 },
        { id: 'meridian-bastion-2', name: 'Meridian Lantern Watch', kind: 'bastion', faction: 'concord', pos: [9000, 0, -6000], axis: [1, 0, 0] },
      ],
      gates: [
        { to: 'anchorage', pos: [22_000, 0, 0], normal: [1, 0, 0] },
        { to: 'rustwake', pos: [0, 0, 26_000], normal: [0, 0, 1] },
      ],
    },
    {
      id: 'anchorage',
      name: 'Anchorage',
      faction: 'concord',
      threat: 0.2,
      stations: [
        { id: 'anchorage-bastion-0', name: 'Anchorage Fleet Yards', kind: 'bastion', faction: 'concord', pos: [-10_000, 0, 5000], axis: [-1, 0, 0] },
        { id: 'anchorage-salvage-1', name: 'Graveyard Breakers', kind: 'salvage', faction: 'concord', pos: [-12_000, 2000, -9000], axis: [-1, 0, 0] },
      ],
      gates: [{ to: 'meridian', pos: [-21_000, 0, 0], normal: [-1, 0, 0] }],
    },
    {
      id: 'rustwake',
      name: 'Rustwake Belt',
      faction: 'rustwake',
      threat: 0.25,
      stations: [
        { id: 'rustwake-freeport-0', name: 'The Moot-Hold', kind: 'freeport', faction: 'rustwake', pos: [0, 0, -12_000], axis: [0, 0, -1] },
        { id: 'rustwake-salvage-1', name: 'Scrapjack Breakers', kind: 'salvage', faction: 'rustwake', pos: [14_000, 0, 9000], axis: [0, 0, 1] },
      ],
      gates: [
        { to: 'meridian', pos: [0, 0, -24_000], normal: [0, 0, -1] },
        { to: 'zephacis', pos: [25_000, 0, 0], normal: [1, 0, 0] },
      ],
    },
    {
      id: 'zephacis',
      name: 'Zephacis',
      faction: 'contested',
      threat: 0.55,
      stations: [{ id: 'zephacis-freeport-0', name: 'Zephacis Exchange', kind: 'freeport', faction: 'rustwake', pos: [-8000, 0, 3000], axis: [-1, 0, 0] }],
      gates: [
        { to: 'rustwake', pos: [-20_000, 0, 0], normal: [-1, 0, 0] },
        { to: 'tessaly', pos: [20_000, 0, 0], normal: [1, 0, 0] },
      ],
    },
    {
      id: 'tessaly',
      name: 'Tessaly',
      faction: 'choir',
      threat: 0.85,
      stations: [
        { id: 'tessaly-refinery-0', name: 'Ebon-Field Refinery', kind: 'refinery', faction: 'choir', pos: [150_000, 0, 0], axis: [1, 0, 0], planet: 0 },
        { id: 'tessaly-bastion-1', name: 'Treaty Line Watch', kind: 'bastion', faction: 'choir', pos: [-9000, 0, 0], axis: [-1, 0, 0] },
      ],
      gates: [{ to: 'zephacis', pos: [-22_000, 0, 0], normal: [-1, 0, 0] }],
    },
  ],
};
const STATIONS = REACH.systems.flatMap((s) => s.stations.map((st) => st.id));
const REP = { concord: 45, choir: -20, rustwake: 30 };

function input(station: string, over: Partial<BoardInput> = {}): BoardInput {
  return { reach: REACH, station, clock: 0, rep: REP, tier: 2, goods: COMMODITIES, ...over };
}

/** Every offer across stations × epochs. */
function sweep(over: Partial<BoardInput> = {}, epochs = 30): Contract[] {
  const out: Contract[] = [];
  for (const st of STATIONS) for (let e = 0; e < epochs; e++) out.push(...generateBoard(input(st, { clock: e * BOARD_PERIOD + 5, ...over })));
  return out;
}

test('contracts: boards are deterministic per station, epoch, standing and tier', () => {
  const a = generateBoard(input('meridian-bastion-2', { clock: 100 }));
  const b = generateBoard(input('meridian-bastion-2', { clock: 500 }));
  assert.ok(a.length >= 2);
  assert.deepEqual(a, b, 'same epoch → same board');
  const next = generateBoard(input('meridian-bastion-2', { clock: BOARD_PERIOD + 1 }));
  assert.notDeepEqual(a.map((x) => x.id), next.map((x) => x.id), 'the board reposts each epoch');
  const other = generateBoard(input('rustwake-freeport-0', { clock: 100 }));
  assert.notDeepEqual(a.map((x) => x.title), other.map((x) => x.title));
  const trusted = generateBoard(input('meridian-bastion-2', { clock: 100, rep: { ...REP, concord: 85 } }));
  assert.notDeepEqual(a.map((x) => x.id), trusted.map((x) => x.id), 'standing reseeds the board');
  for (const k of a) assert.equal(k.expires, BOARD_PERIOD, 'offers lapse at the repost');
});

test('contracts: every kind is posted, with valid destinations, clients and fees', () => {
  const all = sweep();
  const kinds = new Set(all.map((k) => k.kind));
  for (const k of ['courier', 'haul', 'escort', 'bounty', 'patrol', 'salvage', 'recon', 'sortie'] as ContractKind[]) assert.ok(kinds.has(k), `no ${k} posted`);
  const sys = new Set(REACH.systems.map((s) => s.id));
  for (const k of all) {
    assert.ok(CLIENTS.some((c) => c.id === k.client), `unknown client ${k.client}`);
    assert.ok(k.title.length > 4 && k.brief.length > 60, 'titled and briefed');
    assert.ok(sys.has(k.payAtSystem) && STATIONS.includes(k.payAt));
    assert.ok(k.reward >= 50 && k.reward % 50 === 0);
    assert.ok(k.penalty > 0 && k.penalty < k.reward);
    assert.ok(k.duration > 0);
    if (k.kind === 'courier' || k.kind === 'haul') {
      assert.equal(k.payAt, k.dest, 'consignee pays');
      assert.notEqual(k.dest, k.origin);
      if (k.kind === 'haul') assert.ok(k.cargo && k.cargo.units >= 2 && k.cargo.units <= 12);
      if (k.tier >= 2) assert.equal(k.op?.system, k.destSystem, 'interceptors wait at the far end');
    } else {
      assert.equal(k.payAt, k.origin, 'flown work is paid by the client');
      assert.ok(k.op && sys.has(k.op.system));
      assert.equal(k.reward, contractFee(k.kind, k.tier, k.jumps, REP[k.faction]));
    }
    if (k.kind === 'escort') assert.ok(k.op!.start && k.op!.end && k.op!.freighter && k.op!.system === k.originSystem);
    if (k.kind === 'bounty') assert.ok(k.op!.mark?.name && k.op!.mark.id.startsWith('mark-'));
    if (k.kind === 'patrol') assert.ok(k.op!.waypoints!.length >= 3);
    if (k.kind === 'recon') assert.notEqual(k.op!.system, k.originSystem);
    if (k.kind === 'sortie') {
      assert.equal(k.faction, 'concord');
      assert.ok(k.enemy && k.enemy.faction === 'choir' && k.enemy.rep < 0);
    }
  }
  // Reward bands: tier multipliers and base fees order the kinds sensibly.
  assert.ok(REWARD_BASE.sortie > REWARD_BASE.bounty && REWARD_BASE.bounty > REWARD_BASE.courier);
  assert.ok(contractFee('bounty', 3, 0, 0) === Math.round((REWARD_BASE.bounty * TIER_MUL[3]) / 50) * 50);
  assert.ok(contractFee('courier', 1, 2, 100) > contractFee('courier', 1, 2, 0), 'honoured pilots are paid more');
});

test('contracts: tiers follow the ship and are gated by standing', () => {
  const t1 = sweep({ tier: 1, rep: { concord: 0, choir: 0, rustwake: 0 } }, 20);
  assert.ok(t1.every((k) => k.tier <= 2), 'tier I ship at neutral standing never sees tier III');
  assert.ok(t1.every((k) => k.kind !== 'sortie'), 'no sorties for an untrusted tier-I pilot');
  const t3 = sweep({ tier: 3, rep: { concord: 60, choir: 60, rustwake: 60 } }, 20);
  assert.ok(t3.some((k) => k.tier === 3) && t3.every((k) => k.tier >= 2));
  const suspect = sweep({ rep: { concord: -30, choir: -30, rustwake: -30 } }, 10);
  for (const st of STATIONS) {
    const b = generateBoard(input(st, { rep: { concord: -30, choir: -30, rustwake: -30 } }));
    assert.ok(b.length <= 2, 'suspect pilots see a thin board');
  }
  assert.ok(suspect.every((k) => k.tier === 1));
  assert.equal(generateBoard(input('meridian-bastion-2', { rep: { concord: -60, choir: 0, rustwake: 0 } })).length, 0, 'barred: nothing posted');
  assert.equal(shipTier('vf27-kestrel'), 1);
  assert.equal(shipTier('vf31-harrier'), 2);
  assert.equal(shipTier('unknown-hull'), 1);
});

test('contracts: priority orders head every Directorate board while an episode is pending', () => {
  const priority = { episode: 3, title: 'THE OBSERVANCE', tagline: 'Guns cold.' };
  const m = generateBoard(input('meridian-orbital-0', { priority }));
  assert.equal(m[0].kind, 'priority');
  assert.equal(m[0].episode, 3);
  assert.equal(m[0].client, 'kade');
  assert.ok(!generateBoard(input('tessaly-bastion-1', { priority })).some((k) => k.kind === 'priority'), 'the Hegemony does not post Directorate orders');
  assert.ok(!generateBoard(input('meridian-orbital-0')).some((k) => k.kind === 'priority'));
  // Accepting priority orders books nothing: the host starts the episode.
  const r = acceptContract(newBook(), newLedger(), m[0]);
  assert.equal(r.book.active.length, 0);
});

function offer(kind: ContractKind, over: Partial<BoardInput> = {}): Contract {
  const k = sweep(over, 40).find((x) => x.kind === kind);
  assert.ok(k, `no ${kind} found`);
  return k!;
}

test('contracts: haul consignments load into the pod, respect capacity and slots', () => {
  const haul = offer('haul');
  const l0 = { ...newLedger(), cargo: {}, capacity: 16 };
  const book0 = { ...newBook(), clock: haul.expires - 10 };
  const r = acceptContract(book0, l0, haul);
  assert.equal(r.error, undefined);
  assert.equal(r.ledger.cargo[haul.cargo!.id], haul.cargo!.units);
  assert.equal(r.book.active[0].state, 'active');
  assert.equal(r.book.active[0].due, book0.clock + haul.duration);
  // Hidden from the board once taken.
  assert.ok(!openOffers([haul], r.book).length);
  // A full pod refuses the job.
  const full = acceptContract(book0, { ...l0, cargo: { rations: 15 } }, haul);
  assert.match(full.error ?? '', /CARGO POD/);
  // Slots.
  let b = book0;
  const couriers = sweep({}, 40).filter((k) => k.kind === 'courier').slice(0, MAX_ACTIVE + 1);
  for (const k of couriers) b = acceptContract({ ...b, clock: 0 }, l0, { ...k, expires: 1e9 }).book;
  assert.equal(b.active.length, MAX_ACTIVE);
  assert.match(acceptContract(b, l0, { ...couriers[MAX_ACTIVE], id: 'x', expires: 1e9 }).error ?? '', /SLOTS FULL/);
});

test('contracts: couriers pay at the consignee, hauls need the goods, flown work pays at the client', () => {
  const l0 = { ...newLedger(), cargo: {}, credits: 1000 };
  const courier = { ...offer('courier'), expires: 1e9 };
  let r = acceptContract(newBook(), l0, courier);
  assert.equal(settleAt(r.book, r.ledger, courier.origin).receipts!.length, 0, 'not paid at the origin');
  const paid = settleAt(r.book, r.ledger, courier.dest!);
  assert.equal(paid.receipts!.length, 1);
  assert.equal(paid.ledger.credits, 1000 + courier.reward);
  assert.equal(paid.ledger.rep[courier.faction], l0.rep[courier.faction] + courier.rep);
  assert.equal(paid.book.active.length, 0);
  assert.equal(paid.book.completed, 1);
  assert.equal(paid.book.earned, courier.reward);

  const haul = { ...offer('haul'), expires: 1e9 };
  r = acceptContract(newBook(), l0, haul);
  const sold = { ...r.ledger, cargo: { ...r.ledger.cargo, [haul.cargo!.id]: haul.cargo!.units - 1 } };
  assert.equal(settleAt(r.book, sold, haul.dest!).receipts!.length, 0, 'a short consignment is not paid');
  const ok = settleAt(r.book, r.ledger, haul.dest!);
  assert.equal(ok.receipts!.length, 1);
  assert.equal(ok.ledger.cargo[haul.cargo!.id] ?? 0, 0, 'consignment unloaded');

  const bounty = { ...offer('bounty'), expires: 1e9 };
  r = acceptContract(newBook(), l0, bounty);
  assert.equal(settleAt(r.book, r.ledger, bounty.origin).receipts!.length, 0, 'not before the work is done');
  const ready = markReady(r.book, bounty.id);
  assert.equal(ready.active[0].state, 'ready');
  const done = settleAt(ready, r.ledger, bounty.origin);
  assert.equal(done.ledger.credits, 1000 + bounty.reward);

  const sortie = { ...offer('sortie', { tier: 2, rep: { concord: 60, choir: 0, rustwake: 0 } }), expires: 1e9 };
  r = acceptContract(newBook(), l0, sortie);
  const s = settleAt(markReady(r.book, sortie.id), r.ledger, sortie.origin);
  assert.equal(s.ledger.rep.choir, l0.rep.choir + sortie.enemy!.rep, 'the Hegemony remembers');
});

test('contracts: deadlines lapse with a penalty; abandon and decline', () => {
  const haul = { ...offer('haul'), expires: 1e9 };
  const l0 = { ...newLedger(), cargo: {}, credits: 100 };
  const r = acceptContract(newBook(), l0, haul);
  const mid = tickBook(r.book, r.ledger, haul.duration - 1);
  assert.equal(mid.book.active.length, 1);
  assert.equal(mid.receipts, undefined);
  const late = tickBook(mid.book, mid.ledger, 5);
  assert.equal(late.book.active.length, 0);
  assert.equal(late.receipts![0].result, 'lapsed');
  assert.equal(late.ledger.credits, Math.max(0, 100 - haul.penalty), 'never below zero shares');
  assert.equal(late.ledger.rep[haul.faction], l0.rep[haul.faction] - haul.repPenalty);
  assert.equal(late.ledger.cargo[haul.cargo!.id] ?? 0, 0, 'consignment repossessed');
  assert.equal(late.book.failed, 1);
  // Ready contracts don't lapse.
  const b = { ...offer('patrol'), expires: 1e9 };
  const a = acceptContract(newBook(), l0, b);
  const kept = tickBook(markReady(a.book, b.id), a.ledger, 1e6);
  assert.equal(kept.book.active.length, 1);
  // Abandon.
  const ab = abandonContract(a.book, { ...a.ledger, credits: 5000 }, b.id);
  assert.equal(ab.ledger.credits, 5000 - b.penalty);
  assert.equal(ab.receipts![0].result, 'abandoned');
  // Decline hides an offer.
  assert.equal(openOffers([b], declineContract(newBook(), b.id)).length, 0);
  // Book survives a save/load round trip.
  const round = normaliseBook(JSON.parse(JSON.stringify(a.book)));
  assert.deepEqual(round.active, a.book.active);
  assert.deepEqual(normaliseBook({ active: [{ junk: 1 }], clock: 'x' }), newBook());
});

// ── Operations through the CampaignRunner ────────────────────────────────

interface FakeShip {
  faction: string;
  alive: boolean;
  hull: number;
  hullMax: number;
  flight: { position: Vector3 };
}

function host() {
  const ships: FakeShip[] = [];
  const beats: string[] = [];
  const h = {
    playerPosition: new Vector3(),
    playerAlive: true,
    playerHull: 1,
    systemId: 'meridian',
    jumps: 0,
    ships,
    beats,
    gatePosition: () => null,
    spawnShip: (s: { faction: string }, _i: number, p: Vector3) => {
      const ship: FakeShip = { faction: s.faction, alive: true, hull: 100, hullMax: 100, flight: { position: p.clone() } };
      ships.push(ship);
      return ship;
    },
    spawnSetPiece: (s: { tag: string; params?: Record<string, unknown> }, p: Vector3) => ({ tag: s.tag, position: p, radius: typeof s.params?.radius === 'number' ? s.params.radius : 10 }),
    playChatter: (b: { id: string }) => beats.push(b.id),
    unlockCodex: () => {},
  };
  return h;
}

function run(k: Contract) {
  const b = buildOp(k, [0, 0, 0])!;
  assert.ok(b, `${k.kind} builds an op`);
  const h = host();
  const r = new CampaignRunner(b.mission, h as unknown as CampaignHost);
  r.begin();
  const step = (n = 1, dt = 0.5) => {
    for (let i = 0; i < n; i++) r.update(dt);
  };
  const kill = (tag: string) => {
    for (const s of r.shipsTagged(tag)) {
      if (!s.alive) continue;
      s.alive = false;
      r.onKill(s);
    }
  };
  const goTo = (tag: string, off = new Vector3()) => h.playerPosition.copy(r.resolve({ at: 'tag', tag, offset: [0, 0, 0] })!).add(off);
  return { b, h, r, step, kill, goTo };
}

const v = (a: [number, number, number]) => new Vector3(...a);

test('ops: escort — rendezvous, raiders, arrival; losing the freighter fails', () => {
  const k = offer('escort');
  const { r, h, step, kill, goTo, b } = run(k);
  assert.equal(r.escorts.length, 1);
  step(2);
  assert.equal(r.escorts[0].halted, true, 'the freighter waits for her escort');
  goTo('freighter', new Vector3(300, 0, 0));
  step(2);
  assert.equal(r.escorts[0].halted, false);
  step(k.op!.waves * 45 * 2 + 20);
  assert.ok(r.ctx.aliveCount('raiders') > 0, 'raid waves spawn');
  for (let w = 1; w <= k.op!.waves; w++) kill(`raiders-w${w}`);
  for (const s of r.shipsTagged('freighter')) s.flight.position.copy(v(k.op!.end!));
  step();
  assert.equal(r.outcome, 'success');
  assert.equal(b.completes, true);
  assert.ok(h.beats.includes('c-win'));

  const f = run(k);
  f.step();
  f.kill('freighter');
  f.step();
  assert.equal(f.r.outcome, 'failure');
});

test('ops: bounty — find the lair, the mark shows, kill the mark', () => {
  const k = offer('bounty');
  const { r, step, kill, h } = run(k);
  step();
  assert.equal(r.ctx.alive('mark'), false, 'the mark waits in the wrecks');
  h.playerPosition.copy(v(k.op!.center)).add(new Vector3(0, 0, 3000));
  step(2);
  assert.equal(r.ctx.alive('mark'), true);
  assert.equal(r.outcome, 'running');
  kill('mark');
  step();
  assert.equal(r.outcome, 'success');
});

test('ops: patrol — nav points in order, then clear the raiders', () => {
  const k = offer('patrol');
  const { r, step, kill, goTo } = run(k);
  const n = k.op!.waypoints!.length;
  for (let i = 1; i <= n; i++) {
    goTo(`wp${i}`);
    step(12);
  }
  assert.ok(r.flags.has(`wp${n}`));
  assert.equal(r.outcome, 'running', 'raiders still out there');
  kill('raiders');
  step();
  assert.equal(r.outcome, 'success');
});

test('ops: salvage — survey dwell, core recovery, scavengers', () => {
  const k = offer('salvage', { tier: 3, rep: { concord: 60, choir: 60, rustwake: 60 } });
  const { r, step, kill, goTo } = run(k);
  goTo('survey');
  step(Math.ceil((k.op!.hold ?? 8) / 0.5) + 2);
  assert.ok(r.flags.has('survey-held'));
  step();
  assert.ok(r.ctx.alive('core'), 'core appears after the survey');
  r.setFlag('core-recovered');
  step(30);
  if (k.op!.waves > 0) {
    assert.equal(r.outcome, 'running');
    kill('scav');
    step();
  }
  assert.equal(r.outcome, 'success');
});

test('ops: recon — hold the tape, then break contact', () => {
  const k = offer('recon');
  const { r, step, goTo, h } = run(k);
  goTo('obs');
  step(Math.ceil((k.op!.hold ?? 20) / 0.5) + 30);
  assert.ok(r.flags.has('obs-held'));
  assert.ok(r.ctx.alive('patrol'), 'they noticed');
  h.playerPosition.add(new Vector3(20_000, 0, 0));
  step();
  assert.equal(r.outcome, 'success');
});

test('ops: sortie — rally, then break the Measure; courier interceptors', () => {
  const k = offer('sortie', { tier: 2, rep: { concord: 60, choir: 0, rustwake: 0 } });
  const { r, step, goTo } = run(k);
  goTo('rally');
  step(200);
  const total = k.op!.hostiles * k.op!.waves;
  let killed = 0;
  for (const s of r.shipsTagged('measure')) {
    s.alive = false;
    r.onKill(s);
    killed++;
  }
  assert.equal(killed, total);
  step();
  assert.equal(r.outcome, 'success');

  const c = offer('courier', { tier: 3, rep: { concord: 60, choir: 60, rustwake: 60 } });
  assert.ok(c.op);
  const o = run(c);
  assert.equal(o.b.completes, false, 'interceptors do not complete a delivery');
  o.step(30);
  assert.ok(o.r.ctx.alive('hunters'));
  o.kill('hunters');
  o.step();
  assert.equal(o.r.outcome, 'success');
});

test('ops: every posted contract with an op builds a runnable mission', () => {
  for (const tier of [1, 2, 3] as Tier[]) {
    for (const k of sweep({ tier, rep: { concord: 60, choir: 60, rustwake: 60 } }, 6)) {
      if (!k.op) continue;
      const { r, step } = run(k);
      step(4);
      assert.equal(r.outcome, 'running', `${k.kind} ${k.id} should not resolve by itself`);
      for (const s of r.mission.spawns) {
        const p = s.place;
        assert.ok(p.at === 'point' || p.at === 'tag' || p.at === 'player');
      }
    }
  }
});

// ── Leaving mid-operation: progress persists and resumes ─────────────────

test('ops: escort progress survives leaving the system (snapshot → JSON → restore)', () => {
  const k = offer('escort', { tier: 2, rep: { concord: 30, choir: 30, rustwake: 30 } });
  const a = run(k);
  a.step(2);
  a.goTo('freighter', new Vector3(300, 0, 0));
  a.step(2);
  assert.equal(a.r.escorts[0].halted, false, 'under way');
  // Let the first wave arrive, kill one raider, move the freighter down the lane.
  a.step(60);
  const w1 = a.r.shipsTagged('raiders-w1');
  assert.ok(w1.length > 1, 'wave one is out');
  w1[0].alive = false;
  a.r.onKill(w1[0]);
  const fr = a.r.shipsTagged('freighter')[0];
  const mid = v(k.op!.start!).lerp(v(k.op!.end!), 0.4);
  fr.flight.position.copy(mid);
  fr.hull = fr.hullMax * 0.55;
  a.step();
  const aliveBefore = a.r.ctx.aliveCount('raiders');
  assert.ok(a.h.beats.length > 0);

  const snap = JSON.parse(JSON.stringify(a.r.snapshot()));
  const h = host();
  const r = new CampaignRunner(buildOp({ ...k, progress: snap }, [0, 0, 0])!.mission, h as unknown as CampaignHost);
  r.restore(snap);
  r.begin();
  assert.ok(r.flags.has('resume:freighter') && r.flags.has('raid-seen'), 'flags come back');
  assert.equal(h.beats.length, 0, 'no chatter replays on resume');
  assert.equal(r.escorts.length, 1);
  const fr2 = r.shipsTagged('freighter')[0];
  assert.ok(fr2.flight.position.distanceTo(mid) < 1e-6, 'the freighter is where she was');
  assert.ok(Math.abs(fr2.hull / fr2.hullMax - 0.55) < 1e-6, 'at the hull she had');
  assert.equal(r.ctx.aliveCount('raiders'), aliveBefore, 'dead raiders stay dead');
  assert.equal(r.shipsTagged('raiders-w1').length, w1.length - 1);
  r.update(0.5);
  assert.equal(r.escorts[0].halted, false, 'she keeps flying');
  assert.ok(r.state.includes('done'), 'objective states restored');
  // Finish the job from the restored state: every wave out and down, then arrive.
  for (let i = 0; i < 400; i++) {
    for (const s of r.shipsTagged('raiders')) if (s.alive) (s.alive = false), r.onKill(s);
    r.update(0.5);
  }
  for (const s of r.shipsTagged('freighter')) s.flight.position.copy(v(k.op!.end!));
  r.update(0.5);
  assert.equal(r.outcome, 'success');
});

test('ops: salvage dwell progress survives a resume', () => {
  const k = offer('salvage', { tier: 3, rep: { concord: 60, choir: 60, rustwake: 60 } });
  const a = run(k);
  a.goTo('survey');
  const hold = k.op!.hold ?? 8;
  a.step(Math.floor(hold / 0.5 / 2));
  const p = a.r.dwells[0].progress;
  assert.ok(p > 0.3 && p < 1, `progress ${p}`);
  const snap = a.r.snapshot();
  const r = new CampaignRunner(buildOp(k, [0, 0, 0])!.mission, host() as unknown as CampaignHost);
  r.restore(snap);
  r.begin();
  assert.ok(Math.abs(r.dwells[0].progress - p) < 1e-9, 'dwell progress restored');
  assert.equal(r.flags.has('survey-held'), false);
});
