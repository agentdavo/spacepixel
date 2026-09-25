#!/usr/bin/env node
/** V3 deterministic staged gameplay: stock healthy ships, normal simulation after setup. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d;
const out = resolve(opt('out', 'scratchpad/delivery/v3/proof'));
const port = Number(opt('port', '5410'));
const seconds = Number(opt('seconds', '180'));
const probe = args.includes('--probe');
const scenario = opt('scenario', 'capital');
const from = Number(opt('from', '0'));
const replayPath = opt('replay', '');
const replay = replayPath ? JSON.parse(readFileSync(replayPath, 'utf8')) : null;
const camera = opt('camera', '');
const plan = opt('inputs', '') ? JSON.parse(readFileSync(opt('inputs', ''), 'utf8')) : [];
if (existsSync(`${out}/events.jsonl`)) throw new Error('Choose a new output directory; capture logs cannot be appended to old takes');
mkdirSync(out, { recursive: true });
const server = await createServer({ cacheDir: `node_modules/.vite-v3-${port}`, server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'warn', plugins: [{ name: 'v3-replay', configureServer(s) { s.middlewares.use((req,res,next) => { if (req.url !== '/__v3-tape.json') return next(); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(replay)); }); } }] });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  const q = new URLSearchParams(replay?.header.boot ?? 'scene=flight&record=30&demo=0&hud=1&quality=high&dynres=0&traffic=0&planes=0&seed=1994&score=nexus&voice=off');
  if (!replay && scenario === 'capital') { q.set('own','ffl3-valiant'); q.set('bridge','1'); q.set('captureSetup','v3-capital'); }
  if (!replay) for (const [k,v] of new URLSearchParams(opt('query',''))) q.set(k,v);
  if (replay) { q.set('replay','/__v3-tape.json'); q.set('rseek',String(Math.max(0,from-10))); }
  const query = q.toString();
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || (window.__VANGUARD__?.ready && window.__VANGUARD__?.hooks?.step), null, { timeout: 300000 });
  const status = await page.evaluate(() => ({ error: window.__VANGUARD__.error, backend: window.__VANGUARD__.backend }));
  if (status.error || status.backend !== 'WebGPU') throw new Error(JSON.stringify(status));
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: `.hud-debug,.hud-graph,.replay-deck,.replay-toast {display:none!important}${args.includes('--clean') ? '#ui-root {visibility:hidden!important}' : ''}` });
  if (replay) {
    while (await page.evaluate(() => window.__VANGUARD__.hooks.replay.state().seeking)) await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
  }
  const initial = await page.evaluate(async () => {
    const S = window.__VANGUARD__.hooks.scene;
    const { snapshotAudioFrame } = await import('/src/cinema/recording.ts');
    const target = S.lock.target;
    const subjects = S.fleet.ships.filter(s => s.alive);
    window.__v3 = { S, target, subjects, audio: [], ticks: [], inputs: [], deadAt: null };
    const originalTick = S.simStep.bind(S);
    S.simStep = () => {
      originalTick();
      const v = window.__v3;
      v.inputs.push({ tick: S.simTick, ...S.player.controls });
      for (const e of S.weapons.events) v.ticks.push({ tick: S.simTick, kind: e.kind, ship: e.ship?.id, shooter: e.shooter?.id, sub: e.sub?.id, amount: e.amount, cause: e.cause, turret: e.turret });
      if (target && !target.alive && v.deadAt === null) v.deadAt = S.simTick / 60;
    };
    const audioUpdate = S.audio.update.bind(S.audio);
    S.audio.update = f => { window.__v3.audio.push({ tick: S.simTick, ...snapshotAudioFrame(f), player: { ...f.player, position: { ...f.player.position }, velocity: { ...f.player.velocity } }, jumpPhase: f.jumpPhase, combatIntensity: f.combatIntensity }); audioUpdate(f); };
    return subjects.map(s => ({ id: s.id, name: s.name, blueprint: s.model.blueprint.id, pos: s.flight.position.toArray(), orientation: s.flight.orientation.toArray(), hull: s.hull, hullMax: s.hullMax, shield: s.shield, shieldMax: s.shieldMax, loadout: s.combat.loadout }));
  });
  const sourceFiles = Object.fromEntries(['scripts/v3-gameplay.mjs','src/cinema/gameplaySetup.ts','src/world/scenes/FlightScene.ts','src/world/EventTap.ts'].map(p => [p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
  writeFileSync(`${out}/provenance.json`, JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceFiles, query, seed: 1994, fps: 30, probe, from, seconds, replayPath, camera, initial, kind: 'deterministic staged gameplay', policy: 'No health/shield/damage/death/pose writes after initial setup. Normal FlightScene simulation and stock fits.', inputs: plan }, null, 2));
  let ended = false;
  let cameraApplied = false;
  let f = -1;
  for (let attempt = 0; attempt < (seconds+15) * 30 && !ended; attempt++) {
    const tick = await page.evaluate(() => window.__v3.S.simTick);
    if (tick / 60 >= seconds) break;
    if (!cameraApplied && camera && tick / 60 >= from - 1) {
      await page.evaluate(({camera}) => { const { S, target:t } = window.__v3; S.director.cut(camera,{position:t.flight.position,velocity:t.flight.velocity,radius:t.radius},Infinity); }, {camera});
      cameraApplied = true;
    }
    for (const cue of plan) {
      if (tick === Math.round(cue.at*60)) await page.keyboard.down(cue.key);
      if (tick === Math.round((cue.at+(cue.dur ?? 1/30))*60)) await page.keyboard.up(cue.key);
    }
    f++;
    if (probe && f % 30 !== 0) {
      await page.evaluate(() => { const S = window.__v3.S; S.simStep(); S.simStep(); S.update({ dt: 1/30, time: S.simTick/60, alpha: 0, frame: S.simTick/2, ticks: 2 }); });
    } else await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
    const sample = await page.evaluate(() => {
      const v = window.__v3, S = v.S, t = v.target;
      const frame = { tick: S.simTick, at: S.simTick/60, audio: v.audio.splice(0), events: v.ticks.splice(0), camera: S.cameraLabel(), controls: v.inputs.splice(0) };
      if (S.simTick % 60 === 0) frame.state = { player: { hull: S.player.hull, shield: S.player.shield }, target: t && { alive: t.alive, hull: t.hull, shield: t.shield, facings: t.combat.dmg.facings, subsystems: t.combat.dmg.subsystems.map(s => ({ id: s.id, hp: s.hp, destroyed: s.destroyed })), structure: t.combat.dmg.structure }, wrecks: S.fleet.destruction.wrecks.map(w => ({ ship: w.ship.id, cause: w.cause, position: w.position.toArray(), age: w.age })), deadAt: v.deadAt };
      return frame;
    });
    const frame = Math.round(sample.at*30)-1;
    if (sample.at > from) {
      appendFileSync(`${out}/events.jsonl`, JSON.stringify({ frame, ...sample })+'\n');
      if (!probe || f % 300 === 0) await page.screenshot({ path: `${out}/f_${String(frame).padStart(5,'0')}.jpg`, type: 'jpeg', quality: 94 });
    }
    if (sample.state && sample.tick % 600 === 0) console.log(JSON.stringify({ at: sample.at, player: sample.state.player, target: sample.state.target && { hull: sample.state.target.hull, shield: sample.state.target.shield, alive: sample.state.target.alive }, wrecks: sample.state.wrecks.length, deadAt: sample.state.deadAt }));
  }
  const tape = await page.evaluate(() => window.__VANGUARD__.hooks.replay.clip(1e9));
  writeFileSync(`${out}/take.vgr`, JSON.stringify(tape));
  writeFileSync(`${out}/replay-status.json`, JSON.stringify(await page.evaluate(() => window.__VANGUARD__.hooks.replay.state()), null, 2));
  console.log('DONE', out);
} finally { await browser.close(); await server.close(); }
