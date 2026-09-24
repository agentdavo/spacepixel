#!/usr/bin/env node
/**
 * In-browser replay check: the real game, recorded and played back.
 *
 *   node scripts/replay-check.mjs [--seconds 20] [--port 5394] [--query 'traffic=0'] [--dock]
 *
 * 1. Boots `?scene=flight&shot=1` (fixed 1/60 frames, one sim tick each) and
 *    flies it with scripted key presses (stick, trigger, missiles, target
 *    cycling, a wing order) for N simulated seconds; the ReplayDirector
 *    records the take with a world-hash checkpoint every second.
 * 2. Reboots into that tape (`hooks.replay.load` → ?replay=session), seeks
 *    (unrendered fast-forward) through the first half and plays the rest
 *    through the engine's fixed-step loop, rendering, to the end.
 * Pass: every checkpoint of the playback matches the recording bit-for-bit
 * (the deck's SYNC count), no desync, and the Reach's WorldState (guilds,
 * outposts, conversations: the tape's 'world-patch' commands) ends the same.
 *
 * --dock starts berthed (`dock=docked&cargo=demo`) and works the dock screen
 * first — buy, sell, repair, rearm, launch — so the tape carries dock-screen
 * commands (ledger, hull, launch) before the flying. Either way the take
 * starts with a world change made outside a tick (as a conversation makes one).
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const seconds = Number(opt('seconds', '20'));
const port = Number(opt('port', '5394'));
const extra = opt('query', '');
const dock = args.includes('--dock');
const [width, height] = opt('size', '640x360').split('x').map(Number);

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
let code = 0;
const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/?scene=flight&shot=1&demo=0&hud=0&killcam=0${dock ? '&dock=docked&cargo=demo' : ''}${extra ? '&' + extra : ''}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || (window.__VANGUARD__?.hooks?.replay && window.__VANGUARD__.frame() > 30), null, { timeout: 600_000, polling: 250 });
  if (dock) {
    // Berthed: the world holds still; the dock screen's market / repair / launch.
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'KeyR', 'KeyE', 'Enter']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(400);
    }
    await page.waitForFunction(() => window.__VANGUARD__.hooks.replay.state().tick > 240, null, { timeout: 600_000, polling: 250 });
  }
  // A conversation's world change, made outside a tick: the tape's 'world-patch'.
  await page.waitForFunction(() => window.__VANGUARD__.hooks.replay.state().tick > 30, null, { timeout: 600_000, polling: 250 });
  await page.evaluate(() =>
    import('/src/game/world/WorldState.ts').then((m) => {
      m.world().update((w) => m.bump(m.setFact(w, 'replay-check.spoke', 'dockmaster'), 'replay-check.visits'));
      m.world().event('replay-check.spoke', 'station:replay-check', { n: 1 });
    }),
  );
  // Scripted flying: hold keys for spans of ticks.
  const plan = [
    ['ArrowUp', 1.0],
    ['KeyD', 0.8],
    ['Space', 2.0],
    ['KeyT', 0.1],
    ['ArrowDown', 0.6],
    ['KeyF', 0.1],
    ['Digit3', 0.1],
    ['KeyQ', 0.7],
    ['ShiftLeft', 1.2],
    ['KeyW', 1.0],
    ['KeyA', 0.9],
    ['Space', 1.5],
    ['Digit1', 0.1],
    ['KeyR', 0.1],
  ];
  const tick = () => page.evaluate(() => window.__VANGUARD__.hooks.replay.state().tick);
  // The sim can pause for good (shot down → salvage tow → berthed): stop waiting when ticks stall.
  let stalled = false;
  const until = async (t) => {
    let last = -1;
    let since = Date.now();
    for (let now = await tick(); now < t && !stalled; now = await tick()) {
      if (now !== last) {
        last = now;
        since = Date.now();
      } else if (Date.now() - since > 20_000) stalled = true;
      await page.waitForTimeout(40);
    }
  };
  let k = 0;
  let lastLog = 0;
  while (!stalled && (await tick()) < seconds * 60 - 120) {
    const at = await tick();
    if (at - lastLog >= 600) {
      lastLog = at;
      console.log(`  recording… tick ${at} (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
    }
    const [key, hold] = plan[k++ % plan.length];
    const now = await tick();
    await page.keyboard.down(key);
    await until(now + Math.max(1, Math.round(hold * 60)));
    await page.keyboard.up(key);
    await until((await tick()) + 20);
  }
  await until(seconds * 60);
  if (stalled) console.log(`  sim paused at tick ${await tick()} (berthed / shot down) — checking the take up to there`);
  const rec = await page.evaluate(async () => {
    const { world } = await import('/src/game/world/WorldState.ts');
    const r = window.__VANGUARD__.hooks.replay;
    const f = r.clip(1e9);
    f.view = undefined;
    return { file: JSON.stringify(f), state: r.state(), err: window.__VANGUARD__.error, world: JSON.stringify(world().state) };
  });
  if (rec.err) throw new Error(rec.err);
  const file = JSON.parse(rec.file);
  console.log(`recorded: ${file.ticks} ticks, ${file.checks.length} checkpoints, ${file.commands.length} commands (${[...new Set(file.commands.map((c) => c.c))].join(', ')}), input ${file.input.length} B base64, file ${(rec.file.length / 1024).toFixed(1)} KB`);
  // Play it back in a rebooted page.
  await page.evaluate(([f, s]) => window.__VANGUARD__.hooks.replay.load(JSON.parse(f), s), [rec.file, Math.floor(seconds / 2)]);
  await page.waitForFunction(
    (n) => window.__VANGUARD__?.error || (window.__VANGUARD__?.hooks?.replay?.state?.().mode === 'play' && window.__VANGUARD__.hooks.replay.state().ended) || window.__VANGUARD__?.hooks?.replay?.state?.().tick >= n,
    file.ticks,
    { timeout: 900_000, polling: 500 },
  );
  await page.waitForTimeout(300);
  const play = await page.evaluate(async () => {
    const { world } = await import('/src/game/world/WorldState.ts');
    return { state: window.__VANGUARD__.hooks.replay.state(), err: window.__VANGUARD__.error, world: JSON.stringify(world().state) };
  });
  if (play.err) throw new Error(play.err);
  const s = play.state;
  const worldSame = play.world === rec.world;
  const patches = file.commands.filter((c) => c.c === 'world-patch' || c.c === 'world');
  console.log(`world: ${worldSame ? 'same' : 'DIFFERENT'} at the end · ${patches.length} world commands, ${JSON.stringify(patches).length} B`);
  const pass = s.mode === 'play' && s.desyncAt < 0 && s.checksOk === file.checks.length && worldSame;
  console.log(`playback: mode ${s.mode}, ${s.tick}/${s.ticks} ticks, checkpoints matched ${s.checksOk}/${file.checks.length}, desync ${s.desyncAt < 0 ? 'none' : `at tick ${s.desyncAt}`}`);
  console.log(`${pass ? 'PASS' : 'FAIL'} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const bad = logs.filter((l) => /pageerror|\[error\]|desync/i.test(l) && !/Device Lost|popErrorScope|mapAsync/.test(l));
  if (bad.length) console.log(bad.slice(0, 20).join('\n'));
  if (!pass) code = 1;
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
