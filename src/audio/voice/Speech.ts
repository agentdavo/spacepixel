import type { VoiceProfile } from './plan';

/**
 * Optional real speech through the Web Speech API (Voice: SPEECH). Each
 * character gets a stable system voice chosen by pitch class and language,
 * with pitch / rate derived from their VoiceProfile. Absent (headless,
 * no voices installed, blocked) → `available` is false and the caller uses
 * the synth instead. Never throws.
 */
type Synth = SpeechSynthesis;

function synth(): Synth | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

let cached: SpeechSynthesisVoice[] = [];
function voices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  if (!cached.length) {
    try {
      cached = s.getVoices().filter((v) => /^en/i.test(v.lang));
      if (!cached.length) s.addEventListener?.('voiceschanged', () => (cached = s.getVoices().filter((v) => /^en/i.test(v.lang))), { once: true });
    } catch {
      cached = [];
    }
  }
  return cached;
}

/** Real speech can be used right now. */
export function speechAvailable(): boolean {
  return voices().length > 0;
}

const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|susan|hazel|libby|sonia|aria|jenny|kate/i;
const MALE = /male|man|daniel|alex|fred|george|david|mark|james|guy|ryan|thomas|oliver|arthur|rishi/i;

function pick(id: string, p: VoiceProfile): SpeechSynthesisVoice | null {
  const all = voices();
  if (!all.length) return null;
  const high = p.f0 > 160;
  let pool = all.filter((v) => (high ? FEMALE.test(v.name) : MALE.test(v.name) && !FEMALE.test(v.name)));
  // Directorate reads British, Rustwake reads anything but, the Choir prefers the most formal voice on offer.
  if (p.accent === 'directorate') pool = pool.filter((v) => /GB|UK/i.test(v.lang + v.name)).concat(pool);
  if (!pool.length) pool = all;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

export interface SpeechHandle {
  /** Estimated seconds. */
  dur: number;
  stop(): void;
}

/** Speak `text` with a system voice. Returns null when speech is unavailable. */
export function speak(id: string, text: string, p: VoiceProfile, volume = 1): SpeechHandle | null {
  const s = synth();
  const voice = pick(id, p);
  if (!s || !voice) return null;
  try {
    const clean = text.replace(/^\s*\(sung\)\s*/i, '').replace(/—/g, ', ');
    const u = new SpeechSynthesisUtterance(p.accent === 'machine' ? clean.toLowerCase() : clean);
    u.voice = voice;
    u.lang = voice.lang;
    const ref = p.f0 > 160 ? 200 : 115;
    u.pitch = Math.max(0.2, Math.min(1.8, 1 + (p.f0 / ref - 1) * 1.6 + (p.accent === 'oracle' ? -0.6 : 0)));
    u.rate = Math.max(0.6, Math.min(1.5, p.rate / 5));
    u.volume = Math.max(0, Math.min(1, volume));
    s.speak(u);
    return {
      dur: clean.length / (14 * u.rate) + 0.3,
      stop: () => {
        try {
          s.cancel();
        } catch {
          /* gone */
        }
      },
    };
  } catch {
    return null;
  }
}

export function stopSpeech(): void {
  try {
    synth()?.cancel();
  } catch {
    /* gone */
  }
}
