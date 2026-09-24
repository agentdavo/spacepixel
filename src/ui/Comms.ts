import type { Character, ChatterBeat, ChatterLine } from '@/game/campaign/types';
import { drawPortrait, portraitKind, type PortraitKind } from './Portrait';
import { getVoice, type Utterance } from '@/audio/voice';
import { installSettingsKeys } from '@/game/Settings';
import { lineHold, typeDuration } from './subtitleTiming';
import './campaign.css';
import './subtitles.css';

/**
 * Radio chatter panel (bottom-left, above the flight readouts): portrait,
 * callsign plate, typewriter text and a signal meter. Driven entirely by
 * `update(dt)` so it pauses with the game and captures deterministically.
 *
 * Every line is voiced (src/audio/voice: procedural radio voice, or system
 * speech, per Settings) and the typewriter follows the voice; hold times
 * come from the shared subtitle timing (≤ 15 chars/s reading speed).
 *
 * Timing: a line types with its voice, stays up for its reading time, and the next
 * line of the beat starts after `next.delay` seconds (default: the reading
 * time). A short delay never cuts a line before it has finished typing; a
 * long one leaves a pause of dead air. A beat with a higher `priority`
 * interrupts whatever is playing; others queue in priority order.
 */

const CPS = 46; // typewriter characters / second
const GARBLE = '#%&@$*/\\|<>=+?!01▚▞░▒';
const SYSTEM: Character = {
  id: 'system',
  callsign: 'SYSTEM',
  name: 'Ship computer',
  role: 'Flight systems',
  faction: 'concord',
  voice: '',
  portrait: { skin: '#000', hair: '#000', eyes: '#000', suit: '#000', hairStyle: 'short', seed: 1 },
  commsColor: '#7dffb2',
};

interface Queued {
  beat: ChatterBeat;
  order: number;
}

/** Reading time for a line (seconds from line start until it can go). */
export function readingTime(text: string, voiceDur = 0): number {
  return Math.max(2.4, lineHold(text, voiceDur));
}

export class Comms {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly pctx: CanvasRenderingContext2D;
  private readonly callsignEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly roleEl: HTMLElement;
  private readonly typedEl: HTMLElement;
  private readonly jpEl: HTMLElement;
  private utter: Utterance | null = null;
  private readonly bars: HTMLElement[];
  private readonly cast = new Map<string, Character>();

  private pending: Queued[] = [];
  private order = 0;
  private beat: ChatterBeat | null = null;
  private priority = -Infinity;
  private idx = 0;
  private phase: 'idle' | 'wait' | 'line' = 'idle';
  private wait = 0;
  private line: ChatterLine | null = null;
  private speaker: Character = SYSTEM;
  private kind: PortraitKind = 'human';
  private lineT = 0;
  private lineEnd = 0;
  private typeDur = 0;
  private time = 0;
  private burst = 0;
  private shown = false;
  private lastChars = -1;
  private lastTick = -1;
  private sig = -1;
  private pw = 0;
  private ph = 0;
  private readonly onResize = () => this.measure();

  /** Mute the radio clicks. */
  muted = false;

