/** Render the captured combat + actual timed speech through shipping Web Audio. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2] ?? 'scratchpad/combat-readability/improved';
const evidence = JSON.parse(readFileSync(`${path}/evidence.json`, 'utf8'));
// snapshotAudioFrame is JSON-only. Restore ship identity from the independently
// logged tick events so GameAudio's bleed/primary-hit de-duplication is faithful.
let eventCursor = 0;
for (const frame of evidence.frames) for (const e of frame.weaponEvents) {
  const tick = evidence.events[eventCursor++];
  if (!tick || tick.kind !== e.kind || tick.tick > frame.at * 60 + 0.001) throw new Error('Event trace does not match audio frames');
  e.shipId = tick.ship; e.shooterId = tick.shooter;
}
if (eventCursor !== evidence.events.length) throw new Error('Audio trace omits tick events');
const server = await createServer({ server: { host: '127.0.0.1', port: 5438, strictPort: true, hmr: false, watch: null }, logLevel: 'error', plugins: [{ name: 'mix-proof', configureServer(s) {
  s.middlewares.use((req, res, next) => { if (req.url !== '/__mix-proof') return next(); res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Combat mix proof</title>'); });
} }] });
await server.listen();
const browser = await chromium.launch({ args: ['--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5438/__mix-proof');
  const result = await page.evaluate(async evidence => {
    const ships = new Map();
    const identity = (id, value) => {
      if (!value || id === undefined) return value;
      if (!ships.has(id)) ships.set(id, value);
      return ships.get(id);
    };
    for (const frame of evidence.frames) for (const e of frame.weaponEvents) {
      e.ship = identity(e.shipId, e.ship); e.shooter = identity(e.shooterId, e.shooter);
    }
    const { GameAudio } = await import('/src/audio/index.ts');
    const { VoiceBox } = await import('/src/audio/voice/index.ts');
    const { loadClips, fetchClip } = await import('/src/audio/voice/Recorded.ts');
    const sr = 48000, seconds = 62;
    const ctx = new OfflineAudioContext(2, seconds * sr, sr);
    const audio = new GameAudio({ context: ctx });
    audio.setScore('nexus', 0, 0); audio.music.setMood('cruise', 0);
    const voice = new VoiceBox(audio); voice.modeOverride = 'cast';
    await loadClips();
    await Promise.all(evidence.cues.filter(c => c.clip).map(c => fetchClip(ctx, c.clip.key)));
    let fi = 0, ci = 0, maxVoices = 0;
    const live = [], starts = [];
    const step = () => {
      const now = ctx.currentTime;
      for (const c of live) if (!c.stopped && c.at !== null && now >= c.at) { c.utter.stop(); c.stopped = true; }
      while (ci < evidence.cues.length && evidence.cues[ci].at <= now) {
        const cue = evidence.cues[ci++], utter = voice.speak(cue.req);
        live.push({ utter, at: cue.stoppedAt, stopped: false });
        starts.push({ at: cue.at, renderedAt: now, duration: utter.dur, clip: cue.clip?.key, text: cue.req.text });
      }
      while (fi < evidence.frames.length && evidence.frames[fi].at <= now) audio.update({ ...evidence.frames[fi++], dt: 1 / 30 });
      maxVoices = Math.max(maxVoices, audio.engine.activeVoices());
    };
    step();
    for (let n = 1; n * 512 < seconds * sr; n++) void ctx.suspend(n * 512 / sr).then(() => { step(); void ctx.resume(); });
    const b = await ctx.startRendering();
    audio.music.dispose();
    // Export only the matching 38–60 second encounter, retaining the mix history.
    const start = 38 * sr, length = 22 * sr, data = new ArrayBuffer(44 + length * 4), dv = new DataView(data);
    const str = (at, s) => [...s].forEach((c, i) => dv.setUint8(at + i, c.charCodeAt(0)));
    str(0, 'RIFF'); dv.setUint32(4, data.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, length * 4, true);
    let peak = 0, clipped = 0; const energy = [0, 0];
    for (let i = 0; i < length; i++) for (let ch = 0; ch < 2; ch++) {
      const x = b.getChannelData(ch)[i + start]; peak = Math.max(peak, Math.abs(x)); energy[ch] += x * x;
      if (Math.abs(x) >= 0.999) clipped++;
      dv.setInt16(44 + i * 4 + ch * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true);
    }
    let binary = ''; const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return { wav: btoa(binary), peak, peakDbFS: 20 * Math.log10(peak), clipped, rmsDbFS: energy.map(e => 10 * Math.log10(e / length)), maxVoices, starts, policy: 'Actual captured events + VoiceBox cast/synth cues at recorded sim times. Shipping default stereo/full mix, Nexus score. Offline 48kHz; no physical listening assessment.' };
  }, evidence);
  writeFileSync(`${path}/mix.wav`, Buffer.from(result.wav, 'base64')); delete result.wav;
  writeFileSync(`${path}/mix-audit.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ path, peakDbFS: result.peakDbFS, clipped: result.clipped, rmsDbFS: result.rmsDbFS, maxVoices: result.maxVoices }));
} finally { await browser.close(); await server.close(); }
