/**
 * Front-end flow smoke test (headless): a fresh profile goes title → prologue
 * → (skip) → Episode 1; the prologue is remembered and not replayed.
 * The opening launch uses ordinary UI inputs; later mission transitions below
 * are explicitly a debug regression, not proof of playing those missions.
 *
 *   node scripts/flow-check.mjs [--port 5250] [--out <dir>] [--browser msedge]
 *
 * Prints PASS/FAIL per step and exits non-zero on any failure.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 5250));
const out = opt('out', 'flow-check');
mkdirSync(out, { recursive: true });

const server = await createServer({ cacheDir: `node_modules/.vite-flow-${port}`, server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  channel: opt('browser', process.platform === 'win32' ? 'msedge' : 'chromium'),
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
});
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const T = 300_000;

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });

  await page.waitForSelector('.title-screen', { timeout: T });
  check('title screen shows', true);
  const backend = await page.evaluate(() => window.__VANGUARD__?.backend);
  check('renderer is WebGPU', backend === 'WebGPU', String(backend));

  await page.keyboard.press('Enter'); // first item: launch
  const reel = await page.waitForSelector('.cinema', { timeout: T }).then(() => true, () => false);
  check('fresh profile: launch plays the prologue first', reel);
  if (reel) {
    await page.waitForSelector('.cn-cap', { timeout: T }).catch(() => {});
    await page.screenshot({ path: `${out}/1-prologue.png`, timeout: T });
    await page.keyboard.press('Space'); // skip
  }
  const eyecatch = await page.waitForSelector('.eyecatch', { timeout: T }).then(() => true, () => false);
  check('skip hands off to the Episode 1 eyecatch', eyecatch);
  if (eyecatch) await page.screenshot({ path: `${out}/2-eyecatch.png`, timeout: T });
  const seen = await page.evaluate(() => Object.values(localStorage).some((v) => v.includes('"seenPrologue":true')));
  check('profile remembers seenPrologue', seen);

  // Second launch: straight to the episode.
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
  await page.waitForSelector('.title-screen', { timeout: T });
  await page.keyboard.press('Enter');
  const first = await Promise.race([
    page.waitForSelector('.cinema', { timeout: T }).then(() => 'prologue'),
    page.waitForSelector('.eyecatch', { timeout: T }).then(() => 'eyecatch'),
  ]).catch(() => 'nothing');
  check('second launch skips the prologue', first === 'eyecatch', `(got ${first})`);
  await page.waitForSelector('.briefing', { timeout: T });
  await page.keyboard.press('Space'); // finish the briefing's typewriter
  await page.waitForFunction(() => document.querySelector('.briefing .body')?.textContent?.includes('Keep the light.'), null, { timeout: T });
  await page.keyboard.press('Space'); // launch
  await page.waitForFunction(() => window.__VANGUARD__?.hooks?.scene?.campaign?.mission?.episode === 1, null, { timeout: T });
  const opening = await page.evaluate(() => {
    const s = window.__VANGUARD__.hooks.scene, f = s.player.flight;
    return { system: s.currentSystemId(), position: f.position.toArray(), speed: f.velocity.length(), throttle: f.throttle, nav: s.campaign.runner.navigation()?.tag, forward: f.forward().toArray() };
  });
  check('EP01 starts stationary facing the first survey buoy', opening.speed === 0 && opening.throttle === 0 && opening.nav === 'buoy1' && opening.forward[2] > 0.999, JSON.stringify(opening));
  await page.waitForTimeout(30_000); // actual opening dialogue, no sim stepping
  const settled = await page.evaluate(() => {
    const s = window.__VANGUARD__.hooks.scene;
    return { system: s.currentSystemId(), speed: s.player.flight.velocity.length(), nav: s.campaign.runner.navigation()?.tag, backend: window.__VANGUARD__.backend };
  });
  check('opening dialogue does not drift through a gate', settled.system === opening.system && settled.speed === 0 && settled.nav === 'buoy1', JSON.stringify(settled));
  check('flight scene preserves native renderer telemetry', settled.backend === 'WebGPU');
  await page.screenshot({ path: `${out}/3-opening-waypoint.png`, timeout: T });

  // Explicit debug-only regression for existing combat/escort starts and the
  // return to free roam. These calls do not constitute a live career playthrough.
  const transitions = await page.evaluate(async () => {
    const { MISSIONS } = await import('/src/game/campaign/missions.ts');
    const s = window.__VANGUARD__.hooks.scene, results = [];
    for (const m of [MISSIONS.find((m) => m.episode > 1 && !m.spawns.some((p) => p.role === 'escort')), MISSIONS.find((m) => m.spawns.some((p) => p.role === 'escort'))]) {
      void s.startCampaign(m);
      const f = s.player.flight, expected = s.view.gates[0]?.link.normal;
      results.push({ id: m.id, speed: f.velocity.length(), throttle: f.throttle, aligned: !expected || f.forward().dot(expected) > 0.999, nav: s.campaign.runner.navigation()?.tag ?? null });
    }
    void s.startFreeRoam(s.contracts.homeStation(), null);
    return { missions: results, cleared: s.campaign == null, gate: !!s.navGate() };
  });
  for (const m of transitions.missions) check(`DEBUG existing launch unchanged: ${m.id}`, Math.abs(m.speed - 160) < 0.001 && m.throttle === 0.7 && m.aligned && m.nav === null, JSON.stringify(m));
  check('DEBUG free roam clears campaign navigation and retains gate route', transitions.cleared && transitions.gate, JSON.stringify(transitions));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}
const ok = results.every(Boolean);
console.log(ok ? 'ALL PASS' : 'FAILURES');
process.exit(ok ? 0 : 1);
