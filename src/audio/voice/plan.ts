/**
 * Procedural voice — the planner. Pure (no Web Audio, no DOM, no imports), so
 * it runs in node tests and gives subtitles an exact duration before a single
 * node exists.
 *
 * Text → words → syllables → phoneme-ish segments → breakpoint tracks:
 *
 *   voice   glottal source level          f0     pitch (Hz)
 *   breath  aspiration noise level        f1–f3  formant centres (Hz)
 *   noise   frication / burst level       noiseHz  frication band centre
 *
 * VoiceSynth turns the tracks into AudioParam ramps on one small graph. The
 * speech is not English — it is English *shaped*: the vowels, stresses,
 * consonant classes and phrase melody come from the line, so a question rises,
 * a list keeps its commas, "LIT." is one hard syllable and a Hymn line is sung.
 * Heard through a radio band it reads as 1990s OVA chatter in a language you
 * almost know.
 */

export type Accent = 'plain' | 'directorate' | 'choir' | 'rustwake' | 'machine' | 'oracle';

export interface VoiceProfile {
  /** Base pitch, Hz (≈ 95–135 low voices, 170–240 high voices). */
  f0: number;
  /** Intonation range, semitones (2 = flat, 8 = lively). */
  range: number;
  /** Formant scale: 0.86 big chest … 1.0 adult male … 1.18 adult female … 1.3 child. */
  formant: number;
  /** Speaking rate, syllables per second (3.4 calm … 6.5 rattled). */
  rate: number;
  /** 0..1 aspiration noise mixed into the voice. */
  breath: number;
  /** 0..1 random pitch scatter per syllable (nerves, accent). */
  jitter: number;
  /** 0..1 grit / drive. */
  rasp: number;
  accent: Accent;
  /** Vibrato depth, semitones (sustained vowels only). */
  vibrato?: number;
  /** Extra voices at these pitch ratios (the Oracle speaks plural). */
  chorus?: number[];
  /** Output trim (linear, default 1). */
  gain?: number;
}

/** [time s, value] breakpoints, time non-decreasing; linear between points. */
export type Track = [number, number][];

export interface VoiceTracks {
  voice: Track;
  breath: Track;
  noise: Track;
  noiseHz: Track;
  f0: Track;
  f1: Track;
  f2: Track;
  f3: Track;
}

export interface VoicePlan {
  /** Seconds from the first breakpoint to silence. */
  dur: number;
  syllables: number;
  words: number;
  /** Sung (Choir Hymn) line. */
  sung: boolean;
  tracks: VoiceTracks;
  /** [time, chars of the original text revealed] — typewriter sync. */
  marks: [number, number][];
  /** Original text length. */
  chars: number;
}

export interface PlanOptions {
  /** Squeeze (never stretch) to fit this many seconds; at most `maxSqueeze`× faster. */
  maxDur?: number;
  /** Fastest allowed squeeze (default 1.7). */
  maxSqueeze?: number;
  /** Extra variation seed (a character id hash). */
  seed?: number;
}

// ── tiny deterministic helpers ─────────────────────────────────────────

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── phonology ──────────────────────────────────────────────────────────

type V = 'a' | 'e' | 'i' | 'o' | 'u' | '@' | 'ae';

/** Adult formant targets (Hz): F1, F2, F3. */
const VOWEL: Record<V, [number, number, number]> = {
  a: [730, 1150, 2450],
  ae: [660, 1720, 2410],
  e: [520, 1840, 2480],
  i: [300, 2240, 2900],
  o: [560, 860, 2420],
  u: [330, 900, 2250],
  '@': [500, 1450, 2500],
};

type CKind = 'fric' | 'stop' | 'nasal' | 'liquid' | 'asp' | 'silent';
interface Cons {
  kind: CKind;
  /** Frication / burst centre (Hz) or voiced formants for nasals and liquids. */
  hz?: number;
  f?: [number, number, number];
  amp: number;
  voiced?: boolean;
}

