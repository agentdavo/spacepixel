#!/usr/bin/env node
/** Native contact fixture. Only initial conditions and presentation are authored;
 * all post-start motion, shields, damage and breakup come from FlightScene. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d;
const out = resolve(opt('out', 'scratchpad/collision-audit/native'));
const root = resolve(opt('root', '.'));
const baseline = args.includes('--baseline');
if (existsSync(out)) throw new Error('Choose a new output directory; evidence is never overwritten');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5493, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5493/?scene=flight&record=30&demo=0&hud=0&quality=high&dynres=0&traffic=0&planes=0&seed=1994&voice=off', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || (window.__VANGUARD__?.ready && window.__VANGUARD__?.hooks?.step), null, { timeout: 300000 });
  const initial = await page.evaluate(async () => {
    const v = window.__VANGUARD__;
    if (v.error || v.backend !== 'WebGPU') throw new Error(v.error ?? `Expected WebGPU, got ${v.backend}`);
    const S = v.hooks.scene;
    const Vector3 = S.player.flight.position.constructor;
    const Matrix4 = S.player.model.root.matrixWorld.constructor;
    const origin = S.player.flight.position.clone().add(new Vector3(0, 18000, -22000));
    for (const s of S.fleet.ships) if (s !== S.player) { s.alive = false; s.model.root.visible = false; }
    for (const b of S.bandits) b.deadFor = -1;
    S.player.flight.throttle = 0;
    S.player.flight.velocity.set(0, 0, 0);
    const a = S.fleet.spawn('bb-indomitable', 'concord', origin.clone().add(new Vector3(0, 0, -1450)), new Vector3(0, 0, 1));
    const b = S.fleet.spawn('bb-indomitable', 'concord', origin.clone().add(new Vector3(0, 0, 1450)), new Vector3(0, 0, -1));
    for (const [s, vz] of [[a, 180], [b, -180]]) {
      s.flight.velocity.set(0, 0, vz);
      s.flight.throttle = 0;
      s.flight.flightAssist = false;
      s.model.root.position.copy(s.flight.position);
      s.model.root.quaternion.copy(s.flight.orientation);
    }
    const eye = origin.clone().add(new Vector3(4500, 2800, 1800));
    const cameraQ = S.director.orientation.clone().setFromRotationMatrix(new Matrix4().lookAt(eye, origin, new Vector3(0, 1, 0)));
    S.director.update = () => { S.director.eye.copy(eye); S.director.orientation.copy(cameraQ); S.director.camera.quaternion.copy(cameraQ); S.director.camera.fov = 40; S.director.camera.updateProjectionMatrix(); };
    const records = [], damageEvents = [];
    const step = S.simStep.bind(S);
    S.simStep = () => {
      step();
      for (const e of S.hulls.capitals?.events ?? []) records.push({ tick: S.simTick, a: e.a.id, b: e.b.id, closing: e.closing, impulse: e.impulse, energy: e.energy, damageA: e.damageA, damageB: e.damageB, point: e.point.toArray(), normal: e.normal.toArray() });
      for (const e of S.weapons.events) if (e.ship === a || e.ship === b) damageEvents.push({ tick: S.simTick, kind: e.kind, ship: e.ship.id, cause: e.cause, facing: e.facing, sub: e.sub?.id });
    };
    window.__contactFixture = { a, b, records, damageEvents, start: S.simTick };
    return { backend: v.backend, device: v.hooks.renderer().backend.device?.constructor.name, seed: 1994, startTick: S.simTick, origin: origin.toArray(), ships: [a, b].map(s => ({ id: s.id, blueprint: s.model.blueprint.id, position: s.flight.position.toArray(), orientation: s.flight.orientation.toArray(), velocity: s.flight.velocity.toArray(), hull: s.hull, shield: s.shield })) };
  });
  await page.addStyleTag({ content: '#ui-root,.hud-debug,.replay-deck,.replay-toast{display:none!important}' });
  const states = [];
  for (let frame = 0; frame < 150; frame++) {
    await page.evaluate(() => window.__VANGUARD__.hooks.step(2));
    await page.screenshot({ path: `${out}/f_${String(frame).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (frame % 15 === 0) states.push(await page.evaluate(() => {
      const { a, b, start } = window.__contactFixture, S = window.__VANGUARD__.hooks.scene;
      return { seconds: (S.simTick - start) / 60, ships: [a, b].map(s => ({ id: s.id, alive: s.alive, hull: s.hull, shield: s.shield, position: s.flight.position.toArray(), velocity: s.flight.velocity.toArray(), rates: s.flight.bodyRates.toArray(), death: s.combat.dmg.structure.death, breakZ: s.combat.dmg.structure.breakZ })), wrecks: S.fleet.destruction.wrecks.map(w => ({ ship: w.ship.id, cause: w.cause, position: w.position.toArray() })) };
    }));
  }
  const contacts = await page.evaluate(() => window.__contactFixture.records);
  const damageEvents = await page.evaluate(() => window.__contactFixture.damageEvents);
  const evidence = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), baseline, sourceFiles: Object.fromEntries(['src/sim/CapitalCollisions.ts', 'src/sim/Destruction.ts', 'src/world/HullCollisions.ts', 'src/sim/Weapons.ts', 'src/world/scenes/FlightScene.ts'].map(p => [p, existsSync(resolve(root, p)) ? createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex') : null])), harnessSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), policy: 'Authored initial two-ship inertial approach, fixed presentation camera; ordinary FlightScene sim thereafter, no injected damage or post-start poses. This is a collision fixture, not campaign/trailer footage.', initial, states, contacts, damageEvents, errors };
  writeFileSync(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
  const outcome = baseline ? !contacts.length && states.every(s => s.ships.every(x => x.hull === 48000 && x.shield === 9000)) : contacts.some(e => e.energy > 0) && states.some(s => s.wrecks.length >= 4) && damageEvents.filter(e => e.kind === 'kill').length === 2;
  if (errors.length || !outcome) throw new Error('Native fixture did not produce expected outcome: ' + JSON.stringify({ errors, contacts, states }));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-framerate', '15', '-i', `${out}/f_%04d.jpg`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', `${out}/capital-contact.mp4`]);
  console.log(JSON.stringify({ out, backend: initial.backend, contacts: contacts.length, states: states.length, errors }));
} finally { await browser.close(); await server.close(); }
