#!/usr/bin/env node
/**
 * Economy balance sim (docking & trade).
 *
 *   npm run econ-sim            # print the best routes per 16-unit hold, exit 1 outside the bands
 *   npm run econ-sim -- -v      # every scan, not just the summary
 *
 * Loads the real seeded Reach (seed 1994) through Vite's SSR loader, adds the
 * Hesperus Dawn's hangar market in Directorate space and the surface ports
 * under the orbital tethers, and scans every
 * station pair within two Lantern hops at 12 points over ~4 h of play clock.
 * Pure logic lives in src/game/econSim.ts (also run by tests/econ-sim.test.ts).
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const verbose = process.argv.includes('-v');
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });

let failed = 0;
try {
  const gen = await server.ssrLoadModule('/src/universe/generate.ts');
  const U = await server.ssrLoadModule('/src/universe/Universe.ts');
  const sim = await server.ssrLoadModule('/src/game/econSim.ts');
  const econ = await server.ssrLoadModule('/src/game/economy.ts');
  const u = gen.generateUniverse(1994);
  const markets = [];
  for (const sys of u.systems.values()) {
    for (const st of sys.stations) markets.push({ id: st.id, name: st.name, kind: st.kind, faction: st.faction, risk: st.risk ?? 0, system: sys.id });
    for (const st of sys.surfacePorts ?? []) markets.push({ id: st.id, name: st.name, kind: st.kind, faction: st.faction, risk: st.risk ?? 0, system: sys.id });
    if (sys.faction === 'concord') markets.push({ id: 'carrier:Hesperus Dawn', name: 'Hesperus Dawn', kind: 'carrier', faction: 'concord', risk: 0, system: sys.id });
  }
  const hopCache = new Map();
  const hops = (a, b) => {
    const k = `${a}>${b}`;
    if (!hopCache.has(k)) {
      const r = U.route(u, a, b);
      hopCache.set(k, r.length ? r.length - 1 : Infinity);
    }
    return hopCache.get(k);
  };
  const t0 = performance.now();
  const s = sim.summarise(markets, hops, 12, 2);
  const fmt = (r) =>
    r
      ? `${String(r.profit).padStart(6)} sh  ${r.from.name} (${r.from.system}, risk ${(r.from.risk ?? 0).toFixed(2)}) → ${r.to.name} (${r.to.system}, risk ${(r.to.risk ?? 0).toFixed(2)})  ${hops(r.from.system, r.to.system)} hop(s)  outlay ${r.outlay}  ${Object.entries(r.mix).map(([k, v]) => `${k}×${v}`).join(' ')}`
      : '—';
  console.log(`■ Reach: ${u.systems.size} systems · ${markets.length} markets · hold ${econ.newLedger().capacity} units · start purse ${econ.newLedger().credits} sh`);
  for (const sc of s.scans) {
    if (!verbose && sc !== s.scans[0] && sc !== s.scans[6]) continue;
    console.log(`\n  clock ${(sc.clock / 60).toFixed(0)} min`);
    console.log(`    best safe    ${fmt(sc.bestSafe)}`);
    console.log(`    best risky   ${fmt(sc.bestRisky)}`);
    console.log(`    starter run  ${fmt(sc.bestStarter)}`);
  }
  // Reference lines: the in-system loop, and a straight 16-flask Ebon haul on the fattest safe Ebon lane.
  const sc0 = sim.scanRoutes(markets, (a, b) => (a === b ? 0 : Infinity), 600, 0);
  console.log(`\n  in-system best  ${fmt(sc0.bestSafe)}`);
  const l0 = { ...econ.newLedger(), clock: 600, pressure: {}, cargo: {}, credits: 1e9, capacity: 16 };
  let ebon = null;
  for (const a of markets)
    for (const b of markets) {
      if (a.id === b.id || Math.max(a.risk ?? 0, b.risk ?? 0) > sim.SAFE_RISK || hops(a.system, b.system) > 2) continue;
      const bought = econ.buy(l0, a, 'ebon', 16);
      if (bought.units < 16) continue;
      const sold = econ.sell(bought.ledger, b, 'ebon', 16);
      if (sold.units < 16) continue;
      const p = sold.ledger.credits - l0.credits;
      if (!ebon || p > ebon.p) ebon = { p, a, b };
    }
  if (ebon) console.log(`  16 Ebon flasks, best safe lane: ${ebon.p} sh  (${ebon.a.name} → ${ebon.b.name}; was ~16k before the rebalance)`);
  const B = sim.BANDS;
  const checks = [
    { name: 'best safe route, median over clock', value: s.safe.median, pass: s.safe.median >= B.safeMedian[0] && s.safe.median <= B.safeMedian[1], rule: `${B.safeMedian[0]}–${B.safeMedian[1]} sh / hold` },
    { name: 'best safe route, luckiest clock', value: s.safe.max, pass: s.safe.max <= B.safeMax, rule: `≤ ${B.safeMax}` },
    { name: 'best risky route, median', value: s.risky.median, pass: s.risky.median > s.safe.median * 1.25, rule: `> 1.25 × safe median (${Math.round(s.safe.median * 1.25)})` },
    { name: 'best risky route, luckiest clock', value: s.risky.max, pass: s.risky.max <= B.riskyMax, rule: `≤ ${B.riskyMax}` },
    { name: 'starter run (2,500 sh purse), median', value: s.starter.median, pass: s.starter.median >= B.starterMin, rule: `≥ ${B.starterMin}` },
  ];
  console.log('');
  for (const c of checks) {
    if (!c.pass) failed++;
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.value}  (${c.rule})`);
  }
  // Progression estimate: ~5 min per safe run (dock, fly, jump, dock), ~7 min risky.
  const perHourSafe = Math.round((s.safe.median * 60) / 5);
  const perHourRisky = Math.round((s.risky.median * 60) / 7);
  console.log(`  INFO  progression: ~${perHourSafe} sh/h safe, ~${perHourRisky} sh/h risky (5 / 7 min a run) → a 20k ship in ~${Math.round((20000 / perHourSafe) * 60)} min safe`);
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECK(S) FAILED`} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error(e);
  failed = 1;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
