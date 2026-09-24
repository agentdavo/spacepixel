import type { ControlState } from '@/core/Input';

/**
 * Replays (MP-0): the player's per-tick ControlState stream + seed + start
 * state. Because the sim is a pure function of (start state, seed, inputs)
 * at a fixed 60 Hz step, that is all it takes to play a session back to the
 * bit — the same property a server needs to agree with a client.
 *
 * File (JSON, `.vgr`):
 *
 *   {
 *     header:   { v, game, hz, seed, scene, boot, storage, created, … }
 *     ticks:    number of sim ticks recorded
 *     input:    base64 of the delta/run-length ControlState stream (below)
 *     commands: [{ t, c, a }]  tick-stamped non-stick inputs: scene keys
 *               (wing orders, dock request, tactical), episode / free-roam
 *               starts, dock-screen results, launch resync
 *     checks:   [[tick, hash], …] world hash once a second (StateHash.ts),
 *               so playback can prove it is still in sync
 *     view:     { from, to } optional clip window (ticks); playback
 *               fast-forwards unrendered to `from`
 *   }
 *
 * Input stream: one record per tick. The live game quantises the stick
 * before the sim sees it (Input.quantize), so what is recorded is exactly
 * what was flown. Encoding per tick:
 *
 *   0x00 varint(n)      the previous record repeats n more ticks
 *   mask [fields…]      mask bits 0–5: pitch · yaw · roll · throttleDelta ·
 *                       throttleSet · buttons changed; the changed fields
 *                       follow (int8 axes, uint8 throttleSet with 255 =
 *                       none, uint16 buttons)
 *
 * Keyboard flying costs ~0.5–2 KB/min; continuous mouse flying ~8–11 KB/min
 * raw, ~4–6 KB/min once gzipped for a slot / file.
 */
export const REPLAY_VERSION = 1;
export const REPLAY_HZ = 60;

export interface ReplayHeader {
  v: number;
  game: 'vanguard';
  hz: number;
  /** World seed (Fleet root stream). */
  seed: number;
  /** What was running: 'flight' (the game) or a headless scenario name. */
  scene: string;
  /** Query string the flight scene was booted with (flags, captures, dev starts). */
  boot: string;
  /** Snapshot of the persisted profile (vanguard.* storage keys) at boot. */
  storage: Record<string, string>;
  /** Informational: wall-clock time the take started (ISO). */
  created: string;
  /** Free text (system, episode, build). */
  note?: string;
}

export interface ReplayCommand {
  /** Tick index the command applies before. */
  t: number;
  /** Command name ('key', 'episode', 'free', 'ledger', 'outfit', 'launch', …). */
  c: string;
  a?: unknown;
}

export interface ReplayFile {
  header: ReplayHeader;
  ticks: number;
  input: string;
  commands: ReplayCommand[];
  checks: [number, number][];
  view?: { from: number; to?: number };
}

// ── quantisation (shared by the live input path and the codec) ──────────

const AXIS = 127;
const THROTTLE = 254;

export function quantizeAxis(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * AXIS) / AXIS + 0; // + 0 folds −0 into 0 (the stream stores no sign of zero)
}

export function quantizeThrottle(v: number | null): number | null {
  if (v === null) return null;
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(c * THROTTLE) / THROTTLE + 0;
}

/** Snap a ControlState to the recordable grid in place (the live path calls this). */
export function quantizeControls(c: ControlState): ControlState {
  c.pitch = quantizeAxis(c.pitch);
  c.yaw = quantizeAxis(c.yaw);
  c.roll = quantizeAxis(c.roll);
  c.throttleDelta = quantizeAxis(c.throttleDelta);
  c.throttleSet = quantizeThrottle(c.throttleSet);
  return c;
}

const BUTTONS = ['afterburner', 'flightAssistToggle', 'fire', 'missile', 'nextTarget', 'cruise', 'cycleGun', 'cycleMissile', 'cycleSub'] as const;

function buttonsOf(c: ControlState): number {
  let b = 0;
  for (let i = 0; i < BUTTONS.length; i++) if (c[BUTTONS[i]]) b |= 1 << i;
  return b;
}

/** Copy every field (a recorded tick's controls → the ship's). */
export function copyControls(from: ControlState, to: ControlState): ControlState {
  to.pitch = from.pitch;
  to.yaw = from.yaw;
  to.roll = from.roll;
  to.throttleDelta = from.throttleDelta;
  to.throttleSet = from.throttleSet;
  for (const k of BUTTONS) to[k] = !!from[k];
  return to;
}

