/**
 * Subtitle timing — pure, shared by comms, the prologue narration, station
 * conversations and cutscenes (tests/dialog.test.ts checks the numbers).
 *
 *  - A line stays up long enough to read at READ_CPS (never faster than
 *    MAX_CPS) and long enough to hear its voice plus a beat.
 *  - The typewriter runs with the voice: text appears as it is spoken.
 *  - Lines never overlap: a new line waits for the previous one to clear.
 */
export const READ_CPS = 15;
export const MAX_CPS = 17;
/** Pause between one subtitle clearing and the next appearing. */
export const SUB_GAP = 0.15;

/** Characters that count for reading speed (whitespace collapsed, "(sung)" dropped). */
export function visibleLength(text: string): number {
  return text.replace(/^\s*\(sung\)\s*/i, '').replace(/\s+/g, ' ').trim().length;
}

/** Minimum time on screen to read a line comfortably. */
export function readTime(text: string): number {
  const n = visibleLength(text);
  return Math.max(1.8, 0.8 + n / READ_CPS);
}

/** How long a (possibly voiced) line holds: read time, or the voice plus a beat. */
export function lineHold(text: string, voiceDur = 0): number {
  return Math.max(readTime(text), voiceDur > 0 ? voiceDur + 0.45 : 0);
}

/** Typewriter duration: the voice's length, or a brisk 40 cps when silent. */
export function typeDuration(text: string, voiceDur = 0): number {
  const n = visibleLength(text);
  const hold = lineHold(text, voiceDur);
  return Math.max(0.05, Math.min(hold - 0.5, voiceDur > 0 ? voiceDur : n / 40));
}

/** Reading speed a hold implies (chars / second). */
export function cps(text: string, hold: number): number {
  return visibleLength(text) / Math.max(0.01, hold);
}

export interface CueSlot {
  start: number;
  end: number;
}

/**
 * Lay out cues that want to start at `at` without overlapping: each starts at
 * max(at, previous end + gap) and holds `lineHold(text, voiceDur)`.
 */
export function scheduleCues(cues: readonly { at: number; text: string; voiceDur?: number }[], gap = SUB_GAP): CueSlot[] {
  const out: CueSlot[] = [];
  let free = -Infinity;
  for (const c of cues) {
    const start = Math.max(c.at, free + gap);
    const end = start + lineHold(c.text, c.voiceDur ?? 0);
    out.push({ start, end });
    free = end;
  }
  return out;
}
