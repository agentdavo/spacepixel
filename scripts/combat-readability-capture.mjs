/** Native EP04 replay evidence. No simulation state or input writes. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const opt = (k, d) => process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d;
const tapePath = resolve(opt('tape', 'scratchpad/combat-readability/take.vgr'));
const out = resolve(opt('out', 'scratchpad/combat-readability/baseline'));
if (existsSync(`${out}/evidence.json`)) throw new Error('Choose a fresh output directory to preserve prior evidence');
const from = Number(opt('from', '38')), until = Number(opt('until', '60'));
const tape = JSON.parse(readFileSync(tapePath, 'utf8'));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const files = ['src/audio/index.ts', 'src/audio/AudioEngine.ts', 'src/ui/CombatHud.ts', 'src/ui/CombatFeedback.ts', 'src/world/scenes/FlightScene.ts', 'src/game/campaign/episodes/ep04-black-light.ts', 'public/voice/manifest.json'];
const sourceFiles = Object.fromEntries(files.filter(existsSync).map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5437, strictPort: true, hmr: false, watch: null }, logLevel: 'error', plugins: [{ name: 'combat-proof', configureServer(s) {
  s.middlewares.use((req, res, next) => { if (req.url !== '/__combat-tape') return next(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(tape)); });
} }] });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const q = new URLSearchParams(tape.header.boot); q.set('replay', '/__combat-tape'); q.set('rseek', '0');
  await page.goto(`http://127.0.0.1:5437/?${q}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.ready && window.__VANGUARD__?.hooks?.step, null, { timeout: 180000 });
  const hardware = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const v = window.__VANGUARD__;
    return { backend: v.backend, adapter: adapter?.info?.toJSON?.() ?? { vendor: adapter?.info?.vendor, architecture: adapter?.info?.architecture, device: adapter?.info?.device, description: adapter?.info?.description }, userAgent: navigator.userAgent };
  });
  if (hardware.backend !== 'WebGPU') throw new Error('Native WebGPU required');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.hud-debug,.hud-graph,.replay-deck,.replay-toast{display:none!important}' });
  await page.evaluate(async () => {
    const S = window.__VANGUARD__.hooks.scene;
    const { snapshotAudioFrame } = await import('/src/cinema/recording.ts');
    const { GameAudio } = await import('/src/audio/index.ts');
    const { getVoice, VoiceBox } = await import('/src/audio/voice/index.ts');
    const { loadClips, clipFor } = await import('/src/audio/voice/Recorded.ts');
    await loadClips();
    // Native visuals are frame-stepped. Use shipping VoiceBox on an offline
    // context to return real clip durations, and log cues for a separate audio
    // render; wall-clock playback during screenshots would mis-time speech.
    const offline = new GameAudio({ context: new OfflineAudioContext(2, 44100, 44100) });
    const voice = new VoiceBox(offline); voice.modeOverride = 'cast';
    window.__combat = { S, events: [], frames: [], cues: [], hashes: [] };
    const v = window.__combat;
    getVoice().speak = req => {
      const u = voice.speak(req), clip = clipFor(req.who, req.text, voice.plan(req).profile);
      const cue = { at: S.simTick / 60, req, dur: u.dur, clip, stoppedAt: null }; v.cues.push(cue);
      return { ...u, stop() { cue.stoppedAt = S.simTick / 60; u.stop(); } };
    };
    const tick = S.simStep.bind(S);
    S.simStep = () => {
      tick();
      for (const e of S.weapons.events) v.events.push({ tick: S.simTick, kind: e.kind, ship: e.ship?.id, player: e.ship === S.player, shooter: e.shooter?.id, facing: e.facing, strength: e.strength, bleed: e.bleed, hullDamage: e.hullDamage, shieldDamage: e.shieldDamage, amount: e.amount });
      if (S.simTick % 60 === 0) v.hashes.push([S.simTick, S.worldHash()]);
    };
    S.audio.update = f => v.frames.push({ at: S.simTick / 60, ...snapshotAudioFrame(f), player: { ...f.player, position: { ...f.player.position }, velocity: { ...f.player.velocity } }, jumpPhase: f.jumpPhase, combatIntensity: f.combatIntensity });
  });
  let images = 0;
  for (let frame = 0; frame < until * 30; frame++) {
    await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
    if (frame >= from * 30 && frame % 3 === 0) await page.screenshot({ path: `${out}/f_${String(images++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
    if (frame % 300 === 299) console.log(`Captured ${(frame + 1) / 30}s`);
  }
  const data = await page.evaluate(() => {
    const { events, frames, cues, hashes } = window.__combat;
    return { events, frames, cues, hashes, replay: window.__VANGUARD__.hooks.replay.state() };
  });
  writeFileSync(`${out}/evidence.json`, JSON.stringify(data));
  writeFileSync(`${out}/provenance.json`, JSON.stringify({ source, sourceFiles, hardware, tapePath, tapeSha256: createHash('sha256').update(readFileSync(tapePath)).digest('hex'), from, until, captureFps: 10, simulationHz: 60, images, errors, policy: 'Unchanged ordinary-input EP04 replay. Native player camera/HUD. Shipping VoiceBox clip duration/subtitle reveal; cue log recorded for separate offline mix. No physical listening claim.' }, null, 2));
  console.log(JSON.stringify({ out, hardware, replay: data.replay, cues: data.cues.length, events: data.events.length, images, errors }));
} finally { await browser?.close(); await server.close(); }
