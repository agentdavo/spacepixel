#!/usr/bin/env node
/**
 * Headless combat balance with pass/fail numbers.
 *
 *   node scripts/balance.mjs            # every scenario, exit 1 on any failure
 *   node scripts/balance.mjs turret     # only scenarios whose name contains "turret"
 *
 * Real Weapons / Missiles / damage routing at a fixed 60 Hz with scripted,
 * well-aimed shooters (src/sim/balance.ts), loaded through Vite's SSR loader.
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const filter = process.argv[2] ?? '';
const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
});

let failed = 0;
try {
  const sim = await server.ssrLoadModule('/src/sim/balance.ts');
  const t0 = performance.now();
  const results = sim.runAll(filter);
  for (const r of results) {
    console.log(`\n■ ${r.name}`);
    for (const [k, v] of Object.entries(r.metrics)) console.log(`  ${k}: ${v}`);
    for (const c of r.checks) {
      if (!c.pass) failed++;
      console.log(`  ${c.info ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.value}  (${c.rule})`);
    }
  }
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECK(S) FAILED`} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error(e);
  failed = 1;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
