/**
 * Player settings for voices and subtitles. Per-viewer conveniences, kept in
 * localStorage (every access guarded) with URL overrides for captures:
 *
 *   ?voice=synth|speech|off   ?subs=0|1   ?subsize=s|m|l   ?jp=0|1
 *
 * Hotkeys (anywhere): F7 voice mode · F8 subtitle size / off · F9 second
 * language line. Listeners (`onSettings`) re-apply CSS and voice state.
 */
export type VoiceMode = 'synth' | 'speech' | 'off';
export type SubSize = 's' | 'm' | 'l';

export interface GameSettings {
  voice: VoiceMode;
  subtitles: boolean;
  subSize: SubSize;
  /** Show the second-language (Japanese flavour) line where the script has one. */
  subSecond: boolean;
}

const KEY = 'vanguard.settings.v1';
const DEFAULTS: GameSettings = { voice: 'synth', subtitles: true, subSize: 'm', subSecond: true };

const VOICES: VoiceMode[] = ['synth', 'speech', 'off'];
const SIZES: SubSize[] = ['s', 'm', 'l'];

function load(): GameSettings {
  const s: GameSettings = { ...DEFAULTS };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const r = JSON.parse(raw) as Partial<GameSettings>;
      if (VOICES.includes(r.voice as VoiceMode)) s.voice = r.voice as VoiceMode;
      if (typeof r.subtitles === 'boolean') s.subtitles = r.subtitles;
      if (SIZES.includes(r.subSize as SubSize)) s.subSize = r.subSize as SubSize;
      if (typeof r.subSecond === 'boolean') s.subSecond = r.subSecond;
    }
  } catch {
    /* storage unavailable */
  }
  try {
    const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const v = q.get('voice');
    if (VOICES.includes(v as VoiceMode)) s.voice = v as VoiceMode;
    if (q.get('subs')) s.subtitles = q.get('subs') !== '0';
    const z = q.get('subsize');
    if (SIZES.includes(z as SubSize)) s.subSize = z as SubSize;
    if (q.get('jp')) s.subSecond = q.get('jp') !== '0';
  } catch {
    /* no location (tests) */
  }
  return s;
}

/** Live settings (mutated in place by `setSettings`). */
export const settings: GameSettings = load();

const listeners = new Set<(s: GameSettings) => void>();

export function onSettings(cb: (s: GameSettings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setSettings(patch: Partial<GameSettings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* session only */
  }
  applyCss();
  for (const cb of listeners) cb(settings);
}

/** Human-readable summary for menus / toasts. */
export function describeSettings(s: GameSettings = settings): string {
  const v = s.voice === 'synth' ? 'SYNTH' : s.voice === 'speech' ? 'SPEECH' : 'OFF';
  const sub = s.subtitles ? s.subSize.toUpperCase() : 'OFF';
  return `VOICE ${v} [F7] · SUBTITLES ${sub} [F8] · 日本語 ${s.subSecond ? 'ON' : 'OFF'} [F9]`;
}

const SCALE: Record<SubSize, string> = { s: '0.82', m: '1', l: '1.3' };

function applyCss(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.style.setProperty('--sub-scale', SCALE[settings.subSize]);
  r.classList.toggle('subs-off', !settings.subtitles);
  r.classList.toggle('subs-mono', !settings.subSecond);
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(text: string): void {
  if (typeof document === 'undefined') return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'settings-toast';
    (document.getElementById('ui-root') ?? document.body).append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 2600);
}

let installed = false;
/** Install the F7–F9 hotkeys and the CSS variables (idempotent). */
export function installSettingsKeys(): void {
  applyCss();
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F7') {
      setSettings({ voice: VOICES[(VOICES.indexOf(settings.voice) + 1) % VOICES.length] });
    } else if (e.code === 'F8') {
      // m → l → off → s → m
      if (!settings.subtitles) setSettings({ subtitles: true, subSize: 's' });
      else if (settings.subSize === 'l') setSettings({ subtitles: false });
      else setSettings({ subSize: SIZES[SIZES.indexOf(settings.subSize) + 1] });
    } else if (e.code === 'F9') {
      setSettings({ subSecond: !settings.subSecond });
    } else return;
    e.preventDefault();
    toast(describeSettings());
  });
}
