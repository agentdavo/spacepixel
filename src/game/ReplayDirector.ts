import '@/ui/replay.css';
import type { ShipEntity } from '@/sim/Fleet';
import { emptyControls } from '@/sim/Fleet';
import { copyControls, parseReplay, REPLAY_HZ, REPLAY_VERSION, ReplayCursor, ReplayTake, timecode, type ReplayCommand, type ReplayFile } from '@/sim/Replay';

/**
 * Replays in the running game (MP-0): records every flight session and
 * plays tapes back through the real flight scene.
 *
 * Recording (always on): from the moment the flight scene is built, every
 * sim tick's player ControlState, every tick-stamped command that changes
 * the world from outside the sim (scene keys, episode / free-roam starts,
 * dock-screen results: ledger, repairs, shop, contracts, hires, launch) and
 * a world hash once a second. The header holds the world seed, the boot
 * query and a snapshot of the persisted profile, so a fresh page can
 * rebuild the exact starting world. The take lives in memory (a few KB per
 * minute); `saveClip` (key O) writes it to a slot with a clip window over
 * the last few minutes, and it is autosaved to the `auto` slot every
 * minute, on death and when the page closes.
 *
 *   ?replay=auto | clip-3 | session | <url of a .vgr file>
 *
 * Playback boots the scene from the tape's query and profile (the real
 * profile is untouched: storage is shimmed in memory), fast-forwards
 * unrendered to the clip window, then feeds the recorded controls and
 * commands tick by tick. The checkpoints prove it: the deck shows SYNC OK
 * or the second it diverged. Deck keys: P pause · [ ] speed · Esc exit.
 *
 * Cinema / trailer API (window.__VANGUARD__.hooks.replay, or the director
 * itself): `load(file, seek?)` reboots into a tape; `seek(seconds)` (forward;
 * backward reloads), `run()`, `pause()`, `speed`, `state()`.
 */
export interface ReplayHost {
  readonly player: ShipEntity;
  /** True while a sim tick runs (commands are only recorded from outside ticks). */
  readonly inTick: boolean;
  /** Ticks completed since the scene was built. */
  readonly simTick: number;
  applyReplayCommand(c: ReplayCommand): void;
  worldHash(): number;
  /** Run one sim tick now (fast-forward). */
  simStep(): void;
  /** Skip per-tick presentation (particles, barks, cutaways) while seeking. */
  fastForward: boolean;
}

const SLOT = 'vanguard.replay.';
const CLIP_SLOTS = 5;
/** Default clip window (minutes). */
export const CLIP_MINUTES = 3;
/** The `auto` slot keeps this much (minutes). */
const AUTO_MINUTES = 5;

let pending: ReplayFile | null = null;
let pendingSeek = -1;

/** main.ts hands the scene a tape to play (before the flight scene is built). */
export function setPendingReplay(f: ReplayFile, seekSeconds = -1): void {
  pending = f;
  pendingSeek = seekSeconds;
}

/** The world seed for the next flight scene: the tape's, else ?seed=, else the default. */
export function worldSeedFor(fallback: number): number {
  if (pending) return pending.header.seed;
  const q = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('seed')) : NaN;
  return Number.isFinite(q) && q > 0 ? q >>> 0 : fallback;
}

/** Persisted profile keys (the replay slots themselves excluded). */
function snapshotStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('vanguard.') && !k.startsWith(SLOT)) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* storage unavailable: the tape boots from defaults, like this session did */
  }
  return out;
}

/** Boot query without the replay's own parameters. */
function bootQuery(): string {
  const q = new URLSearchParams(location.search);
  for (const k of ['replay', 'rseek']) q.delete(k);
  return q.toString();
}

/**
 * Playback: the game's storage becomes an in-memory copy of the tape's
 * profile, so every load reads the recorded state and nothing the tape
 * writes (saves, contracts, hangar) touches the real profile.
 */
