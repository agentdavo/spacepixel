#!/usr/bin/env node
/**
 * Headless screenshot harness.
 *
 *   node scripts/screenshot.mjs [--out docs/screenshots] [--size 1600x900]
 *        [--frames 90] [--shot name:query ...] [--webgl] [--jpg] [--port 5199]
 *
 * Boots a Vite dev server, opens Chromium with WebGPU enabled (SwiftShader
 * Vulkan when no GPU is present), waits for N rendered frames and captures.
 * Each --shot is `filename:querystring`, e.g. `hero:cam=0&t=4`.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = resolve(opt('out', 'docs/screenshots'));
const [width, height] = opt('size', '1600x900').split('x').map(Number);
const frames = Number(opt('frames', '45'));
const webgl = args.includes('--webgl');
const jpg = args.includes('--jpg');
const port = Number(opt('port', '5199'));
const shots = [];
args.forEach((a, i) => a === '--shot' && shots.push(args[i + 1]));
if (!shots.length) shots.push('showcase:cam=0&t=3');

mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'warn' });
await server.listen();
const base = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

let failed = false;
try {
  for (const spec of shots) {
    const [name, query = ''] = spec.split(':');
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const url = `${base}?shot=1&${query}${webgl ? '&backend=webgl' : ''}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'commit' });
    try {
      await page.waitForFunction(
        (n) => window.__VANGUARD__?.error || (window.__VANGUARD__?.ready && window.__VANGUARD__.frame() >= n),
        frames,
        { timeout: 240_000, polling: 250 },
      );
    } catch (e) {
      logs.push(`[harness] timeout: ${e.message}`);
    }
    const err = await page.evaluate(() => window.__VANGUARD__?.error);
    const backend = await page.evaluate(() => window.__VANGUARD__?.backend);
    const file = `${outDir}/${name}.${jpg ? 'jpg' : 'png'}`;
    await page.screenshot(jpg ? { path: file, type: 'jpeg', quality: 90, timeout: 300_000 } : { path: file, timeout: 300_000 });
    console.log(`✓ ${file}  (${backend}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('Download the'));
    if (err || interesting.some((l) => /error|warn/i.test(l))) {
      console.log(interesting.slice(0, 40).join('\n'));
    }
    if (err) failed = true;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
