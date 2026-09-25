import { getAudio, type GameAudio } from '../index';
import { settings, type VoiceMode } from '@/game/Settings';
import { planUtterance, revealAt, type VoicePlan, type VoiceProfile } from './plan';
import { renderVoice, type VoiceChannel, type VoiceHandle } from './VoiceSynth';
import { speak as speakReal, speechAvailable, stopSpeech } from './Speech';
import { clipFor, loadClips, playClip } from './Recorded';
import { voiceFor } from './voices';

export { planUtterance, revealAt, renderVoice, voiceFor };
export type { VoicePlan, VoiceProfile, VoiceChannel };
export { CAST_VOICES, NARRATOR, npcVoice, registerVoice, type VoiceTraits } from './voices';

/**
 * The voice service: turns a line into sound (synth or system speech) and
 * tells the caller how long it lasts, so subtitles and comms can time their
 * typewriter to it. Timing comes from the pure planner, so it is identical
 * whether audio is running, blocked, muted or off.
 */
export interface SpeakRequest {
  who: string;
  text: string;
  channel?: VoiceChannel;
  /** Squeeze the line into this many seconds (up to `maxSqueeze`× faster, default 1.7). */
  maxDur?: number;
  maxSqueeze?: number;
  /** Override the speaker's profile. */
  profile?: VoiceProfile;
  /** Linear level (default 1). */
  level?: number;
  /** Start this many seconds from now (default immediately). */
  delay?: number;
}

export interface Utterance {
  /** Seconds the voice takes. */
  dur: number;
  plan: VoicePlan;
  /** Characters of the line to show `t` seconds after it started. */
  reveal(t: number): number;
  stop(): void;
}

/** Plan a line exactly as `speak` will (pure: no audio). */
export function planFor(req: Pick<SpeakRequest, 'who' | 'text' | 'maxDur' | 'maxSqueeze' | 'profile'>): { plan: VoicePlan; profile: VoiceProfile } {
  const profile = req.profile ?? voiceFor(req.who);
  let seed = 0;
  for (let i = 0; i < req.who.length; i++) seed = (seed * 31 + req.who.charCodeAt(i)) >>> 0;
  return { plan: planUtterance(req.text, profile, { maxDur: req.maxDur, maxSqueeze: req.maxSqueeze, seed }), profile };
}

const CHANNEL_LEVEL: Record<VoiceChannel, number> = { radio: 0.3, intercept: 0.27, clean: 0.4, narrator: 0.38 };
/** Recorded clips are peak-normalised; these sit them at the synth's loudness. */
const CLIP_LEVEL: Record<VoiceChannel, number> = { radio: 0.4, intercept: 0.36, clean: 0.4, narrator: 0.38 };

export class VoiceBox {
  /** Force a mode (offline renders); null = follow settings. */
  modeOverride: VoiceMode | null = null;
  private live = new Map<{ stop(): void }, number>();

  constructor(private readonly audio: GameAudio) {
    void loadClips();
  }

  get mode(): VoiceMode {
    return this.modeOverride ?? settings.voice;
  }

  plan(req: SpeakRequest): { plan: VoicePlan; profile: VoiceProfile } {
    return planFor(req);
  }

  speak(req: SpeakRequest): Utterance {
    const { plan, profile } = this.plan(req);
    const channel = req.channel ?? 'radio';
    let dur = plan.dur;
    let handle: { stop(): void } | null = null;
    const mode = this.mode;
    if (mode === 'speech' && speechAvailable() && !this.audio.muted) {
      const h = speakReal(req.who, req.text, profile, (req.level ?? 1) * this.audio.engine.getVolume('voice') * this.audio.engine.getVolume('master'));
      if (h) {
        dur = Math.max(plan.dur * 0.8, h.dur);
        handle = h;
      }
    }
    if (mode === 'cast' && !this.audio.muted) {
      const clip = clipFor(req.who, req.text, profile);
      const e = this.audio.engine;
      if (clip && e.ctx && e.voice && e.running) {
        // Squeeze into maxDur a little by playing faster (pitch rises with it, so not much).
        const rate = req.maxDur && clip.dur > req.maxDur ? Math.min(req.maxSqueeze ?? 1.25, 1.25, clip.dur / req.maxDur) : 1;
        const delay = req.delay ?? 0;
        const radio = channel === 'radio' || channel === 'intercept';
        try {
          handle = playClip(e.ctx, e.voice, clip, e.ctx.currentTime + (radio ? 0.08 : 0.02) + delay, channel, (req.level ?? 1) * CLIP_LEVEL[channel] * (profile.gain ?? 1), rate, profile.rasp);
          dur = clip.dur / rate + (radio ? 0.06 : 0);
          e.duckMusic(channel === 'narrator' ? -5 : -7, delay + dur + 0.25, 0.9);
        } catch (err) {
          console.warn('[voice] clip failed', err);
        }
      }
    }
    if (!handle && mode !== 'off') handle = this.synth(plan, profile, channel, req.level ?? 1, req.delay ?? 0);
    if (handle) {
      const hd = handle;
      const now = performance.now() / 1000;
      for (const [h, end] of this.live) if (end < now) this.live.delete(h);
      this.live.set(hd, now + dur + 1);
      const k = dur / plan.dur;
      return {
        dur,
        plan,
        reveal: (t) => revealAt(plan, t / k),
        stop: () => {
          hd.stop();
          this.live.delete(hd);
        },
      };
    }
    return { dur, plan, reveal: (t) => revealAt(plan, t), stop: () => {} };
  }

  private synth(plan: VoicePlan, profile: VoiceProfile, channel: VoiceChannel, level: number, delay: number): VoiceHandle | null {
    const e = this.audio.engine;
    const ctx = e.ctx;
    const out = e.voice;
    if (!ctx || !out || !e.running) return null;
    try {
      const t0 = ctx.currentTime + 0.02 + delay;
      const h = renderVoice(ctx, out, plan, profile, t0, channel, level * CHANNEL_LEVEL[channel]);
      e.duckMusic(channel === 'narrator' ? -5 : -7, delay + plan.dur + 0.25, 0.9);
      return h;
    } catch (err) {
      console.warn('[voice] synth failed', err);
      return null;
    }
  }

  stopAll(): void {
    for (const h of this.live.keys()) h.stop();
    this.live.clear();
    stopSpeech();
  }
}

let shared: VoiceBox | null = null;

/** The app-wide voice service (over getAudio()). */
export function getVoice(): VoiceBox {
  shared ??= new VoiceBox(getAudio());
  return shared;
}