const C: Record<string, Cons> = {
  s: { kind: 'fric', hz: 5600, amp: 0.34 },
  z: { kind: 'fric', hz: 5200, amp: 0.2, voiced: true },
  sh: { kind: 'fric', hz: 2900, amp: 0.38 },
  ch: { kind: 'fric', hz: 3100, amp: 0.4 },
  j: { kind: 'fric', hz: 2700, amp: 0.26, voiced: true },
  f: { kind: 'fric', hz: 7000, amp: 0.15 },
  v: { kind: 'fric', hz: 6500, amp: 0.1, voiced: true },
  th: { kind: 'fric', hz: 6800, amp: 0.13 },
  h: { kind: 'asp', amp: 0.5 },
  p: { kind: 'stop', hz: 900, amp: 0.55 },
  b: { kind: 'stop', hz: 800, amp: 0.3, voiced: true },
  t: { kind: 'stop', hz: 3800, amp: 0.55 },
  d: { kind: 'stop', hz: 3300, amp: 0.3, voiced: true },
  k: { kind: 'stop', hz: 2000, amp: 0.55 },
  g: { kind: 'stop', hz: 1800, amp: 0.3, voiced: true },
  m: { kind: 'nasal', f: [260, 1000, 2200], amp: 0.24 },
  n: { kind: 'nasal', f: [260, 1500, 2500], amp: 0.24 },
  ng: { kind: 'nasal', f: [260, 1900, 2600], amp: 0.22 },
  l: { kind: 'liquid', f: [360, 1100, 2600], amp: 0.34 },
  r: { kind: 'liquid', f: [420, 1250, 1650], amp: 0.34 },
  w: { kind: 'liquid', f: [300, 700, 2200], amp: 0.3 },
  y: { kind: 'liquid', f: [280, 2200, 2900], amp: 0.3 },
  silent: { kind: 'silent', amp: 0 },
};

const DIGRAPHS = ['sh', 'ch', 'th', 'ph', 'ck', 'ng', 'qu', 'wh', 'gh'];

function consonants(cluster: string, wordStart: boolean, nextVowel: string): Cons[] {
  const out: Cons[] = [];
  let i = 0;
  while (i < cluster.length) {
    const two = cluster.slice(i, i + 2);
    if (DIGRAPHS.includes(two)) {
      i += 2;
      if (two === 'ph') out.push(C.f);
      else if (two === 'ck') out.push(C.k);
      else if (two === 'qu') out.push(C.k, C.w);
      else if (two === 'wh') out.push(C.w);
      else if (two === 'gh') {
        if (wordStart && i === 2) out.push(C.g);
      } else out.push(C[two]);
      continue;
    }
    const ch = cluster[i++];
    const soft = i === cluster.length && /^[eiy]/.test(nextVowel);
    switch (ch) {
      case 'c':
        out.push(soft ? C.s : C.k);
        break;
      case 'g':
        out.push(soft && !wordStart ? C.j : C.g);
        break;
      case 'x':
        out.push(C.k, C.s);
        break;
      case 'q':
        out.push(C.k);
        break;
      default:
        if (C[ch]) out.push(C[ch]);
    }
  }
  return out;
}

function nucleus(group: string): V[] {
  switch (group) {
    case 'ee':
    case 'ea':
    case 'ie':
      return ['i'];
    case 'oo':
      return ['u'];
    case 'ou':
    case 'ow':
      return ['a', 'u'];
    case 'ai':
    case 'ay':
    case 'ei':
    case 'ey':
      return ['e', 'i'];
    case 'oi':
    case 'oy':
      return ['o', 'i'];
    case 'au':
    case 'aw':
    case 'oa':
      return ['o'];
    case 'ue':
    case 'ew':
    case 'eu':
    case 'ui':
      return ['u'];
    case 'ia':
    case 'io':
      return ['i', group[1] === 'a' ? '@' : 'o'];
  }
  const c = group[0];
  return [c === 'y' ? 'i' : c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' ? c : '@'];
}

interface Syl {
  onset: Cons[];
  vowels: V[];
  coda: Cons[];
  stressed: boolean;
  /** Short function word (a, of, the…). */
  light: boolean;
}

const isV = (s: string, i: number): boolean => {
  const c = s[i];
  if ('aeiou'.includes(c)) return true;
  // y is a vowel unless it starts the word or precedes a vowel.
  return c === 'y' && i > 0 && !'aeiou'.includes(s[i + 1] ?? '');
};

const LIGHT = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'is', 'it', 'and', 'or', 'but', 'we', 'he', 'she', 'you', 'i', 'my', 'as', 'by', 'be', 'for', 'if', 'so', 'do', 'that', 'this', 'are', 'was']);

