#!/usr/bin/env node
/**
 * MP-0 determinism check (headless, no renderer).
 *
 *   npm run determinism                       # 10 simulated minutes per scenario
 *   node scripts/determinism.mjs --minutes 2  # quicker
 *   node scripts/determinism.mjs capital      # one scenario
 *
 * For each scenario (dogfight · capital · traffic · station) the world is flown four
 * times at the fixed 60 Hz step with a scripted player: A records a replay,
 * B repeats the seed + script, C flies the player from A's replay (after a
 * JSON round trip), D uses the next seed. Pass: A = B = C bit-for-bit at
 * every one-second checkpoint, and D differs. Exit 1 on any failure.
 * The TypeScript lives in src/sim/determinism.ts (loaded through Vite's SSR
 * loader, like scripts/ai-sim.mjs).
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const minutes = Number(opt('minutes', '10'));
const filter = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--minutes') ?? '';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });

let failed = 0;
try {
  const det = await server.ssrLoadModule('/src/sim/determinism.ts');
  const t0 = performance.now();
  for (const name of det.SCENARIOS.filter((n) => n.includes(filter))) {
    const r = det.checkScenario(name, minutes);
    if (!r.pass) failed++;
    const s = r.stats;
    console.log(`\n■ ${name} · ${r.minutes} simulated min · ${r.checkpoints} checkpoints (1/s) · ${r.msPerRun} ms/run`);
    console.log(`  world: ${s.ships} ships spawned · ${s.shots} gun shots · ${s.missiles} missiles · ${s.kills} kills · final hash ${r.final}`);
    console.log(`  ${r.sameSeed.firstMismatch < 0 ? 'PASS' : 'FAIL'}  same seed + script, run twice: ${r.sameSeed.matched}/${r.checkpoints} checkpoints bit-identical${r.sameSeed.firstMismatch > 0 ? ` (first mismatch at ${r.sameSeed.firstMismatch} s)` : ''}`);
    console.log(`  ${r.replay.firstMismatch < 0 ? 'PASS' : 'FAIL'}  recorded input replayed: ${r.replay.matched}/${r.checkpoints} checkpoints bit-identical${r.replay.firstMismatch > 0 ? ` (first mismatch at ${r.replay.firstMismatch} s)` : ''} · replay ${(r.replay.bytes / 1024).toFixed(1)} KB (${r.replay.kbPerMin} KB/min base64, ${r.replay.commands} commands)`);
    console.log(`  ${r.otherSeedDiffers ? 'PASS' : 'FAIL'}  a different seed gives a different world (hash sensitivity)`);
  }
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} SCENARIO(S) FAILED`} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error(e);
  failed = 1;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