  constructor(root: HTMLElement, cast: Character[]) {
    for (const c of cast) this.cast.set(c.id, c);
    this.el = document.createElement('div');
    this.el.className = 'comms';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <div class="comms-port"><canvas></canvas><span class="comms-rec">RX</span></div>
      <div class="comms-main">
        <div class="comms-plate">
          <span class="comms-callsign"></span>
          <span class="comms-name"></span>
          <span class="comms-sig"><i></i><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="comms-jp" hidden></div>
        <div class="comms-text"><span class="comms-typed"></span><span class="comms-caret"></span></div>
        <div class="comms-foot"><span class="comms-role"></span><span class="comms-freq"></span></div>
      </div>`;
    root.append(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.pctx = this.canvas.getContext('2d')!;
    this.callsignEl = this.el.querySelector('.comms-callsign')!;
    this.nameEl = this.el.querySelector('.comms-name')!;
    this.roleEl = this.el.querySelector('.comms-role')!;
    this.typedEl = this.el.querySelector('.comms-typed')!;
    this.jpEl = this.el.querySelector('.comms-jp')!;
    this.bars = [...this.el.querySelectorAll<HTMLElement>('.comms-sig i')];
    window.addEventListener('resize', this.onResize);
    armAudioUnlock();
    installSettingsKeys();
  }

  /** Add speakers at runtime (station people, bark callsigns). */
  addCast(chars: readonly Character[]): void {
    for (const c of chars) this.cast.set(c.id, c);
  }

  /** Is this speaker known (cast or added)? */
  hasSpeaker(id: string): boolean {
    return this.cast.has(id);
  }

  /** True while a line is up or anything is queued. */
  get busy(): boolean {
    return this.phase !== 'idle' || this.pending.length > 0;
  }

  /** The beat currently playing (null when idle). */
  get currentBeat(): ChatterBeat | null {
    return this.beat;
  }

  /** Play a beat: interrupts a lower-priority beat, otherwise queues. */
  play(beat: ChatterBeat): void {
    if (!beat.lines.length) return;
    if (this.beat?.id === beat.id || this.pending.some((q) => q.beat.id === beat.id)) return;
    const pr = beat.priority ?? 0;
    if (this.phase === 'idle') return this.startBeat(beat);
    if (pr > this.priority) {
      // Cut the current transmission mid-word.
      if (this.phase === 'line') radioClick('cut');
      this.stopVoice();
      this.startBeat(beat, true);
      return;
    }
    this.pending.push({ beat, order: this.order++ });
    this.pending.sort((a, b) => (b.beat.priority ?? 0) - (a.beat.priority ?? 0) || a.order - b.order);
    // Don't let an unattended queue grow forever: drop the stalest low-priority beat.
    if (this.pending.length > 6) this.pending.pop();
  }

  /** One-off line (priority 0). */
  say(line: ChatterLine): void {
    this.play({ id: `say-${this.order++}`, trigger: { on: 'start' }, lines: [line], priority: 0 });
  }

  /** Stop everything and hide the panel. */
  clear(): void {
    this.stopVoice();
    this.pending.length = 0;
    this.beat = null;
    this.line = null;
    this.phase = 'idle';
    this.priority = -Infinity;
    this.setShown(false);
  }

  destroy(): void {
    this.clear();
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }

  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.time += dt;
    this.burst = Math.max(0, this.burst - dt * 3.2);
    if (this.phase === 'idle') return;
    if (this.phase === 'wait') {
      this.wait -= dt;
      if (this.wait <= 0) this.showLine();
      else if (this.shown) this.drawPortrait(false);
      return;
    }
    // phase === 'line'
    this.lineT += dt;
    if (this.lineT >= this.lineEnd) {
      this.endLine();
      return;
    }
    this.renderText();
    this.drawPortrait(this.lineT < this.typeDur + 0.15);
    this.renderSignal();
  }

  // ── internals ─────────────────────────────────────────────────────

  private startBeat(beat: ChatterBeat, interrupt = false): void {
    this.beat = beat;
    this.priority = beat.priority ?? 0;
    this.idx = 0;
    this.phase = 'wait';
    this.wait = interrupt ? 0.08 : (beat.lines[0].delay ?? 0.1);
    if (interrupt) this.burst = 1;
  }

  private showLine(): void {
    const beat = this.beat;
    if (!beat) return this.clear();
    const line = beat.lines[this.idx];
    this.line = line;
    this.phase = 'line';
    this.lineT = 0;
    // Voice first: its length times the typewriter and the hold.
    this.stopVoice();
    const kind = portraitKind(line.who, this.cast.get(line.who));
    this.utter = this.muted ? null : getVoice().speak({ who: line.who, text: line.text, channel: line.static ? 'intercept' : kind === 'oracle' || kind === 'system' ? 'clean' : 'radio' });
    const vd = this.utter?.dur ?? 0;
    this.typeDur = vd > 0 ? typeDuration(line.text, vd) : line.text.length / CPS;
    const read = readingTime(line.text, vd);
    const next = beat.lines[this.idx + 1];
    const d = next?.delay;
    // Next line starts at `d` after this one (default: reading time), but
    // never before this line has been typed and glanced at.
    this.lineEnd = next ? Math.max(this.typeDur + 0.7, d === undefined ? read : Math.min(d, read)) : read;
    this.wait = next && d !== undefined && d > read ? d - read : 0.12;

    const who = line.who;
    const ch = this.cast.get(who) ?? (portraitKind(who) === 'system' ? SYSTEM : fallback(who));
    this.speaker = ch;
    this.kind = portraitKind(who, ch);
    this.el.style.setProperty('--cc', ch.commsColor || '#7dffb2');
    this.callsignEl.textContent = ch.callsign.toUpperCase();
    this.nameEl.textContent = ch.name;
    this.roleEl.textContent = ch.role.toUpperCase();
    this.jpEl.textContent = line.jp ?? '';
    this.jpEl.hidden = !line.jp;
    const freq = this.el.querySelector('.comms-freq');
    if (freq) freq.textContent = line.static ? 'INTERCEPT · ??? MHz' : this.kind === 'system' ? 'INTERNAL' : `CH ${String((hashStr(ch.id) % 12) + 1).padStart(2, '0')} · ${(240 + (hashStr(ch.id) % 90) / 10).toFixed(1)}`;
    this.el.classList.toggle('is-static', !!line.static);
    this.el.classList.toggle('is-system', this.kind === 'system');
    this.el.classList.toggle('is-oracle', this.kind === 'oracle');
    this.el.classList.toggle('is-priority', this.priority >= 2);
    this.lastChars = -1;
    this.lastTick = -1;
    this.burst = Math.max(this.burst, 0.55);
    if (!this.shown) this.setShown(true);
    else {
      // Retrigger the line-change flash.
      this.el.classList.remove('flash');
      void this.el.offsetWidth;
      this.el.classList.add('flash');
    }
    this.renderText();
    this.drawPortrait(true);
    this.renderSignal();
    if (!this.muted) radioClick('open');
  }

  private endLine(): void {
    if (!this.muted) radioClick('close');
    const beat = this.beat;
    this.idx++;
    if (beat && this.idx < beat.lines.length) {
      this.phase = 'wait';
      // Long dead air: drop the panel until the next voice.
      if (this.wait > 0.6) this.setShown(false);
      return;
    }
    const next = this.pending.shift();
    if (next) {
      this.startBeat(next.beat);
      this.wait = Math.max(this.wait, 0.35 + (next.beat.lines[0].delay ?? 0));
      return;
    }
    this.beat = null;
    this.line = null;
    this.phase = 'idle';
    this.priority = -Infinity;
    this.setShown(false);
  }

  private stopVoice(): void {
    this.utter?.stop();
    this.utter = null;
  }

  private setShown(v: boolean): void {
    this.shown = v;
    this.el.classList.toggle('show', v);
    if (v) this.measure();
  }

  private measure(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(32, Math.round((r.width || 112) * dpr));
    const h = Math.max(32, Math.round((r.height || 112) * dpr));
    if (w !== this.pw || h !== this.ph) {
      this.pw = this.canvas.width = w;
      this.ph = this.canvas.height = h;
    }
  }

  private renderText(): void {
    const line = this.line;
    if (!line) return;
    const text = line.text;
    const n = this.lineT >= this.typeDur ? text.length : this.utter ? Math.min(text.length, this.utter.reveal(this.lineT)) : Math.min(text.length, Math.floor(this.lineT * CPS));
    const tick = line.static ? Math.floor(this.time * 18) : 0;
    if (n === this.lastChars && tick === this.lastTick) return;
    this.lastChars = n;
    this.lastTick = tick;
    this.el.classList.toggle('typing', n < text.length);
    if (!line.static) {
      this.typedEl.textContent = text.slice(0, n);
      return;
    }
    // Intercept: each glyph arrives scrambled and resolves after a moment;
    // a few keep dropping out.
    let out = '';
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (ch === ' ' || ch === '\n') {
        out += ch;
        continue;
      }
      const typedAt = i / CPS;
      const resolveAt = typedAt + 0.3 + hash2(i, 7) * 0.8;
      const drop = hash2(i * 31 + tick, 3) < 0.05;
      out += this.lineT < resolveAt || drop ? GARBLE[Math.floor(hash2(i, tick) * GARBLE.length)] : ch;
    }
    this.typedEl.textContent = out;
  }

  private renderSignal(): void {
    const line = this.line;
    let s: number;
    if (this.kind === 'system') s = 5;
    else if (line?.static) s = 1 + Math.floor(hash2(Math.floor(this.time * 7), 5) * 2.4);
    else s = 4 + (hash2(Math.floor(this.time * 2), 9) < 0.3 ? 1 : 0);
    if (this.burst > 0.5) s = Math.min(s, 2);
    if (s === this.sig) return;
    this.sig = s;
    for (let i = 0; i < this.bars.length; i++) this.bars[i].classList.toggle('on', i < s);
  }

  private drawPortrait(talking: boolean): void {
    if (!this.pw) this.measure();
    const st = (this.line?.static ? 0.55 : 0) + this.burst * 0.6;
    drawPortrait(this.pctx, this.speaker.portrait, this.pw, this.ph, {
      talking: talking && this.phase === 'line',
      time: this.time,
      static: Math.min(1, st),
      kind: this.kind,
      tint: this.speaker.commsColor,
    });
  }
}

function fallback(who: string): Character {
  return {
    ...SYSTEM,
    id: who,
    callsign: who,
    name: 'Unidentified',
    role: 'Unknown transmitter',
    portrait: { skin: '#e8c0a0', hair: '#303040', eyes: '#404060', suit: '#505a70', hairStyle: 'short', accessory: 'visor', seed: hashStr(who) },
    commsColor: '#ffc46b',
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x5bd1e995, 0x27d4eb2d) + Math.imul(b + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── radio click (WebAudio) ────────────────────────────────────────────

let audio: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let unlocked = false;
let armed = false;

/** Audio only starts after a user gesture, so we never trip autoplay warnings. */
function armAudioUnlock(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** Tiny band-passed noise burst: key-up / key-down / cut. Never throws. */
export function radioClick(kind: 'open' | 'close' | 'cut'): void {
  if (!unlocked) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    const ac = audio;
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
    if (!noise) {
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + 0.005;
    const dur = kind === 'close' ? 0.16 : kind === 'cut' ? 0.09 : 0.05;
    const src = ac.createBufferSource();
    src.buffer = noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(kind === 'close' ? 3200 : 2200, t);
    if (kind === 'close') bp.frequency.exponentialRampToValueAtTime(900, t + dur);
    bp.Q.value = 1.4;
    const g = ac.createGain();
    const peak = kind === 'cut' ? 0.1 : 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t, Math.random() * 0.1, dur + 0.02);
    src.onended = () => {
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
  } catch {
    /* audio blocked or unavailable: silent radio */
  }
}
