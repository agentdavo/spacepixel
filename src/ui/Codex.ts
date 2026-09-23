import type { CodexEntry } from '@/game/campaign/types';
import './campaign.css';

/**
 * The archive: a full-screen CRT terminal for codex entries. Plain DOM,
 * keyboard + mouse. Unlocked ids persist in localStorage when available
 * (every access guarded — private mode / blocked storage just forgets).
 *
 *   ←/→ or Q/E  category      ↑/↓ or W/S  entry
 *   PgUp/PgDn   scroll text   Esc         close
 *
 * The owner decides the open key and calls `toggle()` (or pass `{ key }`).
 */

export type CodexCategory = CodexEntry['category'];

export const CODEX_CATEGORIES: { id: CodexCategory; label: string }[] = [
  { id: 'history', label: 'HISTORY' },
  { id: 'factions', label: 'FACTIONS' },
  { id: 'technology', label: 'TECHNOLOGY' },
  { id: 'people', label: 'PERSONNEL' },
  { id: 'anomalies', label: 'ANOMALIES' },
  { id: 'logs', label: 'LOGS' },
];

const STORE_UNLOCKED = 'vanguard.codex.unlocked';
const STORE_SEEN = 'vanguard.codex.seen';
const CORRUPT = '█▓▒░#%&@$/\\<>';

function loadSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, s: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function corrupt(n: number, seed: number): string {
  let out = '';
  let h = seed * 2654435761;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) + i;
    const r = ((h >>> 0) % 1000) / 1000;
    out += r < 0.16 ? ' ' : CORRUPT[Math.floor(r * CORRUPT.length)];
  }
  return out;
}

export interface CodexOptions {
  /** Key code the codex binds itself to toggle (e.g. 'KeyL'). Omit to let the owner call toggle(). */
  key?: string;
  /** Persist unlocks (default true). */
  persist?: boolean;
}

export class Codex {
  open = false;

  private readonly el: HTMLDivElement;
  private readonly tabsEl: HTMLElement;
  private readonly listEl: HTMLUListElement;
  private readonly readEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly toastEl: HTMLDivElement;
  private readonly entries: CodexEntry[];
  private readonly unlocked: Set<string>;
  private readonly seen: Set<string>;
  private readonly persist: boolean;
  private cat = 0;
  private sel = 0;
  private toastTimer = 0;
  /** Called when the archive opens/closes (e.g. to pause flight). */
  onToggle?: (open: boolean) => void;

