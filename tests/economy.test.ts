import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMODITIES,
  MISSILE_MAX,
  bestBid,
  buy,
  cargoUsed,
  dockingClearance,
  drift,
  marketBoard,
  newLedger,
  normaliseLedger,
  pressureAt,
  quote,
  rumours,
  rearm,
  rearmCost,
  repair,
  repairCost,
  reputationForKill,
  sell,
  stance,
  type MarketSpec,
  type StationKind,
  type EconFaction,
} from '../src/game/economy.ts';
import { Vector3 } from 'three';
import { placeStations, type StationSystemInput } from '../src/universe/stations.ts';

const refinery: MarketSpec = { id: 'test-refinery', kind: 'refinery', faction: 'concord' };
const bastion: MarketSpec = { id: 'test-bastion', kind: 'bastion', faction: 'concord' };
const freeport: MarketSpec = { id: 'test-freeport', kind: 'freeport', faction: 'rustwake' };
const KINDS: StationKind[] = ['refinery', 'salvage', 'bastion', 'freeport', 'orbital', 'carrier'];
const FACTIONS: EconFaction[] = ['concord', 'choir', 'rustwake'];

test('quotes are deterministic and the station always buys lower than it sells', () => {
  const l = newLedger();
  for (const kind of KINDS)
    for (const faction of FACTIONS)
      for (const rep of [-49, 0, 100]) {
        const spec = { id: `${kind}-${faction}`, kind, faction };
        const led = { ...l, rep: { ...l.rep, [faction]: rep } };
        for (const t of [0, 1234, 99_999]) {
          const board = marketBoard(spec, { ...led, clock: t });
          assert.ok(board.length >= 5, `${kind} trades a useful range`);
          for (const q of board) {
            assert.ok(q.sell > 0 && q.buy > q.sell, `${kind}/${faction}/${q.id}: bid ${q.sell} < ask ${q.buy}`);
            assert.deepEqual(q, quote(spec, q.id, { ...led, clock: t }));
          }
        }
      }
});

test('station type sets supply and demand: refinery Ebon is cheap, bastion Ebon is dear', () => {
  const l = newLedger();
  const atRefinery = quote(refinery, 'ebon', l)!;
  const atBastion = quote(bastion, 'ebon', l)!;
  assert.equal(stance(refinery, 'ebon'), 'surplus');
  assert.equal(stance(bastion, 'ebon'), 'demand');
  assert.ok(atBastion.sell > atRefinery.buy, `haul Ebon refinery ${atRefinery.buy} → bastion ${atBastion.sell} pays`);
  assert.equal(quote(bastion, 'luxury', l), null, 'bastions do not trade luxuries');
});

test('drift is slow and bounded', () => {
  for (const c of COMMODITIES) {
    let max = 0;
    for (let t = 0; t < 20_000; t += 97) {
      const d = drift('drift-station', c.id, t);
      max = Math.max(max, Math.abs(d));
      // ~1 s of play never moves a price by more than a fraction of a percent.
      assert.ok(Math.abs(drift('drift-station', c.id, t + 1) - d) < 0.002);
    }
    assert.ok(max <= 0.11 + 1e-9 && max > 0.02, `${c.id} drifts (max ${max.toFixed(3)})`);
  }
});

test('buying spends shares, fills the hold, and respects capacity', () => {
  let l = { ...newLedger(), credits: 100_000, cargo: {} };
  const r = buy(l, refinery, 'ebon', 40);
  assert.equal(r.units, l.capacity);
  assert.equal(r.error, 'CARGO POD FULL');
  assert.equal(cargoUsed(r.ledger), l.capacity);
  assert.equal(r.ledger.credits, l.credits - r.total);
  assert.equal(l.cargo.ebon, undefined, 'input ledger is not mutated');
  l = { ...newLedger(), credits: 50, cargo: {} };
  const poor = buy(l, refinery, 'ebon', 1);
  assert.equal(poor.units, 0);
  assert.equal(poor.error, 'INSUFFICIENT SHARES');
  assert.equal(poor.ledger, l);
});

test('selling pays out and each unit gluts the market a notch', () => {
  const l = { ...newLedger(), cargo: { ebon: 10 } };
  const before = quote(bastion, 'ebon', l)!.sell;
  const r = sell(l, bastion, 'ebon', 10);
  assert.equal(r.units, 10);
  assert.equal(r.ledger.cargo.ebon, undefined);
  assert.equal(r.ledger.credits, l.credits + r.total);
  const after = quote(bastion, 'ebon', r.ledger)!.sell;
  assert.ok(after < before * 0.8, `bid falls with pressure (${before} → ${after})`);
  assert.ok(r.total < before * 10, 'later units sell for less');
  // Pressure relaxes with play time.
  const later = { ...r.ledger, clock: r.ledger.clock + 3600 };
  assert.ok(pressureAt(later, bastion.id, 'ebon') < pressureAt(r.ledger, bastion.id, 'ebon') * 0.05);
  assert.equal(sell(r.ledger, bastion, 'ebon', 1).error, 'NONE IN HOLD');
});

