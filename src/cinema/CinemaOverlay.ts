import './cinema.css';
import { typed, type Caption } from './timeline';

/**
 * The cutscene's DOM layer: 2.35:1 letterbox bars, film grain + vignette,
 * outlined subtitle captions (with an optional Japanese line above, OVA
 * dual-sub style), a date slug that types itself out, big single words,
 * the Signal's prime counter, the closing title card, and the skip hint.
 *
 * Stateless with respect to time: `update()` is handed the captions live at
 * this instant plus their ages, so a seek renders exactly like playback.
 */
export class CinemaOverlay {
  readonly el: HTMLDivElement;
  private readonly subs: HTMLDivElement;
  private readonly skipEl: HTMLDivElement;
  private readonly live = new Map<Caption, { el: HTMLElement; typedEls: { el: HTMLElement; text: string; shown: number }[] }>();
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onPointer: (e: PointerEvent) => void;
  /** Called when the viewer asks to skip (Space / Enter / Esc / click). */
  onSkip: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cinema';
    this.el.innerHTML = `
      <div class="cn-vignette"></div>
      <div class="cn-grain"></div>
      <div class="cn-bar cn-top"></div>
      <div class="cn-bar cn-bottom"></div>
      <div class="cn-subs"></div>
      <div class="cn-skip">SKIP <b>▸</b> SPACE · ESC · CLICK</div>`;
    this.subs = this.el.querySelector('.cn-subs') as HTMLDivElement;
    this.skipEl = this.el.querySelector('.cn-skip') as HTMLDivElement;
    root.append(this.el);

    this.onKey = (e) => {
      if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.onSkip?.();
    };
    this.onPointer = () => this.onSkip?.();
    window.addEventListener('keydown', this.onKey, true);
    this.el.addEventListener('pointerdown', this.onPointer);
  }

  setSkipVisible(v: boolean): void {
    this.skipEl.style.opacity = v ? '' : '0';
  }

  /** Fade the whole overlay (bars, captions) toward black for an exit. */
  setExit(k: number): void {
    this.el.style.setProperty('--exit', k.toFixed(3));
  }

  update(active: readonly { caption: Caption; age: number }[]): void {
    const seen = new Set<Caption>();
    for (const { caption: c, age } of active) {
      seen.add(c);
      let entry = this.live.get(c);
      if (!entry) {
        entry = this.make(c);
        this.live.set(c, entry);
      }
      const rem = c.dur - age;
      const fadeIn = c.kind === 'word' || c.kind === 'count' ? 0.06 : c.kind === 'title' ? 0.02 : 0.28;
      const a = Math.max(0, Math.min(1, age / fadeIn, rem / (c.kind === 'title' ? 0.6 : 0.3)));
      entry.el.style.opacity = a.toFixed(3);
      entry.el.style.setProperty('--age', age.toFixed(3));
      for (const t of entry.typedEls) {
        const n = typed(t.text, age, c.kind === 'slug' ? 30 : 38);
        if (n !== t.shown) {
          t.shown = n;
          t.el.textContent = t.text.slice(0, n);
        }
      }
    }
    for (const [c, entry] of this.live) {
      if (seen.has(c)) continue;
      entry.el.remove();
      this.live.delete(c);
    }
  }

  private make(c: Caption): { el: HTMLElement; typedEls: { el: HTMLElement; text: string; shown: number }[] } {
    const typedEls: { el: HTMLElement; text: string; shown: number }[] = [];
    const el = document.createElement('div');
    const kind = c.kind ?? 'narration';
    el.className = `cn-cap cn-${kind}`;
    const kicker = (text: string) => {
      const k = document.createElement('div');
      k.className = 'cn-kicker';
      const span = document.createElement('span');
      k.append(span);
      typedEls.push({ el: span, text, shown: -1 });
      return k;
    };
    switch (kind) {
      case 'narration': {
        if (c.kicker) el.append(kicker(c.kicker));
        if (c.jp) el.append(line('cn-jp', c.jp));
        el.append(line('cn-en', c.text));
        this.subs.append(el);
        break;
      }
      case 'slug': {
        const s = document.createElement('span');
        el.append(s);
        el.append(line('cn-cursor', ' '));
        typedEls.push({ el: s, text: c.text, shown: -1 });
        this.el.append(el);
        break;
      }
      case 'word': {
        el.append(line('cn-word-en', c.text));
        if (c.jp) el.append(line('cn-word-jp', c.jp));
        this.el.append(el);
        break;
      }
      case 'count': {
        if (c.kicker) el.append(line('cn-count-k', c.kicker));
        el.append(line('cn-count-n', c.text));
        this.el.append(el);
        break;
      }
      case 'title': {
        el.innerHTML = `<div class="cn-t-stripe"></div>`;
        const h = document.createElement('h1');
        c.text.split('\n').forEach((part, i) => {
          if (i) h.append(document.createElement('br'));
          h.append(document.createTextNode(part));
        });
        el.append(h);
        if (c.kicker) el.append(line('cn-t-sub', c.kicker));
        if (c.jp) el.append(line('cn-t-jp', c.jp));
        this.el.append(el);
        break;
      }
    }
    return { el, typedEls };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.el.removeEventListener('pointerdown', this.onPointer);
    this.el.remove();
    this.live.clear();
    void this.root;
  }
}

function line(cls: string, text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}
