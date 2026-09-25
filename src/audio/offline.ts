import { PROLOGUE } from '@/cinema/prologue';
import { CONCOURSE_PERSON, TRAILER } from '@/cinema/trailer';
import { narrationCues } from '@/cinema/narration';
import { intensityAt, soundTimes, type Shot } from '@/cinema/timeline';
import { hashStr, personById } from '@/dialog/people';
import { GameAudio, SCORE_IDS, type AudioFrame, type AudioMissileEvent, type AudioShip, type AudioWeaponEvent, type Mood, type ScoreId } from './index';
import { clipFor, clipsSettled, fetchClip, loadClips } from './voice/Recorded';
import { BANTER, barkLine } from '@/dialog/barks';
import { CAST_VOICES, VoiceBox, npcVoice, planFor, registerVoice, type VoiceChannel } from './voice';
import type { RecordedAudioFrame } from '@/cinema/recording';

let capturedFrames: readonly RecordedAudioFrame[] | null = null;
// These sounds now come from matching simulation frames. Script-only cinematic
// explosions (kills, detonate, hits) retain their authored cues exactly once.
const capturedSounds = new Set(['laser', 'cannon', 'missileLaunch', 'missileHit', 'shieldDown', 'hullHit', 'beamHit']);

/** Every trailer line, including the greeting spoken by the actual dock UI. */
export async function auditTrailerVoices() {
  await loadClips();
  const person = personById(CONCOURSE_PERSON)!;
  registerVoice(person.id, npcVoice(hashStr(person.id), { ...person.voice, faction: person.faction }));
  const lines = narrationCues(TRAILER).map(c => ({ who: c.who, text: c.caption.text, channel: c.channel,
    at: c.at, maxDur: c.maxDur, captionEnd: c.at - (c.caption.kind === 'word' ? 0 : 0.08) + c.caption.dur }));
  let start = 0;
  for (const shot of TRAILER) {
    if (shot.id === 'concourse') {
      lines.push({ who: person.id, text: person.greeting, channel: 'clean', at: start + 0.12, maxDur: shot.dur - 0.3, captionEnd: start + shot.dur });
      break;
    }
    start += shot.dur;
  }
  return lines.sort((a, b) => a.at - b.at).map(line => {
    const clip = clipFor(line.who, line.text, planFor(line).profile);
    const rate = clip ? Math.max(1, Math.min(1.2, clip.dur / line.maxDur)) : 1;
    const end = line.at + (line.channel === 'radio' || line.channel === 'intercept' ? 0.08 : 0.02) + (clip?.dur ?? 0) / rate;
    return { ...line, clip, rate, end, fits: !!clip && end <= line.captionEnd + 0.025 };
  });
}

/**
 * Headless renders for scripts/audio-render.mjs. Each scenario runs the real
 * GameAudio façade on an OfflineAudioContext, calling `update()` from
 * suspend() callbacks every 1024 samples (~43 fps), exactly like the game's
 * frame loop — so what gets measured is the shipping code path.
 *
 * Not imported by the game; loaded by the render script through Vite.
 */
export interface RenderStats {
  name: string;
  seconds: number;
  sampleRate: number;
  /** Peak |x| before 16-bit quantisation. */
  peak: number;
  /** Samples with |x| ≥ 0.999. */
  clipped: number;
  maxVoices: number;
  /** 16-bit PCM WAV, base64. */
  wav: string;
}

interface Ev extends Pick<AudioWeaponEvent, 'type' | 'shielded' | 'strength' | 'sub' | 'turret'> {
  kind: AudioWeaponEvent['kind'];
  position: { x: number; y: number; z: number };
  ship: AudioShip | null;
  shooter: AudioShip | null;
}
interface MEv {
  kind: AudioMissileEvent['kind'];
  position: { x: number; y: number; z: number };
  target: AudioShip | null;
  shooter: AudioShip | null;
}

const PLAYER: AudioShip = { isPlayer: true, faction: 'concord', radius: 9 };
const CANTOR: AudioShip = { isPlayer: false, faction: 'choir', radius: 8 };
const RUST: AudioShip = { isPlayer: false, faction: 'rustwake', radius: 8 };
const WING: AudioShip = { isPlayer: false, faction: 'concord', radius: 9 };
const CATHEDRAL: AudioShip = { isPlayer: false, faction: 'choir', radius: 700 };

