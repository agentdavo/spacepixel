#!/usr/bin/env node
/**
 * Headless audio verification.
 *
 *   node scripts/audio-render.mjs [--out <dir>] [--only name,name] [--port 5198]
 *
 * Boots Vite, opens a blank page in Chromium, imports src/audio/offline.ts and
 * renders each scenario (music moods + SFX) on an OfflineAudioContext through
 * the real GameAudio.update() path. Writes 16-bit WAVs and prints analysis:
 * peak / RMS (dBFS), clipped samples, max pooled voices, silence gaps,
 * spectral centroid over time, onset density, tempo estimate and L/R balance.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = resolve(opt('out', '/tmp/claude-0/-home-user-spacepixel/8e290d9e-5be9-58a7-9f52-012490160559/scratchpad/audio'));
const port = Number(opt('port', '5198'));
const only = opt('only', '')
  .split(',')
  .filter(Boolean);
mkdirSync(outDir, { recursive: true });

const blank = {
  name: 'audio-render-page',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/__audio.html') return next();
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>audio</title></head><body></body></html>');
    });
  },
};
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'warn', plugins: [blank] });
await server.listen();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ── analysis ─────────────────────────────────────────────────────────────
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-inf');

function decodeWav(b64) {
  const buf = Buffer.from(b64, 'base64');
  const sr = buf.readUInt32LE(24);
  const n = (buf.length - 44) / 4;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = buf.readInt16LE(44 + i * 4) / 32768;
    R[i] = buf.readInt16LE(46 + i * 4) / 32768;
  }
  return { buf, sr, L, R };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function analyse(L, R, sr) {
  const n = L.length;
  const M = new Float32Array(n);
  let sumL = 0;
  let sumR = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    M[i] = (L[i] + R[i]) * 0.5;
    sumL += L[i] * L[i];
    sumR += R[i] * R[i];
    sum += M[i] * M[i];
  }
  const rms = Math.sqrt((sumL + sumR) / (2 * n));

  // Silence: 50 ms windows under −60 dBFS.
  const win = Math.floor(sr * 0.05);
  let silent = 0;
  let run = 0;
  let longest = 0;
  const windows = Math.floor(n / win);
  for (let w = 0; w < windows; w++) {
    let e = 0;
    for (let i = w * win; i < (w + 1) * win; i++) e += M[i] * M[i];
    if (db(Math.sqrt(e / win)) < -60) {
      silent++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  // STFT: centroid, flux.
  const N = 2048;
  const hop = 512;
  const hann = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let prev = new Float64Array(N / 2);
  const cents = [];
  const energies = [];
  const flux = [];
  for (let s = 0; s + N <= n; s += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = M[s + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(N / 2);
    let num = 0;
    let den = 0;
    let fl = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      num += m * ((k * sr) / N);
      den += m;
      const d = Math.log1p(m * 10) - Math.log1p(prev[k] * 10);
      if (d > 0) fl += d;
    }
    prev = mag;
    cents.push(den > 1e-6 ? num / den : 0);
    energies.push(den);
    flux.push(fl);
  }
  // Energy-weighted centroid overall + per 2 s buckets.
  const framesPerSec = sr / hop;
  let cw = 0;
  let ew = 0;
  for (let i = 0; i < cents.length; i++) {
    cw += cents[i] * energies[i];
    ew += energies[i];
  }
  const centroid = ew > 0 ? cw / ew : 0;
  const bucket = Math.round(framesPerSec * 2);
  const centSeries = [];
  const rmsSeries = [];
  for (let b = 0; b * bucket < cents.length; b++) {
    let c = 0;
    let e = 0;
    for (let i = b * bucket; i < Math.min(cents.length, (b + 1) * bucket); i++) {
      c += cents[i] * energies[i];
      e += energies[i];
    }
    centSeries.push(e > 0 ? Math.round(c / e) : 0);
    const s0 = Math.floor((b * bucket * hop));
    const s1 = Math.min(n, Math.floor(((b + 1) * bucket * hop)));
    let q = 0;
    for (let i = s0; i < s1; i++) q += M[i] * M[i];
    rmsSeries.push(Math.round(db(Math.sqrt(q / Math.max(1, s1 - s0)))));
  }

  // Onsets: flux peaks above a moving median-ish threshold.
  let onsets = 0;
  const W = 8;
  for (let i = 1; i < flux.length - 1; i++) {
    let m = 0;
    for (let k = Math.max(0, i - W); k < Math.min(flux.length, i + W); k++) m += flux[k];
    m /= 2 * W;
    if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > m * 1.5 + 1) onsets++;
  }
  const onsetRate = onsets / (n / sr);

  // Tempo: autocorrelation of mean-removed flux, 60–200 BPM (octave-folded into 70–180).
  const mu = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const f0 = flux.map((x) => x - mu);
  let best = 0;
  let bestLag = 0;
  let ac0 = 0;
  for (let i = 0; i < f0.length; i++) ac0 += f0[i] * f0[i];
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = (60 / bpm) * framesPerSec;
    const l0 = Math.floor(lag);
    const fr = lag - l0;
    let ac = 0;
    for (let i = 0; i + l0 + 1 < f0.length; i++) ac += f0[i] * (f0[i + l0] * (1 - fr) + f0[i + l0 + 1] * fr);
    if (ac > best) {
      best = ac;
      bestLag = bpm;
    }
  }
  const pulse = ac0 > 0 ? best / ac0 : 0;

  // L/R balance per 0.5 s (dB, + = right).
  const half = Math.floor(sr * 0.5);
  const pan = [];
  for (let s = 0; s + half <= n; s += half) {
    let l = 0;
    let r = 0;
    for (let i = s; i < s + half; i++) {
      l += L[i] * L[i];
      r += R[i] * R[i];
    }
    pan.push(l + r > 1e-7 ? Math.round(10 * Math.log10((r + 1e-12) / (l + 1e-12))) : null);
  }
  return {
    rmsDb: db(rms),
    silentPct: (100 * silent) / Math.max(1, windows),
    longestSilence: longest * 0.05,
    centroid,
    centSeries,
    rmsSeries,
    onsetRate,
    tempo: bestLag,
    pulse,
    pan,
  };
}

// ── render ───────────────────────────────────────────────────────────────
let failed = false;
const rows = [];
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/__audio.html`);
  const names = await page.evaluate(async () => Object.keys((await import('/src/audio/offline.ts')).SCENARIOS));
  for (const name of names) {
    if (only.length && !only.includes(name)) continue;
    const t0 = Date.now();
    let r;
    try {
      r = await page.evaluate(async (nm) => (await import('/src/audio/offline.ts')).renderScenario(nm), name);
    } catch (e) {
      console.log(`✗ ${name}: ${e.message}`);
      failed = true;
      continue;
    }
    const { buf, sr, L, R } = decodeWav(r.wav);
    const file = `${outDir}/${name}.wav`;
    writeFileSync(file, buf);
    const a = analyse(L, R, sr);
    rows.push({ name, ...a, peak: r.peak, clipped: r.clipped, maxVoices: r.maxVoices, file, ms: Date.now() - t0 });
    if (r.clipped > 0) failed = true;
  }
  const bad = logs.filter((l) => /error|warn/i.test(l) && !l.includes('[vite]'));
  if (bad.length) console.log(bad.slice(0, 20).join('\n'));
  await page.close();
} finally {
  await browser.close();
  await server.close();
}

console.log(`\nWAVs → ${outDir}\n`);
console.log(
  'scenario'.padEnd(18) +
    'peak dB'.padStart(8) +
    'rms dB'.padStart(8) +
    'clip'.padStart(6) +
    'voices'.padStart(7) +
    'silent%'.padStart(8) +
    'maxgap s'.padStart(9) +
    'centroid'.padStart(9) +
    'onsets/s'.padStart(9) +
    'tempo'.padStart(7) +
    'pulse'.padStart(7),
);
for (const r of rows) {
  console.log(
    r.name.padEnd(18) +
      fmt(db(r.peak)).padStart(8) +
      fmt(r.rmsDb).padStart(8) +
      String(r.clipped).padStart(6) +
      String(r.maxVoices).padStart(7) +
      fmt(r.silentPct, 0).padStart(8) +
      fmt(r.longestSilence, 2).padStart(9) +
      String(Math.round(r.centroid)).padStart(9) +
      fmt(r.onsetRate).padStart(9) +
      fmt(r.tempo, 0).padStart(7) +
      fmt(r.pulse, 2).padStart(7),
  );
}
console.log('\nper-2s series (rms dBFS | centroid Hz):');
for (const r of rows) console.log(`  ${r.name.padEnd(17)} rms  ${r.rmsSeries.join(' ')}\n  ${''.padEnd(17)} cent ${r.centSeries.join(' ')}`);
console.log('\nL/R balance per 0.5 s (dB, + = right) for SFX:');
for (const r of rows) if (!r.name.startsWith('music')) console.log(`  ${r.name.padEnd(17)} ${r.pan.map((p) => (p === null ? '·' : p)).join(' ')}`);
process.exit(failed ? 1 : 0);
