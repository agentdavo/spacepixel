#!/usr/bin/env node
/** Native WebGPU A/B captures in the real flight scene. Dev staging only.
 * node scripts/kessen-cameo-check.mjs --out docs/screenshots/kessen --port 5251
 * Episode 10 fast-forwards real fixed ticks after positioning at CAP range;
 * the existing timed attack/destruction emit their own flags, without seeking.
 * Player views use unchanged chase tuning. Close views are labelled inspection.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d;
const out = resolve(opt('out', 'docs/screenshots/kessen'));
const port = Number(opt('port', '5251'));
const episodes = opt('episodes', '10,19').split(',').map(Number);
assert.ok(episodes.length > 0 && episodes.every((ep) => [10, 19].includes(ep)), 'episodes must be 10 and/or 19');
const framesRoot = args.includes('--approach') ? resolve(opt('frames-dir', '') || mkdtempSync(resolve(tmpdir(), 'vanguard-kessen-'))) : null;
mkdirSync(out, { recursive: true });
const server = await createServer({ cacheDir: resolve(`node_modules/.vite-kessen-${port}`), server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
let browser;
const reports = [];
try {
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  for (const episode of episodes) for (const enabled of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { let seed = 0x56414e47; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); });
    const url = `http://127.0.0.1:${port}/?scene=flight&episode=${episode}${enabled ? '' : '&kessenCameos=0'}&shot=1&record=60&demo=0&hud=1&quality=high&dynres=0`;
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__VANGUARD__?.error || (window.__VANGUARD__?.hooks?.step && window.__VANGUARD__.hooks.scene?.campaign), null, { timeout: 180_000 });
    const device = await page.evaluate(() => {
      const v = window.__VANGUARD__;
      const b = v.hooks.renderer().backend;
      return { backend: v.backend, error: v.error, deviceCreated: !!b.device?.queue, adapter: b.device?.adapterInfo?.description || b.adapter?.info?.description || 'unreported' };
    });
    assert.equal(device.error, undefined);
    assert.equal(device.backend, 'WebGPU');
    assert.equal(device.deviceCreated, true, 'actual renderer GPUDevice required');
    const progression = await page.evaluate(async (ep) => {
      const hooks = window.__VANGUARD__.hooks;
      const scene = hooks.scene;
      const Vector3 = scene.player.flight.position.constructor;
      await hooks.step(2);
      const progression = [];
      if (ep === 10) {
        const bastion = scene.campaign.pieces.find((p) => p.kind === 'bastion');
        const pf = scene.player.flight;
        pf.position.copy(bastion.position).add(new Vector3(0, 500, 2000));
        pf.velocity.set(0, 0, 0); pf.throttle = 0; pf.bodyRates.set(0, 0, 0);
        // Same fixed-tick path used by replay seeking: run every simulation
        // tick, omit intermediate renders. No flags, kills or objectives set.
        for (let tick = 0; tick <= 6000; tick++) {
          if (tick % 60 === 0) progression.push({ time: scene.campaign.runner.snapshot().time, flags: [...scene.campaign.runner.flags], cameoReleased: scene.campaign.pieces.some((p) => p.kind === 'kessen-cameo'), alive: scene.player.alive });
          if (tick < 6000) scene.simStep();
        }
        await hooks.step(2);
      }
      const tag = ep === 10 ? 'lane' : 'tune-meridian';
      const site = scene.campaign.pieces.find((p) => p.tag === tag).position;
      const pf = scene.player.flight;
      pf.position.copy(site).add(new Vector3(ep === 10 ? -100 : 0, 0, ep === 10 ? 220 : -220));
      pf.orientation.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 0, ep === 10 ? -1 : 1));
      pf.velocity.set(0, 0, 0); pf.throttle = 0; pf.bodyRates.set(0, 0, 0);
      scene.chase.snap(pf);
      scene.director.setBase('chase');
      await hooks.step(30);
      return progression;
    }, episode);
    const state = await page.evaluate(() => {
      const h = window.__VANGUARD__.hooks, s = h.scene;
      const p = s.campaign.pieces.find((p) => p.kind === 'kessen-cameo');
      const b = p.position.clone().sub(s.world.eye);
      b.project(s.camera);
      const gate = s.navGate();
      const navigation = { objective: s.campaign.runner.navigation()?.tag ?? null, gateTo: gate?.link.to ?? null, gatePosition: gate?.center.toArray() ?? null };
      return { hash: s.worldHash(), runner: s.campaign.runner.snapshot(), facts: s.worldRt.state.facts, navigation, frames: p.frames.length, camera: s.director.kind, cameoNdc: b.toArray(), playerPosition: s.player.flight.position.toArray(), cameoPosition: p.position.toArray(), flags: [...s.campaign.runner.flags], memory: h.memory() };
    });
    assert.equal(state.frames, enabled ? 2 : 0);
    if (episode === 10) {
      assert.ok(progression.every((p) => !p.cameoReleased || p.flags.includes('bastion-destroyed')));
      assert.ok(progression.some((p) => p.flags.includes('bastion-attack') && !p.cameoReleased));
      assert.ok(progression.at(-1).cameoReleased);
      assert.ok(progression.every((p) => p.alive));
    }
    const stem = `ep${episode}-${enabled ? 'on' : 'off'}`;
    await page.screenshot({ path: `${out}/${stem}-player.png`, timeout: 120_000 });
    const report = { episode, enabled, url, ...device, ...state, progression, errors };
    reports.push(report);
    console.log(JSON.stringify({ episode, enabled, ...device, hash: state.hash, frames: state.frames, cameoNdc: state.cameoNdc, errors }));
    assert.deepEqual(errors, []);
    if (enabled && args.includes('--approach')) {
      const framesDir = resolve(framesRoot, `ep${episode}-frames`);
      mkdirSync(framesDir, { recursive: true });
      const approachStart = await page.evaluate(() => {
        const s = window.__VANGUARD__.hooks.scene;
        const V = s.player.flight.position.constructor;
        const p = s.campaign.pieces.find((p) => p.kind === 'kessen-cameo');
        const pf = s.player.flight;
        const dir = s.campaign.mission.episode === 10 ? -1 : 1;
        // Pass beside the module at a fixed ordinary flight speed, using the
        // actual FlightModel and normal chase camera for every recorded tick.
        pf.position.copy(p.position).add(new V(-38, 18, -dir * 680));
        pf.orientation.setFromUnitVectors(new V(0, 0, 1), new V(0, 0, dir));
        pf.velocity.set(0, 0, dir * 75); pf.throttle = 75 / pf.spec.maxSpeed;
        pf.bodyRates.set(0, 0, 0); pf.flightAssist = true;
        s.chase.snap(pf);
        return { position: pf.position.toArray(), speed: pf.speed, throttle: pf.throttle, camera: s.director.kind };
      });
      for (let i = 0; i < 240; i++) {
        await page.evaluate(async () => { await window.__VANGUARD__.hooks.step(2); });
        await page.screenshot({ path: `${framesDir}/f_${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
      }
      const approachEnd = await page.evaluate(() => {
        const s = window.__VANGUARD__.hooks.scene;
        return { position: s.player.flight.position.toArray(), speed: s.player.flight.speed, alive: s.player.alive, hash: s.worldHash() };
      });
      assert.equal(approachEnd.alive, true);
      assert.ok(Math.abs(approachEnd.speed - 75) < 0.01);
      assert.ok(Math.abs(Math.hypot(...approachEnd.position.map((v, i) => v - approachStart.position[i])) - 600) < 0.01);
      report.approach = { fps: 30, seconds: 8, start: approachStart, end: approachEnd, note: 'Initial placement only; eight seconds of real normal-speed flight. No camera, visibility, dialogue or objective overrides during clip. Silent visual-review clip.' };
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${framesDir}/f_%04d.jpg`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${out}/ep${episode}-approach.mp4`]);
      console.log(`Captured Episode ${episode} native approach clip.`);
    }
    if (enabled) {
      await page.evaluate(async () => {
        const h = window.__VANGUARD__.hooks, s = h.scene;
        const Vector3 = s.player.flight.position.constructor;
        const p = s.campaign.pieces.find((p) => p.kind === 'kessen-cameo');
        const pf = s.player.flight;
        pf.position.copy(p.position).add(new Vector3(-23, 5, 45));
        const aim = p.position.clone().add(new Vector3(0, 4, 0)).sub(pf.position).normalize();
        pf.orientation.setFromUnitVectors(new Vector3(0, 0, 1), aim);
        pf.velocity.set(0, 0, 0); pf.throttle = 0;
        s.chase.tuning.offset.set(0, 3, -10); s.chase.snap(pf);
        // Inspection only: remove foreground fighter occlusion. Normal player
        // captures above retain the complete ship and unchanged chase camera.
        s.player.model.root.traverse((o) => { if (o.isMesh) o.visible = false; });
        await h.step(20);
      });
      await page.screenshot({ path: `${out}/ep${episode}-inspection.png`, timeout: 120_000 });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const episode of episodes) {
    const [off, on] = reports.filter((r) => r.episode === episode);
    assert.equal(on.hash, off.hash, `Episode ${episode}: gameplay hash`);
    assert.deepEqual(on.runner, off.runner, `Episode ${episode}: runner progress`);
    assert.deepEqual(on.facts, off.facts, `Episode ${episode}: world facts`);
    assert.deepEqual(on.navigation, off.navigation, `Episode ${episode}: objective and gate navigation`);
  }
  const sourceFiles = Object.fromEntries(['src/world/setpieces/KessenCameo.ts', 'src/world/setpieces/index.ts', 'src/game/campaign/missions.ts', 'src/world/scenes/FlightScene.ts', 'scripts/kessen-cameo-check.mjs'].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  writeFileSync(`${out}/${opt('evidence', 'evidence.json')}`, JSON.stringify({ sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceFiles, note: 'Default-on versus explicit kessenCameos=0. Source hashes identify tested working files, including uncommitted integration changes. Staged real mission sites; Episode 10 fast-forwards 100 seconds of actual fixed simulation ticks from CAP range, with no Bastion seek, flag or kill injection. Player screenshots use normal chase tuning. Inspection screenshots use a shorter chase offset with foreground player meshes hidden. Memory records renderer resource accounting, not frame timing or a crowd performance guarantee. This is not a manual end-to-end battle playthrough.', reports }, null, 2));
  console.log('PASS: native WebGPU captures, default-on/explicit-off gameplay hashes, runner snapshots, world facts and navigation match.');
} finally {
  await browser?.close();
  await server.close();
}