export function installStorageShim(snapshot: Record<string, string>): void {
  const mem = new Map(Object.entries(snapshot));
  const shim: Storage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => shim });
}

/** Read a tape: a slot name (auto, clip-N, session) or a URL. */
export async function loadReplay(ref: string): Promise<ReplayFile> {
  if (ref === 'session') {
    const s = sessionStorage.getItem(SLOT + 'session');
    if (!s) throw new Error('no session replay');
    return parseReplay(s);
  }
  if (/^[\w-]+$/.test(ref)) {
    const s = localStorage.getItem(SLOT + ref);
    if (s) return parseReplay(s);
  }
  const r = await fetch(ref);
  if (!r.ok) throw new Error(`replay ${ref}: HTTP ${r.status}`);
  return parseReplay(await r.text());
}

/** The query a tape must boot with (reload there if the page differs). */
export function replayBootUrl(f: ReplayFile, ref: string, seek = -1): string {
  const q = new URLSearchParams(f.header.boot);
  if (!q.get('scene')) q.set('scene', 'flight');
  q.set('replay', ref);
  if (seek >= 0) q.set('rseek', String(seek));
  return `?${q.toString()}`;
}

export function downloadReplay(f: ReplayFile, name = 'vanguard'): void {
  const blob = new Blob([JSON.stringify(f)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.vgr`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export class ReplayDirector {
  readonly mode: 'record' | 'play';
  readonly take: ReplayTake | null = null;
  readonly cursor: ReplayCursor | null = null;
  /** True while a recorded command is being applied (guarded entry points let it through). */
  applying = false;
  /** Scene construction: dev/capture staging reruns identically on playback, so it isn't recorded. */
  booting = true;
  private suppress = 0;
  /** Playback: fast-forward target (tick), −1 = none. */
  private seekTo = -1;
  ended = false;
  paused = false;
  /** Playback speed (sim ticks per real tick; the fixed step is unchanged). */
  speed = 1;
  /** First checkpoint that disagreed (tick), −1 = in sync. */
  desyncAt = -1;
  checksOk = 0;
  private due: ReplayCommand[] = [];
  private deck = document.createElement('div');
  private toastEl = document.createElement('div');
  private toastT = 0;
  private lastAuto = 0;

  constructor(
    private host: ReplayHost,
    seed: number,
  ) {
    const root = document.getElementById('ui-root') ?? document.body;
    this.deck.className = 'replay-deck';
    this.toastEl.className = 'replay-toast';
    root.append(this.deck, this.toastEl);
    if (pending) {
      this.mode = 'play';
      this.cursor = new ReplayCursor(pending);
      const from = pendingSeek >= 0 ? Math.round(pendingSeek * REPLAY_HZ) : (pending.view?.from ?? 0);
      if (from > 0) this.seekTo = from;
      pending = null;
      pendingSeek = -1;
      this.deck.classList.add('show');
      window.addEventListener('keydown', (e) => this.deckKey(e));
    } else {
      this.mode = 'record';
      this.take = new ReplayTake({
        v: REPLAY_VERSION,
        game: 'vanguard',
        hz: REPLAY_HZ,
        seed,
        scene: 'flight',
        boot: bootQuery(),
        storage: snapshotStorage(),
        created: new Date().toISOString(),
      });
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyO' && !e.repeat) this.saveClip();
      });
      window.addEventListener('pagehide', () => this.autosave());
    }
  }

  get playing(): boolean {
    return this.mode === 'play';
  }

  get seeking(): boolean {
    return this.seekTo > this.host.simTick && !this.ended;
  }

  /** Sim speed multiplier the scene applies (0 = the engine runs no ticks). */
  timeScale(): number {
    if (this.mode !== 'play') return 1;
    return this.paused || this.ended || this.seeking ? 0 : this.speed;
  }

  // ── per tick ────────────────────────────────────────────────────────

  /** First thing in a tick: apply due commands, then load (play) or record the player's controls. */
  beforeTick(): void {
    const c = this.host.player.controls;
    if (this.cursor) {
      this.applying = true;
      try {
        for (const cmd of this.cursor.due(this.due)) this.host.applyReplayCommand(cmd);
      } finally {
        this.applying = false;
      }
      if (!this.cursor.next(this.host.player.controls)) {
        this.ended = true;
        copyControls(emptyControls(), this.host.player.controls);
      }
      return;
    }
    this.take!.input.push(c);
  }

  /** Last thing in a tick: the 1 Hz checkpoint (record it, or verify it). */
  afterTick(): void {
    const done = this.host.simTick;
    if (done % REPLAY_HZ !== 0) return;
    const h = this.host.worldHash();
    if (this.cursor) {
      const ok = this.cursor.verify(done, h);
      if (ok === false && this.desyncAt < 0) {
        this.desyncAt = done;
        console.warn(`[replay] desync at tick ${done} (${timecode(done / REPLAY_HZ)})`);
      } else if (ok) this.checksOk++;
      return;
    }
    this.take!.checks.push([done, h]);
    if (done - this.lastAuto >= 60 * REPLAY_HZ && !this.host.fastForward) {
      this.lastAuto = done;
      this.autosave();
    }
  }

  // ── commands from outside the sim ───────────────────────────────────

  /**
   * An entry point that changes the world from outside a tick (a key, a
   * dock-screen button, the career loop). Recording: stamp it, then run it
   * (nested changes are part of it, not recorded again). Playback: a live
   * call is ignored — the tape's own copy runs at its tick.
   */
  external<T>(c: string, a: unknown, fn: () => T): T | undefined {
    if (this.mode === 'play' && !this.applying) return undefined;
    this.note(c, a);
    this.suppress++;
    try {
      return fn();
    } finally {
      this.suppress--;
    }
  }

  /** Record-only: a world change that already happened outside a tick (ledger, contract book). */
  note(c: string, a: unknown): void {
    if (this.mode !== 'record' || this.booting || this.suppress > 0 || this.host.inTick || this.applying) return;
    this.take!.command(c, a === undefined ? undefined : JSON.parse(JSON.stringify(a)));
  }

  // ── clips ───────────────────────────────────────────────────────────

  /** The take as a file, with a clip window over the last `minutes`. */
  clip(minutes = CLIP_MINUTES): ReplayFile | null {
    const t = this.take;
    if (!t) return null;
    return t.file({ from: Math.max(0, t.ticks - Math.round(minutes * 60 * REPLAY_HZ)) });
  }

  /** Key O: save the last few minutes to the next clip slot. */
  saveClip(minutes = CLIP_MINUTES): string | null {
    const f = this.clip(minutes);
    if (!f) return null;
    let n = 1;
    try {
      n = (Number(localStorage.getItem(SLOT + 'next')) || 0) % CLIP_SLOTS + 1;
      localStorage.setItem(SLOT + `clip-${n}`, JSON.stringify(f));
      localStorage.setItem(SLOT + 'next', String(n));
    } catch {
      downloadReplay(f, `vanguard-clip-${Date.now()}`);
      this.toast('CLIP TOO BIG FOR A SLOT · DOWNLOADED');
      return null;
    }
    const kb = (JSON.stringify(f).length / 1024).toFixed(0);
    this.toast(`CLIP SAVED · SLOT ${n} · ${timecode((f.ticks - (f.view?.from ?? 0)) / REPLAY_HZ)} · ${kb} KB · ?replay=clip-${n}`);
    console.info(`[replay] clip-${n}: ${f.ticks} ticks, ${kb} KB — open with ?replay=clip-${n}`);
    return `clip-${n}`;
  }

  /** The ring buffer: the last few minutes, always on disk. */
  autosave(): void {
    const f = this.clip(AUTO_MINUTES);
    if (!f) return;
    try {
      localStorage.setItem(SLOT + 'auto', JSON.stringify(f));
    } catch {
      /* storage full: the in-memory take is still there for O */
    }
  }

  // ── playback control ────────────────────────────────────────────────

  /** Jump to `seconds` of the tape: forward fast-forwards here; backward reboots the tape. */
  seek(seconds: number): void {
    const tick = Math.max(0, Math.round(seconds * REPLAY_HZ));
    if (!this.cursor) return;
    if (tick >= this.host.simTick) this.seekTo = tick;
    else {
      sessionStorage.setItem(SLOT + 'session', JSON.stringify(this.cursor.file));
      location.assign(replayBootUrl(this.cursor.file, 'session', seconds));
    }
  }

  run(): void {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  state(): { mode: string; tick: number; ticks: number; seconds: number; seeking: boolean; paused: boolean; ended: boolean; desyncAt: number; checksOk: number } {
    return {
      mode: this.mode,
      tick: this.host.simTick,
      ticks: this.cursor?.file.ticks ?? this.take?.ticks ?? 0,
      seconds: this.host.simTick / REPLAY_HZ,
      seeking: this.seeking,
      paused: this.paused,
      ended: this.ended,
      desyncAt: this.desyncAt,
      checksOk: this.checksOk,
    };
  }

  /** Hooks for captures, the cinema module and the console. */
  api() {
    return {
      state: () => this.state(),
      seek: (s: number) => this.seek(s),
      run: () => this.run(),
      pause: () => this.pause(),
      setSpeed: (x: number) => (this.speed = Math.max(0.25, Math.min(4, x))),
      clip: (minutes?: number) => this.clip(minutes),
      saveClip: (minutes?: number) => this.saveClip(minutes),
      download: (minutes?: number) => {
        const f = this.clip(minutes ?? 1e9);
        if (f) downloadReplay(f);
      },
      /** Reboot into a tape (a parsed file), optionally seeking to `seek` seconds. */
      load: (f: ReplayFile, seek = -1) => {
        sessionStorage.setItem(SLOT + 'session', JSON.stringify(f));
        location.assign(replayBootUrl(f, 'session', seek));
      },
    };
  }

  /**
   * Per frame (presentation): run a slice of the fast-forward, update the
   * deck readout and the toast.
   */
  present(realDt: number): void {
    if (this.toastT > 0 && (this.toastT -= realDt) <= 0) this.toastEl.classList.remove('show');
    if (!this.cursor) return;
    if (this.seeking) {
      const t0 = performance.now();
      this.host.fastForward = true;
      try {
        while (this.seeking && performance.now() - t0 < 30) this.host.simStep();
      } finally {
        this.host.fastForward = false;
      }
    }
    const f = this.cursor.file;
    const now = this.host.simTick;
    const pct = Math.min(100, (100 * now) / Math.max(1, f.ticks));
    const sync = this.desyncAt >= 0 ? `<span class="bad">DESYNC @ ${timecode(this.desyncAt / REPLAY_HZ)}</span>` : `SYNC OK ×${this.checksOk}`;
    const state = this.seeking ? `▶▶ SEEK ${timecode(this.seekTo / REPLAY_HZ)}` : this.ended ? '■ END OF TAPE' : this.paused ? '❚❚ PAUSE' : `▶ ${this.speed !== 1 ? `×${this.speed}` : 'PLAY'}`;
    this.deck.innerHTML = `<b>REPLAY</b> ${state} · ${timecode(now / REPLAY_HZ)} / ${timecode(f.ticks / REPLAY_HZ)} · ${sync}<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div><small class="warn">P PAUSE · [ ] SPEED · SHIFT+ESC EXIT</small>`;
  }

  private deckKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.code === 'KeyP') this.paused = !this.paused;
    else if (e.code === 'BracketRight') this.speed = Math.min(4, this.speed * 2);
    else if (e.code === 'BracketLeft') this.speed = Math.max(0.25, this.speed / 2);
    else if (e.code === 'Escape' && (this.ended || e.shiftKey)) location.assign(location.pathname);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastT = 4;
  }
}