/** Mutable frame the scenarios poke at; events are pushed per frame and cleared. */
interface Sim {
  t: number;
  frame: AudioFrame & { player: AudioFrame['player'] & { velocity: { x: number; y: number; z: number } } };
  w: Ev[];
  m: MEv[];
  audio: GameAudio;
  voice: VoiceBox;
  /** Did something cross time `x` during this frame? */
  at(x: number): boolean;
  every(period: number, from?: number, to?: number): boolean;
  fire(kind: Ev['kind'], x: number, y: number, z: number, shooter: AudioShip | null, ship?: AudioShip | null, extra?: Partial<Ev>): void;
  missile(kind: MEv['kind'], x: number, y: number, z: number, shooter: AudioShip | null, target?: AudioShip | null): void;
}

interface Scenario {
  seconds: number;
  setup?(s: Sim): void;
  tick?(s: Sim): void;
}

const music = (mood: Mood, seconds: number, intensity: number, rampTo?: number): Scenario => ({
  seconds,
  setup: (s) => {
    s.audio.autoMood = false;
    s.audio.music.setMood(mood, 0.1);
    s.frame.combatIntensity = intensity;
  },
  tick: (s) => {
    if (rampTo !== undefined) s.frame.combatIntensity = intensity + (rampTo - intensity) * Math.min(1, s.t / seconds);
  },
});

/** A mood in a given score (and place variant). */
const scored = (id: ScoreId, mood: Mood, seconds: number, intensity: number, rampTo?: number, variant = 0): Scenario => {
  const base = music(mood, seconds, intensity, rampTo);
  return {
    ...base,
    setup: (s) => {
      s.audio.setScore(id, variant, 0.1);
      base.setup!(s);
    },
  };
};

/** Every score's cruise and combat (combat ramps 0.2 → 1 so each layer enters). */
const SCORE_SCENARIOS: Record<string, Scenario> = {};
for (const id of SCORE_IDS) {
  SCORE_SCENARIOS[`score-${id}-cruise`] = scored(id, 'cruise', 20, 0.1);
  SCORE_SCENARIOS[`score-${id}-combat`] = scored(id, 'combat', 16, 0.2, 1);
}

/**
 * A flight across the Reach: cruise in Concord space, jump to Rustwake, fight
 * in contested space, then the Dead Zone: each crossfade is a score switch.
 */
const tour = (): Scenario => ({
  seconds: 40,
  setup: (s) => {
    s.audio.autoMood = false;
    s.audio.setPlace('anchorage', 'concord', null, 0.1);
    s.audio.music.setMood('cruise', 0.1);
    s.frame.combatIntensity = 0.1;
  },
  tick: (s) => {
    if (s.at(10)) s.audio.setPlace('rustwake', 'rustwake');
    if (s.at(20)) {
      s.audio.setPlace('zephacis', 'contested');
      s.audio.music.setMood('combat', 2);
      s.frame.combatIntensity = 0.8;
    }
    if (s.at(30)) {
      s.audio.setPlace('deadzone', 'unknown');
      s.audio.music.setMood('dread', 3);
      s.frame.combatIntensity = 0.3;
    }
  },
});

/** The eight scores back to back, 7 s of each in battle (docs/audio/score-reel). */
const reel = (mood: Mood, each: number, intensity: number): Scenario => ({
  seconds: SCORE_IDS.length * each + 2,
  setup: (s) => {
    s.audio.autoMood = false;
    s.audio.setScore(SCORE_IDS[0], 0, 0.1);
    s.audio.music.setMood(mood, 0.1);
    s.frame.combatIntensity = intensity;
  },
  tick: (s) => {
    for (let k = 1; k < SCORE_IDS.length; k++) if (s.at(k * each)) s.audio.setScore(SCORE_IDS[k], 0, 0.8);
  },
});