export function syllabify(raw: string, reduce: () => number): Syl[] {
  let w = raw.toLowerCase().replace(/[^a-z]/g, '').replace(/qu/g, 'kw');
  if (!w) return [];
  // Silent endings: "-e" (make), "-ed" after a non-dental (rolled), "-es" after non-sibilant.
  const groups = (s: string) => s.split('').filter((_, i) => isV(s, i) && !isV(s, i - 1)).length;
  if (w.length > 3 && groups(w) > 1) {
    if (/[^aeiouyl]e$/.test(w)) w = w.slice(0, -1);
    else if (/[^aeiouytd]ed$/.test(w)) w = w.slice(0, -2) + 'd';
    else if (/[^aeiouysxzhc]es$/.test(w)) w = w.slice(0, -2) + 's';
  }
  // Split into consonant clusters and vowel groups.
  const parts: { v: boolean; s: string }[] = [];
  for (let i = 0; i < w.length; i++) {
    const v = isV(w, i);
    const last = parts[parts.length - 1];
    if (last && last.v === v && !(v && last.s.length >= 2)) last.s += w[i];
    else parts.push({ v, s: w[i] });
  }
  if (!parts.some((p) => p.v)) parts.push({ v: true, s: '@' });
  const syls: Syl[] = [];
  const light = LIGHT.has(raw.toLowerCase());
  let pendingOnset = '';
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (!p.v) {
      if (!syls.length) pendingOnset = p.s;
      continue;
    }
    // Consonants between this vowel and the next: one goes to our coda, the rest to the next onset.
    const next = parts[k + 1];
    const after = parts[k + 2];
    let coda = '';
    if (next && !next.v) {
      if (!after) coda = next.s;
      else if (next.s.length >= 2) {
        const dg = DIGRAPHS.includes(next.s.slice(0, 2)) && next.s.length > 2 ? 2 : 1;
        coda = next.s.slice(0, dg);
        next.s = next.s.slice(dg);
      }
    }
    const nextV = after?.s ?? '';
    const onset = syls.length === 0 ? pendingOnset : parts[k - 1] && !parts[k - 1].v ? parts[k - 1].s : '';
    const idx = syls.length;
    let vowels = nucleus(p.s);
    const stressed = idx === 0 && !light;
    if (!stressed && (light || reduce() < 0.45) && vowels.length === 1) vowels = ['@'];
    syls.push({
      onset: consonants(onset, idx === 0, p.s),
      vowels,
      coda: consonants(coda, false, nextV),
      stressed,
      light,
    });
  }
  return syls;
}

// ── numbers → words (the Signal counts primes on air) ──────────────────

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ' ' + numberWords(n % 100) : ''}`;
  if (n < 1_000_000) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ' ' + numberWords(n % 1000) : ''}`;
  return String(n)
    .split('')
    .map((d) => ONES[Number(d)])
    .join(' ');
}

// ── tokens ─────────────────────────────────────────────────────────────

interface Tok {
  word?: string;
  /** Pause punctuation. */
  punct?: string;
  /** End index (exclusive) of this token in the original text. */
  end: number;
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\d[\d,]*)|([A-Za-z'’]+)|(\.\.\.|…|[.!?;:,—–]|\s-\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[1]) {
      const n = Number(m[1].replace(/,/g, ''));
      for (const w of numberWords(n).split(' ')) out.push({ word: w, end });
    } else if (m[2]) out.push({ word: m[2], end });
    else out.push({ punct: m[3].trim() || '-', end });
  }
  return out;
}

const PAUSE: Record<string, number> = { ',': 0.17, ';': 0.24, ':': 0.24, '.': 0.34, '!': 0.32, '?': 0.34, '—': 0.26, '–': 0.24, '-': 0.2, '...': 0.46, '…': 0.46 };

// Just-intonation steps for the Hymn of Ascent (prime ratios, as the lore says).
const HYMN = [1, 9 / 8, 5 / 4, 11 / 8, 3 / 2, 13 / 8, 7 / 4, 2].map((r) => 12 * Math.log2(r));

// ── the planner ────────────────────────────────────────────────────────

