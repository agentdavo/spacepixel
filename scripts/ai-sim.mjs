#!/usr/bin/env node
/**
 * Headless AI simulation test (M13/M14).
 *
 *   node scripts/ai-sim.mjs            # run every scenario, exit 1 on any failure
 *   node scripts/ai-sim.mjs dogfight   # only scenarios whose name contains "dogfight"
 *
 * Runs FlightModel + AI + stand-in guns at a fixed 60 Hz step with no
 * renderer. The TypeScript lives in src/sim/ai/sim.ts; Vite's SSR loader
 * resolves the `@/` alias and TS without any extra dependency.
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
  const sim = await server.ssrLoadModule('/src/sim/ai/sim.ts');
  const t0 = performance.now();
  const results = sim.runAll(filter);
  for (const r of results) {
    console.log(`\n■ ${r.name}`);
    console.log('  ' + Object.entries(r.metrics).map(([k, v]) => `${k}=${v}`).join('  '));
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
