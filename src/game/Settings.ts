import { SOUNDTRACK_SETTINGS, describeSoundtrack, type SoundtrackSetting } from '@/audio/score/catalog';

/**
 * Player settings for voices, subtitles and the soundtrack. Per-viewer
 * conveniences, kept in localStorage (every access guarded) with URL
 * overrides for captures:
 *
 *   ?voice=synth|speech|off   ?subs=0|1   ?subsize=s|m|l   ?jp=0|1
 *   ?score=auto|classic|concord|choir|rustwake|contested|deadzone|monolith|nexus
 *
 * Hotkeys (anywhere): F7 voice mode · Shift+F7 soundtrack · F8 subtitle
 * size / off · F9 second language line. Listeners (`onSettings`) re-apply
 * CSS, voice state and the score.
 */
/** cast: recorded neural voices (public/voice), synth where a line has no clip. */
export type VoiceMode = 'cast' | 'synth' | 'speech' | 'off';
export type SubSize = 's' | 'm' | 'l';
export interface AudioSettings {
  master: number;
  music: number;
  effects: number;
  dialogue: number;
  output: 'stereo' | 'headphones' | 'surround';
  range: 'full' | 'reduced';
}
export const DEFAULT_AUDIO: AudioSettings = { master: 0.9, music: 0.3, effects: 1, dialogue: 1, output: 'stereo', range: 'full' };
export function normaliseAudio(value: Partial<AudioSettings> | null | undefined): AudioSettings {
  const a = { ...DEFAULT_AUDIO };
  if (!value || typeof value !== 'object') return a;
  for (const key of ['master', 'music', 'effects', 'dialogue'] as const) {
    const v = value[key];
    if (typeof v === 'number' && Number.isFinite(v)) a[key] = Math.min(1, Math.max(0, v));
  }
  if (['stereo', 'headphones', 'surround'].includes(value.output ?? '')) a.output = value.output!;
  if (value.range === 'full' || value.range === 'reduced') a.range = value.range;
  return a;
}

export interface GameSettings {
  voice: VoiceMode;
  subtitles: boolean;
  subSize: SubSize;
  /** Show the second-language (Japanese flavour) line where the script has one. */
  subSecond: boolean;
  /** 'auto' follows the galaxy / episode; a score id pins that score everywhere. */
  soundtrack: SoundtrackSetting;
  audio: AudioSettings;
  /** Optional reduction of animated ink, grain and post flashes. Default visuals remain unchanged. */
  reducedEffects: boolean;
}

const KEY = 'vanguard.settings.v1';
const DEFAULTS: GameSettings = { voice: 'cast', subtitles: true, subSize: 'm', subSecond: true, soundtrack: 'auto', audio: DEFAULT_AUDIO, reducedEffects: false };

const VOICES: VoiceMode[] = ['cast', 'synth', 'speech', 'off'];
const SIZES: SubSize[] = ['s', 'm', 'l'];

function load(): GameSettings {
  const s: GameSettings = { ...DEFAULTS };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const r = JSON.parse(raw) as Partial<GameSettings>;
      if (VOICES.includes(r.voice as VoiceMode)) s.voice = r.voice as VoiceMode;
      // 'synth' was the only voice before the recorded cast: move old saves over once.
      if (s.voice === 'synth' && !(r as { castVoices?: boolean }).castVoices) s.voice = 'cast';
      if (typeof r.subtitles === 'boolean') s.subtitles = r.subtitles;
      if (SIZES.includes(r.subSize as SubSize)) s.subSize = r.subSize as SubSize;
      if (typeof r.subSecond === 'boolean') s.subSecond = r.subSecond;
      if (SOUNDTRACK_SETTINGS.includes(r.soundtrack as SoundtrackSetting)) s.soundtrack = r.soundtrack as SoundtrackSetting;
      s.audio = normaliseAudio(r.audio);
      if (typeof r.reducedEffects === 'boolean') s.reducedEffects = r.reducedEffects;
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
    if (q.has('calm')) s.reducedEffects = q.get('calm') === '1';
    const sc = q.get('score');
    if (SOUNDTRACK_SETTINGS.includes(sc as SoundtrackSetting)) s.soundtrack = sc as SoundtrackSetting;
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
  if (patch.audio) patch = { ...patch, audio: normaliseAudio(patch.audio) };
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...settings, castVoices: true }));
  } catch {
    /* session only */
  }
  applyCss();
  for (const cb of listeners) cb(settings);
}

/** Human-readable summary for menus / toasts. */
export function describeSettings(s: GameSettings = settings): string {
  const v = s.voice === 'cast' ? 'CAST' : s.voice === 'synth' ? 'SYNTH' : s.voice === 'speech' ? 'SPEECH' : 'OFF';
  const sub = s.subtitles ? s.subSize.toUpperCase() : 'OFF';
  const score = s.soundtrack === 'auto' ? 'AUTO' : s.soundtrack.toUpperCase();
  return `VOICE ${v} [F7] · SUBTITLES ${sub} [F8] · 日本語 ${s.subSecond ? 'ON' : 'OFF'} [F9] · SCORE ${score} [⇧F7] · EFFECTS ${s.reducedEffects ? 'REDUCED' : 'FULL'} [⇧F9]`;
}

/** What the score probe reports for 'auto' (set by the audio layer; null before audio exists). */
let scoreProbe: (() => string | null) | null = null;
export function setSoundtrackProbe(fn: (() => string | null) | null): void {
  scoreProbe = fn;
}

const SCALE: Record<SubSize, string> = { s: '0.82', m: '1', l: '1.3' };

function applyCss(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.style.setProperty('--sub-scale', SCALE[settings.subSize]);
  r.classList.toggle('subs-off', !settings.subtitles);
  r.classList.toggle('subs-mono', !settings.subSecond);
  r.classList.toggle('reduced-effects', settings.reducedEffects);
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
/** Install the F7–F9 (and Shift+F7) hotkeys and the CSS variables (idempotent). */
export function installSettingsKeys(): void {
  applyCss();
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F9' && e.shiftKey) {
      setSettings({ reducedEffects: !settings.reducedEffects });
      e.preventDefault();
      toast(describeSettings());
      return;
    }
    if (e.code === 'F7' && e.shiftKey) {
      const next = SOUNDTRACK_SETTINGS[(SOUNDTRACK_SETTINGS.indexOf(settings.soundtrack) + 1) % SOUNDTRACK_SETTINGS.length];
      setSettings({ soundtrack: next });
      e.preventDefault();
      // The score probe answers after the listeners have re-orchestrated.
      toast(`${describeSoundtrack(next)}${next === 'auto' && scoreProbe?.() ? ` · ${scoreProbe()!.toUpperCase()}` : ''}  [⇧F7]`);
      return;
    }
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
