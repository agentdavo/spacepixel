#!/usr/bin/env node
/**
 * Economy balance sim (docking & trade).
 *
 *   npm run econ-sim            # print the best routes per 16-unit hold, exit 1 outside the bands
 *   npm run econ-sim -- -v      # every scan, not just the summary
 *
 * Loads the real seeded Reach (seed 1994) through Vite's SSR loader, adds the
 * Hesperus Dawn's hangar market in Directorate space, and scans every
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

  // ── World scenarios (src/game/world): how far the story and the pilot move the default Reach ──
  const W = await server.ssrLoadModule('/src/game/world/sim.ts');
  const WS = await server.ssrLoadModule('/src/game/world/econScenarios.ts');
  const T = await server.ssrLoadModule('/src/universe/traffic.ts');
  const scenario = (name, value, pass, rule) => {
    if (!pass) failed++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}: ${value}  (${rule})`);
  };
  const pct = (a, b) => `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%`;

  // 1. After Episode 19: the Symphony of Gates. Ebon collapses; gate fuel is free.
  console.log('\n■ Scenario: after Episode 19 (gates aligned)');
  const post = WS.econShift(W.fastForward(19), markets, hops, 12);
  const P = WS.POSTGAME;
  console.log(`    refinery Ebon mid ${Math.round(post.ebon[0])} → ${Math.round(post.ebon[1])} sh a flask (${pct(post.ebon[0], post.ebon[1])}) · Lantern toll ${W.lanternToll(W.fastForward(18))} → ${W.lanternToll(W.fastForward(19))} sh`);
  console.log(`    mids: ${Object.entries(post.mids).map(([k, [a, b]]) => `${k} ${pct(a, b)}`).join(' · ')}`);
  console.log(`    best safe ${post.before.safe.median} → ${post.after.safe.median} sh/hold (median) · risky ${post.before.risky.median} → ${post.after.risky.median} · starter ${post.before.starter.median} → ${post.after.starter.median}`);
  console.log(`    best safe route now  ${fmt(post.after.scans[0].bestSafe)}`);
  scenario('post-Ep19 refinery Ebon collapses', pct(post.ebon[0], post.ebon[1]), post.ebon[1] <= post.ebon[0] * (1 - P.ebonDrop), `≤ −${P.ebonDrop * 100}%`);
  scenario('post-Ep19 Ebon leaves the safe trade', `${Math.round(post.ebonInSafe * 100)}% of best holds carry Ebon`, post.ebonInSafe <= P.ebonInSafe, `≤ ${P.ebonInSafe * 100}%`);
  scenario('post-Ep19 the Reach still pays a living', post.after.safe.median, post.after.safe.median >= P.safeMedianMin, `safe median ≥ ${P.safeMedianMin}`);
  scenario('post-Ep19 gate fuel is free', W.lanternToll(W.fastForward(19)), W.lanternToll(W.fastForward(19)) === 0 && W.lanternToll(W.fastForward(18)) > 0, 'toll 0 after, > 0 before');

  // 2. After Episode 10: the Bastion falls. Anchorage bids up rations and medical.
  console.log('\n■ Scenario: after Episode 10 (the Bastion falls)');
  const anch = markets.filter((m) => m.system === 'anchorage' && !m.id.startsWith('carrier:'));
  const sysOf = (id) => markets.find((m) => m.id === id)?.system ?? '';
  const bid = (cid) => WS.meanMid(anch, cid);
  const r0 = bid('rations');
  const m0 = bid('medical');
  const [r1, m1] = WS.withWorld(W.fastForward(10), sysOf, () => [bid('rations'), bid('medical')]);
  console.log(`    Anchorage rations ${r0.toFixed(0)} → ${r1.toFixed(0)} (${pct(r0, r1)}) · medical ${m0.toFixed(0)} → ${m1.toFixed(0)} (${pct(m0, m1)})`);
  scenario('post-Ep10 refugee demand at Anchorage', `${pct(r0, r1)} / ${pct(m0, m1)}`, r1 >= r0 * 1.25 && m1 >= m0 * 1.25, 'rations and medical ≥ +25%');

  // 3. The pilot clears a lane: three ambushes broken on the most raided system.
  const raided = [...u.systems.values()].filter((sy) => sy.faction === 'contested').sort((a, b) => T.systemTraffic(u.seed, b).piracy - T.systemTraffic(u.seed, a).piracy || b.threat - a.threat)[0];
  console.log(`\n■ Scenario: a cleared lane (${raided.name}, three ambushes broken)`);
  const t0s = T.systemTraffic(u.seed, raided);
  let cleared = W.fastForward(0);
  for (let i = 0; i < 3; i++) cleared = W.actAmbush(cleared, raided.id, 'concord', 3, true);
  const t1s = WS.withWorld(cleared, sysOf, () => T.systemTraffic(u.seed, raided));
  console.log(`    sailings ${Math.round(t0s.perHour)} → ${Math.round(t1s.perHour)} /h (${pct(t0s.perHour, t1s.perHour)}) · raid rate ${t0s.piracy.toFixed(2)} → ${t1s.piracy.toFixed(2)} · safe fact: ${!!cleared.facts[`lane.${raided.id}.safe`]}`);
  scenario('cleared lane: traffic up', pct(t0s.perHour, t1s.perHour), t1s.perHour >= t0s.perHour * 1.2, '≥ +20%');
  scenario('cleared lane: raids down', `${t0s.piracy.toFixed(2)} → ${t1s.piracy.toFixed(2)}`, t1s.piracy <= t0s.piracy * 0.5, '≤ half');
  const tHour = WS.withWorld((await server.ssrLoadModule('/src/game/world/WorldState.ts')).tick(cleared, 3 * 3600), sysOf, () => T.systemTraffic(u.seed, raided));
  scenario('cleared lane: still quieter three hours on', `${tHour.piracy.toFixed(2)}`, tHour.piracy < t0s.piracy, `< ${t0s.piracy.toFixed(2)}`);
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECK(S) FAILED`} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error(e);
  failed = 1;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
