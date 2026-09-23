import './campaign.css';

/**
 * OVA-style episode title card ("eyecatch") and the mission debrief.
 * Pure DOM + CSS animation; both resolve a promise when the player moves on.
 */

export interface EyecatchInfo {
  chapter: number;
  episode: number;
  title: string;
  tagline: string;
}

export interface EyecatchOptions {
  /** Total seconds on screen (default 3.6). Infinity holds until skipped. */
  duration?: number;
}

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  let out = '';
  let v = Math.max(1, Math.floor(n));
  for (const [k, s] of ROMAN) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const OUT_MS = 520;

/** Episode title card: diagonal wipes, huge numerals, title + tagline. Skippable. */
export function showEyecatch(root: HTMLElement, info: EyecatchInfo, opts: EyecatchOptions = {}): Promise<void> {
  const total = (opts.duration ?? 3.6) * 1000;
  const ep = String(info.episode).padStart(2, '0');
  const el = document.createElement('div');
  el.className = 'eyecatch';
  el.style.setProperty('--n', String(Math.max(1, info.tagline.length)));
  el.innerHTML = `
    <div class="ec-bg"></div>
    <div class="ec-speed"></div>
    <div class="ec-band ec-band-c"></div>
    <div class="ec-band ec-band-o"></div>
    <div class="ec-band ec-band-i"></div>
    <div class="ec-stripes"></div>
    <div class="ec-chapter"><span>CHAPTER</span><b>${roman(info.chapter)}</b></div>
    <div class="ec-ep">
      <span class="ec-ep-label">EPISODE</span>
      <span class="ec-num" data-n="${ep}">${ep}</span>
      <span class="ec-spark"></span>
    </div>
    <div class="ec-titles">
      <h1 class="ec-title">${esc(info.title)}</h1>
      <div class="ec-tag"><span>${esc(info.tagline)}</span></div>
    </div>
    <div class="ec-logo"><span class="ec-logo-stripe"></span>PROJECT VANGUARD</div>
    <div class="ec-skip">SPACE ▸ SKIP</div>
    <div class="ec-wipe w1"></div><div class="ec-wipe w2"></div><div class="ec-wipe w3"></div>
    <div class="ec-wipe-out"></div>`;
  root.append(el);

  return new Promise((resolve) => {
    let leaving = false;
    let t1 = 0;
    const finish = () => {
      window.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', leave);
      el.remove();
      resolve();
    };
    const leave = () => {
      if (leaving) return;
      leaving = true;
      window.clearTimeout(t1);
      el.classList.add('out');
      window.setTimeout(finish, OUT_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        leave();
      }
    };
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('pointerdown', leave);
    if (Number.isFinite(total)) t1 = window.setTimeout(leave, Math.max(600, total - OUT_MS));
  });
}

// ── debrief ───────────────────────────────────────────────────────────

export interface DebriefInfo {
  title: string;
  debrief: string;
  /** Titles of codex entries unlocked by this mission. */
  codexUnlocked: string[];
  outcome: 'success' | 'failure';
  /** Optional episode number for the header. */
  episode?: number;
}

/** Mission end screen: stamp, teletyped debrief, archive updates, continue / retry. */
export function showDebrief(root: HTMLElement, info: DebriefInfo): Promise<'continue' | 'retry'> {
  const ok = info.outcome === 'success';
  const el = document.createElement('div');
  el.className = `debrief ${ok ? 'success' : 'failure'}`;
  const choices: ('continue' | 'retry')[] = ok ? ['continue', 'retry'] : ['retry', 'continue'];
  const label = { continue: ok ? 'CONTINUE ▸' : 'CONTINUE ANYWAY ▸', retry: '↺ RETRY' };
  el.innerHTML = `
    <div class="db-stripes"></div>
    <div class="db-panel">
      <div class="db-stamp">${ok ? 'MISSION COMPLETE' : 'MISSION FAILED'}</div>
      <div class="db-head">
        <span class="db-kicker">${info.episode ? `EPISODE ${String(info.episode).padStart(2, '0')} · ` : ''}AFTER-ACTION REPORT</span>
        <h2>${esc(info.title)}</h2>
      </div>
      <div class="db-body"><span class="db-typed"></span><span class="db-cursor">&nbsp;</span></div>
      ${
        info.codexUnlocked.length
          ? `<div class="db-codex"><div class="db-codex-h">ARCHIVE UPDATED · ${info.codexUnlocked.length} RECORD${info.codexUnlocked.length > 1 ? 'S' : ''} RESTORED</div><ul>${info.codexUnlocked
              .map((t, i) => `<li style="--d:${(i * 0.12).toFixed(2)}s">▸ ${esc(t)}</li>`)
              .join('')}</ul></div>`
          : ''
      }
      <div class="db-actions">${choices.map((c, i) => `<button type="button" data-v="${c}" class="${i === 0 ? 'active' : ''}">${label[c]}</button>`).join('')}</div>
    </div>`;
  root.append(el);
  const typed = el.querySelector('.db-typed') as HTMLElement;
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('.db-actions button')];
  const text = info.debrief.trim();
  let sel = 0;
  let raf = 0;
  let shown = -1;
  let skipped = false;
  const t0 = performance.now();
  const tick = () => {
    const n = skipped ? text.length : Math.min(text.length, Math.floor(((performance.now() - t0) / 1000 - 0.5) * 90));
    if (n !== shown && n >= 0) {
      shown = n;
      typed.textContent = text.slice(0, n);
    }
    if (shown >= text.length) {
      el.classList.add('typed');
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const paint = () => buttons.forEach((b, i) => b.classList.toggle('active', i === sel));

  return new Promise((resolve) => {
    const done = (v: 'continue' | 'retry') => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 380);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      let handled = true;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') sel = (sel + buttons.length - 1) % buttons.length;
      else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS' || e.code === 'Tab') sel = (sel + 1) % buttons.length;
      else if (e.code === 'KeyR') return done('retry');
      else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (shown < text.length) {
          skipped = true;
          return;
        }
        return done(choices[sel]);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        paint();
      }
    };
    window.addEventListener('keydown', onKey, true);
    buttons.forEach((b, i) => {
      b.addEventListener('pointerenter', () => {
        sel = i;
        paint();
      });
      b.addEventListener('click', () => done(choices[i]));
    });
  });
}
