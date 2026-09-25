#!/usr/bin/env node
/**
 * Frame-stepped video capture (headless). Each frame advances the engine by
 * exactly 1/fps (`?record=fps`), CSS animations are paused and advanced on the
 * same clock, then the page (canvas + DOM captions) is screenshotted.
 *
 *   node scripts/record.mjs --out <dir> [--scene prologue] [--fps 24]
 *        [--from 0] [--to 60] [--size 1280x720] [--port 5270] [--query k=v&..]
 *
 * Frames are written as <dir>/f_<index>.jpg with index = round(time·fps), so
 * several processes can render disjoint time ranges into the same directory.
 * Encode with ffmpeg afterwards (scripts/make-video.mjs). On a shared machine,
 * VITE_CACHE_DIR=<dir> gives the render its own Vite dep-optimizer cache (no
 * "Outdated Optimize Dep" reloads when other dev servers re-optimize); start
 * parallel ranges a minute apart so the first one fills it.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = opt('out', 'recording');
const scene = opt('scene', 'prologue');
const fps = Number(opt('fps', 24));
const from = Math.round(Number(opt('from', 0)) * fps) / fps;
const to = Math.round(Number(opt('to', 60)) * fps) / fps;
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const port = Number(opt('port', 5270));
const extra = opt('query', '');
const gpu = opt('gpu', process.platform === 'win32' ? 'native' : 'software');
if (![fps, from, to, width, height].every(Number.isFinite) || fps <= 0 || from < 0 || to <= from || width <= 0 || height <= 0) throw new Error('Invalid capture range, frame rate or size');
mkdirSync(out, { recursive: true });
if (!args.includes('--overwrite')) {
  for (let i = Math.round(from * fps); i < Math.round(to * fps); i++) {
    if (existsSync(`${out}/f_${String(i).padStart(5, '0')}.jpg`)) throw new Error('Existing frames: choose a fresh output directory or --overwrite so events and images stay matched');
  }
}

const server = await createServer({ cacheDir: process.env.VITE_CACHE_DIR || resolve(`node_modules/.vite-record-${port}`), server: { port, host: '127.0.0.1', strictPort: true, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  channel: opt('browser', process.platform === 'win32' ? 'msedge' : 'chromium'),
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(gpu === 'software' ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'] : ['--use-angle=d3d11'])],
});

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { let seed = 0x56414e47; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`[console.error] ${m.text().slice(0, 300)}`));
  const url = `http://127.0.0.1:${port}/?shot=1&record=${fps}&scene=${scene}&loop=0&hud=0&t=${from}${extra ? '&' + extra : ''}`;
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || window.__VANGUARD__?.hooks?.step, null, { timeout: 300_000, polling: 250 });
  const err = await page.evaluate(() => window.__VANGUARD__?.error);
  if (err) throw new Error(err);
  await page.evaluate(() => document.fonts.ready);
  const metadata = await page.evaluate(() => ({ backend: window.__VANGUARD__.backend, duration: window.__VANGUARD__.hooks.trailer?.cinema.duration }));
  console.log(JSON.stringify(metadata));
  if (args.includes('--require-webgpu') && metadata.backend !== 'WebGPU') throw new Error('WebGPU required; refusing reduced-quality fallback');
  const eventFile = `${out}/events-${Math.round(from * fps)}.jsonl`;
  writeFileSync(eventFile, JSON.stringify({ version: 1, scene, fps, from, to, width, height, query: extra, browser: opt('browser', process.platform === 'win32' ? 'msedge' : 'chromium'), gpu, ...metadata }) + '\n');
  // Snapshot pooled events before the next simulation step mutates them.
  await page.evaluate(async () => {
    const { getAudio } = await import('/src/audio/index.ts');
    const { snapshotAudioFrame } = await import('/src/cinema/recording.ts');
    const audio = getAudio();
    const update = audio.update.bind(audio);
    audio.update = (frame) => { window.__recordAudio = snapshotAudioFrame(frame); update(frame); };
    const trailer = window.__VANGUARD__.hooks.trailer;
    if (trailer) trailer.overlay.fullCaptions = true;
  });
  // A film, not a UI: no skip hint.
  await page.addStyleTag({ content: '.cn-skip { display: none !important; } .cinema { z-index: 1000 !important; }' });

  const first = Math.round(from * fps);
  const last = Math.round(to * fps);
  const t0 = Date.now();
  for (let i = first; i < last; i++) {
    await page.evaluate(
      async ([frameMs, resume]) => {
        await window.__VANGUARD__.hooks.step(1);
        // CSS animations run on wall-clock time; put them on the film's clock.
        // A range that starts mid-film finds its intro animations (letterbox
        // bars…) already finished, as they would be in a continuous take.
        for (const a of document.getAnimations()) {
          if (a.__rec === undefined) {
            a.__rec = resume ? 60_000 : 0;
            a.pause();
          } else a.__rec += frameMs;
          a.currentTime = a.__rec;
        }
      },
      [1000 / fps, i === first && from > 0],
    );
    const sample = await page.evaluate(() => {
      const trailer = window.__VANGUARD__.hooks.trailer;
      return { ...window.__recordAudio, timeline: trailer?.cinema.t, shot: trailer?.cinema.shot.id };
    });
    appendFileSync(eventFile, JSON.stringify({ frame: i, at: i / fps, ...sample }) + '\n');
    const file = `${out}/f_${String(i).padStart(5, '0')}.jpg`;
    if (!existsSync(file) || args.includes('--overwrite')) await page.screenshot({ path: file, type: 'jpeg', quality: 92, timeout: 300_000 });
    if ((i - first) % 24 === 0) {
      const done = i - first + 1;
      const rate = (Date.now() - t0) / 1000 / done;
      console.log(`frame ${i} (${(i / fps).toFixed(2)} s)  ${rate.toFixed(2)} s/frame  eta ${(((last - i) * rate) / 60).toFixed(1)} min`);
    }
  }
  console.log(`done ${first}..${last - 1}`);
} finally {
  await browser.close();
  await server.close();
}
