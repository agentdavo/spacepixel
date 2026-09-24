import './subtitles.css';
import { getVoice, type Utterance, type VoiceChannel, type VoiceProfile } from '@/audio/voice';
import { installSettingsKeys, settings } from '@/game/Settings';
import { lineHold, SUB_GAP, typeDuration, visibleLength } from './subtitleTiming';

/**
 * The subtitle system. One line at a time — speaker name + line, an optional
 * second-language line above (OVA dual-sub style), typewriter timed to the
 * voice — used by station conversations and cutscenes directly, and by the
 * comms panel and the prologue overlay through the same timing
 * (subtitleTiming.ts) and settings (size, on/off, second line: F8 / F9).
 *
 * Driven by `update(dt)` so it pauses with its owner. `say()` queues; lines
 * never overlap. `skip()` completes the typing, a second skip advances.
 */
export interface SubtitleLine {
  /** Speaker id (voice lookup). */
  who: string;
  /** Display name; omit for narration. */
  speaker?: string;
  color?: string;
  text: string;
  /** Second-language line (Japanese flavour). */
  jp?: string;
  kicker?: string;
  /** Voice channel (default clean: in person). */
  channel?: VoiceChannel;
  /** Voice it (default true). */
  voice?: boolean;
  profile?: VoiceProfile;
  /** Hold at least this long (s). */
  minHold?: number;
  /** Stay up until skipped / cleared (conversation lines awaiting a choice). */
  sticky?: boolean;
}

interface Live {
  line: SubtitleLine;
  t: number;
  hold: number;
  typeDur: number;
  utter: Utterance | null;
  done: () => void;
  shown: number;
}

export class Subtitles {
  readonly el: HTMLDivElement;
  private readonly whoEl: HTMLElement;
  private readonly typedEl: HTMLElement;
  private readonly restEl: HTMLElement;
  private readonly jpEl: HTMLElement;
  private readonly kickerEl: HTMLElement;
  private queue: { line: SubtitleLine; done: () => void }[] = [];
  private live: Live | null = null;
  private wait = 0;

  constructor(root: HTMLElement, variant: 'bar' | 'dock' | 'cut' = 'bar') {
    installSettingsKeys();
    this.el = document.createElement('div');
    this.el.className = `subs subs-${variant}`;
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="sub-line"><div class="sub-kicker"></div><div class="sub-jp"></div><div class="sub-en"><b class="sub-who"></b><span class="sub-typed"></span><span class="sub-caret"></span><span class="sub-rest"></span></div></div>`;
    this.whoEl = this.el.querySelector('.sub-who')!;
    this.typedEl = this.el.querySelector('.sub-typed')!;
    this.restEl = this.el.querySelector('.sub-rest')!;
    this.jpEl = this.el.querySelector('.sub-jp')!;
    this.kickerEl = this.el.querySelector('.sub-kicker')!;
    root.append(this.el);
  }

  get busy(): boolean {
    return !!this.live || this.queue.length > 0;
  }

  /** The line on screen (null between lines). */
  get current(): SubtitleLine | null {
    return this.live?.line ?? null;
  }

  /** True once the current line has finished typing. */
  get typed(): boolean {
    return !this.live || this.live.t >= this.live.typeDur;
  }

  /** Queue a line; resolves when it has cleared. */
  say(line: SubtitleLine): Promise<void> {
    return new Promise((done) => {
      this.queue.push({ line, done });
      if (!this.live && this.wait <= 0) this.next();
    });
  }

  /** First call completes the typing; the next clears the line. */
  skip(): void {
    const l = this.live;
    if (!l) return;
    if (l.t < l.typeDur) {
      l.t = l.typeDur;
      this.render();
      return;
    }
    this.end();
  }

  clear(): void {
    this.live?.utter?.stop();
    const all = [...this.queue];
    this.queue.length = 0;
    const l = this.live;
    this.live = null;
    l?.done();
    for (const q of all) q.done();
    this.el.classList.remove('show');
  }

  destroy(): void {
    this.clear();
    this.el.remove();
  }

  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.25);
    if (!this.live) {
      if (this.wait > 0) this.wait -= dt;
      if (this.wait <= 0 && this.queue.length) this.next();
      return;
    }
    const l = this.live;
    l.t += dt;
    if (!l.line.sticky && l.t >= l.hold) return this.end();
    this.render();
  }

  private next(): void {
    const q = this.queue.shift();
    if (!q) return;
    const { line } = q;
    const utter = line.voice === false ? null : getVoice().speak({ who: line.who, text: line.text, channel: line.channel ?? 'clean', profile: line.profile });
    const vd = utter?.dur ?? 0;
    this.live = {
      line,
      t: 0,
      hold: Math.max(line.minHold ?? 0, lineHold(line.text, vd)),
      typeDur: typeDuration(line.text, vd),
      utter,
      done: q.done,
      shown: -1,
    };
    this.el.style.setProperty('--sc', line.color ?? '#fff6d8');
    this.whoEl.textContent = line.speaker ? `${line.speaker}` : '';
    this.whoEl.hidden = !line.speaker;
    this.jpEl.textContent = line.jp ?? '';
    this.jpEl.hidden = !line.jp;
    this.kickerEl.textContent = line.kicker ?? '';
    this.kickerEl.hidden = !line.kicker;
    this.el.classList.toggle('sung', /^\s*\(sung\)/i.test(line.text));
    this.el.classList.add('show');
    this.render();
  }

  private render(): void {
    const l = this.live;
    if (!l) return;
    const full = l.line.text;
    const text = full.replace(/^\s*\(sung\)\s*/i, '');
    const lead = full.length - text.length;
    const raw = l.t >= l.typeDur ? full.length : l.utter ? Math.min(full.length, l.utter.reveal(l.t)) : Math.floor((full.length * l.t) / l.typeDur);
    const n = Math.max(0, raw - lead);
    if (n === l.shown) return;
    l.shown = n;
    this.typedEl.textContent = text.slice(0, n);
    this.restEl.textContent = text.slice(n);
    this.el.classList.toggle('typing', n < text.length);
  }

  private end(): void {
    const l = this.live;
    if (!l) return;
    l.utter?.stop();
    this.live = null;
    this.el.classList.remove('show');
    this.wait = SUB_GAP;
    l.done();
  }
}

/** Reading speed check used by tests / debug: chars per second a line is held for. */
export function subtitleCps(text: string, voiceDur: number): number {
  return visibleLength(text) / lineHold(text, voiceDur);
}

/** Whether subtitles are on (the bar hides itself via CSS; callers may skip work). */
export function subtitlesOn(): boolean {
  return settings.subtitles;
}
