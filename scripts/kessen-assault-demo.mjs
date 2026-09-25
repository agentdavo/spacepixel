/** Native GPU film capture. No campaign state is created or modified.
 * node scripts/kessen-assault-demo.mjs --preview
 * node scripts/kessen-assault-demo.mjs --render
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const out = resolve(opt('out', 'docs/demos/kessen-assault'));
const scratch = mkdtempSync(resolve(tmpdir(), 'kessen-assault-'));
const port = Number(opt('port', '5264'));
const fps = 24;
mkdirSync(out, { recursive: true });
const server = await createServer({ cacheDir: resolve('node_modules/.vite-kessen-assault'), logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const reports = [];

/** Original procedural film sound: thruster wash, low engine bed, gun cracks,
 * impact thuds. Authored to the same salvo times as the standalone scene. */
function soundtrack(file, start, duration) {
  const sr = 48000, count = Math.round(duration * sr);
  const pcm = Buffer.alloc(count * 4);
  let seed = 491;
  let filtered = 0;
  for (let i = 0; i < count; i++) {
    const t = start + i / sr;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    filtered += (noise - filtered) * 0.04;
    const jets = t < 5 ? 0.13 : t > 16 ? 0.17 : 0.035;
    const bed = 0.035 * Math.sin(t * Math.PI * 2 * 48) + 0.015 * Math.sin(t * Math.PI * 2 * 73) + filtered * jets;
    let l = bed, r = bed;
    if (t >= 12 && t < 14) {
      const age = t - 12;
      const blast = Math.exp(-age * 3) * (Math.sin(age * 2 * Math.PI * 42) * 0.3 + filtered * 0.4);
      l += blast; r += blast;
    }
    for (let actor = 0; actor < 8; actor++) {
      const elapsed = t - 5 - actor * 0.07;
      if (elapsed < 0 || elapsed >= 11.2) continue;
      const shot = Math.floor(elapsed / 0.6);
      if (shot >= 18) continue;
      const age = elapsed - shot * 0.6;
      const crack = age < 0.13 ? Math.exp(-age * 42) * (noise * 0.075 + Math.sin(2 * Math.PI * (780 * age - 2100 * age * age)) * 0.04) : 0;
      const hitAge = age - 0.3;
      const hit = hitAge >= 0 && hitAge < 0.27 ? Math.exp(-hitAge * 15) * (Math.sin(hitAge * 2 * Math.PI * 85) * 0.075 + filtered * 0.12) : 0;
      const pan = (actor % 4) / 3;
      l += (crack + hit) * (1 - pan * 0.65);
      r += (crack + hit) * (0.35 + pan * 0.65);
    }
    const fade = Math.min(1, i / sr / 0.35, (duration - i / sr) / 0.6);
    pcm.writeInt16LE(Math.round(Math.tanh(l * 2) * 26000 * fade), i * 4);
    pcm.writeInt16LE(Math.round(Math.tanh(r * 2) * 26000 * fade), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([header, pcm]));
}

try {
  for (const cut of ['cinematic', 'close']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.route('**/favicon.ico', r => r.fulfill({ status: 204 }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const url = `http://127.0.0.1:${port}/?scene=kessen-assault&cut=${cut}&shot=1&record=${fps}&hud=0&quality=high&dynres=0`;
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__VANGUARD__?.error || window.__VANGUARD__?.hooks?.assault, null, { timeout: 180000 });
    const device = await page.evaluate(() => {
      const v = window.__VANGUARD__;
      return { error: v.error, backend: v.backend, deviceCreated: !!v.hooks?.renderer?.().backend.device?.queue };
    });
    assert.equal(device.error, undefined);
    assert.equal(device.backend, 'WebGPU'); assert.equal(device.deviceCreated, true);
    const checks = await page.evaluate(() => {
      const s = window.__VANGUARD__.hooks.assault;
      const snapshot = () => s.actors.map(a => ({ p: a.frame.root.position.toArray(), muzzle: a.muzzle.toArray(), joints: Object.values(a.frame.bones).map(b => b.quaternion.toArray()) }));
      s.poseAt(9); const direct = JSON.stringify(snapshot());
      s.poseAt(3.25); s.poseAt(9); const replayed = JSON.stringify(snapshot());
      const V = s.camera.position.constructor;
      const Q = s.camera.quaternion.constructor;
      return { frames: s.actors.length, originalScale: s.actors.every(a => a.frame.root.scale.equals(new V(1, 1, 1))), seekStable: direct === replayed,
        barrelAlignment: s.actors.map(a => new V(0, -1, 0).applyQuaternion(a.frame.bones.weapon_R.getWorldQuaternion(new Q())).dot(a.target.clone().sub(a.muzzle).normalize())) };
    });
    assert.equal(checks.frames, 8); assert.equal(checks.originalScale, true); assert.equal(checks.seekStable, true);
    assert.ok(checks.barrelAlignment.every(dot => dot > 0.999), 'visible barrels must aim at their hit points');
    await page.evaluate(() => document.fonts.ready);
    for (const t of cut === 'cinematic' ? [1, 4, 6, 9, 12, 16.5] : [6, 10, 14]) {
      await page.evaluate(async t => { const h = window.__VANGUARD__.hooks; h.assault.poseAt(t - 1 / 24); await h.step(1); }, t);
      await page.screenshot({ path: `${out}/${cut}-${t}.png` });
    }
    if (args.includes('--render')) {
      const start = cut === 'close' ? 5 : 0;
      const duration = cut === 'close' ? 12 : 18;
      const dir = resolve(scratch, cut); mkdirSync(dir);
      await page.evaluate(t => window.__VANGUARD__.hooks.assault.poseAt(t), start);
      for (let i = 0; i < duration * fps; i++) {
        await page.evaluate(async () => { await window.__VANGUARD__.hooks.step(1); });
        await page.screenshot({ path: `${dir}/f_${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
        if (i % 96 === 0) console.log(`${cut}: ${i}/${duration * fps} frames`);
      }
      const wav = resolve(dir, 'soundtrack.wav');
      soundtrack(wav, start, duration);
      const file = cut === 'close' ? 'kessen-assault-close.mp4' : 'kessen-capital-assault.mp4';
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', `${fps}`, '-i', `${dir}/f_%05d.jpg`, '-i', wav,
        '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-af', 'loudnorm=I=-18:TP=-1.5:LRA=9', '-movflags', '+faststart', '-t', `${duration}`, `${out}/${file}`]);
      console.log(`Created ${file}`);
      reports.push({ cut, file, start, duration, fps, size: [1280, 720], url, ...device, checks, errors });
    } else reports.push({ cut, url, ...device, checks, errors });
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(`${out}/capture.json`, JSON.stringify({ note: 'Authored standalone cinematic demo using native game assets at their original scale. Choreographed salvo/impacts, not campaign combat or boarding mechanics. Original procedural soundtrack.', scratch, reports }, null, 2));
} finally { await browser.close(); await server.close(); }
