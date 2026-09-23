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
 * Encode with ffmpeg afterwards (see scripts/make-video.sh).
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = opt('out', 'recording');
const scene = opt('scene', 'prologue');
const fps = Number(opt('fps', 24));
const from = Number(opt('from', 0));
const to = Number(opt('to', 60));
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const port = Number(opt('port', 5270));
const extra = opt('query', '');
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true, hmr: false }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`[console.error] ${m.text().slice(0, 300)}`));
  const url = `http://127.0.0.1:${port}/?shot=1&record=${fps}&scene=${scene}&loop=0&t=${from}${extra ? '&' + extra : ''}`;
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || window.__VANGUARD__?.hooks?.step, null, { timeout: 300_000, polling: 250 });
  const err = await page.evaluate(() => window.__VANGUARD__?.error);
  if (err) throw new Error(err);
  // A film, not a UI: no skip hint.
  await page.addStyleTag({ content: '.cn-skip { display: none !important; }' });

  const first = Math.round(from * fps);
  const last = Math.round(to * fps);
  const t0 = Date.now();
  for (let i = first; i < last; i++) {
    await page.evaluate(async (frameMs) => {
      await window.__VANGUARD__.hooks.step(1);
      // CSS animations run on wall-clock time; put them on the film's clock.
      for (const a of document.getAnimations()) {
        if (a.__rec === undefined) {
          a.__rec = 0;
          a.pause();
        } else a.__rec += frameMs;
        a.currentTime = a.__rec;
      }
    }, 1000 / fps);
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