/** A cutscene's soundtrack: the same music/sound cues the Cinema fires, on the same clock. */
const film = (shots: readonly Shot[], opts: { intensity?: boolean } = {}): Scenario => {
  const seconds = shots.reduce((a, sh) => a + sh.dur, 0) + 1.5;
  return {
    seconds,
    setup: (s) => {
      s.audio.autoMood = false;
      s.frame.player.alive = false;
      s.frame.player.throttle = 0;
    },
    tick: (s) => {
      let start = 0;
      for (const sh of shots) {
        for (const m of sh.music ?? []) if (s.at(start + m.at)) s.audio.music.setMood(m.mood, m.fade ?? 2);
        for (const c of sh.sound ?? []) {
          if (capturedFrames && shots === TRAILER && c.sfx && (capturedSounds.has(c.sfx) || (sh.id === 'capital' && c.sfx === 'explosionLarge'))) continue;
          for (const at of soundTimes(c)) {
            if (!s.at(start + at)) continue;
            if (c.sfx) s.audio.sfx.play(c.sfx, { gain: c.gain ?? 1 });
            if (c.stinger) s.audio.stinger(c.stinger);
            if (c.radio) s.audio.radio(c.radio);
          }
        }
        start += sh.dur;
      }
      if (opts.intensity) s.frame.combatIntensity = intensityAt(shots, s.t, 0.3);
    },
  };
};
const prologue = (): Scenario => film(PROLOGUE);

/**
 * The trailer's soundtrack (scripts/make-video.mjs muxes it under the
 * recorded frames): music moods + intensity, the authored SFX, every voiced
 * caption (narrator and radio) and the concourse greeting the dock tab
 * speaks when the trailer cuts to it.
 */
const trailer = (): Scenario => {
  const base = film(TRAILER, { intensity: true });
  const cues = narrationCues(TRAILER);
  let t = 0;
  for (const sh of TRAILER) {
    if (sh.id === 'concourse') break;
    t += sh.dur;
  }
  const concourseAt = t + 0.12;
  const person = personById(CONCOURSE_PERSON);
  return {
    ...base,
    setup: (s) => {
      base.setup!(s);
      if (person && !CAST_VOICES[person.id]) registerVoice(person.id, npcVoice(hashStr(person.id), { ...person.voice, faction: person.faction }));
    },
    tick: (s) => {
      base.tick!(s);
      for (const c of cues) if (s.at(c.at)) s.voice.speak({ who: c.who, text: c.caption.text, channel: c.channel, maxDur: c.maxDur, maxSqueeze: c.maxSqueeze });
      if (person && s.at(concourseAt)) s.voice.speak({ who: person.id, text: person.greeting, channel: 'clean' });
    },
  };
};

/** A run of voiced lines, each starting `gap` s after the previous one ends. */
type VLine = [who: string, text: string, channel?: VoiceChannel];
const voices = (lines: VLine[], gap = 0.6, setup?: (s: Sim) => void, extra?: (s: Sim) => void): Scenario => {
  let t = 0.3;
  const at: number[] = [];
  for (const [who, text] of lines) {
    at.push(t);
    t += planFor({ who, text }).plan.dur + gap;
  }
  return {
    seconds: t + 0.8,
    setup: (s) => {
      s.frame.player.alive = false;
      s.frame.player.throttle = 0;
      setup?.(s);
    },
    tick: (s) => {
      lines.forEach(([who, text, channel], i) => {
        if (s.at(at[i])) s.voice.speak({ who, text, channel: channel ?? 'radio' });
      });
      extra?.(s);
    },
  };
};

