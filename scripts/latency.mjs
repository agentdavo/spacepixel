#!/usr/bin/env node
/**
 * Input → response latency probe (flight scene, real rAF loop, no autopilot).
 *
 *   node scripts/latency.mjs [--presses 16] [--port 5393] [--size 960x540] [--query '']
 *
 * Presses ArrowUp (pitch) repeatedly and reports:
 *   responseFrames  engine frames from the key event to the first frame whose
 *                   sim state shows the pitch rate responding (1 = the very
 *                   next frame — the latency rule; 2+ = a frame of added lag)
 *   responseMs      wall time for the same
 *   inputToSubmit   Perf's input-event → GPU-submit (p50 / p95), the existing
 *                   latency stat (input→photon adds compositor + scanout)
 *
 * On a software adapter frames are slow, so milliseconds scale with frame
 * time; the frame count is the number to compare before/after.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const presses = Number(opt('presses', '16'));
const port = Number(opt('port', '5393'));
const [width, height] = opt('size', '960x540').split('x').map(Number);
const extra = opt('query', '');

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
});
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://127.0.0.1:${port}/?scene=flight&demo=0&hud=0&traffic=0${extra ? '&' + extra : ''}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || window.__VANGUARD__?.frame?.() >= 90, null, { timeout: 600_000, polling: 500 });
  await page.evaluate(() => {
    const v = window.__VANGUARD__;
    const scene = v.hooks.scene;
    const lat = (window.__lat = { out: [], pending: null });
    addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'ArrowUp') lat.pending = { frame: v.frame(), t: performance.now(), base: scene.player.flight.bodyRates.x };
      },
      true,
    );
    const loop = () => {
      const p = lat.pending;
      if (p && Math.abs(scene.player.flight.bodyRates.x - p.base) > 1e-5) {
        lat.out.push({ frames: v.frame() - p.frame, ms: performance.now() - p.t });
        lat.pending = null;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  for (let i = 0; i < presses; i++) {
    // Random phase against the frame clock, then a short hold.
    await page.waitForTimeout(700 + ((i * 137) % 250));
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(250);
    await page.keyboard.up('ArrowUp');
  }
  await page.waitForTimeout(1500);
  const res = await page.evaluate(() => ({ lat: window.__lat.out, perf: window.__VANGUARD__.hooks.perf(), err: window.__VANGUARD__.error }));
  if (res.err) throw new Error(res.err);
  const f = res.lat.map((x) => x.frames).sort((a, b) => a - b);
  const ms = res.lat.map((x) => x.ms).sort((a, b) => a - b);
  const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
  const hist = {};
  for (const x of f) hist[x] = (hist[x] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        samples: f.length,
        responseFrames: { hist, p50: pct(f, 0.5), max: f[f.length - 1] },
        responseMs: { p50: +pct(ms, 0.5).toFixed(1), p95: +pct(ms, 0.95).toFixed(1) },
        inputToSubmit: res.perf.inputToSubmit,
        frameInterval: res.perf.interval,
        cpu: res.perf.cpu,
      },
      null,
      2,
    ),
  );
  if (!f.length) code = 1;
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
