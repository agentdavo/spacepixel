#!/usr/bin/env node
/**
 * Headless frame-time report with pass/fail budgets.
 *
 *   node scripts/perf.mjs [--scene flight] [--frames 300] [--size 1280x720]
 *                         [--cpu-budget 4] [--gpu-budget 8] [--port 5198]
 *                         [--query 'k=v&…'] [--no-demo]
 *
 * `--no-demo` drops the scripted autopilot (the ship holds its staged pose:
 * A/B a fixed view, e.g. `--query 'reach=body&dist=119' --no-demo` with and
 * without `planetlod=0`).
 *
 * On a software adapter (SwiftShader) GPU numbers are not meaningful — the
 * report says so and budgets are informational. On real hardware a failed
 * budget exits non-zero, so it can gate CI or a pre-push hook.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const scene = opt('scene', 'flight');
const frames = Number(opt('frames', '300'));
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const cpuBudget = Number(opt('cpu-budget', '4'));
const gpuBudget = Number(opt('gpu-budget', '8'));
const port = Number(opt('port', '5198'));
const extra = opt('query', '');
const demo = args.includes('--no-demo') ? '' : 'demo=1&';

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
});
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://127.0.0.1:${port}/?scene=${scene}&${demo}hud=0${extra ? '&' + extra : ''}`, { waitUntil: 'commit' });
  await page.waitForFunction((n) => window.__VANGUARD__?.error || window.__VANGUARD__?.frame?.() >= n, frames, { timeout: 600_000, polling: 500 });
  const res = await page.evaluate(() => ({
    err: window.__VANGUARD__?.error,
    perf: window.__VANGUARD__?.hooks?.perf?.(),
    adapter: navigator.gpu ? 'webgpu' : 'webgl',
  }));
  if (res.err) throw new Error(res.err);
  const soft = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    return (a?.info?.architecture ?? '').includes('swiftshader') || (a?.info?.vendor ?? '') === 'google';
  });
  const p = res.perf;
  console.log(JSON.stringify({ scene, size: `${width}x${height}`, softwareAdapter: soft, ...p }, null, 2));
  const cpuOk = p.cpu.p95 <= cpuBudget;
  const gpuOk = p.gpu.p95 <= gpuBudget || p.gpuMode === 'none';
  console.log(`CPU p95 ${p.cpu.p95} ms vs ${cpuBudget} ms → ${cpuOk ? 'PASS' : 'FAIL'}`);
  console.log(`GPU p95 ${p.gpu.p95} ms vs ${gpuBudget} ms (${p.gpuMode}) → ${gpuOk ? 'PASS' : 'FAIL'}${soft ? '  [software adapter: informational only]' : ''}`);
  if (!soft && (!cpuOk || !gpuOk)) code = 1;
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
