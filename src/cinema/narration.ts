import type { Caption, Shot } from './timeline';

/**
 * The prologue's narration track: a voice keyed to the captions that already
 * exist (the prologue itself is untouched). Narration captions are read by
 * the narrator — calm, older — squeezed into the caption's time on screen;
 * the one-word "LIT." is the first relight pilot on an open channel, as the
 * Keeping remembers it. Slugs, counts and the title card stay silent.
 *
 * Pure: global start times + who/how, so the scene, the offline audio render
 * (voice-prologue) and tests all agree.
 */
export interface NarrationCue {
  /** Global timeline time (s) the line starts. */
  at: number;
  caption: Caption;
  who: string;
  channel: 'narrator' | 'radio' | 'clean' | 'intercept';
  /** The voice must finish inside the caption… */
  maxDur: number;
  /** …which the dense captions allow at up to this many × natural pace. */
  maxSqueeze: number;
}

export function narrationCues(shots: readonly Shot[]): NarrationCue[] {
  const out: NarrationCue[] = [];
  let start = 0;
  for (const sh of shots) {
    for (const c of sh.captions ?? []) {
      const kind = c.kind ?? 'narration';
      if (c.who === '') continue; // silent caption
      if (kind === 'narration') {
        const who = c.who ?? 'narrator';
        out.push({ at: start + c.at + 0.08, caption: c, who, channel: c.channel ?? (who === 'narrator' ? 'narrator' : 'radio'), maxDur: Math.max(0.6, c.dur - 0.2), maxSqueeze: 2 });
      } else if (kind === 'word') out.push({ at: start + c.at, caption: c, who: c.who ?? 'relight-pilot', channel: c.channel ?? 'radio', maxDur: Math.max(0.4, c.dur - 0.1), maxSqueeze: 1.7 });
    }
    start += sh.dur;
  }
  return out;
}

/** Cues whose start lies in (from, to] — what to speak this frame. */
export function cuesCrossed(cues: readonly NarrationCue[], from: number, to: number): NarrationCue[] {
  return cues.filter((c) => c.at > from && c.at <= to);
}
