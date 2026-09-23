import type { MissionDef } from '@/game/Missions';

/**
 * Milestone 19 — title card and mission briefing. Plain DOM, styled in
 * style.css with the CRT treatment. Each screen resolves a promise when the
 * player moves on, so the boot flow in main.ts reads top to bottom.
 */
export function titleScreen(root: HTMLElement): Promise<'launch' | 'map' | 'hangar' | 'showcase'> {
  const items: { id: 'launch' | 'map' | 'hangar' | 'showcase'; label: string }[] = [
    { id: 'launch', label: 'LAUNCH — EPISODE 01' },
    { id: 'hangar', label: 'HANGAR / MODEL SHEETS' },
    { id: 'showcase', label: 'SHOWCASE' },
  ];
  const el = document.createElement('div');
  el.className = 'title-screen';
  el.innerHTML = `
    <div class="stripe"></div>
    <h1>PROJECT<br/>VANGUARD</h1>
    <div class="episode">The Lantern Sings</div>
    <ul>${items.map((it, i) => `<li data-i="${i}" class="${i === 0 ? 'active' : ''}">${it.label}</li>`).join('')}</ul>
    <div class="foot">↑↓ SELECT · ENTER CONFIRM · MERIDIAN CONCORD DEFENSE FORCE // 13TH INDEPENDENT SQUADRON</div>`;
  root.append(el);
  let sel = 0;
  const lis = [...el.querySelectorAll('li')];
  const paint = () => lis.forEach((li, i) => li.classList.toggle('active', i === sel));
  return new Promise((resolve) => {
    const done = (i: number) => {
      window.removeEventListener('keydown', onKey);
      el.remove();
      resolve(items[i].id);
    };
    const onKey = (e: KeyboardEvent) => {
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
