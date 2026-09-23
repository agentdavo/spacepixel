import type { FxField, FxTrack, Shot } from './timeline';

/**
 * PROLOGUE — the cold open. ~60 s, nine shots, told like the first minute
 * of a 1994 OVA: a single star, the golden age, the Shattering, the long
 * dark, the relighting, two powers, Vanguard, the Signal, the title.
 *
 * Pure data (plus two envelope helpers). Camera keys are kilometres relative
 * to the shot's set anchor; `rig` moves are in the subject's frame (x right,
 * y up, z forward). The stage that builds the sets is PrologueStage.
 *
 * Sets: void · gate · graveyard · lantern · treaty · launch · null
 */

/** Attack → hold → release pulse on one postFx field. */
function pulse(field: FxField, at: number, peak: number, attack = 0.06, hold = 0.05, release = 0.5): FxTrack {
  return { field, keys: [[at, 0], [at + attack, peak], [at + attack + hold, peak], [at + attack + hold + release, 0]] };
}

/** Ramp a field from `a` to `b` over [t0, t1] (held beyond). */
function ramp(field: FxField, t0: number, t1: number, a: number, b: number): FxTrack {
  return { field, keys: [[t0, a], [t1, b]] };
}

/** The Signal's pulses (shot-local times in `signal`). */
export const SIGNAL_PULSES = [3.6, 4.45, 5.3, 6.15] as const;
const PRIMES = ['1,009', '997', '991', '983'] as const;