class Builder {
  t = 0;
  readonly tr: VoiceTracks = { voice: [[0, 0]], breath: [[0, 0]], noise: [[0, 0]], noiseHz: [[0, 4000]], f0: [], f1: [], f2: [], f3: [] };
  pt(track: Track, t: number, v: number): void {
    const last = track[track.length - 1];
    const tt = last ? Math.max(t, last[0]) : t;
    if (last && Math.abs(last[0] - tt) < 1e-6) last[1] = v;
    else track.push([tt, v]);
  }
  formants(t: number, f: [number, number, number]): void {
    this.pt(this.tr.f1, t, f[0]);
    this.pt(this.tr.f2, t, f[1]);
    this.pt(this.tr.f3, t, f[2]);
  }
}

/**
 * Plan an utterance. Deterministic for (text, profile, seed). Times start
 * at 0; the synth offsets them.
 */
export function planUtterance(text: string, p: VoiceProfile, opts: PlanOptions = {}): VoicePlan {
  let src = text;
  const sung = /^\s*\(sung\)\s*/i.test(src);
  const lead = sung ? src.match(/^\s*\(sung\)\s*/i)![0].length : 0;
  src = src.slice(lead);
  const toks = tokenize(src);
  const r = rng(hashStr(text) ^ (opts.seed ?? 0) ^ Math.round(p.f0 * 13));
  const machine = p.accent === 'machine';
  const b = new Builder();
  const fs = p.formant;
  const scaleF = (f: [number, number, number]): [number, number, number] => [f[0] * fs, f[1] * fs, f[2] * (0.5 + fs * 0.5)];
  const rateK = 5 / Math.max(2.5, p.rate); // consonant time scale
  const sylBase = 1 / Math.max(2.5, p.rate);
  const vowelK = (sung ? 2.3 : 1) * (p.accent === 'choir' ? 1.15 : p.accent === 'oracle' ? 1.25 : 1);

  // Phrases: runs of words between pause punctuation, each with its own melody.
  interface WordRef {
    syls: Syl[];
    end: number;
    start: number;
  }
  const phrases: { words: WordRef[]; punct: string; end: number }[] = [];
  let cur: WordRef[] = [];
  let lastEnd = 0;
  for (const tk of toks) {
    if (tk.word) {
      const syls = syllabify(tk.word, r);
      if (syls.length) cur.push({ syls, end: tk.end, start: lastEnd });
      lastEnd = tk.end;
    } else {
      if (cur.length) phrases.push({ words: cur, punct: tk.punct!, end: tk.end });
      else if (phrases.length) phrases[phrases.length - 1].end = tk.end;
      cur = [];
      lastEnd = tk.end;
    }
  }
  if (cur.length) phrases.push({ words: cur, punct: '.', end: src.length });

  const marks: [number, number][] = [[0, lead]];
  let syllables = 0;
  let words = 0;
  const exclaim = /!/.test(src);
  const baseSt = exclaim ? 1.5 : 0;
  let hymnStep = 0;
  let lastF0 = p.f0;

  b.t = 0.04;
  for (let pi = 0; pi < phrases.length; pi++) {
    const ph = phrases[pi];
    const total = ph.words.reduce((a, w) => a + w.syls.length, 0);
    let k = 0;
    for (let wi = 0; wi < ph.words.length; wi++) {
      const w = ph.words[wi];
      words++;
      for (let si = 0; si < w.syls.length; si++, k++) {
        const s = w.syls[si];
        syllables++;
        const prog = total > 1 ? k / (total - 1) : 0.5;
        const final = k === total - 1;
        // ── pitch (semitones from base) ──
        let st = baseSt + p.range * (0.3 - 0.6 * prog);
        if (s.stressed) st += p.range * 0.32;
        st += (r() - 0.5) * p.range * 0.7 * p.jitter;
        if (ph.punct === '?' && k >= total - 2) st += p.range * (final ? 1.0 : 0.55);
        else if (ph.punct === ',' && final) st += p.range * 0.22;
        else if (final && (ph.punct === '.' || ph.punct === '...' || ph.punct === '…')) st -= p.range * 0.2;
        if (machine) st = st > p.range * 0.1 ? 3 : 0;
        if (sung) {
          hymnStep = Math.max(0, Math.min(HYMN.length - 1, hymnStep + (r() < 0.55 ? 1 : -1) * (r() < 0.8 ? 1 : 2)));
          if (final) hymnStep = 0;
          st = HYMN[hymnStep] + 2;
        }
        const f0a = p.f0 * Math.pow(2, st / 12);
        const f0b = machine || sung ? f0a : f0a * Math.pow(2, (ph.punct === '?' && final ? 1.5 : -0.6) / 12);

        // ── timing ──
        let vdur = sylBase * vowelK * (s.stressed ? 0.72 : s.light ? 0.42 : 0.52);
        if (final) vdur *= ph.punct === ',' ? 1.15 : 1.35;
        vdur = Math.max(0.045, vdur - 0.008 * (s.onset.length + s.coda.length) * rateK);
        if (machine) vdur = sylBase * 0.85;

        for (const c of s.onset) consonant(b, c, rateK, fs, p, f0a, s.vowels[0]);
        const va = VOWEL[machine && s.vowels[0] === '@' ? 'e' : s.vowels[0]];
        const vb = VOWEL[s.vowels[s.vowels.length - 1]];
        vowel(b, vdur, scaleF(p.accent === 'rustwake' && s.vowels[0] === 'e' ? VOWEL.ae : va), scaleF(vb), f0a, f0b, s.stressed ? 1 : s.light ? 0.72 : 0.84, p, machine);
        for (const c of s.coda) consonant(b, c, rateK, fs, p, f0b, null);
        lastF0 = f0b;
        // Reveal this syllable's share of the word by now.
        const at = w.start + ((w.end - w.start) * (si + 1)) / w.syls.length;
        marks.push([b.t, lead + Math.round(at)]);
      }
      // Tiny breath between words (not between every syllable).
      if (wi < ph.words.length - 1) gap(b, machine ? 0.05 : 0.018 + r() * 0.025, false);
    }
    const pause = PAUSE[ph.punct] ?? 0.2;
    marks.push([b.t, lead + ph.end]);
    if (pi < phrases.length - 1) gap(b, pause * (p.accent === 'oracle' ? 1.4 : 1), true);
  }
  // Release.
  b.pt(b.tr.voice, b.t + 0.06, 0);
  b.pt(b.tr.breath, b.t + 0.06, 0);
  b.pt(b.tr.noise, b.t + 0.02, 0);
  b.t += 0.08;
  if (!b.tr.f0.length) b.pt(b.tr.f0, 0, lastF0);
  if (!b.tr.f1.length) b.formants(0, scaleF(VOWEL['@']));
  marks.push([b.t, text.length]);

  const plan: VoicePlan = { dur: b.t, syllables, words, sung, tracks: b.tr, marks, chars: text.length };
  if (opts.maxDur && plan.dur > opts.maxDur) scalePlan(plan, Math.max(1 / (opts.maxSqueeze ?? 1.7), opts.maxDur / plan.dur));
  return plan;
}