export const SCENARIOS: Record<string, Scenario> = {
  ...SCORE_SCENARIOS,
  'score-tour': tour(),
  'score-reel': reel('combat', 7, 0.85),
  'score-reel-cruise': reel('cruise', 9, 0.1),
  'voice-radio': voices([
    ['kade', 'Vanguard, form on me. Nobody breaks formation until I say the word.'],
    ['jackpot', 'Pool is open, people! Two shares says I splash the first Cantor.'],
    ['candle', 'First keeping: the seal holds. Second keeping: the feed runs clean.'],
    ['sparrow', 'Is that a Cathedral? Abbess, is that really a Cathedral?'],
    ['salt', 'Every gram on that barge is somebody\'s winter. Keep it moving.'],
    ['magpie', 'Triple for the Directorate, double for the Hegemony, and for you, love? A favour.'],
    ['psalm', 'Be witnessed, Vanguard. Break the Observance and I will break you.'],
    ['system', 'SERVICE WILL RESUME SHORTLY. THANK YOU FOR YOUR PATIENCE.'],
  ]),
  // Wing orders answered (keys 1–4, then 2 with no lock), then two quiet-leg exchanges.
  'voice-wing-chat': voices(
    [
      ...(['order-form', 'order-attack', 'order-free', 'order-cover', 'order-no-target'] as const).map((k, i) => {
        const who = ['kade', 'jackpot', 'sparrow', 'salt', 'candle'][i];
        return [who, barkLine(k, who, 0)] as VLine;
      }),
      ...BANTER[0].map(([w, t]) => [w, t] as VLine),
      ...BANTER[4].map(([w, t]) => [w, t] as VLine),
    ],
    0.5,
  ),
  'voice-cast': voices(
    [
      ['oyelaran', 'Tell her the lines go somewhere. Go where the light is. Keep the light.'],
      ['zenith', 'A cradle is a safe place to be a child. Forever, if need be.'],
      ['ledger', 'Engagement one-fourteen. Expected expenditure: eleven fighters.'],
      ['pryce', 'You think it is a key. It is a lever.'],
      ['psalm', '(sung) Out of the dust we were lifted. Out of the dark we were shown.'],
      ['oracle', 'WE ARE NOT GONE. WE ARE AHEAD.'],
    ].map(([w, t]) => [w, t, 'clean'] as VLine),
    0.7,
  ),
  'voice-intercept': voices([
    ['system', 'NULL BURST: 1,009 PULSES. DESTINATION FIELD EMPTY.', 'intercept'],
    ['quillon', 'The floor holds at eighty-eight. Nobody need know why.', 'intercept'],
  ]),
  'voice-narrator': voices(
    [
      ['narrator', 'Once, the stars were joined.', 'narrator'],
      ['narrator', 'Four hundred years ago, the gates sang.', 'narrator'],
      ['narrator', 'Then, in a single day, every Lantern went dark.', 'narrator'],
      ['narrator', 'Everything that flies is a fossil — kept running, never understood.', 'narrator'],
    ],
    0.8,
  ),
  // Radio over a dogfight: the voice must sit on top of guns + combat score.
  'voice-mix': voices(
    [
      ['kade', 'Point, you\'re hit. Break, break!'],
      ['jackpot', 'Splash! Write it down, write it down!'],
      ['sparrow', 'I\'m hit, I\'m hit — still flying!'],
    ],
    0.5,
    (s) => {
      s.audio.music.setMood('combat', 0.1);
      s.frame.combatIntensity = 0.85;
      s.frame.player.alive = true;
      s.frame.player.throttle = 0.8;
    },
    (s) => {
      if (s.t > 0.5 && s.t < 7 && s.every(1 / 12, 0.5, 1.6)) s.fire('fire', 0, 0, 0, PLAYER);
      if (s.every(0.13, 2.5, 3.6)) s.fire('fire', 150 * Math.sin(s.t), 20, -300, CANTOR);
      if (s.at(4.2)) s.fire('kill', 300, 40, -700, PLAYER, CANTOR);
    },
  ),

  prologue: prologue(),
  trailer: trailer(),
  // The trailer under Symphony of Gates instead of the Original Score (render it as trailer-ova+cast).
  'trailer-ova': (() => {
    const t = trailer();
    return { ...t, setup: (s) => (t.setup!(s), s.audio.setScore('nexus', 0, 0.1)) };
  })(),
  // The prologue soundtrack with its narration voice track (what the cold open sounds like now).
  'voice-prologue': (() => {
    const base = prologue();
    const cues = narrationCues(PROLOGUE);
    return {
      ...base,
      tick: (s: Sim) => {
        base.tick!(s);
        for (const c of cues) if (s.at(c.at)) s.voice.speak({ who: c.who, text: c.caption.text, channel: c.channel, maxDur: c.maxDur, maxSqueeze: c.maxSqueeze });
      },
    };
  })(),
  'music-title': music('title', 48, 0.5),
  'music-briefing': music('briefing', 20, 0.2),
  'music-cruise': music('cruise', 24, 0.1),
  'music-combat-low': music('combat', 14, 0.1),
  'music-combat': music('combat', 16, 0.9),
  'music-sublime': music('sublime', 30, 0.3),
  'music-dread': music('dread', 24, 0.5),
  'music-victory': music('victory', 10, 0),
  'music-defeat': music('defeat', 10, 0),
  'music-crossfade': {
    seconds: 16,
    setup: (s) => {
      s.audio.autoMood = true;
      s.audio.music.setMood('cruise', 0.1);
      s.frame.combatIntensity = 0;
    },
    tick: (s) => {
      if (s.at(4)) s.frame.combatIntensity = 0.85; // auto cruise → combat
      if (s.at(12)) s.audio.stinger('victory');
    },
  },

  'sfx-lasers': {
    seconds: 5,
    tick: (s) => {
      // Player guns (12/s) for 1 s, Zenith fire from the right, Rustwake from the left, then far away.
      if (s.t < 1 && s.every(1 / 12)) s.fire('fire', 0, 0, 0, PLAYER);
      if (s.t > 1.3 && s.t < 2.3 && s.every(1 / 10)) s.fire('fire', 80, 0, -60, CANTOR);
      if (s.t > 2.6 && s.t < 3.6 && s.every(1 / 10)) s.fire('fire', -120, 10, -40, RUST);
      if (s.t > 3.9 && s.t < 4.6 && s.every(1 / 10)) s.fire('fire', 1500, 0, -2000, CANTOR);
    },
  },
  // Hull hits hard right (0–1 s), hard left (1.5–2.5 s), dead ahead (3–4 s). Camera looks down −Z.
  'sfx-pan': {
    seconds: 4.5,
    setup: (s) => {
      s.frame.player.throttle = 0;
      s.frame.player.alive = false;
    },
    tick: (s) => {
      const t = s.t;
      if (t < 1 && s.every(0.2)) s.fire('hit', 60, 0, 30, PLAYER, CANTOR);
      if (t > 1.5 && t < 2.5 && s.every(0.2)) s.fire('hit', -60, 0, 30, PLAYER, CANTOR);
      if (t > 3 && t < 4 && s.every(0.2)) s.fire('hit', 0, 0, -30, PLAYER, CANTOR);
    },
  },
  'sfx-impacts': {
    seconds: 5,
    tick: (s) => {
      if (s.at(0.1) || s.at(0.35) || s.at(0.6)) s.fire('shield', 60, 0, -80, PLAYER, CANTOR);
      if (s.at(1.0) || s.at(1.25) || s.at(1.5)) s.fire('hit', -60, 0, -80, PLAYER, CANTOR);
      if (s.at(2.0) || s.at(2.4)) s.fire('shield', 0, 0, 20, CANTOR, PLAYER);
      if (s.at(2.9)) s.fire('hit', 0, 0, 20, CANTOR, PLAYER);
      if (s.t > 3.4 && s.t < 4.6) s.fire('beam-hit', 200, 50, -400, CATHEDRAL, WING);
    },
  },
  // Batch 6: hull hits by damage type, shield bleed / collapse / return, subsystems destroyed, a player turret shot.
  'sfx-batch6': {
    seconds: 8,
    tick: (s) => {
      if (s.at(0.1)) s.fire('hit', 0, 0, -60, PLAYER, CANTOR, { type: 'laser' });
      if (s.at(0.5)) s.fire('hit', 0, 0, -60, PLAYER, CANTOR, { type: 'kinetic' });
      if (s.at(0.9)) s.fire('hit', 0, 0, -60, PLAYER, CANTOR, { type: 'explosive' });
      if (s.at(1.3)) s.fire('shield', 40, 0, -60, PLAYER, CANTOR, { strength: 0.1 });
      if (s.at(1.6)) s.fire('shield-bleed', 40, 0, -60, PLAYER, CANTOR, { type: 'laser' });
      if (s.at(2.0)) s.fire('shield-down', 40, 0, -60, PLAYER, CANTOR);
      if (s.at(3.0)) s.fire('shield-up', 40, 0, -60, PLAYER, CANTOR);
      if (s.at(4.0)) s.fire('subsystem', -80, 0, -200, PLAYER, CATHEDRAL, { sub: { kind: 'turret' } });
      if (s.at(5.3)) s.fire('subsystem', 80, 0, -300, PLAYER, CATHEDRAL, { sub: { kind: 'hangar' } });
      if (s.at(6.8)) s.fire('beam-hit', 0, 0, -120, CATHEDRAL, PLAYER, { shielded: true });
      if (s.at(7.2)) s.fire('fire', 20, 10, -40, PLAYER, null, { turret: true });
    },
  },
  'sfx-explosions': {
    seconds: 8,
    tick: (s) => {
      if (s.at(0.1)) s.fire('kill', 40, 0, -80, PLAYER, CANTOR);
      if (s.at(1.2)) s.fire('kill', -300, 0, -600, WING, RUST);
      if (s.at(2.2)) s.missile('detonate', 120, 0, -200, PLAYER, CANTOR);
      if (s.at(3.0)) s.fire('kill', 900, 200, -2500, WING, CATHEDRAL);
      if (s.at(6.5)) s.fire('kill', 0, 0, 25, CANTOR, PLAYER);
    },
  },
  'sfx-missiles': {
    seconds: 5,
    tick: (s) => {
      for (let k = 0; k < 12; k++) if (s.at(0.1 + k * 0.045)) s.missile('launch', 0, -1, 0, PLAYER, CANTOR);
      for (let k = 0; k < 12; k++) if (s.at(2.2 + k * 0.03)) s.missile('detonate', 300 + k * 5, 0, -900, PLAYER, CANTOR);
      if (s.at(3.4)) for (let k = 0; k < 6; k++) s.missile('launch', 400, 0, -300, CANTOR, PLAYER);
    },
  },
  'sfx-engine': {
    seconds: 9,
    setup: (s) => {
      s.frame.player.throttle = 0;
    },
    tick: (s) => {
      const p = s.frame.player;
      const t = s.t;
      p.throttle = Math.min(1, t / 3);
      p.boosting = t > 4 && t < 6.5;
      const speed = p.boosting ? Math.min(460, 220 + (t - 4) * 150) : Math.min(220, t * 70);
      p.velocity.z = speed;
    },
  },
  'sfx-cruise': {
    seconds: 7,
    tick: (s) => {
      const p = s.frame.player;
      const t = s.t;
      p.throttle = 0.7;
      p.cruise = t < 0.5 ? 'off' : t < 1.9 ? 'spool' : t < 5 ? 'on' : 'off';
      p.velocity.z = p.cruise === 'on' ? Math.min(3000, 160 + (t - 1.9) * 650) : t >= 5 ? Math.max(160, 3000 - (t - 5) * 3000) : 160;
    },
  },
  'sfx-jump': {
    seconds: 7,
    setup: (s) => {
      s.audio.music.setMood('cruise', 0.1);
    },
    tick: (s) => {
      const t = s.t;
      s.frame.jumpPhase = t < 0.5 ? 'none' : t < 1.4 ? 'spool' : t < 4.0 ? 'tunnel' : t < 4.9 ? 'exit' : 'none';
      s.frame.player.velocity.z = 220;
    },
  },
  'sfx-lock': {
    seconds: 6,
    tick: (s) => {
      const p = s.frame.player;
      const t = s.t;
      p.lockProgress = t < 0.3 ? 0 : Math.min(1, (t - 0.3) / 1.1);
      p.locked = t >= 1.4 && t < 3;
      if (t >= 3) p.lockProgress = 0;
      p.incomingMissile = t > 3.5 && t < 5.5;
    },
  },
  'sfx-ui-radio': {
    seconds: 5,
    tick: (s) => {
      const a = s.audio;
      if (s.at(0.1) || s.at(0.3) || s.at(0.5)) a.ui('move');
      if (s.at(0.8)) a.ui('confirm');
      if (s.at(1.2)) a.ui('back');
      if (s.at(1.6)) a.ui('error');
      if (s.t > 2 && s.t < 2.6 && s.every(0.05)) a.ui('tick');
      if (s.at(2.8)) a.ui('open');
      if (s.at(3.2)) a.radio('open');
      if (s.at(3.8)) a.radio('static');
      if (s.at(4.4)) a.radio('close');
    },
  },
  // Full mix: combat score under a dogfight, radio call, capital kill. Checks SFX sit on top.
  'mix-combat': {
    seconds: 12,
    setup: (s) => {
      s.audio.music.setMood('combat', 0.1);
      s.frame.combatIntensity = 0.8;
      s.frame.player.throttle = 0.8;
      s.frame.player.velocity.z = 200;
    },
    tick: (s) => {
      const t = s.t;
      if (t > 2 && t < 3.5 && s.every(1 / 12)) s.fire('fire', 0, 0, 0, PLAYER);
      if (t > 2.5 && t < 4 && s.every(0.1)) s.fire('fire', 150 * Math.sin(t), 20, -300, CANTOR);
      if (s.at(3.2) || s.at(3.4)) s.fire('shield', 0, 0, -300, PLAYER, CANTOR);
      if (s.at(3.6)) s.fire('kill', 0, 0, -300, PLAYER, CANTOR);
      if (s.at(5)) s.audio.radio('open');
      if (s.at(7)) s.audio.radio('close');
      if (s.at(8)) s.fire('kill', 600, 100, -1800, WING, CATHEDRAL);
      s.frame.player.lockProgress = t > 9 ? Math.min(1, (t - 9) / 1.1) : 0;
      s.frame.player.locked = t > 10.1;
    },
  },
  // Stress: 120 remote shots + 30 kills + 40 hits per frame for 3 s.
  stress: {
    seconds: 4,
    setup: (s) => {
      s.audio.music.setMood('combat', 0.1);
      s.frame.combatIntensity = 1;
    },
    tick: (s) => {
      if (s.t > 3) return;
      for (let k = 0; k < 120; k++) s.fire('fire', (k % 11) * 40 - 200, 0, -100 - k * 3, k % 2 ? CANTOR : RUST);
      for (let k = 0; k < 40; k++) s.fire(k % 2 ? 'hit' : 'shield', k * 10 - 200, 0, -150, PLAYER, CANTOR);
      for (let k = 0; k < 30; k++) s.fire('kill', k * 30 - 450, 0, -200 - k * 20, PLAYER, k % 5 ? CANTOR : CATHEDRAL);
      for (let k = 0; k < 12; k++) s.missile('detonate', k * 20, 0, -300, PLAYER, CANTOR);
    },
  },
};