  constructor(
    private readonly root: HTMLElement,
    entries: CodexEntry[],
    opts: CodexOptions = {},
  ) {
    this.entries = entries;
    this.persist = opts.persist !== false;
    this.unlocked = this.persist ? loadSet(STORE_UNLOCKED) : new Set();
    this.seen = this.persist ? loadSet(STORE_SEEN) : new Set();

    this.el = document.createElement('div');
    this.el.className = 'codex';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Archive');
    this.el.innerHTML = `
      <header class="codex-head">
        <div class="codex-brand"><span class="cx-stripe"></span><b>VANGUARD ARCHIVE</b><span class="cx-sub">DIRECTORATE NAVAL INTELLIGENCE · CLEARANCE 4</span></div>
        <div class="codex-count"></div>
        <button class="codex-close" type="button">ESC ✕</button>
      </header>
      <nav class="codex-tabs"></nav>
      <div class="codex-body">
        <ul class="codex-list"></ul>
        <article class="codex-read"></article>
      </div>
      <footer class="codex-foot">←→ CATEGORY · ↑↓ RECORD · PGUP/PGDN SCROLL · ESC CLOSE</footer>`;
    this.tabsEl = this.el.querySelector('.codex-tabs')!;
    this.listEl = this.el.querySelector('.codex-list')!;
    this.readEl = this.el.querySelector('.codex-read')!;
    this.countEl = this.el.querySelector('.codex-count')!;
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'codex-toast';

    this.tabsEl.innerHTML = CODEX_CATEGORIES.map((c, i) => `<button type="button" data-i="${i}">${c.label}<small></small></button>`).join('');
    this.tabsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.i) this.setCat(Number(b.dataset.i));
    });
    this.listEl.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li?.dataset.i) this.setSel(Number(li.dataset.i));
    });
    this.el.querySelector('.codex-close')!.addEventListener('click', () => this.toggle(false));
    window.addEventListener('keydown', this.onKey, true);
    if (opts.key) {
      const key = opts.key;
      window.addEventListener('keydown', (e) => {
        if (e.code === key && !e.repeat) this.toggle();
      });
    }
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  /** Unlock an entry; returns true if it was newly unlocked (shows a toast when closed). */
  unlock(id: string): boolean {
    if (this.unlocked.has(id)) return false;
    const e = this.entries.find((x) => x.id === id);
    this.unlocked.add(id);
    if (this.persist) saveSet(STORE_UNLOCKED, this.unlocked);
    if (e && !this.open) this.toast(e.title);
    if (this.open) this.render();
    return true;
  }

  /** Re-lock everything (new campaign). */
  reset(): void {
    this.unlocked.clear();
    this.seen.clear();
    if (this.persist) {
      saveSet(STORE_UNLOCKED, this.unlocked);
      saveSet(STORE_SEEN, this.seen);
    }
    if (this.open) this.render();
  }

  get unlockedIds(): string[] {
    return [...this.unlocked];
  }

  /** Open/close. Returns the new state. */
  toggle(force?: boolean): boolean {
    const v = force ?? !this.open;
    if (v === this.open) return v;
    this.open = v;
    if (v) {
      this.root.append(this.el);
      // Start on the first category that has something readable.
      if (!this.catEntries(this.cat).some((e) => this.unlocked.has(e.id))) {
        const i = CODEX_CATEGORIES.findIndex((_, k) => this.catEntries(k).some((e) => this.unlocked.has(e.id)));
        if (i >= 0) this.cat = i;
      }
      this.render();
      this.toastEl.remove();
    } else {
      this.el.remove();
    }
    this.onToggle?.(v);
    return v;
  }

  /** Jump to an entry (opens its category). */
  show(id: string): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    this.cat = Math.max(0, CODEX_CATEGORIES.findIndex((c) => c.id === e.category));
    this.sel = Math.max(0, this.catEntries(this.cat).indexOf(e));
    if (!this.open) this.toggle(true);
    else this.render();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.toastEl.remove();
  }

  // ── internals ─────────────────────────────────────────────────────

  private catEntries(i: number): CodexEntry[] {
    const id = CODEX_CATEGORIES[i].id;
    return this.entries.filter((e) => e.category === id);
  }

  private setCat(i: number): void {
    const n = CODEX_CATEGORIES.length;
    this.cat = ((i % n) + n) % n;
    this.sel = 0;
    this.render();
  }

  private setSel(i: number): void {
    const list = this.catEntries(this.cat);
    if (!list.length) return;
    this.sel = Math.max(0, Math.min(list.length - 1, i));
    this.render();
    this.listEl.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.open) return;
    let handled = true;
    switch (e.code) {
      case 'Escape':
        this.toggle(false);
        break;
      case 'ArrowLeft':
      case 'KeyQ':
      case 'KeyA':
        this.setCat(this.cat - 1);
        break;
      case 'ArrowRight':
      case 'KeyE':
      case 'KeyD':
        this.setCat(this.cat + 1);
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.setSel(this.sel - 1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.setSel(this.sel + 1);
        break;
      case 'PageUp':
        this.readEl.scrollBy({ top: -this.readEl.clientHeight * 0.8 });
        break;
      case 'PageDown':
      case 'Space':
        this.readEl.scrollBy({ top: this.readEl.clientHeight * 0.8 });
        break;
      case 'Home':
        this.setSel(0);
        break;
      case 'End':
        this.setSel(1e9);
        break;
      default:
        // Digits jump to a category.
        if (/^Digit[1-6]$/.test(e.code)) this.setCat(Number(e.code.slice(5)) - 1);
        else handled = false;
    }
    if (handled) {
      // Keep flight controls from seeing archive navigation.
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private render(): void {
    const total = this.entries.length;
    const got = this.entries.filter((e) => this.unlocked.has(e.id)).length;
    this.countEl.textContent = `${String(got).padStart(2, '0')} / ${String(total).padStart(2, '0')} RECORDS RESTORED`;

    const tabs = this.tabsEl.querySelectorAll('button');
    tabs.forEach((b, i) => {
      const list = this.catEntries(i);
      const n = list.filter((e) => this.unlocked.has(e.id)).length;
      const fresh = list.some((e) => this.unlocked.has(e.id) && !this.seen.has(e.id));
      b.classList.toggle('active', i === this.cat);
      b.classList.toggle('fresh', fresh);
      b.querySelector('small')!.textContent = `${n}/${list.length}`;
    });

    const list = this.catEntries(this.cat);
    this.sel = Math.min(this.sel, Math.max(0, list.length - 1));
    this.listEl.innerHTML = list.length
      ? list
          .map((e, i) => {
            const ok = this.unlocked.has(e.id);
            const cls = [i === this.sel ? 'active' : '', ok ? '' : 'locked', ok && !this.seen.has(e.id) ? 'fresh' : ''].join(' ');
            const label = ok ? esc(e.title) : '— DATA CORRUPTED —';
            return `<li data-i="${i}" class="${cls}"><span class="cx-idx">${String(i + 1).padStart(2, '0')}</span><span class="cx-title">${label}</span></li>`;
          })
          .join('')
      : `<li class="empty">NO RECORDS IN THIS SECTION</li>`;

    const e = list[this.sel];
    if (!e) {
      this.readEl.innerHTML = `<div class="cx-none">▌ AWAITING SELECTION</div>`;
      return;
    }
    if (!this.unlocked.has(e.id)) {
      this.readEl.innerHTML = `
        <h3 class="cx-h locked">— DATA CORRUPTED —</h3>
        <div class="cx-meta">RECORD ${esc(e.id.toUpperCase())} · INTEGRITY 0.0%</div>
        <div class="cx-text corrupt">${corrupt(420, e.id.length * 97 + this.sel)}</div>
        <div class="cx-note">RECORD SEALED. RECOVER FIELD DATA TO RESTORE.</div>`;
      return;
    }
    if (!this.seen.has(e.id)) {
      this.seen.add(e.id);
      if (this.persist) saveSet(STORE_SEEN, this.seen);
    }
    const paras = e.body
      .trim()
      .split(/\n\s*\n/)
      .map((p, i) => `<p style="--d:${Math.min(i, 8) * 0.07}s">${esc(p.trim()).replace(/\n/g, '<br/>')}</p>`)
      .join('');
    this.readEl.innerHTML = `
      <h3 class="cx-h">${esc(e.title)}</h3>
      <div class="cx-meta">${CODEX_CATEGORIES[this.cat].label} · RECORD ${esc(e.id.toUpperCase())} · INTEGRITY 100%</div>
      <div class="cx-text">${paras}<span class="cx-cursor">&nbsp;</span></div>`;
    this.readEl.scrollTop = 0;
  }

  private toast(title: string): void {
    this.toastEl.innerHTML = `<b>ARCHIVE UPDATED</b><span>${esc(title)}</span>`;
    this.root.append(this.toastEl);
    this.toastEl.classList.remove('in');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('in');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.remove(), 4200);
  }
}
