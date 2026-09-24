import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { acceptContract, newBook, settleAt, markReady, type ReachMap } from '../src/game/contracts/contracts.ts';
import { NAMED_CLIENTS, NAMED_IDS, namedContract, namedKey, type NamedInput } from '../src/game/contracts/named.ts';
import { buildOp } from '../src/game/contracts/ops.ts';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import { CONVERSATIONS } from '../src/dialog/conversations.ts';
import { HIRES, hire, newCrew, normaliseCrew, repairMultiplier, REPAIR_DISCOUNT } from '../src/game/crew.ts';
import { newLedger, repairCost, type MarketSpec } from '../src/game/economy.ts';

// A slice of the Reach with the places the conversations name.
const REACH: ReachMap = {
  systems: [
    {
      id: 'meridian',
      name: 'Meridian Prime',
      faction: 'concord',
      threat: 0.26,
      stations: [
        { id: 'meridian-orbital-0', name: 'Castellan Highport', kind: 'orbital', faction: 'concord', pos: [200_000, 0, 60_000], axis: [1, 0, 0], planet: 0 },
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
      threat: 0.08,
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
      threat: 0.02,
      stations: [
        { id: 'rustwake-freeport-0', name: 'The Moot-Hold', kind: 'freeport', faction: 'rustwake', pos: [4000, 0, 9000], axis: [0, 0, -1] },
        { id: 'rustwake-salvage-1', name: 'Scrapjack Breakers', kind: 'salvage', faction: 'rustwake', pos: [-6000, 500, 7000], axis: [1, 0, 0] },
      ],
      gates: [
        { to: 'meridian', pos: [0, 0, -24_000], normal: [0, 0, -1] },
        { to: 'tessaly', pos: [24_000, 0, 0], normal: [1, 0, 0] },
      ],
    },
    {
      id: 'tessaly',
      name: 'Tessaly',
      faction: 'choir',
      threat: 0.99,
      stations: [
        { id: 'tessaly-refinery-0', name: 'Ebon-Field Refinery', kind: 'refinery', faction: 'choir', pos: [150_000, 0, 0], axis: [0, 0, 1], planet: 0 },
        { id: 'tessaly-bastion-1', name: 'Treaty Line Watch', kind: 'bastion', faction: 'choir', pos: [8000, 0, 3000], axis: [0, 0, 1] },
      ],
      gates: [{ to: 'rustwake', pos: [-22_000, 0, 0], normal: [-1, 0, 0] }],
    },
  ],
};

const inp = (station: string, o: Partial<NamedInput> = {}): NamedInput => ({ reach: REACH, station, clock: 1200, rep: { concord: 20, choir: 25, rustwake: 45 }, tier: 1, ...o });

test('named contracts: every id the conversations offer has a template', () => {
  const offered = new Set<string>();
  for (const c of CONVERSATIONS) for (const n of Object.values(c.nodes)) for (const e of n.effects ?? []) if ('contract' in e) offered.add(e.contract);
  assert.deepEqual([...offered].sort(), [...NAMED_IDS].sort());
  for (const id of ['pell', 'magpie', 'idris']) assert.ok(NAMED_CLIENTS.some((c) => c.id === id && c.portrait), `${id} is a comms character`);
  assert.equal(namedContract('no-such-job', inp('meridian-bastion-2')), null);
});

test('named: continuity-courier runs Castellan ↔ Anchorage and pays at the consignee', () => {
  const k = namedContract('continuity-courier', inp('meridian-orbital-0'))!;
  assert.equal(k.kind, 'courier');
  assert.equal(k.client, 'pell');
  assert.equal(k.destSystem, 'anchorage');
  assert.equal(k.payAt, 'anchorage-bastion-0');
  assert.equal(namedKey(k), 'continuity-courier');
  assert.equal(k.op, undefined, 'tier I: nobody follows');
  const back = namedContract('continuity-courier', inp('anchorage-bastion-0'))!;
  assert.equal(back.payAt, 'meridian-orbital-0', 'from Anchorage it goes to Castellan');
  const hot = namedContract('continuity-courier', inp('meridian-orbital-0', { tier: 2 }))!;
  assert.ok(hot.op && hot.op.system === 'anchorage', 'tier II: someone waits at the far end');

  const l = newLedger();
  const a = acceptContract({ ...newBook(), clock: 1200 }, l, k);
  assert.equal(a.error, undefined);
  const paid = settleAt(a.book, a.ledger, 'anchorage-bastion-0');
  assert.equal(paid.receipts?.length, 1);
  assert.equal(paid.ledger.credits, l.credits + k.reward);
});

test('named: magpie-escort — a clan convoy out of Scrapjack Breakers, jumped by Scrapjacks', () => {
  const k = namedContract('magpie-escort', inp('rustwake-freeport-0'))!;
  assert.equal(k.kind, 'escort');
  assert.equal(k.client, 'magpie');
  assert.equal(k.faction, 'rustwake');
  assert.equal(k.op!.system, 'rustwake');
  assert.equal(k.op!.enemy.name, 'Scrapjack');
  assert.equal(k.op!.freighter!.name, 'Kittiwake');
  assert.equal(k.op!.waves, 2);
  // The lane leaves from the Breakers' bay.
  const br = REACH.systems[2].stations[1];
  const bay = new Vector3(...br.pos).addScaledVector(new Vector3(...br.axis), 2600);
  assert.ok(new Vector3(...k.op!.start!).distanceTo(bay) < 1);
  assert.equal(k.payAt, 'rustwake-freeport-0', 'paid back where Magpie asked');
  // It is a runnable operation.
  const b = buildOp(k, [0, 0, 0])!;
  const ships: { alive: boolean; hull: number; hullMax: number; faction: string; flight: { position: Vector3 } }[] = [];
  const h = {
    playerPosition: new Vector3(...k.op!.start!),
    playerAlive: true,
    playerHull: 1,
    systemId: 'rustwake',
    jumps: 0,
    ships,
    gatePosition: () => null,
    spawnShip: (s: { faction: string }, _i: number, p: Vector3) => {
      const x = { faction: s.faction, alive: true, hull: 100, hullMax: 100, flight: { position: p.clone() } };
      ships.push(x);
      return x;
    },
    spawnSetPiece: (s: { tag: string }, p: Vector3) => ({ tag: s.tag, position: p, radius: 10 }),
    playChatter: () => {},
    unlockCodex: () => {},
  };
  const r = new CampaignRunner(b.mission, h as unknown as CampaignHost);
  r.begin();
  for (let i = 0; i < 200; i++) r.update(0.5);
  assert.ok(r.flags.has('resume:freighter'));
  assert.ok(r.ctx.aliveCount('raiders') > 0, 'the Scrapjacks come');
});

test('named: choir-line-escort runs out of the Treaty Line Watch; off-Schedule Kestrels, a Directorate frown', () => {
  const k = namedContract('choir-line-escort', inp('tessaly-bastion-1', { tier: 2 }))!;
  assert.equal(k.client, 'idris');
  assert.equal(k.faction, 'choir');
  assert.equal(k.op!.system, 'tessaly');
  assert.equal(k.op!.enemy.faction, 'concord');
  assert.equal(k.op!.freighter!.blueprint, 'choir-vesper');
  assert.deepEqual(k.enemy, { faction: 'concord', rep: -1 });
  const a = acceptContract({ ...newBook(), clock: 1200 }, newLedger(), k);
  const ready = markReady(a.book, k.id);
  const paid = settleAt(ready, a.ledger, 'tessaly-bastion-1');
  assert.equal(paid.ledger.rep.choir, a.ledger.rep.choir + k.rep);
  assert.equal(paid.ledger.rep.concord, a.ledger.rep.concord - 1);
});

test('crew: hires, duplicates, the mechanic discount on repairs', () => {
  let c = newCrew();
  assert.equal(repairMultiplier(c), 1);
  c = hire(c, 'brennick-mechanic').crew;
  assert.equal(repairMultiplier(c), 1 - REPAIR_DISCOUNT);
  assert.ok(hire(c, 'brennick-mechanic').error, 'already aboard');
  assert.ok(hire(c, 'somebody').error);
  c = hire(c, 'magpie-due').crew;
  assert.deepEqual(normaliseCrew(JSON.parse(JSON.stringify(c))), c, 'survives the save file');
  assert.deepEqual(normaliseCrew({ hired: ['magpie-due', 'magpie-due', 7, 'bogus'] }), { hired: ['magpie-due'] });
  for (const id of Object.keys(HIRES)) assert.ok(CONVERSATIONS.some((cv) => Object.values(cv.nodes).some((n) => (n.effects ?? []).some((e) => 'recruit' in e && e.recruit === id))), `${id} is offered somewhere`);
  const spec: MarketSpec = { id: 'x', name: 'X', kind: 'orbital', faction: 'concord' } as unknown as MarketSpec;
  const l = newLedger();
  const full = repairCost(spec, l, 0.5);
  const cheap = repairCost(spec, l, 0.5, repairMultiplier(c));
  assert.ok(cheap < full && Math.abs(cheap - full * 0.7) <= 1, `${cheap} ≈ 0.7 × ${full}`);
});
