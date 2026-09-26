import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

/**
 * MP-0 guard inside `npm test`: a short version of `npm run determinism`
 * (30 simulated seconds per scenario instead of 10 minutes). Same seed and
 * script twice, and the recorded input replayed after a JSON round trip,
 * must hash identically every second; another seed must not.
 */
let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

async function det() {
  server ??= await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  return server.ssrLoadModule('/src/sim/determinism.ts');
}

for (const scenario of ['dogfight', 'capital', 'traffic', 'station']) {
  test(`determinism: ${scenario} — same seed, same script, recorded replay → bit-identical`, async () => {
    const d = await det();
    const r = d.checkScenario(scenario, 0.5);
    assert.equal(r.checkpoints, 30);
    assert.equal(r.sameSeed.firstMismatch, -1, `same-seed runs diverge at ${r.sameSeed.firstMismatch} s`);
    assert.equal(r.replay.firstMismatch, -1, `replay diverges at ${r.replay.firstMismatch} s`);
    assert.ok(r.otherSeedDiffers, 'another seed gives the same world (hash not sensitive)');
    assert.ok(r.stats.shots > 0, 'the fight happened');
  });
}
