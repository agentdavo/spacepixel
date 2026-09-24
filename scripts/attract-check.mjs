#!/usr/bin/env node
/**
 * Attract-mode soak test (headless): the title is left alone and runs its
 * attract loop — prologue, title, trailer, title, … — with the idle wait cut
 * to `--idle` s and the reels played `--reel`× faster. At every return to the
 * title it forces a GC and samples what could leak: the renderer's live GPU
 * objects (renderer.info.memory: geometries, textures), the JS heap and the
 * DOM size. Then a keypress mid-reel must bring the title back.
 *
 *   node scripts/attract-check.mjs [--port 5403] [--cycles 3] [--reel 24] [--idle 6] [--out <dir>]
 *
 * PASS when, comparing each title with the one a full cycle earlier (same
 * reel just played) once the first cycle has warmed the caches: geometries and textures are
 * flat (± 2 %), cached render pipelines grow < 5 %, DOM nodes are flat (± 30),
 * the heap grows < 6 MB per cycle, no page errors, and any key returns to the
 * title. (three.js stops counting a cached geometry once it has been freed
 * and re-used, so `geometries` reads low after the first swap — it still
 * must not climb.)
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 5403));
const cycles = Number(opt('cycles', 3));
const reel = Number(opt('reel', 24));
const idle = Number(opt('idle', 6));
const out = opt('out', '');
if (out) mkdirSync(out, { recursive: true });
const T = 900_000;

const server = await createServer({ cacheDir: process.env.VITE_CACHE_DIR || undefined, server: { port, host: '127.0.0.1', strictPort: true, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/CERT|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/?idle=${idle}&reel=${reel}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.hooks?.attract, null, { timeout: T, polling: 500 });

  const sample = async (label) => {
    await page.waitForTimeout(1500);
    return page.evaluate((label) => {
      window.gc?.();
      const v = window.__VANGUARD__;
      const mem = v.hooks.memory();
      const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN;
      return { label, geometries: mem.geometries ?? 0, textures: mem.textures ?? 0, pipelines: mem.pipelines ?? 0, programs: mem.programs ?? 0, heapMB: +heap.toFixed(1), dom: document.getElementsByTagName('*').length, reels: v.hooks.attract.reels };
    }, label);
  };
  const waitTitle = async (n) => {
    await page.waitForFunction((n) => window.__VANGUARD__.hooks.attract.titles >= n && !!document.querySelector('.title-screen'), n, { timeout: T, polling: 500 });
  };

  // Title 1 (fresh), then 2 × cycles reels, sampling at every title.
  const samples = [];
  await waitTitle(1);
  samples.push(await sample('title 0 (boot)'));
  console.log(JSON.stringify(samples.at(-1)));
  for (let r = 1; r <= cycles * 2; r++) {
    await waitTitle(r + 1);
    samples.push(await sample(`title ${r} (after ${r % 2 ? 'prologue' : 'trailer'})`));
    console.log(JSON.stringify(samples.at(-1)), `${((Date.now() - t0) / 60000).toFixed(1)} min`);
    if (out) await page.screenshot({ path: `${out}/title-${r}.png`, timeout: T });
  }

  // Same-phase comparisons once the first full cycle has warmed the caches (index i vs i − 2, i ≥ 4).
  let worstGeo = 0;
  let worstTex = 0;
  let worstDom = 0;
  let worstPipe = 0;
  const heapGrowth = [];
  for (let i = 4; i < samples.length; i++) {
    const a = samples[i - 2];
    const b = samples[i];
    worstGeo = Math.max(worstGeo, Math.abs(b.geometries - a.geometries) / Math.max(1, a.geometries));
    worstTex = Math.max(worstTex, Math.abs(b.textures - a.textures) / Math.max(1, a.textures));
    worstDom = Math.max(worstDom, Math.abs(b.dom - a.dom));
    worstPipe = Math.max(worstPipe, (b.pipelines - a.pipelines) / Math.max(1, a.pipelines));
    heapGrowth.push(b.heapMB - a.heapMB);
  }
  const perCycle = heapGrowth.length ? Math.max(...heapGrowth) : 0;
  check('attract loop alternates reels unattended', samples.at(-1).reels >= cycles * 2, `(${samples.at(-1).reels} reels, ${cycles} cycles ≈ ${((cycles * (2 * 45 + 60 + 90)) / 60).toFixed(0)} min unattended at real pace)`);
  check('GPU geometries flat cycle to cycle', worstGeo <= 0.02, `(worst ${(worstGeo * 100).toFixed(1)} %)`);
  check('GPU textures flat cycle to cycle', worstTex <= 0.02, `(worst ${(worstTex * 100).toFixed(1)} %)`);
  check('DOM flat cycle to cycle', worstDom <= 30, `(worst ${worstDom} nodes)`);
  check('render pipelines flat cycle to cycle', worstPipe <= 0.05, `(worst ${(worstPipe * 100).toFixed(1)} % growth)`);
  check('JS heap growth < 6 MB per cycle', perCycle < 6, `(${heapGrowth.map((x) => x.toFixed(1)).join(', ')} MB)`);

  // Any key during an attract reel returns to the title.
  const titles = await page.evaluate(() => window.__VANGUARD__.hooks.attract.titles);
  await page.waitForFunction(() => !!document.querySelector('.cinema'), null, { timeout: T, polling: 250 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('KeyQ');
  const back = await page
    .waitForFunction((n) => window.__VANGUARD__.hooks.attract.titles > n && !!document.querySelector('.title-screen'), titles, { timeout: T, polling: 250 })
    .then(() => true, () => false);
  check('any key returns to the title', back);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}
const ok = results.every(Boolean);
console.log(`${ok ? 'ALL PASS' : 'FAILURES'}  (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(ok ? 0 : 1);
