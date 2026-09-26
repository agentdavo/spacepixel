import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { MISSIONS } from '../src/game/campaign/missions.ts';

/**
 * Headless EP01 by ordinary input (scripts/first-session-route.mjs): the
 * HUD-following pilot's recorded take completes every objective in order and
 * replays bit-for-bit from the tape alone. Seed 22 is the one winning seed
 * of 1–100 for this pilot (see docs/FIRST-SESSION-ROUTE-2026-09-26.md);
 * a change to combat, AI, flight or the episode will move it.
 */
let server: ViteDevServer;
let R: any;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  R = await server.ssrLoadModule('/src/sim/episodeRoute.ts');
});
after(async () => { await server?.close(); });

test('EP01 ordinary-input take: success in objective order, then deterministic replay from the tape', () => {
  const A = R.runEpisode({ seed: 22, record: true });
  const done = A.events.filter((e: any) => e.kind === 'objective' && e.detail.endsWith('→ done')).map((e: any) => e.detail.split(':')[0]);
  assert.deepEqual(done, ['buoy1', 'buoy2', 'buoy3', 'thieves', 'beacon', 'yards']);
  assert.equal(A.outcome, 'success');
  assert.equal(A.jumped, null);
  assert.equal(A.stats.kills.rustwake, 3);
  const tape = JSON.parse(JSON.stringify(A.take));
  assert.equal(tape.commands[0].c, 'episode');
  assert.equal(tape.commands[0].t, 0);
  const B = R.runEpisode({ seed: 22, replay: tape });
  assert.deepEqual(B.hashes, A.hashes);
  assert.equal(B.outcome, 'success');
  assert.equal(B.outcomeTick, A.outcomeTick);
  assert.deepEqual(tape.checks.map((c: any) => c[1]), A.hashes);
});

test('the pilot sees exactly the HUD view on EP01: stationary +Z start, Survey Buoy 1 marker, no target', () => {
  const S = new R.HeadlessFlight(1994);
  const session = S.beginCampaign(MISSIONS[0]);
  assert.equal(S.systemId, 'anchorage');
  assert.equal(S.player.flight.velocity.length(), 0);
  S.simStep();
  const hud = R.hudViewOf(S);
  assert.deepEqual(R.pilotView(S, session.runner, { thieves: 'graveyard' }), hud, 'authored navigation: no extra destinations');
  const buoy1 = session.runner.resolve({ at: 'tag', tag: 'buoy1', offset: [0, 0, 0] });
  assert.ok(hud.marker && hud.marker.distanceTo(buoy1) < 1e-6);
  assert.equal(hud.target, null);
  assert.equal(hud.hostilesPresent, false);
  S.disposeCampaign();
});

test('wing keys reach the episode wingman (Candle), not only the parked free-flight wing, and go on the tape', async () => {
  const { brainOf } = await server.ssrLoadModule('/src/sim/ai/index.ts');
  const S = new R.HeadlessFlight(1994);
  const session = S.beginCampaign(MISSIONS[0]);
  S.simStep();
  const [candle] = session.runner.shipsTagged('candle');
  assert.ok(candle && candle.alive);
  assert.equal(brainOf(candle).order, 'formUp');
  S.simKey('Digit3');
  assert.equal(brainOf(candle).order, 'engageAtWill');
  S.simKey('Digit1');
  assert.equal(brainOf(candle).order, 'formUp');
  S.disposeCampaign();

  // Recorded as a 'key' command when the pilot presses it, and replayed from the tape.
  const A = R.runEpisode({ seed: 22, record: true, seconds: 70, pilot: { fireCone: 0.06, missileEvery: 3, targetEvery: 0.5, wingOrder: 'Digit3' } });
  const keys = A.take.commands.filter((c: any) => c.c === 'key');
  assert.deepEqual(keys.map((c: any) => c.a), ['Digit3']);
  const B = R.runEpisode({ seed: 22, replay: JSON.parse(JSON.stringify(A.take)) });
  assert.deepEqual(B.hashes, A.hashes);
});
