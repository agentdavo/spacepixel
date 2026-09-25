#!/usr/bin/env node
/**
 * Native GPU report: --scene combat --query stage=capital --frames 360 --size 1920x1080
 * --gpu software is informational. --backend webgl checks fallback, not GPU budgets.
 * --stepped includes browser automation/queue overhead, not real-time FPS.
 * Exit 0 = passed/informational, 1 = measured budget failure, 2 = unavailable/error.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : d;
const scene = opt('scene', 'flight'), gpu = opt('gpu', 'native'), backend = opt('backend', 'webgpu');
const frames = Number(opt('frames', '360'));
const [width, height] = opt('size', '1920x1080').split('x').map(Number);
const cpuBudget = Number(opt('cpu-budget', '4')), gpuBudget = Number(opt('gpu-budget', '8'));
const frameBudget = Number(opt('frame-budget', '16.7'));
const port = Number(opt('port', '5198')), extra = opt('query', '');
const stepped = args.includes('--stepped');
if (!['native', 'software'].includes(gpu) || !['webgpu', 'webgl'].includes(backend) ||
    ![frames, width, height, cpuBudget, gpuBudget, frameBudget, port].every(Number.isFinite) || frames < 120 || width <= 0 || height <= 0)
  throw new Error('Invalid options (at least 120 frames required).');
const server = await createServer({ cacheDir: resolve('node_modules/.vite-perf-' + port),
  server: { port, host: '127.0.0.1', strictPort: true, hmr: false }, logLevel: 'warn' });
await server.listen();
let browser, code = 0;
try {
  browser = await chromium.launch({
    channel: opt('browser', process.platform === 'win32' ? 'msedge' : 'chromium'),
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(gpu === 'software'
      ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader']
      : process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' ' + m.location().url); });
  const query = new URLSearchParams(extra);
  query.set('scene', scene); query.set('hud', '0'); query.set('voice', 'off'); query.set('dynres', '0');
  query.set('backend', backend);
  if (!args.includes('--no-demo')) query.set('demo', '1');
  if (stepped) { query.set('record', '60'); query.set('shot', '1'); }
  await page.goto('http://127.0.0.1:' + port + '/?' + query, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || window.__VANGUARD__?.ready, null, { timeout: 120000 });
  let steppedMsPerFrame = null;
  if (stepped) {
    const batches = [];
    for (let i = 0; i < 60; i++) await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
    for (let i = 0; i < Math.ceil(frames / 10); i++) {
      const t = performance.now();
      for (let j = 0; j < 10; j++) await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
      batches.push((performance.now() - t) / 10);
    }
    batches.sort((a,b) => a-b);
    steppedMsPerFrame = { median: batches[batches.length >> 1], min: batches[0], max: batches.at(-1), includesAutomation: true };
  } else await page.waitForFunction(n => window.__VANGUARD__?.error || window.__VANGUARD__?.frame?.() >= n, frames, { timeout: 180000 });
  const res = await page.evaluate(() => ({
    error: window.__VANGUARD__.error,
    perf: window.__VANGUARD__.hooks.perf(),
    memory: window.__VANGUARD__.hooks.memory(),
    features: [...(window.__VANGUARD__.hooks.renderer().backend.device?.features ?? [])],
  }));
  if (res.error) throw new Error(res.error);
  const p = res.perf;
  const software = /swiftshader|llvmpipe|software|lavapipe/i.test(p.adapter);
  const nativeVerified = p.backend === 'WebGPU' && !software && p.adapter !== 'n/a';
  const timingAvailable = p.gpuSamples > 0 && p.gpuMode === 'timestamp';
  const gates = {
    backend: p.backend === (backend === 'webgl' ? 'WebGL2' : 'WebGPU'),
    cpu: p.cpu.p95 <= cpuBudget, gpu: timingAvailable ? p.gpu.p95 <= gpuBudget : null,
    interval: stepped ? null : p.interval.p95 <= frameBudget,
    pageErrors: errors.length === 0,
    timingErrors: p.timingErrors === 0,
  };
  const informational = gpu === 'software' || backend === 'webgl' || stepped;
  const status = !gates.pageErrors || !gates.backend ? 'error'
    : !informational && (!nativeVerified || !timingAvailable) ? 'unavailable'
    : informational ? 'informational' : Object.values(gates).every(v => v === true) ? 'pass' : 'fail';
  const report = { timestamp: new Date().toISOString(), scene, size: width + 'x' + height,
    query: query.toString(), browser: browser.version(), requestedGpu: gpu, nativeVerified,
    softwareAdapter: software, status, budgets: { cpuBudget, gpuBudget, frameBudget }, gates,
    ...res, errors, steppedMsPerFrame };
  console.log(JSON.stringify(report, null, 2));
  const out = opt('out', '');
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
  code = status === 'error' || status === 'unavailable' ? 2 : status === 'fail' ? 1 : 0;
} finally {
  await browser?.close();
  await server.close();
}
process.exitCode = code;
