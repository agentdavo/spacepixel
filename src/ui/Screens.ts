import type { MissionDef } from '@/game/Missions';
import { loadContracts, loadLedger, loadProfile } from '@/game/Profile';
import { getAudio } from '@/audio';
import { describeSettings, installSettingsKeys, onSettings } from '@/game/Settings';
import { loadWorld } from '@/game/world/WorldState';
import { backfillStory } from '@/game/world/sim';
import { signalState } from '@/game/world/signal';
import { labelOf } from './SignalCounter';

/**
 * Milestone 19 — title card and mission briefing. Plain DOM, styled in
 * style.css with the CRT treatment. Each screen resolves a promise when the
 * player moves on, so the boot flow in main.ts reads top to bottom.
 */
export type TitleChoice = 'launch' | 'free' | 'map' | 'hangar' | 'paint' | 'showcase' | 'prologue' | 'trailer' | 'attract' | 'frontier';

export interface TitleOptions {
  /** Resolve with 'attract' after this long with no input (the prologue / trailer play as attract reels). */
  idleMs?: number;
}

export function titleScreen(root: HTMLElement, opts: TitleOptions = {}): Promise<TitleChoice> {
  const profile = loadProfile();
  // A career in progress (an episode flown, a berth logged, a contract in hand) can fly free.
  const career = profile.episode > 1 || !!loadLedger().lastDock || loadContracts().active.length > 0;
  const items: { id: TitleChoice; label: string }[] = [
    { id: 'launch', label: `LAUNCH — EPISODE ${String(profile.episode).padStart(2, '0')}` },
    ...(career ? [{ id: 'free' as const, label: 'CONTINUE — FREE FLIGHT' }] : []),
    { id: 'prologue', label: 'PROLOGUE — THE LONG DARK' },
    { id: 'trailer', label: 'TRAILER' },
    { id: 'paint', label: 'PAINT SHOP' },
    { id: 'hangar', label: 'HANGAR / MODEL SHEETS' },
    { id: 'showcase', label: 'SHOWCASE' },
    { id: 'frontier', label: 'OPEN HORIZON — FRONTIER ATLAS' },
  ];
  // The Signal, once a career has heard it (Episode 5): the count waits on the title card.
  const signal = career ? labelOf(signalState(backfillStory(loadWorld(), profile.episode))) : '';
  const el = document.createElement('div');
  el.className = 'title-screen';
  el.innerHTML = `
    <div class="stripe"></div>
    <h1>PROJECT<br/>VANGUARD</h1>
    <div class="episode">The Lantern Sings</div>${signal ? `<div class="signal-count" style="font:13px 'Share Tech Mono',monospace;color:#b77bff;letter-spacing:0.12em;text-shadow:0 0 8px rgba(183,123,255,0.6);margin:6px 0 10px">${signal}</div>` : ''}
    <ul>${items.map((it, i) => `<li data-i="${i}" class="${i === 0 ? 'active' : ''}">${it.label}</li>`).join('')}</ul>
    <div class="foot">↑↓ SELECT · ENTER CONFIRM · TERRAN DIRECTORATE // 13TH INDEPENDENT SQUADRON "VANGUARD"<br/><span class="settings-line"></span></div>`;
  root.append(el);
  // Voice / subtitle settings live on F7–F9 everywhere; the title shows where they stand.
  installSettingsKeys();
  const line = el.querySelector('.settings-line')!;
  line.textContent = describeSettings();
  const off = onSettings(() => (line.textContent = describeSettings()));
  let sel = 0;
  const lis = [...el.querySelectorAll('li')];
  const paint = () => {
    lis.forEach((li, i) => li.classList.toggle('active', i === sel));
    getAudio().ui('move');
  };
  return new Promise((resolve) => {
    let idle = 0;
    const settle = (v: TitleChoice) => {
      window.clearTimeout(idle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', poke);
      off();
      el.remove();
      resolve(v);
    };
    const done = (i: number) => settle(items[i].id);
    const poke = () => {
      window.clearTimeout(idle);
      if (opts.idleMs) idle = window.setTimeout(() => settle('attract'), opts.idleMs);
    };
    poke();
    window.addEventListener('pointermove', poke);
    const onKey = (e: KeyboardEvent) => {
      poke();
      if (e.code === 'ArrowDown' || e.code === 'KeyS') sel = (sel + 1) % items.length;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') sel = (sel + items.length - 1) % items.length;
      else if (e.code === 'Enter' || e.code === 'Space') return done(sel);
      paint();
    };
    window.addEventListener('keydown', onKey);
    lis.forEach((li, i) => {
      li.addEventListener('pointerenter', () => {
        sel = i;
        paint();
      });
      li.addEventListener('click', () => done(i));
    });
  });
}

export function briefingScreen(root: HTMLElement, m: MissionDef): Promise<void> {
  const el = document.createElement('div');
  el.className = 'briefing';
  el.innerHTML = `
    <div>
      <h2>${m.episode} — ${m.title}</h2>
      <div class="meta">MISSION BRIEFING · ${m.system.toUpperCase()} · PRIORITY ONE</div>
      <div class="body"></div>
      <ol>${m.objectives.map((o) => `<li>${o.text}${o.optional ? ' (optional)' : ''}</li>`).join('')}</ol>
      <div class="launch">PRESS SPACE TO LAUNCH</div>
    </div>
    <div><canvas></canvas></div>`;
  root.append(el);
  const body = el.querySelector('.body') as HTMLDivElement;
  const canvas = el.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  let chars = 0;
  let skipped = false;
  let raf = 0;
  const t0 = performance.now();
  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    // Teletype at ~70 chars/s.
    chars = skipped ? m.briefing.length : Math.min(m.briefing.length, Math.floor(t * 70));
    body.innerHTML = `${escape(m.briefing.slice(0, chars))}<span class="cursor">&nbsp;</span>`;
    const r = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(r.width)) {
      canvas.width = Math.round(r.width);
      canvas.height = Math.round(r.height);
    }
    m.diagram?.(ctx, canvas.width, canvas.height, t);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return new Promise((resolve) => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (chars < m.briefing.length) {
        // First press completes the teletype, second launches.
        skipped = true;
        return;
      }
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      el.remove();
      resolve();
    };
    window.addEventListener('keydown', onKey);
  });
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}