test('no free money: buying and selling back at one station always loses', () => {
  for (const kind of KINDS)
    for (const faction of FACTIONS)
      for (const rep of [-40, 0, 100]) {
        const spec = { id: `rt-${kind}-${faction}`, kind, faction };
        const l0 = { ...newLedger(), credits: 1_000_000, cargo: {}, capacity: 999, rep: { concord: rep, choir: rep, rustwake: rep } };
        for (const q of marketBoard(spec, l0)) {
          for (const n of [1, 5, 30]) {
            const b = buy(l0, spec, q.id, n);
            const s = sell(b.ledger, spec, q.id, n);
            assert.ok(s.ledger.credits < l0.credits, `${kind}/${faction}/rep ${rep}/${q.id}×${n}: ${l0.credits} → ${s.ledger.credits}`);
          }
        }
      }
});

test('trade builds standing; kills cost it; low standing bars docking', () => {
  let l = { ...newLedger(), credits: 100_000, cargo: {} };
  const rep0 = l.rep.rustwake;
  l = buy(l, freeport, 'luxury', 10).ledger;
  assert.ok(l.rep.rustwake > rep0);
  for (let i = 0; i < 60; i++) l = reputationForKill(l, 'choir');
  assert.equal(dockingClearance(l, 'choir').ok, false);
  assert.match(dockingClearance(l, 'choir').reason!, /UNWITNESSED/);
  assert.equal(dockingClearance(l, 'concord').ok, true);
  assert.ok(l.rep.choir >= -100);
});

test('hostility widens the spread and marks up services', () => {
  const spec: MarketSpec = { id: 'hesper-x', kind: 'orbital', faction: 'choir' };
  const friendly = { ...newLedger(), rep: { concord: 0, choir: 60, rustwake: 0 } };
  const hostile = { ...newLedger(), rep: { concord: 0, choir: -45, rustwake: 0 } };
  const a = quote(spec, 'medical', friendly)!;
  const b = quote(spec, 'medical', hostile)!;
  assert.ok(b.buy > a.buy && b.sell < a.sell);
  assert.ok(repairCost(spec, hostile, 0.5) > repairCost(spec, friendly, 0.5));
});

test('repair and rearm: full when affordable, partial when not', () => {
  const l = { ...newLedger(), credits: 100_000, missiles: 2 };
  const full = repair(l, bastion, 0.4);
  assert.equal(full.hull, 1);
  assert.equal(full.ledger.credits, l.credits - repairCost(bastion, l, 0.4));
  const broke = { ...l, credits: 300 };
  const part = repair(broke, bastion, 0.4);
  assert.ok(part.hull > 0.4 && part.hull < 1);
  assert.ok(part.ledger.credits >= 0 && part.cost <= 300);
  assert.equal(repair(l, bastion, 1).cost, 0);

  const armed = rearm(l, bastion);
  assert.equal(armed.ledger.missiles, MISSILE_MAX);
  assert.equal(armed.cost, rearmCost(bastion, l));
  const partArm = rearm({ ...l, credits: 200 }, bastion);
  assert.ok(partArm.ledger.missiles > 2 && partArm.ledger.missiles < MISSILE_MAX);
});

test('stored ledgers are sanitised', () => {
  assert.deepEqual(normaliseLedger(null), newLedger());
  const l = normaliseLedger({ credits: -5, cargo: { ebon: 3.7, bogus: 9, rations: -2 }, rep: { choir: -400 }, missiles: 99, clock: 'x' });
  assert.equal(l.credits, 0);
  assert.deepEqual(l.cargo, { ebon: 3 });
  assert.equal(l.rep.choir, -100);
  assert.equal(l.rep.concord, newLedger().rep.concord);
  assert.equal(l.missiles, MISSILE_MAX);
  assert.equal(l.clock, 0);
});

/** A synthetic Reach: the six key systems plus procedural ones of every allegiance. */
function reach(seed = 1994): StationSystemInput[] {
  const out: StationSystemInput[] = [];
  const ids = ['meridian', 'anchorage', 'tessaly', 'hesper', 'rustwake', 'null'];
  const factions: StationSystemInput['faction'][] = ['concord', 'concord', 'choir', 'choir', 'rustwake', 'unknown', 'concord', 'choir', 'rustwake', 'contested', 'contested', 'concord'];
  factions.forEach((faction, i) => {
    const a = i * 1.7;
    const planets = Array.from({ length: 1 + (i % 2) }, (_, k) => ({
      name: `P${i}-${k}`,
      position: new Vector3(Math.cos(a + k) * (200_000 + k * 90_000), 20_000 * k, Math.sin(a + k) * (200_000 + k * 90_000)),
      radius: 30_000 + k * 20_000,
    }));
    const gates = Array.from({ length: 1 + (i % 3) }, (_, k) => {
      const n = new Vector3(Math.cos(a * 3 + k * 2), 0, Math.sin(a * 3 + k * 2));
      return { position: n.clone().multiplyScalar(18_000 + k * 7000), normal: n };
    });
    out.push({ id: ids[i] ?? `sys${i}`, name: ids[i] ?? `Sys ${i}`, faction, planets, gates });
  });
  void seed;
  return out;
}

