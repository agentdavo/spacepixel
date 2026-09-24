/**
 * The soundtrack catalog: which score plays where. Pure data + functions (no
 * Web Audio), so the resolver is unit-tested in node (tests/score.test.ts).
 *
 * A **score** is a studio palette plus an arrangement style: the instruments
 * each part is played on, key/tempo/swing, and score-specific parts layered
 * over the mood sequencer (src/audio/Music.ts). A **variant** is a stable
 * per-place / per-episode number that shifts the key, nudges the tempo and
 * reseeds the melody generator, so every star system and every episode has
 * its own tunes inside its score's sound.
 *
 * Resolution order: the player's pinned soundtrack → the campaign episode →
 * a special system (Dead Zone, the Anchor, the Nexus, Null Lantern) → the
 * system's faction → the original score.
 */
export type ScoreId = 'classic' | 'concord' | 'choir' | 'rustwake' | 'contested' | 'deadzone' | 'monolith' | 'nexus';

export const SCORE_IDS: readonly ScoreId[] = ['classic', 'concord', 'choir', 'rustwake', 'contested', 'deadzone', 'monolith', 'nexus'];

export interface ScoreInfo {
  title: string;
  /** Title-card flavour line (the soundtrack CD's Japanese subtitle). */
  jp: string;
  /** What it sounds like, for the settings toast / audio test scene. */
  blurb: string;
}

export const SCORE_INFO: Record<ScoreId, ScoreInfo> = {
  classic: { title: 'Original Score', jp: 'オリジナル・サウンドトラック', blurb: 'The first-pressing score: DX bells, JP-8 brass, gated drums.' },
  concord: { title: 'Castellan Fleet March', jp: '艦隊行進曲', blurb: 'Mecha-OVA heroics: string section, horns over JP-8 brass, synth lead, 909.' },
  choir: { title: 'Cathedral Liturgy', jp: '聖歌の空', blurb: 'Choir and strings, harp and glass pads, timpani and orchestra hits.' },
  rustwake: { title: 'Rustwake Nights', jp: '錆の街のブルース', blurb: 'City-pop noir: slap bass, DX e-piano, alto sax, LinnDrum, swing.' },
  contested: { title: 'Border Line', jp: '境界線', blurb: 'Cold-war synth: Solina strings, analog bass, Simmons toms, ORCH5 stabs.' },
  deadzone: { title: 'The Long Dark', jp: '長い闇', blurb: 'Near-silence: glass pads, flute, low string tremolo, a heartbeat.' },
  monolith: { title: 'The Anchor', jp: '錨', blurb: 'Vast and still: divisi strings, choir, celesta, suspended cymbal.' },
  nexus: { title: 'Symphony of Gates', jp: '門の交響曲', blurb: 'The finale orchestra: strings, horns, choir, timpani and the full synth rig.' },
};

/** The player's soundtrack setting: follow the game, or pin one score everywhere. */
export type SoundtrackSetting = 'auto' | ScoreId;
export const SOUNDTRACK_SETTINGS: readonly SoundtrackSetting[] = ['auto', ...SCORE_IDS];

export function isScoreId(v: unknown): v is ScoreId {
  return typeof v === 'string' && (SCORE_IDS as readonly string[]).includes(v);
}

/** One score per campaign episode (1..20): the story's arc across the four chapters. */
export const EPISODE_SCORES: Readonly<Record<number, ScoreId>> = {
  1: 'concord', // The Long Dark: Anchorage, the first sortie
  2: 'concord', // Fossil Fire
  3: 'choir', // Two Heavens: Tessaly, where the Cathedrals came through
  4: 'rustwake', // Black Light
  5: 'deadzone', // Whispers in the Static: Null Lantern
  6: 'contested', // Border Skirmish
  7: 'contested', // The Stolen Coordinates
  8: 'contested', // The Internal Rot
  9: 'deadzone', // The Ghost Ship
  10: 'concord', // The Fall of the Bastion
  11: 'deadzone', // Crossing the Dead Zone
  12: 'monolith', // Encounter with the Monolith
  13: 'monolith', // The Oracle Broadcast
  14: 'rustwake', // The Schism
  15: 'nexus', // The Siege of the Nexus
  16: 'choir', // The Solo Pilgrimage
  17: 'choir', // The Revelation of the Zenith
  18: 'concord', // The Key, Not the Sword
  19: 'nexus', // The Symphony of Gates
  20: 'nexus', // The Open Horizon
};

/** Hand-placed systems whose sound isn't their faction's. */
export const SYSTEM_SCORES: Readonly<Record<string, ScoreId>> = {
  deadzone: 'deadzone',
  null: 'deadzone',
  monolith: 'monolith',
  nexus: 'nexus',
};

export const FACTION_SCORES: Readonly<Record<string, ScoreId>> = {
  concord: 'concord',
  choir: 'choir',
  rustwake: 'rustwake',
  contested: 'contested',
  unknown: 'deadzone',
};

export interface ScoreContext {
  /** Star system id (generated or special). */
  system?: string | null;
  /** The system's faction ('concord' | 'choir' | 'rustwake' | 'contested' | 'unknown'). */
  faction?: string | null;
  /** Campaign episode 1..20 while a story mission runs. */
  episode?: number | null;
}

export interface ScorePick {
  id: ScoreId;
  /** Stable 0..2^31 number: key shift, tempo nudge and melody seeds. 0 = the score's home variant. */
  variant: number;
  reason: 'user' | 'episode' | 'system' | 'faction' | 'default';
}

/** FNV-1a, 31-bit (stable across runs and platforms). */
export function variantOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) & 0x7fffffff;
}

/** Which score plays for this context. `setting` is the player's soundtrack choice. */
export function scoreFor(ctx: ScoreContext, setting: SoundtrackSetting | string = 'auto'): ScorePick {
  const place = ctx.episode ? `ep${ctx.episode}` : ctx.system ? `sys:${ctx.system}` : '';
  const variant = place ? variantOf(place) : 0;
  if (isScoreId(setting)) return { id: setting, variant, reason: 'user' };
  if (ctx.episode && EPISODE_SCORES[ctx.episode]) return { id: EPISODE_SCORES[ctx.episode], variant, reason: 'episode' };
  if (ctx.system && SYSTEM_SCORES[ctx.system]) return { id: SYSTEM_SCORES[ctx.system], variant, reason: 'system' };
  if (ctx.faction && FACTION_SCORES[ctx.faction]) return { id: FACTION_SCORES[ctx.faction], variant, reason: 'faction' };
  return { id: 'classic', variant, reason: 'default' };
}

/**
 * What a variant does to a score: semitone shift (−2..+3), tempo factor
 * (0.96..1.04) and a melody seed. Variant 0 is the score's home arrangement.
 */
export function variantShape(variant: number): { transpose: number; tempo: number; seed: number } {
  if (!variant) return { transpose: 0, tempo: 1, seed: 0 };
  return {
    transpose: (variant % 6) - 2,
    tempo: 1 + ((((variant >>> 3) % 5) - 2) * 0.02),
    seed: (variant >>> 7) % 100003,
  };
}

/** "Castellan Fleet March · 艦隊行進曲" style label, for toasts. */
export function describeSoundtrack(setting: SoundtrackSetting, current?: ScoreId | null): string {
  if (setting === 'auto') return `SOUNDTRACK AUTO${current ? ` · ${SCORE_INFO[current].title.toUpperCase()}` : ''}`;
  return `SOUNDTRACK ${SCORE_INFO[setting].title.toUpperCase()} · ${SCORE_INFO[setting].jp}`;
}
