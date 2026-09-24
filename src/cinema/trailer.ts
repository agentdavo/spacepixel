import type { Caption, CamMove, FxTrack, MusicCue, Shot, SoundCue } from './timeline';
import { pulse, ramp } from './prologue.ts';

/**
 * TRAILER — a 90 s gameplay trailer, cut like the promo reel on the back of
 * a 1994 OVA tape: the Signal's cold open, the tagline, then the game in
 * three movements behind eyecatch cards — FIGHT. (launch, dogfight, the
 * missile circus, a capital battle), TRADE. (the living Reach, docking, the
 * station), RISE. (the shipyard, the ladder at true scale, a frigate's
 * broadside) — and the title and end slate.
 *
 * Pure data like the prologue. Sets and rigs are TrailerStage's:
 *   null · lantern · launch · fight · battle · reach · lineup · broadside
 * Rigs: deck, lead (launch) · k0 k1 c0 c1 c2 (fight) · cathedral, indomitable,
 * bk0 (battle) · giant, lantern, liner, kestrel, bay (reach, all in metres
 * unless noted) · row (lineup) · valiant, canticle (broadside).
 *
 * The combat movement is cut on the beat of the combat score (156 bpm).
 */

/** One beat of the combat theme (s). */
export const BEAT = 60 / 156;
const B = BEAT;

/** The Signal's pulses in the cold open (shot-local, `signal`). */
export const TRAILER_PULSES = [0.8, 1.6, 2.4, 3.2] as const;
const PRIMES = ['1,009', '997', '991', '983'] as const;

/** Shots whose frame is a docked UI screen (TrailerUi), keyed by shot id. */
export const UI_SHOTS: Record<string, 'market' | 'concourse' | 'shipyard'> = { market: 'market', concourse: 'concourse', shipyard: 'shipyard' };

/** The concourse shot's speaker (greeting voiced by the Concourse tab itself; mirrored offline). */
export const CONCOURSE_PERSON = 'lucan';

const hold = (at: number, dur: number, eye: CamMove['from']['eye'], look: CamMove['from']['look'], fov = 50): CamMove => ({ at, dur, from: { eye, look, fov }, ease: 'linear' });

/** A gun burst: `n` shots `every` s apart. */
const burst = (at: number, n: number, every: number, sfx: SoundCue['sfx'] = 'laser', gain = 0.6): SoundCue => ({ at, sfx, repeat: n, every, gain });

/** An eyecatch interstitial card: the word slams in over the whole frame. */
function card(id: string, set: string, word: string, jp: string, n: string, tone: string, music?: MusicCue[]): Shot {
  const dur = 2 * B;
  return {
    id,
    set,
    dur,
    cams: [hold(0, dur, [0, 0.02, 0.2], [0, 0, 0], 40)],
    captions: [{ at: 0, dur, kind: 'card', text: word, jp, kicker: n, tone }],
    fx: [pulse('flash', 0, 0.35, 0.01, 0.02, 0.2)],
    sound: [{ at: 0, sfx: 'lockConfirm', gain: 0.8 }, { at: 0.02, radio: 'click' }],
    ...(music ? { music } : {}),
  };
}

const speed = (t0: number, t1: number, v: number): FxTrack => ({ field: 'speed', keys: [[t0, v], [t1, v]] });