// ── byte stream ───────────────────────────────────────────────────────────

class Bytes {
  buf = new Uint8Array(1024);
  n = 0;
  push(b: number): void {
    if (this.n === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.n++] = b & 0xff;
  }
  varint(v: number): void {
    while (v >= 0x80) {
      this.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.push(v);
  }
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.n);
  }
}

/** Per-tick record in integer form. */
interface Rec {
  p: number;
  y: number;
  r: number;
  td: number;
  ts: number;
  b: number;
}

function recOf(c: ControlState, out: Rec): Rec {
  out.p = Math.round(Math.max(-1, Math.min(1, c.pitch)) * AXIS);
  out.y = Math.round(Math.max(-1, Math.min(1, c.yaw)) * AXIS);
  out.r = Math.round(Math.max(-1, Math.min(1, c.roll)) * AXIS);
  out.td = Math.round(Math.max(-1, Math.min(1, c.throttleDelta)) * AXIS);
  out.ts = c.throttleSet === null ? 255 : Math.round(Math.max(0, Math.min(1, c.throttleSet)) * THROTTLE);
  out.b = buttonsOf(c);
  return out;
}

/** Records one ControlState per sim tick. */
export class InputRecorder {
  private out = new Bytes();
  private prev: Rec = { p: 0, y: 0, r: 0, td: 0, ts: 255, b: 0 };
  private cur: Rec = { p: 0, y: 0, r: 0, td: 0, ts: 255, b: 0 };
  private run = 0;
  private first = true;
  ticks = 0;

  push(c: ControlState): void {
    const r = recOf(c, this.cur);
    const p = this.prev;
    let mask = 0;
    if (this.first || r.p !== p.p) mask |= 1;
    if (this.first || r.y !== p.y) mask |= 2;
    if (this.first || r.r !== p.r) mask |= 4;
    if (this.first || r.td !== p.td) mask |= 8;
    if (this.first || r.ts !== p.ts) mask |= 16;
    if (this.first || r.b !== p.b) mask |= 32;
    this.first = false;
    this.ticks++;
    if (!mask) {
      this.run++;
      return;
    }
    this.flushRun();
    const o = this.out;
    o.push(mask);
    if (mask & 1) o.push(r.p);
    if (mask & 2) o.push(r.y);
    if (mask & 4) o.push(r.r);
    if (mask & 8) o.push(r.td);
    if (mask & 16) o.push(r.ts);
    if (mask & 32) {
      o.push(r.b);
      o.push(r.b >>> 8);
    }
    this.prev = { ...r };
  }

  private flushRun(): void {
    if (!this.run) return;
    this.out.push(0);
    this.out.varint(this.run);
    this.run = 0;
  }

  /** The stream so far (the recorder keeps going). */
  bytes(): Uint8Array {
    if (!this.run) return this.out.bytes().slice();
    const saved = this.run;
    const n = this.out.n;
    this.flushRun();
    const b = this.out.bytes().slice();
    this.out.n = n;
    this.run = saved;
    return b;
  }

  get size(): number {
    return this.out.n + (this.run ? 4 : 0);
  }
}

/** Plays a recorded stream back tick by tick. */
export class InputPlayer {
  private i = 0;
  private repeat = 0;
  private cur: Rec = { p: 0, y: 0, r: 0, td: 0, ts: 255, b: 0 };
  tick = 0;

  constructor(
    private data: Uint8Array,
    readonly ticks: number,
  ) {}

  get done(): boolean {
    return this.tick >= this.ticks;
  }

  /** Controls for the next tick (written into `out`); false past the end. */
  next(out: ControlState): boolean {
    if (this.tick >= this.ticks) return false;
    this.tick++;
    if (this.repeat > 0) this.repeat--;
    else this.read();
    const r = this.cur;
    out.pitch = s8(r.p) / AXIS;
    out.yaw = s8(r.y) / AXIS;
    out.roll = s8(r.r) / AXIS;
    out.throttleDelta = s8(r.td) / AXIS;
    out.throttleSet = r.ts === 255 ? null : r.ts / THROTTLE;
    for (let k = 0; k < BUTTONS.length; k++) out[BUTTONS[k]] = (r.b & (1 << k)) !== 0;
    return true;
  }