function vowel(b: Builder, dur: number, fa: [number, number, number], fb: [number, number, number], f0a: number, f0b: number, amp: number, p: VoiceProfile, machine: boolean): void {
  const t = b.t;
  const tr = b.tr;
  const att = Math.min(0.025, dur * 0.3);
  const glide = machine ? 0.004 : Math.min(0.04, dur * 0.4);
  b.pt(tr.voice, t + att, amp);
  b.pt(tr.voice, t + dur * 0.6, amp * 0.9);
  b.pt(tr.voice, t + dur, amp * 0.55);
  b.pt(tr.breath, t + att, amp * p.breath);
  b.pt(tr.breath, t + dur, amp * p.breath * 0.9);
  b.pt(tr.noise, t + 0.01, 0);
  b.pt(tr.f0, t, f0a);
  b.pt(tr.f0, t + dur, f0b);
  b.formants(t + glide, fa);
  if (fa !== fb) b.formants(t + dur, fb);
  else b.formants(t + dur - 0.001, fa);
  b.t = t + dur;
}

function consonant(b: Builder, c: Cons, k: number, fs: number, p: VoiceProfile, f0: number, next: V | null): void {
  const t = b.t;
  const tr = b.tr;
  switch (c.kind) {
    case 'silent':
      return;
    case 'fric': {
      const d = (c.voiced ? 0.045 : 0.058) * k;
      b.pt(tr.voice, t + 0.012, c.voiced ? 0.22 : 0);
      b.pt(tr.voice, t + d, c.voiced ? 0.22 : 0);
      b.pt(tr.noiseHz, t, c.hz! * (0.7 + fs * 0.3));
      b.pt(tr.noise, t, 0);
      b.pt(tr.noise, t + 0.014, c.amp);
      b.pt(tr.noise, t + d - 0.01, c.amp * 0.85);
      b.pt(tr.noise, t + d, 0);
      b.pt(tr.f0, t + d, f0);
      b.t = t + d;
      return;
    }
    case 'stop': {
      const closure = (c.voiced ? 0.024 : 0.032) * k;
      const burst = c.voiced ? 0.011 : 0.016;
      b.pt(tr.voice, t + 0.012, c.voiced ? 0.1 : 0);
      b.pt(tr.voice, t + closure, c.voiced ? 0.1 : 0);
      b.pt(tr.breath, t + 0.01, 0);
      b.pt(tr.noiseHz, t + closure, c.hz! * (0.75 + fs * 0.25));
      b.pt(tr.noise, t + closure, 0);
      b.pt(tr.noise, t + closure + 0.003, c.amp);
      b.pt(tr.noise, t + closure + burst, 0);
      // Aspiration after voiceless stops.
      if (!c.voiced) b.pt(tr.breath, t + closure + burst + 0.012, 0.25 + p.breath * 0.3);
      b.pt(tr.f0, t + closure + burst, f0);
      b.t = t + closure + burst + (c.voiced ? 0.004 : 0.016);
      return;
    }
    case 'asp': {
      const d = 0.04 * k;
      b.pt(tr.voice, t + 0.015, 0.05);
      b.pt(tr.breath, t + 0.012, c.amp);
      b.pt(tr.breath, t + d, c.amp * 0.8);
      if (next) b.formants(t + 0.01, [VOWEL[next][0] * fs, VOWEL[next][1] * fs, VOWEL[next][2]]);
      b.pt(tr.f0, t + d, f0);
      b.t = t + d;
      return;
    }
    case 'nasal':
    case 'liquid': {
      const d = (c.kind === 'nasal' ? 0.048 : 0.038) * k;
      const f = c.f!;
      b.pt(tr.voice, t + 0.015, c.amp);
      b.pt(tr.voice, t + d, c.amp);
      b.pt(tr.breath, t + 0.015, c.amp * p.breath * 0.5);
      b.pt(tr.noise, t + 0.01, 0);
      b.formants(t + Math.min(0.025, d * 0.5), [f[0] * fs, f[1] * fs, f[2] * (0.5 + fs * 0.5)]);
      b.formants(t + d, [f[0] * fs, f[1] * fs, f[2] * (0.5 + fs * 0.5)]);
      b.pt(tr.f0, t, f0);
      b.pt(tr.f0, t + d, f0);
      b.t = t + d;
      return;
    }
  }
}

