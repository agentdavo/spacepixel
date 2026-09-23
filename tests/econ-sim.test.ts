import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BANDS, SAFE_RISK, bestHold, scanRoutes, summarise, type SimMarket } from '../src/game/econSim.ts';
import { buy, newLedger, sell, hazard } from '../src/game/economy.ts';
import { placeStations, systemRisk, type StationSystemInput } from '../src/universe/stations.ts';

/**
 * Economy balance on a synthetic Reach (the real one is `npm run econ-sim`):
 * a chain of systems from Directorate home space through Rustwake and the
 * contested line into Hegemony space and the Null Lantern.
 */
const CHAIN: { id: string; faction: StationSystemInput['faction']; threat: number }[] = [
  { id: 'meridian', faction: 'concord', threat: 0.1 },
  { id: 'anchorage', faction: 'concord', threat: 0.2 },
  { id: 'c1', faction: 'concord', threat: 0.25 },
  { id: 'rustwake', faction: 'rustwake', threat: 0.1 },
  { id: 'r1', faction: 'rustwake', threat: 0.2 },
  { id: 'x1', faction: 'contested', threat: 0.55 },
  { id: 'x2', faction: 'contested', threat: 0.65 },
  { id: 'tessaly', faction: 'choir', threat: 0.8 },
  { id: 'h1', faction: 'choir', threat: 0.75 },
  { id: 'null', faction: 'unknown', threat: 1 },
];

function reach(): { markets: SimMarket[]; hops: (a: string, b: string) => number } {
  const markets: SimMarket[] = [];
  CHAIN.forEach((sys, i) => {
    const a = i * 1.3;
    const input: StationSystemInput = {
      id: sys.id,
      name: sys.id,
      faction: sys.faction,
      planets: [{ name: `${sys.id}-p`, position: new Vector3(Math.cos(a) * 250_000, 0, Math.sin(a) * 250_000), radius: 40_000 }, { name: `${sys.id}-q`, position: new Vector3(-Math.cos(a) * 300_000, 20_000, -Math.sin(a) * 300_000), radius: 60_000 }],
      gates: [0, 1].map((k) => {
        const n = new Vector3(Math.cos(a * 3 + k * 2), 0, Math.sin(a * 3 + k * 2));
        return { position: n.clone().multiplyScalar(20_000 + k * 6000), normal: n };
      }),
    };
    const risk = systemRisk(sys.threat, sys.faction, CHAIN[i + 1]?.id === 'null');
    for (const st of placeStations(1994, input)) markets.push({ id: st.id, name: st.name, kind: st.kind, faction: st.faction, risk, system: sys.id });
    if (sys.faction === 'concord') markets.push({ id: 'carrier:Hesperus Dawn', name: 'Hesperus Dawn', kind: 'carrier', faction: 'concord', risk: 0, system: sys.id });
  });
  const idx = new Map(CHAIN.map((s, i) => [s.id, i]));
  return { markets, hops: (a, b) => Math.abs(idx.get(a)! - idx.get(b)!) };
}

test('system risk: home space is safe, the line and the Null Lantern are not', () => {
  assert.ok(systemRisk(0.2, 'concord') <= SAFE_RISK);
  assert.ok(systemRisk(0.5, 'contested') > SAFE_RISK);
  assert.equal(systemRisk(0.3, 'unknown'), 1);
  assert.ok(systemRisk(0.2, 'concord', true) > systemRisk(0.2, 'concord'), 'the Null shadow adds risk');
  assert.equal(hazard({ id: 'x', kind: 'bastion', faction: 'concord', risk: 0.2 }), 0, 'no hazard premium in home space');
  assert.ok(hazard({ id: 'x', kind: 'bastion', faction: 'concord', risk: 1 }) === 1);
});

test('hazard premium: a risky bastion pays more for Ebon than a safe one', () => {
  const l = newLedger();
  const safe: SimMarket = { id: 'b-safe', kind: 'bastion', faction: 'concord', risk: 0.1, name: 'S', system: 's' };
  const risky: SimMarket = { ...safe, risk: 0.9 };
  const q = (m: SimMarket) => sell(buy({ ...l, credits: 1e6 }, m, 'ebon', 1).ledger, m, 'ebon', 1);
  // Same id so drift matches; only the hazard differs.
  assert.ok(q(risky).total > q(safe).total * 1.15, `${q(risky).total} vs ${q(safe).total}`);
});

test('a mixed hold is never worse than nothing, and pressure caps a single-commodity haul', () => {
  const { markets } = reach();
  const l = newLedger();
  for (const a of markets.slice(0, 8))
    for (const b of markets.slice(0, 8)) {
      if (a.id === b.id) continue;
      const r = bestHold(a, b, l);
      assert.ok(r.profit >= 0, `${a.id} → ${b.id}: ${r.profit}`);
      assert.ok(r.units <= l.capacity);
    }
});

test('balance bands: safe runs earn low thousands per hold, the fat margins need risk', () => {
  const { markets, hops } = reach();
  const s = summarise(markets, hops, 8, 2);
  const line = `safe median ${s.safe.median} (max ${s.safe.max}) · risky median ${s.risky.median} (max ${s.risky.max}) · starter ${s.starter.median}`;
  console.log(`  econ: ${line}`);
  assert.ok(s.safe.median >= BANDS.safeMedian[0] && s.safe.median <= BANDS.safeMedian[1], `safe median in band: ${line}`);
  assert.ok(s.safe.max <= BANDS.safeMax, `safe max: ${line}`);
  assert.ok(s.risky.median > s.safe.median * 1.25, `risk pays: ${line}`);
  assert.ok(s.risky.max <= BANDS.riskyMax, `risky max: ${line}`);
  assert.ok(s.starter.median >= BANDS.starterMin, `a fresh pilot can make a first run: ${line}`);
});

test('in-system loop exists but is modest', () => {
  const { markets } = reach();
  const sc = scanRoutes(markets, (a, b) => (a === b ? 0 : Infinity), 900, 0);
  assert.ok(sc.bestSafe && sc.bestSafe.profit > 0 && sc.bestSafe.profit <= BANDS.safeMedian[1], `in-system best ${sc.bestSafe?.profit}`);
});
