/**
 * Front-end flow smoke test (headless): a fresh profile goes title → prologue
 * → (skip) → Episode 1 eyecatch; the prologue is remembered and not replayed.
 *
 *   node scripts/flow-check.mjs [--port 5250] [--out <dir>]
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

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
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
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}
const ok = results.every(Boolean);
console.log(ok ? 'ALL PASS' : 'FAILURES');
process.exit(ok ? 0 : 1);