export const TRAILER: Shot[] = [
  // ══ COLD OPEN ═════════════════════════════════════════════════════════
  {
    id: 'signal',
    set: 'null',
    dur: 4.6,
    cams: [
      { at: 0, dur: 2.3, from: { eye: [-2.2, 0.7, 5011], look: [0, 0, 0], fov: 50 }, to: { eye: [-1.9, 0.6, 5009.2], look: [0, 0, 0], fov: 50 }, ease: 'linear' },
      { at: 2.3, dur: 2.3, from: { eye: [0.25, 0.1, 5003], look: [0, 0, 0], fov: 58 }, to: { eye: [0.06, 0.02, 5000.3], look: [0, 0, 0], fov: 54 }, ease: 'inOut' },
    ],
    captions: [
      { at: 0.15, dur: 4.4, kind: 'slug', text: 'NULL · THE EDGE OF THE REACH · YEAR 431' },
      ...TRAILER_PULSES.map((at, i): Caption => ({ at, dur: i === TRAILER_PULSES.length - 1 ? 1.3 : 0.75, kind: 'count', kicker: 'NULL · BURST', text: PRIMES[i] })),
      { at: 2.35, dur: 2.2, text: 'Something is counting down the primes.', jp: '何かが、素数を数えている。' },
    ],
    fx: [ramp('fade', 0, 0.7, 1, 0), ...TRAILER_PULSES.flatMap((at) => [pulse('flash', at, 0.12, 0.02, 0.02, 0.25), pulse('solarize', at, 0.35, 0.02, 0.05, 0.4)])],
    music: [{ at: 0, mood: 'dread', fade: 0.8, intensity: 0.5 }],
    sound: [{ at: 0.05, radio: 'static' }, ...TRAILER_PULSES.map((at) => ({ at, radio: 'click' as const }))],
  },
  {
    id: 'long-dark',
    set: 'lantern',
    dur: 5.0,
    cams: [
      { at: 0, dur: 2.6, from: { eye: [-3.6, -0.9, 7.6], look: [0, 0.1, 0], fov: 46 }, to: { eye: [-3.15, -0.78, 6.7], look: [0, 0.1, 0], fov: 45 }, ease: 'linear' },
      { at: 2.6, dur: 2.4, from: { eye: [0.6, 0.35, 13.5], look: [0, 0, 0], fov: 36 }, to: { eye: [0.5, 0.3, 11.7], look: [0, 0, 0], fov: 36 }, ease: 'linear' },
    ],
    captions: [
      { at: 0.35, dur: 2.15, text: 'In the Long Dark…', jp: '長い闇の中で…' },
      { at: 2.75, dur: 2.15, text: '…every light is worth a war.', jp: '光ひとつが、戦争に値する。' },
    ],
    events: [{ at: 2.3, id: 'ebon' }],
    fx: [ramp('fade', 0, 0.5, 0.8, 0), pulse('hue', 2.3, 0.45, 0.2, 0.3, 1.0), pulse('flash', 2.6, 0.5, 0.03, 0.04, 0.45), pulse('solarize', 2.6, 0.3, 0.05, 0.1, 0.6)],
    music: [{ at: 0, mood: 'sublime', fade: 1.2 }],
    sound: [
      { at: 2.3, sfx: 'jumpEntry', gain: 0.7 },
      { at: 2.6, sfx: 'jumpExit', gain: 0.9 },
    ],
  },

  // ══ FIGHT. ════════════════════════════════════════════════════════════
  {
    id: 'launch',
    set: 'launch',
    dur: 4.0,
    cams: [
      { at: 0, dur: 2.2, rig: 'deck', units: 'm', from: { eye: [-11, 3.2, -12], look: [0, 3, 6], fov: 50 }, to: { eye: [-11, 3.2, -10], look: [-1, 5, 240], fov: 44 }, ease: 'inOut' },
      { at: 2.2, dur: 1.8, aim: 'lead', units: 'm', from: { eye: [0.036, 1.192, 3.03], look: [0, 0, 8], fov: 34 }, to: { eye: [0.036, 1.192, 3.03], look: [0, 0, 8], fov: 50 }, ease: 'in' },
    ],
    captions: [{ at: 0.35, dur: 2.5, who: 'kade', kicker: 'KADE · VANGUARD LEAD', text: 'Vanguard, launch! Weapons free!', jp: 'ヴァンガード、発進！' }],
    fx: [ramp('speed', 2.2, 2.5, 0, 0.7), ramp('boost', 2.2, 2.6, 0, 0.45)],
    music: [{ at: 0, mood: 'combat', fade: 0.2, intensity: 0.95 }],
    sound: [
      { at: 0.1, radio: 'open' },
      { at: 0.35, sfx: 'afterburnerIgnite', gain: 0.9 },
      { at: 1.0, sfx: 'afterburnerIgnite', gain: 0.6 },
      { at: 2.9, sfx: 'afterburnerIgnite', gain: 1.0 },
    ],
  },
  card('fight-card', 'fight', 'FIGHT.', '戦え', '01', 'cobalt'),
  {
    // Head-on merge: over the lead's shoulder into the Cantors' fire, then the pass.
    id: 'merge',
    set: 'fight',
    dur: 8 * B,
    cams: [
      { at: 0, dur: 4 * B, rig: 'k0', units: 'm', from: { eye: [5.5, 3.6, -19], look: [-4, 9, 400], fov: 56 }, to: { eye: [4.8, 3.2, -17], look: [-4, 9, 400], fov: 56 }, ease: 'linear', shake: 0.002 },
      { at: 4 * B, dur: 4 * B, aim: 'k0', units: 'm', from: { eye: [-0.034, 0.008, 0.02], look: [0, 0, 6], fov: 62 }, to: { eye: [-0.034, 0.008, 0.02], look: [0, 0, 6], fov: 62 }, ease: 'linear' },
    ],
    events: [
      { at: 0.35, id: 'fire:k' },
      { at: 0.55, id: 'fire:c' },
      { at: 1.95, id: 'kill:c1' },
      { at: 2.2, id: 'cease' },
    ],
    fx: [speed(0, 8 * B, 0.45), pulse('flash', 1.95, 0.25, 0.02, 0.03, 0.3)],
    sound: [burst(0.35, 16, 1 / 12, 'laser', 0.55), burst(0.55, 8, 0.14, 'laser', 0.35), { at: 1.95, sfx: 'explosionSmall', gain: 1 }, { at: 2.35, sfx: 'afterburnerIgnite', gain: 0.8 }],
  },
  {
    // On a Cantor's tail: it jinks, the lasers walk onto it, it goes.
    id: 'chase',
    set: 'fight',
    dur: 8 * B,
    cams: [{ at: 0, dur: 8 * B, rig: 'k0', units: 'm', from: { eye: [1.6, 3.3, -15], look: [0, 0.5, 220], fov: 58 }, to: { eye: [1.2, 3.0, -13.5], look: [0, 0.5, 220], fov: 60 }, ease: 'linear', shake: 0.0025 }],
    captions: [{ at: 2.45, dur: 0.62, kind: 'word', who: 'jackpot', text: 'SPLASH!', jp: '撃墜' }],
    events: [
      { at: 0.4, id: 'fire:k' },
      { at: 2.3, id: 'kill:c0' },
      { at: 2.35, id: 'cease' },
    ],
    fx: [speed(0, 8 * B, 0.6), pulse('flash', 2.3, 0.35, 0.02, 0.03, 0.35)],
    sound: [burst(0.4, 23, 1 / 12, 'laser', 0.6), { at: 2.3, sfx: 'explosionSmall', gain: 1.1 }],
  },
  {
    // Reverse angle: a Cantor on the lead's six, hymn shards streaking past — then Jackpot's guns take it off.
    id: 'break',
    set: 'fight',
    dur: 6 * B,
    cams: [{ at: 0, dur: 6 * B, rig: 'k0', units: 'm', from: { eye: [-3.2, 1.6, 26], look: [0, 0, -260], fov: 48, roll: 0.05 }, to: { eye: [-3.0, 1.4, 24], look: [0, 0, -260], fov: 50, roll: -0.08 }, ease: 'linear', shake: 0.003 }],
    captions: [{ at: 0.1, dur: 1.55, who: 'sparrow', kicker: 'SPARROW · VANGUARD 4', text: 'Two on my six! Break, break!' }],
    events: [
      { at: 0.05, id: 'fire:c' },
      { at: 0.9, id: 'fire:k1' },
      { at: 1.65, id: 'kill:c2' },
      { at: 1.7, id: 'cease' },
    ],
    fx: [speed(0, 6 * B, 0.55), pulse('flash', 1.65, 0.3, 0.02, 0.03, 0.3)],
    sound: [{ at: 0.02, radio: 'open' }, burst(0.05, 10, 0.14, 'laser', 0.45), burst(0.9, 9, 1 / 12, 'cannon', 0.5), { at: 1.65, sfx: 'explosionSmall', gain: 1 }],
  },
  {
    // The missile circus: two salvos fan out, spiral, and find the flight.
    id: 'itano',
    set: 'fight',
    dur: 12 * B,
    cams: [
      { at: 0, dur: 4 * B, rig: 'k0', units: 'm', from: { eye: [-10, 3.6, -7], look: [8, 2, 200], fov: 64 }, to: { eye: [-11, 4.2, -9], look: [8, 2, 200], fov: 66 }, ease: 'linear' },
      { at: 4 * B, dur: 8 * B, aim: 'c0', units: 'm', from: { eye: [0.62, 0.16, 1.28], look: [150, 0, 0], fov: 54 }, to: { eye: [0.6, 0.155, 1.26], look: [150, 0, 0], fov: 54 }, ease: 'linear', shake: 0.0015 },
    ],
    captions: [{ at: 0.15, dur: 1.6, who: 'jackpot', kicker: 'JACKPOT · VANGUARD 2', text: 'Fox three — swarm away!', jp: 'ミサイル発射！' }],
    events: [
      { at: 0.3, id: 'salvo:0' },
      { at: 0.62, id: 'salvo:1' },
      { at: 1.0, id: 'salvo:2' },
    ],
    fx: [speed(0, 12 * B, 0.35)],
    sound: [{ at: 0.05, radio: 'open' }, { at: 0.3, sfx: 'missileLaunch', repeat: 12, every: 0.045, gain: 0.55 }, { at: 0.62, sfx: 'missileLaunch', repeat: 12, every: 0.045, gain: 0.5 }, { at: 1.0, sfx: 'missileLaunch', repeat: 12, every: 0.045, gain: 0.45 }, { at: 3.0, sfx: 'missileHit', repeat: 8, every: 0.09, gain: 0.8 }, { at: 3.2, sfx: 'explosionSmall', repeat: 3, every: 0.3, gain: 1 }],
  },
  {
    // A Cathedral mid-battle: batteries, a spire and a hangar burning; Vanguard strafing the port side.
    id: 'capital',
    set: 'battle',
    dur: 10 * B,
    cams: [
      { at: 0, dur: 5 * B, rig: 'cathedral', units: 'm', from: { eye: [1250, 700, 260], look: [60, 120, -380], fov: 50 }, to: { eye: [1230, 690, 330], look: [60, 120, -380], fov: 50 }, ease: 'linear' },
      { at: 5 * B, dur: 5 * B, rig: 'bk0', units: 'm', from: { eye: [-7, 4, -24], look: [-60, -20, 300], fov: 60 }, to: { eye: [-7, 4.5, -22], look: [-60, -20, 300], fov: 62 }, ease: 'linear', shake: 0.002 },
    ],
    captions: [{ at: 0.2, dur: 1.7, who: 'psalm', kicker: 'CANTOR PSALM · ZENITH HEGEMONY', text: 'Be witnessed, Vanguard!', jp: '見届けよ。' }],
    events: [
      { at: 0.1, id: 'fire:bk' },
      { at: 2.3, id: 'sub:battery' },
      { at: 3.2, id: 'sub:spire' },
    ],
    fx: [pulse('flash', 2.3, 0.2, 0.02, 0.03, 0.3), pulse('flash', 3.2, 0.3, 0.02, 0.03, 0.4)],
    sound: [{ at: 0.1, radio: 'open' }, burst(0.1, 20, 0.09, 'cannon', 0.5), burst(1.9, 16, 1 / 12, 'laser', 0.5), { at: 2.3, sfx: 'explosionLarge', gain: 0.8 }, { at: 3.2, sfx: 'explosionLarge', gain: 1 }],
  },
  {
    // A Choir Measure hammers a dreadnought's fore facing until it goes.
    id: 'shield',
    set: 'battle',
    dur: 8 * B,
    cams: [{ at: 0, dur: 8 * B, rig: 'indomitable', units: 'm', from: { eye: [1150, 180, 1850], look: [0, 0, 900], fov: 50 }, to: { eye: [1080, 170, 1760], look: [0, 0, 900], fov: 48 }, ease: 'linear', shake: 0.0015 }],
    captions: [{ at: 2.25, dur: 0.8, kind: 'word', who: 'candle', text: 'SHIELDS DOWN!', jp: 'シールド消失' }],
    events: [
      { at: 0.05, id: 'fire:measure' },
      { at: 1.62, id: 'collapse' },
    ],
    fx: [pulse('flash', 1.62, 0.6, 0.02, 0.05, 0.5), pulse('invert', 1.64, 1, 0.01, 0.05, 0.02), pulse('hue', 1.62, 0.25, 0.03, 0.1, 0.4)],
    sound: [burst(0.05, 22, 0.13, 'laser', 0.45), { at: 1.62, sfx: 'shieldDown', gain: 1.2 }, { at: 1.8, sfx: 'hullHit', repeat: 6, every: 0.18, gain: 0.8 }],
  },
  {
    // Line of battle: the dreadnought's broadside answers, the great lance crosses it.
    id: 'lance',
    set: 'battle',
    dur: 8 * B,
    cams: [
      { at: 0, dur: 4 * B, rig: 'indomitable', units: 'm', from: { eye: [-900, 420, -1500], look: [1500, 0, 2000], fov: 46 }, to: { eye: [-860, 400, -1380], look: [1500, 0, 2000], fov: 46 }, ease: 'linear' },
      { at: 4 * B, dur: 4 * B, rig: 'cathedral', units: 'm', from: { eye: [-2600, 900, 3200], look: [0, 0, 400], fov: 44 }, to: { eye: [-2500, 860, 3050], look: [0, 0, 400], fov: 44 }, ease: 'linear', shake: 0.003 },
    ],
    captions: [{ at: 0.1, dur: 1.4, who: 'candle', kicker: 'CANDLE · VANGUARD 3', text: 'All batteries — fire!' }],
    events: [
      { at: 0.2, id: 'broadside' },
      { at: 1.6, id: 'great-lance' },
      { at: 2.4, id: 'detonate' },
    ],
    fx: [pulse('flash', 1.6, 0.2, 0.03, 0.05, 0.4), pulse('flash', 2.4, 0.3, 0.02, 0.05, 0.35)],
    sound: [{ at: 0.05, radio: 'open' }, { at: 0.2, sfx: 'beamHit', gain: 0.8 }, burst(0.2, 12, 0.1, 'cannon', 0.6), { at: 1.6, sfx: 'beamHit', gain: 1.0 }, { at: 2.4, sfx: 'explosionLarge', gain: 1.3 }, { at: 2.6, sfx: 'explosionLarge', gain: 0.9 }],
  },

  // ══ TRADE. ════════════════════════════════════════════════════════════
  // The title theme builds from here to the title card (bass and arp at ~bar 8, full at bar 16).
  card('trade-card', 'reach', 'TRADE.', '交易', '02', 'orange', [{ at: 0, mood: 'title', fade: 0.3, intensity: 0.6 }]),
  {
    // Castellan: a ringed giant, the Kestrel skimming the ring plane.
    id: 'giant',
    set: 'reach',
    dur: 4.6,
    cams: [
      { at: 0, dur: 2.3, rig: 'giant', from: { eye: [-18, 26, 150], look: [0, 0, 0], fov: 42 }, to: { eye: [-15, 24, 140], look: [0, 0, 0], fov: 42 }, ease: 'linear' },
      { at: 2.3, dur: 2.3, rig: 'kestrel', units: 'm', from: { eye: [9, 3.5, -26], look: [-400, -40, 1500], fov: 54 }, to: { eye: [8, 3.2, -24], look: [-400, -40, 1500], fov: 55 }, ease: 'linear' },
    ],
    captions: [
      { at: 0.3, dur: 2.0, text: 'Twenty-two systems. Six Lanterns.', jp: '二十二の星系。六つのランタン。' },
      { at: 2.5, dur: 2.0, text: 'A Reach that keeps its own timetable.', jp: '時刻表どおりに生きる宙域。' },
    ],
    fx: [speed(2.3, 4.6, 0.3)],
    sound: [{ at: 2.3, sfx: 'cruiseDisengage', gain: 0.6 }],
  },
  {
    // A lane into the Lantern: haulers in a line, one goes through the throat.
    id: 'lane',
    set: 'reach',
    dur: 3.8,
    cams: [{ at: 0, dur: 3.8, rig: 'lantern', units: 'm', from: { eye: [1500, 260, 1500], look: [0, 0, 380], fov: 46 }, to: { eye: [1420, 245, 1380], look: [0, 0, 360], fov: 46 }, ease: 'linear' }],
    captions: [{ at: 0.25, dur: 3.3, text: 'Haul Ebon-gas down the lanes…', jp: 'エボンガスを運び…' }],
    events: [{ at: 2.35, id: 'jump' }],
    fx: [pulse('flash', 2.35, 0.3, 0.02, 0.04, 0.5)],
    sound: [{ at: 2.2, sfx: 'jumpEntry', gain: 0.6 }, { at: 2.35, sfx: 'jumpExit', gain: 0.8 }],
  },
  {
    id: 'liner',
    set: 'reach',
    dur: 3.0,
    cams: [{ at: 0, dur: 3.0, rig: 'liner', units: 'm', from: { eye: [70, 34, -200], look: [0, 0, 150], fov: 52 }, to: { eye: [62, 30, -110], look: [0, 0, 170], fov: 52 }, ease: 'linear' }],
    captions: [{ at: 0.2, dur: 2.7, text: '…fly escort, take contracts, trade.', jp: '護衛し、契約し、交易する。' }],
    sound: [{ at: 0.6, sfx: 'afterburnerIgnite', gain: 0.4 }],
  },
  {
    // Down the corridor and through the atmosphere curtain into a hollow bay.
    id: 'dock',
    set: 'reach',
    dur: 4.4,
    cams: [
      { at: 0, dur: 1.3, rig: 'bay', units: 'm', from: { eye: [-80, 34, 560], look: [0, -10, 0], fov: 46 }, to: { eye: [-76, 32, 530], look: [0, -10, 0], fov: 46 }, ease: 'linear' },
      { at: 1.3, dur: 1.1, rig: 'kestrel', units: 'm', from: { eye: [-9, 4.5, -26], look: [0, -3, 300], fov: 50 }, to: { eye: [-8, 4, -23], look: [0, -3, 300], fov: 50 }, ease: 'linear' },
      { at: 2.4, dur: 2.0, rig: 'bay', units: 'm', from: { eye: [52, -30, -114], look: [0, -6, 150], fov: 62 }, to: { eye: [50, -29, -112], look: [0, -6, 150], fov: 62 }, ease: 'linear' },
    ],
    captions: [{ at: 0.25, dur: 2.5, who: 'control', kicker: 'CASTELLAN CONTROL', text: 'Vanguard, cleared to berth twelve.', jp: '第十二バース、着艦を許可。' }],
    sound: [{ at: 0.1, radio: 'open' }, { at: 2.9, radio: 'close' }],
  },
  {
    id: 'market',
    set: 'reach',
    dur: 3.4,
    cams: [hold(0, 3.4, [50, -29, -112], [0, -6, 150], 62)].map((m) => ({ ...m, rig: 'bay', units: 'm' as const })),
    captions: [{ at: 0.4, dur: 2.9, text: 'Buy where it’s cheap. Sell where it’s scarce.', jp: '安く買い、足りない所で売れ。' }],
    sound: [{ at: 0.05, sfx: 'lockConfirm', gain: 0.4 }],
  },
  {
    id: 'concourse',
    set: 'reach',
    dur: 4.6,
    cams: [hold(0, 4.6, [50, -29, -112], [0, -6, 150], 62)].map((m) => ({ ...m, rig: 'bay', units: 'm' as const })),
    captions: [{ at: 3.2, dur: 1.35, kind: 'label', who: '', kicker: 'CONCOURSE', text: 'Fourteen people.', jp: 'EVERY ONE OF THEM REMEMBERS YOU' }],
  },

  // ══ RISE. ═════════════════════════════════════════════════════════════
  card('rise-card', 'lineup', 'RISE.', '昇れ', '03', 'magenta', [{ at: 0, mood: 'title', intensity: 0.85 }]),
  {
    id: 'shipyard',
    set: 'lineup',
    dur: 4.0,
    cams: [{ at: 0, dur: 4.0, rig: 'row', from: { eye: [0.9, 0.35, 1.9], look: [0.3, 0.05, 0], fov: 40 }, to: { eye: [0.8, 0.33, 1.8], look: [0.3, 0.05, 0], fov: 40 }, ease: 'linear' }],
    captions: [{ at: 0.3, dur: 3.5, text: 'Earn your shares. Buy the next hull.', jp: '稼いで、次の艦を買え。' }],
  },
  {
    // The ladder at true scale: Kestrel → Gauntlet → Bulwark → Resolute → Valiant.
    id: 'lineup',
    set: 'lineup',
    dur: 7.0,
    cams: [
      { at: 0, dur: 1.3, rig: 'row', units: 'm', from: { eye: [-14, 6, 34], look: [0, 0, 0], fov: 40 }, to: { eye: [-12, 5.5, 31], look: [0, 0, 0], fov: 40 }, ease: 'linear' },
      { at: 1.3, dur: 1.4, rig: 'row', units: 'm', from: { eye: [20, 20, 120], look: [55, 0, 0], fov: 40 }, to: { eye: [26, 18, 110], look: [55, 0, 0], fov: 40 }, ease: 'linear' },
      { at: 2.7, dur: 1.5, rig: 'row', units: 'm', from: { eye: [110, 60, 380], look: [190, 10, 0], fov: 40 }, to: { eye: [124, 56, 360], look: [190, 10, 0], fov: 40 }, ease: 'linear' },
      { at: 4.2, dur: 2.8, rig: 'row', units: 'm', from: { eye: [40, 120, 600], look: [240, 20, 0], fov: 46 }, to: { eye: [70, 100, 500], look: [250, 20, 0], fov: 46 }, ease: 'inOut' },
    ],
    captions: [
      { at: 0.05, dur: 1.2, kind: 'label', who: '', kicker: 'T1 · 17 M', text: 'VF-27 KESTREL', jp: 'BORROWED' },
      { at: 1.35, dur: 1.3, kind: 'label', who: '', kicker: 'T3 · 28 M  ·  T4 · 56 M', text: 'GAUNTLET · BULWARK', jp: '58,000 SH · 125,000 SH' },
      { at: 2.75, dur: 1.4, kind: 'label', who: '', kicker: 'T5 · 177 M · CREW 20', text: 'CR-5 RESOLUTE', jp: '240,000 SH' },
      { at: 4.3, dur: 2.6, kind: 'label', who: '', kicker: 'T6 · 380 M · FLOWN FROM THE BRIDGE', text: 'FFL-3 VALIANT', jp: 'YOUR OWN FRIGATE' },
      { at: 4.35, dur: 2.5, text: 'From a borrowed Kestrel to your own frigate.', jp: '借り物のケストレルから、自分のフリゲートへ。' },
    ],
    sound: [{ at: 1.3, radio: 'click' }, { at: 2.7, radio: 'click' }, { at: 4.2, radio: 'click' }],
  },
  {
    // The frigate's broadside: every turret trains and fires on a Choir Canticle.
    id: 'broadside',
    set: 'broadside',
    dur: 4.6,
    cams: [
      { at: 0, dur: 2.3, rig: 'valiant', units: 'm', from: { eye: [-120, 60, -330], look: [700, -40, 500], fov: 46 }, to: { eye: [-110, 55, -300], look: [700, -40, 500], fov: 46 }, ease: 'linear' },
      { at: 2.3, dur: 2.3, rig: 'canticle', units: 'm', from: { eye: [-520, 220, -640], look: [0, 0, 60], fov: 44 }, to: { eye: [-480, 205, -600], look: [0, 0, 60], fov: 44 }, ease: 'linear', shake: 0.0025 },
    ],
    captions: [{ at: 0.2, dur: 1.9, who: 'kade', kicker: 'KADE · VANGUARD LEAD', text: 'Broadside. Everything you have.', jp: '全砲門、斉射！' }],
    events: [
      { at: 0.3, id: 'broadside' },
      { at: 1.6, id: 'broadside' },
      { at: 2.6, id: 'broadside' },
      { at: 3.4, id: 'hits' },
    ],
    fx: [pulse('flash', 3.4, 0.35, 0.02, 0.05, 0.4)],
    sound: [{ at: 0.1, radio: 'open' }, burst(0.3, 6, 0.08, 'cannon', 0.8), { at: 0.3, sfx: 'beamHit', gain: 0.7 }, burst(1.6, 6, 0.08, 'cannon', 0.8), burst(2.6, 6, 0.08, 'cannon', 0.8), { at: 3.4, sfx: 'explosionLarge', gain: 1.2 }, { at: 3.7, sfx: 'explosionLarge', gain: 0.8 }],
  },

  // ══ TITLE ═════════════════════════════════════════════════════════════
  {
    id: 'title',
    set: 'lantern',
    dur: 6.5,
    cams: [{ at: 0, dur: 6.5, from: { eye: [0.35, -0.2, 10.5], look: [0, 0.25, 0], fov: 34 }, to: { eye: [0.3, -0.16, 9.6], look: [0, 0.25, 0], fov: 34 }, ease: 'linear' }],
    captions: [
      { at: 0.35, dur: 6.15, kind: 'title', text: 'PROJECT\nVANGUARD', kicker: 'THE LONG DARK', jp: '長い闇' },
      { at: 2.2, dur: 4.1, text: 'The squadron that goes through first.', jp: '最初に抜ける部隊。' },
    ],
    fx: [pulse('flash', 0.35, 0.45, 0.02, 0.04, 0.5), ramp('fade', 6.0, 6.5, 0, 0.7)],
    music: [{ at: 0, mood: 'title', fade: 0.3, intensity: 0.9 }],
    sound: [{ at: 0.35, stinger: 'victory' }],
  },
  {
    id: 'slate',
    set: 'lantern',
    dur: 4.5,
    cams: [{ at: 0, dur: 4.5, from: { eye: [0.3, -0.16, 9.6], look: [0, 0.25, 0], fov: 34 }, to: { eye: [0.28, -0.15, 9.3], look: [0, 0.25, 0], fov: 34 }, ease: 'linear' }],
    captions: [{ at: 0, dur: 4.5, kind: 'slate', text: 'PLAY IN\nYOUR BROWSER', kicker: 'PROJECT VANGUARD: THE LONG DARK', jp: 'WEBGPU · NO INSTALL · CHROME · EDGE · SAFARI · FIREFOX' }],
    fx: [ramp('fade', 0, 0.2, 0.7, 0.55), ramp('fade', 3.6, 4.5, 0.55, 1)],
    sound: [{ at: 0.05, sfx: 'lockConfirm', gain: 0.5 }],
  },
];