export const PROLOGUE: Shot[] = [
  // ── 1 · a single star ──────────────────────────────────────────────
  {
    id: 'cold-open',
    set: 'void',
    dur: 5.5,
    cams: [{ at: 0, dur: 5.5, from: { eye: [0, 0, 0], look: [0, 0, -1], fov: 40 }, to: { eye: [0, 0, 0], look: [0, 0, -1], fov: 31 }, ease: 'linear' }],
    captions: [
      { at: 0.5, dur: 4.8, kind: 'slug', text: 'THE MERIDIAN REACH · YEAR 431 OF THE LONG DARK' },
      { at: 1.7, dur: 3.6, text: 'Once, the stars were joined.', jp: 'かつて、星々はひとつに結ばれていた。' },
    ],
    fx: [ramp('fade', 0, 1.4, 1, 0)],
    music: [{ at: 0, mood: 'sublime', fade: 3 }],
    sound: [{ at: 0.3, radio: 'static' }],
  },

  // ── 2 · the gates sang ─────────────────────────────────────────────
  {
    id: 'gates-sang',
    set: 'gate',
    dur: 6.5,
    cams: [
      { at: 0, dur: 3.4, from: { eye: [-5.5, -3.2, 44], look: [0.5, 0.6, 0], fov: 50 }, to: { eye: [-5.0, -2.9, 41], look: [0.5, 0.6, 0], fov: 48 }, ease: 'linear' },
      { at: 3.4, dur: 3.1, rig: 'liner0', from: { eye: [0.75, 0.32, -2.3], look: [-0.1, 0, 3], fov: 46 }, to: { eye: [0.62, 0.27, -1.9], look: [-0.1, 0, 3], fov: 44 }, ease: 'linear' },
    ],
    captions: [
      { at: 0.3, dur: 3.0, text: 'Four hundred years ago, the gates sang.', jp: '四百年前、ゲートは歌っていた。' },
      { at: 3.55, dur: 2.9, text: 'For twenty-two centuries we rode them — on a timetable.' },
    ],
    fx: [pulse('flash', 0, 0.35, 0.02, 0.03, 0.5)],
    sound: [{ at: 3.4, sfx: 'cruiseEngage', gain: 0.5 }],
  },

  // ── 3 · the Shattering ─────────────────────────────────────────────
  {
    id: 'shattering',
    set: 'gate',
    dur: 6.5,
    cams: [
      { at: 0, dur: 1.5, from: { eye: [8, 2.8, 26], look: [0, 0, 0], fov: 55 }, to: { eye: [7.4, 2.6, 24.5], look: [0, 0, 0], fov: 55 }, ease: 'linear', shake: 0.003 },
      { at: 1.5, dur: 0.9, rig: 'liner0', from: { eye: [-1.1, 0.45, 1.6], look: [0.1, 0, -0.6], fov: 60 }, to: { eye: [-1.0, 0.4, 1.4], look: [0.1, 0, -0.6], fov: 62 }, shake: 0.012 },
      { at: 2.4, dur: 4.1, from: { eye: [-15, 5, 44], look: [0, -0.8, 0], fov: 50 }, to: { eye: [-17, 6, 50], look: [0, -0.8, 0], fov: 48 }, ease: 'out' },
    ],
    captions: [{ at: 2.9, dur: 3.5, kicker: 'YEAR 0 · THE SHATTERING', text: 'Then, in a single day, every Lantern went dark.', jp: 'そしてある日、すべてのランタンが消えた。' }],
    events: [{ at: 1.8, id: 'shatter' }],
    fx: [
      // The bell struck at the wrong note: hue lurches, a stutter of negative.
      pulse('flash', 0.35, 0.3, 0.04, 0.02, 0.4),
      pulse('hue', 0.35, 0.7, 0.05, 0.1, 0.5),
      pulse('hue', 0.95, -0.6, 0.04, 0.1, 0.45),
      pulse('invert', 0.95, 1, 0.01, 0.07, 0.05),
      pulse('invert', 1.25, 1, 0.01, 0.04, 0.05),
      // It rings, then cracks.
      pulse('flash', 1.8, 1, 0.03, 0.22, 0.85),
      pulse('invert', 1.88, 1, 0.01, 0.06, 0.02),
      pulse('solarize', 2.4, 0.45, 0.02, 0.2, 1.0),
      ramp('fade', 3.2, 6.5, 0, 0.18),
    ],
    music: [{ at: 1.8, mood: 'dread', fade: 0.4 }],
    sound: [
      { at: 0.3, sfx: 'jumpEntry', gain: 0.8 },
      { at: 1.8, sfx: 'explosionLarge', gain: 1.2 },
      { at: 1.95, sfx: 'explosionLarge', gain: 0.8 },
      { at: 2.3, sfx: 'jumpExit', gain: 0.6 },
    ],
  },

  // ── 4 · the long dark: fossils ─────────────────────────────────────
  {
    id: 'long-dark',
    set: 'graveyard',
    dur: 6.5,
    cams: [
      { at: 0, dur: 3.4, from: { eye: [-2.1, 0.55, 2.0], look: [0.1, -0.05, -0.2], fov: 46 }, to: { eye: [-1.75, 0.47, 1.6], look: [0.1, -0.05, -0.25], fov: 46 }, ease: 'linear' },
      { at: 3.4, dur: 3.1, rig: 'warden', units: 'm', from: { eye: [17, 3.5, 27], look: [-30, -2, -14], fov: 42 }, to: { eye: [14, 3, 23], look: [-30, -2, -14], fov: 42 }, ease: 'linear' },
    ],
    captions: [
      { at: 0.3, dur: 3.0, kicker: 'THE LONG DARK', text: 'The colonies were left where they stood. Alone.' },
      { at: 3.5, dur: 2.9, kicker: 'SIXTH KEEPING · WE DO NOT ASK THE ENGINE WHY', text: 'Everything that flies is a fossil — kept running, never understood.' },
    ],
    fx: [pulse('flash', 0, 0.12, 0.02, 0.02, 0.3)],
    sound: [{ at: 0.2, radio: 'static' }],
  },

  // ── 5 · the Relighting: Ebon-gas ───────────────────────────────────
  {
    id: 'relighting',
    set: 'lantern',
    dur: 6.5,
    cams: [
      { at: 0, dur: 2.9, from: { eye: [-3.6, -0.9, 7.6], look: [0, 0.1, 0], fov: 46 }, to: { eye: [-3.1, -0.75, 6.6], look: [0, 0.1, 0], fov: 45 }, ease: 'linear' },
      { at: 2.9, dur: 1.3, from: { eye: [1.3, 2.6, 2.2], look: [0.1, 1.5, 0], fov: 52 }, to: { eye: [1.2, 2.5, 1.9], look: [0.1, 1.5, 0], fov: 52 }, shake: 0.003 },
      { at: 4.2, dur: 2.3, from: { eye: [0.6, 0.35, 13.5], look: [0, 0, 0], fov: 36 }, to: { eye: [0.5, 0.3, 11.8], look: [0, 0, 0], fov: 36 }, ease: 'linear' },
    ],
    captions: [
      { at: 0.3, dur: 2.5, kicker: 'YEAR 212 · THE RELIGHTING', text: 'Then — Ebon-gas. Black light, skimmed from dying stars.' },
      { at: 3.15, dur: 1.05, kind: 'word', text: 'LIT.', jp: '点灯' },
      { at: 4.35, dur: 2.1, text: 'Six Lanterns burn again. Every gram is fought over.' },
    ],
    events: [{ at: 2.5, id: 'ebon' }],
    fx: [
      pulse('hue', 2.5, 0.45, 0.2, 0.3, 1.2),
      pulse('solarize', 2.9, 0.3, 0.05, 0.1, 0.6),
      pulse('flash', 3.15, 0.45, 0.03, 0.04, 0.45),
    ],
    music: [{ at: 2.9, mood: 'sublime', fade: 1.5 }],
    sound: [
      { at: 2.5, sfx: 'jumpEntry', gain: 0.7 },
      { at: 3.15, sfx: 'jumpExit', gain: 0.9 },
    ],
  },

  // ── 6 · two heavens ────────────────────────────────────────────────
  {
    id: 'two-heavens',
    set: 'treaty',
    dur: 8.5,
    cams: [
      { at: 0, dur: 2.9, from: { eye: [-4.9, 0.35, 2.3], look: [-1.8, 0, -1.2], fov: 44 }, to: { eye: [-4.75, 0.4, 1.8], look: [-1.8, 0, -1.2], fov: 44 }, ease: 'linear' },
      { at: 2.9, dur: 2.8, from: { eye: [1.9, -0.75, 1.9], look: [3.4, 0.45, -0.9], fov: 44 }, to: { eye: [2.05, -0.7, 1.5], look: [3.4, 0.45, -0.9], fov: 44 }, ease: 'linear' },
      { at: 5.7, dur: 2.8, from: { eye: [0.8, 3.2, 9.5], look: [0, -0.2, -0.8], fov: 50 }, to: { eye: [0.4, 2.9, 8.4], look: [0, -0.2, -0.8], fov: 50 }, ease: 'linear', shake: 0.0015 },
    ],
    captions: [
      { at: 0.2, dur: 2.6, kicker: 'THE TERRAN DIRECTORATE', text: '“Keep the light.” They count every gram, and call it survival.' },
      { at: 3.05, dur: 2.55, kicker: 'THE ZENITH HEGEMONY', text: '“Be witnessed.” They sing to their ships, and call it ascension.' },
      { at: 5.9, dur: 2.5, text: 'Neither side is winning. That is the point.' },
    ],
    events: [
      { at: 4.2, id: 'vesper-lance' },
      { at: 5.75, id: 'cathedral-lance' },
      { at: 6.1, id: 'broadside' },
      { at: 6.6, id: 'kill-lance' },
      { at: 7.3, id: 'guard-dies' },
    ],
    fx: [pulse('flash', 7.3, 0.28, 0.03, 0.03, 0.5)],
    music: [{ at: 0, mood: 'combat', fade: 1.2 }],
    sound: [
      { at: 4.2, sfx: 'beamHit', gain: 0.5 },
      { at: 5.75, sfx: 'beamHit', gain: 0.9 },
      { at: 6.1, sfx: 'laser', gain: 0.8 },
      { at: 7.3, sfx: 'explosionLarge', gain: 1.0 },
    ],
  },

  // ── 7 · Vanguard ───────────────────────────────────────────────────
  {
    id: 'vanguard',
    set: 'launch',
    dur: 6.5,
    cams: [
      { at: 0, dur: 2.2, rig: 'deck', units: 'm', from: { eye: [-11, 3.2, -12], look: [0, 3, 6], fov: 50 }, to: { eye: [-11, 3.2, -10], look: [-1, 5, 240], fov: 44 }, ease: 'inOut' },
      { at: 2.2, dur: 2.2, aim: 'lead', units: 'm', from: { eye: [0.036, 1.192, 3.03], look: [0, 0, 8], fov: 34 }, to: { eye: [0.036, 1.192, 3.03], look: [0, 0, 8], fov: 52 }, ease: 'in' },
      { at: 4.4, dur: 2.1, rig: 'lead', units: 'm', from: { eye: [5, 5.5, -30], look: [0, 3, 120], fov: 52, roll: -0.05 }, to: { eye: [4, 5, -27], look: [0, 3, 120], fov: 54, roll: 0.03 }, ease: 'linear' },
    ],
    captions: [
      { at: 0.3, dur: 2.6, kicker: '13TH INDEPENDENT SQUADRON', text: 'Between them flies Vanguard —' },
      { at: 3.2, dur: 3.1, text: 'the squadron that goes through first.', jp: '最初に抜ける部隊。' },
    ],
    fx: [ramp('speed', 4.4, 4.6, 0, 0.75), ramp('boost', 4.4, 4.7, 0, 0.45)],
    music: [{ at: 0, mood: 'title', fade: 1.2 }],
    sound: [
      { at: 0.35, sfx: 'afterburnerIgnite', gain: 0.9 },
      { at: 1.35, sfx: 'afterburnerIgnite', gain: 0.6 },
      { at: 2.9, sfx: 'afterburnerIgnite', gain: 1.0 },
    ],
  },

  // ── 8 · the Signal ─────────────────────────────────────────────────
  {
    id: 'signal',
    set: 'null',
    dur: 7.0,
    cams: [
      { at: 0, dur: 3.3, from: { eye: [-2.2, 0.7, 5011], look: [0, 0, 0], fov: 50 }, to: { eye: [-1.8, 0.55, 5008.5], look: [0, 0, 0], fov: 50 }, ease: 'linear' },
      { at: 3.3, dur: 3.7, from: { eye: [0.25, 0.1, 5003], look: [0, 0, 0], fov: 58 }, to: { eye: [0.05, 0.02, 4999.2], look: [0, 0, 0], fov: 54 }, ease: 'inOut' },
    ],
    captions: [
      { at: 0.3, dur: 3.0, text: 'And at the edge of the Reach, beyond a gate that leads nowhere,' },
      { at: 3.45, dur: 3.45, text: 'something is counting down the primes.', jp: '何かが、素数を数えている。' },
      ...SIGNAL_PULSES.map((at, i) => ({ at, dur: i === SIGNAL_PULSES.length - 1 ? 0.85 : 0.8, kind: 'count' as const, kicker: 'NULL · BURST', text: PRIMES[i] })),
    ],
    fx: [...SIGNAL_PULSES.flatMap((at) => [pulse('flash', at, 0.1, 0.02, 0.02, 0.25), pulse('solarize', at, 0.35, 0.02, 0.05, 0.4)]), pulse('flash', 0, 0.15, 0.02, 0.02, 0.4)],
    music: [{ at: 0, mood: 'dread', fade: 1.5 }],
    sound: [{ at: 0.1, radio: 'static' }, ...SIGNAL_PULSES.map((at) => ({ at, radio: 'click' as const }))],
  },

  // ── 9 · title ──────────────────────────────────────────────────────
  {
    id: 'title',
    set: 'lantern',
    dur: 6.5,
    cams: [{ at: 0, dur: 6.5, from: { eye: [0.35, -0.2, 10.5], look: [0, 0.25, 0], fov: 34 }, to: { eye: [0.3, -0.16, 9.6], look: [0, 0.25, 0], fov: 34 }, ease: 'linear' }],
    captions: [{ at: 0.35, dur: 6.15, kind: 'title', text: 'PROJECT\nVANGUARD', kicker: 'THE LONG DARK', jp: '長い闇' }],
    fx: [pulse('flash', 0.35, 0.4, 0.02, 0.04, 0.5), ramp('fade', 5.4, 6.5, 0, 1)],
    music: [{ at: 0, mood: 'title', fade: 0.8 }],
    sound: [{ at: 0.35, stinger: 'victory' }],
  },
];