function gap(b: Builder, d: number, full: boolean): void {
  const t = b.t;
  const tr = b.tr;
  b.pt(tr.voice, t + Math.min(0.04, d * 0.6), full ? 0 : 0.04);
  b.pt(tr.voice, t + d, full ? 0 : 0.04);
  b.pt(tr.breath, t + Math.min(0.04, d * 0.6), 0);
  b.pt(tr.breath, t + d, 0);
  b.pt(tr.noise, t + 0.01, 0);
  b.t = t + d;
}

/** Time-scale a plan in place (k < 1 speeds up). */
export function scalePlan(plan: VoicePlan, k: number): void {
  for (const tr of Object.values(plan.tracks) as Track[]) for (const pt of tr) pt[0] *= k;
  for (const m of plan.marks) m[0] *= k;
  plan.dur *= k;
}

/** Sample a track at time t (linear). */
export function sample(tr: Track, t: number): number {
  if (!tr.length) return 0;
  if (t <= tr[0][0]) return tr[0][1];
  for (let i = 1; i < tr.length; i++) {
    if (t <= tr[i][0]) {
      const [t0, v0] = tr[i - 1];
      const [t1, v1] = tr[i];
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return tr[tr.length - 1][1];
}

/** How many characters of the line the typewriter shows at time t (synced to the voice). */
export function revealAt(plan: VoicePlan, t: number): number {
  const m = plan.marks;
  if (t <= 0) return m[0][1];
  for (let i = 1; i < m.length; i++) {
    if (t <= m[i][0]) {
      const [t0, c0] = m[i - 1];
      const [t1, c1] = m[i];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return Math.min(plan.chars, Math.floor(c0 + (c1 - c0) * k));
    }
  }
  return plan.chars;
}