  private read(): void {
    const d = this.data;
    const mask = d[this.i++];
    if (mask === 0) {
      // Run: the previous record repeats n ticks (this one included).
      let n = 0;
      let mul = 1;
      for (;;) {
        const b = d[this.i++];
        n += (b & 0x7f) * mul;
        if (b < 0x80) break;
        mul *= 128;
      }
      this.repeat = n - 1;
      return;
    }
    const r = this.cur;
    if (mask & 1) r.p = d[this.i++];
    if (mask & 2) r.y = d[this.i++];
    if (mask & 4) r.r = d[this.i++];
    if (mask & 8) r.td = d[this.i++];
    if (mask & 16) r.ts = d[this.i++];
    if (mask & 32) {
      r.b = d[this.i] | (d[this.i + 1] << 8);
      this.i += 2;
    }
  }
}

function s8(b: number): number {
  const v = b & 0xff;
  return v > 127 ? v - 256 : v;
}

// ── base64 (no Buffer / btoa dependency: works in Node, browsers, workers) ──

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function toBase64(b: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INV[clean.charCodeAt(i)];
    const b = B64_INV[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_INV[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? B64_INV[clean.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ── takes ─────────────────────────────────────────────────────────────────

/**
 * A recording in progress: input stream + commands + hash checkpoints.
 * `file()` snapshots it (optionally as a clip window) without stopping.
 */
export class ReplayTake {
  readonly input = new InputRecorder();
  readonly commands: ReplayCommand[] = [];
  readonly checks: [number, number][] = [];

  constructor(readonly header: ReplayHeader) {}

  get ticks(): number {
    return this.input.ticks;
  }

  /** Stamp a command before the next tick. */
  command(c: string, a?: unknown): void {
    this.commands.push(a === undefined ? { t: this.ticks, c } : { t: this.ticks, c, a });
  }

  file(view?: { from: number; to?: number }): ReplayFile {
    return {
      header: this.header,
      ticks: this.ticks,
      input: toBase64(this.input.bytes()),
      commands: this.commands.slice(),
      checks: this.checks.slice(),
      ...(view ? { view } : {}),
    };
  }
}

/** Playback cursor over a file: controls per tick, commands due before each tick, checkpoints. */
export class ReplayCursor {
  readonly input: InputPlayer;
  private ci = 0;
  private hi = 0;

  constructor(readonly file: ReplayFile) {
    this.input = new InputPlayer(fromBase64(file.input), file.ticks);
  }

  /** Tick about to run (0-based). */
  get tick(): number {
    return this.input.tick;
  }

  get done(): boolean {
    return this.input.done;
  }

  /** Commands stamped for the tick about to run (call before `next`). */
  due(out: ReplayCommand[] = []): ReplayCommand[] {
    out.length = 0;
    const cs = this.file.commands;
    while (this.ci < cs.length && cs[this.ci].t <= this.tick) out.push(cs[this.ci++]);
    return out;
  }

  next(out: ControlState): boolean {
    return this.input.next(out);
  }

  /**
   * After a tick has run: compare against the recorded checkpoint for that
   * tick, if any. Returns null (no checkpoint), true (match) or false (desync).
   */
  verify(tickDone: number, hash: number): boolean | null {
    const hs = this.file.checks;
    while (this.hi < hs.length && hs[this.hi][0] < tickDone) this.hi++;
    if (this.hi < hs.length && hs[this.hi][0] === tickDone) return hs[this.hi++][1] === hash >>> 0;
    return null;
  }
}

/** Validate the shape of a parsed replay file (throws on nonsense). */
export function parseReplay(text: string): ReplayFile {
  const f = JSON.parse(text) as ReplayFile;
  if (!f || typeof f !== 'object' || !f.header || f.header.game !== 'vanguard') throw new Error('not a Vanguard replay');
  if (f.header.v !== REPLAY_VERSION) throw new Error(`replay version ${f.header.v} (this build reads ${REPLAY_VERSION})`);
  if (typeof f.input !== 'string' || typeof f.ticks !== 'number') throw new Error('replay has no input stream');
  f.commands ??= [];
  f.checks ??= [];
  return f;
}

/** Tick ↔ timecode helpers ("MM:SS:FF" at 24 fps frames, OVA style). */
export function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ff = Math.floor((s % 1) * 24);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}