test('every system gets 1–3 stations, deterministic from the seed, spaced and clear of planets', () => {
  const ids = new Set<string>();
  for (const sys of reach()) {
    const a = placeStations(1994, sys);
    const b = placeStations(1994, sys);
    assert.ok(a.length >= 1 && a.length <= 3, `${sys.id}: ${a.length} stations`);
    a.forEach((s, i) => {
      assert.equal(s.name, b[i].name);
      assert.ok(s.position.equals(b[i].position));
      assert.ok(!ids.has(s.id), `unique id ${s.id}`);
      ids.add(s.id);
      assert.ok(Math.abs(s.axis.length() - 1) < 1e-6 && Math.abs(s.up.length() - 1) < 1e-6);
      assert.ok(Math.abs(s.axis.dot(s.up)) < 1e-6, 'up ⟂ axis');
      for (const p of sys.planets) assert.ok(s.position.distanceTo(p.position) > p.radius + 6000, `${s.name} clear of the planet`);
      for (const o of a) if (o !== s) assert.ok(o.position.distanceTo(s.position) > 5000, `${s.name} ↔ ${o.name}`);
      if (s.kind === 'orbital') {
        const p = sys.planets[s.planet!];
        const down = p.position.clone().sub(s.position).normalize();
        assert.ok(down.dot(s.axis) < -0.99, 'orbital ports face straight up out of the well');
      }
    });
    const other = placeStations(7, sys);
    if (!['meridian', 'anchorage', 'tessaly', 'hesper', 'rustwake', 'null'].includes(sys.id)) {
      assert.ok(other.some((s, i) => !a[i] || !s.position.equals(a[i].position)), 'a different seed moves them');
    }
  }
  const meridian = placeStations(1994, reach()[0]);
  assert.ok(meridian.some((s) => s.kind === 'refinery' && /Tey/.test(s.name)), 'the Tey works at Castellan');
  assert.ok(placeStations(1994, reach()[4]).some((s) => s.kind === 'freeport'));
});

test('the market finds a buyer elsewhere; rumours are lore-flavoured and stable', () => {
  const markets = reach().flatMap((s) => placeStations(1994, s));
  const l = newLedger();
  const best = bestBid(markets, 'ebon', l);
  const refineryAsk = quote(markets.find((m) => m.kind === 'refinery')!, 'ebon', l)!.buy;
  assert.ok(best && best.price > refineryAsk, `Ebon hauling pays (${refineryAsk} → ${best?.price})`);
  const st = markets.find((m) => m.kind === 'refinery')!;
  const lines = rumours({ station: st, systemName: 'Tessaly', clock: 100, markets, ledger: l });
  assert.ok(lines.length >= 4);
  assert.deepEqual(lines, rumours({ station: st, systemName: 'Tessaly', clock: 100, markets, ledger: l }));
  assert.ok(lines.some((s) => /BAND TALK: .* \d+ sh/.test(s)), 'a price tip is included');
});

test('campaign hook: onDocked sets flags a mission can key off', async () => {
  const { CampaignRunner } = await import('../src/game/CampaignRunner.ts');
  const host = {
    playerPosition: new Vector3(),
    playerAlive: true,
    playerHull: 1,
    systemId: 'meridian',
    jumps: 0,
    ships: [],
    gatePosition: () => new Vector3(),
    spawnShip: () => ({}) as never,
    spawnSetPiece: (s: { tag: string }, p: Vector3) => ({ tag: s.tag, position: p, radius: 1 }),
    playChatter: () => {},
    unlockCodex: () => {},
  };
  const mission = {
    id: 'dock-test',
    chapter: 1,
    episode: 1,
    title: 'Dock',
    milestones: [],
    system: 'meridian',
    briefing: '',
    tagline: '',
    debrief: '',
    codex: [],
    spawns: [],
    setpieces: [],
    objectives: [{ id: 'dock', text: 'Dock at Castellan Highport', done: (c: { flag(n: string): boolean }) => c.flag('docked:meridian-orbital-0') }],
    chatter: [],
  };
  const r = new CampaignRunner(mission as never, host as never);
  r.begin();
  r.update(0.1);
  assert.equal(r.state[0], 'active');
  r.onDocked('meridian-orbital-0');
  r.update(0.1);
  assert.ok(r.flags.has('docked'));
  assert.equal(r.state[0], 'done');
});