export async function renderScenario(name: string, sampleRate = 44100, frames: RecordedAudioFrame[] | null = null): Promise<RenderStats> {
  capturedFrames = frames;
  // "<scenario>+cast": the same scenario with the recorded voices.
  const cast = name.endsWith('+cast');
  const sc = SCENARIOS[cast ? name.slice(0, -5) : name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const seconds = sc.seconds;
  const length = Math.ceil(seconds * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const audio = new GameAudio({ context: ctx });
  audio.autoMood = false;
  const voice = new VoiceBox(audio);
  voice.modeOverride = cast ? 'cast' : 'synth';
  if (cast) await loadClips();
  if (cast && name.startsWith('trailer')) {
    const audit = await auditTrailerVoices();
    if (audit.some(line => !line.fits)) throw new Error(`Trailer voice coverage/fit failed: ${JSON.stringify(audit.filter(line => !line.fits))}`);
    for (const line of audit) if (!await fetchClip(ctx, line.clip!.key)) throw new Error(`Cannot decode trailer voice: ${line.text}`);
  }
  if (name.startsWith('trailer')) {
    // Keep the synthetic recorded cast forward; duck effects as well as music.
    const speak = voice.speak.bind(voice);
    voice.speak = (req) => {
      const utterance = speak({ ...req, level: 1.15, maxSqueeze: 1.2 });
      audio.engine.duckMusic(-9, utterance.dur + 0.15, 0.45);
      const gain = audio.engine.sfx!.gain;
      const now = ctx.currentTime;
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(0.45, now, 0.025);
      gain.setTargetAtTime(1, now + utterance.dur + 0.1, 0.12);
      return utterance;
    };
  }
  const zero = { x: 0, y: 0, z: 0 };
  const sim: Sim = {
    t: 0,
    audio,
    voice,
    w: [],
    m: [],
    frame: {
      dt: 1024 / sampleRate,
      eye: { x: 0, y: 0, z: 30 },
      camera: { x: 0, y: 0, z: 0, w: 1 },
      player: { position: zero, velocity: { x: 0, y: 0, z: 150 }, throttle: 0.6, boosting: false, cruise: 'off', lockProgress: 0, locked: false, incomingMissile: false },
      weaponEvents: [],
      missileEvents: [],
      jumpPhase: 'none',
      combatIntensity: 0,
    },
    at(x) {
      return x >= this.t && x < this.t + this.frame.dt;
    },
    every(period, from = 0, to = Infinity) {
      if (this.t < from || this.t > to) return false;
      const a = Math.floor((this.t - from) / period);
      const b = Math.floor((this.t + this.frame.dt - from) / period);
      return b > a || this.t === from;
    },
    fire(kind, x, y, z, shooter, ship = null, extra) {
      this.w.push({ ...extra, kind, position: { x, y, z }, ship, shooter });
    },
    missile(kind, x, y, z, shooter, target = null) {
      this.m.push({ kind, position: { x, y, z }, target, shooter });
    },
  };
  sim.frame.weaponEvents = sim.w;
  sim.frame.missileEvents = sim.m;
  sc.setup?.(sim);
  let maxVoices = 0;
  let frameCursor = 0;
  const step = (): void => {
    sim.w.length = 0;
    sim.m.length = 0;
    sc.tick?.(sim);
    if (frames) {
      while (frameCursor < frames.length && frames[frameCursor].at < sim.t + sim.frame.dt) {
        const f = frames[frameCursor++];
        sim.frame.eye = f.eye;
        sim.frame.camera = f.camera;
        sim.frame.beams = f.beams ?? [];
        sim.w.push(...f.weaponEvents);
        sim.m.push(...f.missileEvents);
      }
    }
    audio.update(sim.frame);
    maxVoices = Math.max(maxVoices, audio.engine.activeVoices());
  };
  step();
  const frameLen = 1024;
  for (let k = 1; k * frameLen < length; k++) {
    const when = (k * frameLen) / sampleRate;
    ctx.suspend(when).then(() => {
      sim.t = when;
      step();
      // Recorded lines fetch their clip on first use: hold the render until it lands.
      if (cast) void clipsSettled().then(() => ctx.resume());
      else ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  audio.music.dispose();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]);
    const b = Math.abs(R[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
    if (a >= 0.999) clipped++;
    if (b >= 0.999) clipped++;
  }
  return { name, seconds, sampleRate, peak, clipped, maxVoices, wav: wavBase64(L, R, sampleRate) };
}

/** V3 edit stems: events come only from the selected gameplay frames. */
export async function renderCapturedStem(
  frames: (RecordedAudioFrame & Partial<AudioFrame>)[], seconds: number,
  stem: 'music' | 'sfx', cues: { at: number; mood: Mood; intensity: number; fade?: number }[],
): Promise<RenderStats> {
  const sampleRate = 48000;
  const length = Math.ceil(seconds * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const audio = new GameAudio({ context: ctx });
  audio.autoMood = false;
  audio.setScore('nexus', 0, 0);
  audio.setVolume('music', stem === 'music' ? 1 : 0);
  audio.setVolume('sfx', stem === 'sfx' ? 1 : 0);
  let frameCursor = 0, cueCursor = 0, maxVoices = 0;
  let intensity = 0.3;
  const frame: AudioFrame = {
    dt: 1024/sampleRate, eye: { x: 0, y: 0, z: 0 },
    player: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, throttle: 0, boosting: false, cruise: 'off', lockProgress: 0, locked: false, incomingMissile: false },
    weaponEvents: [], missileEvents: [], jumpPhase: 'none', combatIntensity: 0,
  };
  const step = () => {
    const t = ctx.currentTime;
    while (cueCursor < cues.length && cues[cueCursor].at <= t) {
      const cue = cues[cueCursor++];
      intensity = cue.intensity;
      if (stem === 'music') audio.music.setMood(cue.mood, cue.fade ?? 3);
    }
    const weapons: AudioWeaponEvent[] = [], missiles: AudioMissileEvent[] = [];
    while (frameCursor < frames.length && frames[frameCursor].at < t + frame.dt) {
      const f = frames[frameCursor++];
      frame.eye = f.eye; frame.camera = f.camera;
      frame.beams = stem === 'sfx' ? f.beams ?? [] : [];
      if (f.player) frame.player = f.player;
      frame.jumpPhase = f.jumpPhase ?? 'none';
      frame.combatIntensity = f.combatIntensity ?? 0;
      if (stem === 'sfx') { weapons.push(...f.weaponEvents); missiles.push(...f.missileEvents); }
    }
    frame.weaponEvents = weapons; frame.missileEvents = missiles;
    if (stem === 'music') frame.combatIntensity = intensity;
    audio.update(frame);
    maxVoices = Math.max(maxVoices, audio.engine.activeVoices());
  };
  step();
  for (let k = 1; k*1024 < length; k++) {
    void ctx.suspend(k*1024/sampleRate).then(() => { step(); void ctx.resume(); });
  }
  const buffer = await ctx.startRendering();
  audio.music.dispose();
  const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
  let peak = 0, clipped = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (Math.abs(L[i]) >= 0.999) clipped++;
    if (Math.abs(R[i]) >= 0.999) clipped++;
  }
  return { name: `v3-${stem}`, seconds, sampleRate, peak, clipped, maxVoices, wav: wavBase64(L,R,sampleRate) };
}

function wavBase64(L: Float32Array, R: Float32Array, sr: number): string {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    o += 4;
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}
