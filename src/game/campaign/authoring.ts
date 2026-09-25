/**
 * PROJECT VANGUARD — the campaign, as data. 20 episodes in 4 chapters.
 * Story reference: docs/CAMPAIGN.md (outline) and docs/LORE.md (bible).
 *
 * ─── RUNTIME NOTES (for the CampaignRunner author) ────────────────────────
 * Predicates only use the CampaignContext API from ./types. On top of the
 * built-in set-piece flags (`${tag}-recovered`, `-scanned`, `-contact`,
 * `-reached`, `-complete`, `-exited`, `-destroyed`, and `bastion-attack`),
 * these missions rely on the following conventions:
 *
 *  1. SCRIPT CUES. Objectives with `hidden: true, optional: true` are script
 *     triggers, never shown in the HUD. When their predicate passes they set
 *     their `setsFlag`. Flags with these prefixes are commands:
 *       destroy:<tag>  cinematic destruction of the tagged ship(s); overrides
 *                      PLOT_ARMOUR (Episode 15: Jackpot).
 *       depart:<tag>   tagged ship(s) break off and jump / fly out, then are
 *                      removed. Not counted as kills.
 *       halt:<tag>     an 'escort' stops on its route; resume:<tag> continues.
 *  2. ESCORT ARRIVAL. When every surviving ship of an 'escort' group is within
 *     800 m of its `routeTo` target, set flag `${tag}-arrived`.
 *  3. BEACON DWELL. A 'beacon' set piece with `params.hold` (seconds) and
 *     optional `params.radius` (m, default 300) sets `${tag}-held` once the
 *     player has stayed inside the radius for `hold` seconds (show a ring).
 *     Beacons without `hold` are plain nav points / props.
 *  4. DEFERRED SET PIECES. A set piece with `params.whenFlag` appears only
 *     when that flag is set; its Placement is resolved at that moment.
 *  5. DEFERRED SPAWNS. When a SpawnSpec has both `whenFlag` and `delay`, the
 *     delay counts from the moment the flag is set.
 *  6. MULTI-SYSTEM (Episode 19). The mission keeps running across jumps;
 *     deferred spawns and set pieces resolve in the player's current system.
 *  7. ALLEGIANCE BY ROLE. `role` overrides faction alignment: 'hostile' on a
 *     'concord' ship is a renegade (Eps 14, 18); 'wing' on 'choir' or
 *     'rustwake' ships is an ally; 'static' ships of any faction are
 *     non-hostile unless the player damages them (Ep 3 Observance, Ep 17).
 *  8. kills(faction) counts every ship of that faction destroyed during the
 *     mission, by anyone. depart:/destroy: removals are not counted.
 *  9. PLOT_ARMOUR (runtimePolicy.ts) lists tags that must not die from damage:
 *     clamp their hull at ~0.15. (Objectives read hull() < 0.35-0.45 to fire
 *     withdrawal cues, so clamping below that keeps the story moving.)
 * 10. MONOLITH distances (the 20 km `-contact` and distanceTo) are measured
 *     from the sphere's surface, `params.radius`. MEGAGATE distances are to
 *     the centre of the throat.
 * 11. Offsets: metres in world axes (+Y up); player placement adds the initial position, not orientation.
 * 12. Chatter: `static: true` renders as a garbled intercept. Lines starting
 *     "(sung)" are the Choir's Hymn: italicise, add a music glyph if the font
 *     has one.
 * 13. Procedural system ids (seed 1994): 'zephacis', 'lysowick', 'corouhold'.
 *     If the generator changes, use SYSTEM_FALLBACK.
 */
import type {
  CampaignContext,
  CampaignObjective,
  ChatterBeat,
  ChatterLine,
  ChatterTrigger,
  Placement,
  SetPieceKind,
  SetPieceSpec,
  SpawnSpec,
} from './types';
import type { FactionId } from '@/assets/Blueprint';

// ── Blueprint ids (src/assets/blueprints) ───────────────────────────────

export const KESTREL = 'vf27-kestrel';
export const HARRIER = 'vf31-harrier';
export const LANTERN_GUARD = 'ffc-lantern-guard';
export const DAWN = 'cvs07-hesperus-dawn';
export const INDOMITABLE = 'bb-indomitable';
export const CANTOR = 'choir-cantor';
export const PSALTER = 'choir-psalter';
export const VESPER = 'choir-vesper';
export const CATHEDRAL = 'choir-cathedral';
export const SCRAPJACK = 'rw-scrapjack';

// ── Authoring helpers ───────────────────────────────────────────────────

type Pred = (c: CampaignContext) => boolean;

export const say = (who: string, text: string, delay?: number): ChatterLine => (delay === undefined ? { who, text } : { who, text, delay });
export const hiss = (who: string, text: string, delay?: number): ChatterLine => ({ ...say(who, text, delay), static: true });
export const beat = (id: string, trigger: ChatterTrigger, lines: ChatterLine[], priority?: number): ChatterBeat =>
  priority === undefined ? { id, trigger, lines } : { id, trigger, lines, priority };

export const START: ChatterTrigger = { on: 'start' };
export const SUCCESS: ChatterTrigger = { on: 'success' };
export const FAILURE: ChatterTrigger = { on: 'failure' };
export const HULL_LOW: ChatterTrigger = { on: 'hull-low' };
export const at = (t: number): ChatterTrigger => ({ on: 'time', at: t });
export const onFlag = (flag: string): ChatterTrigger => ({ on: 'flag', flag });
export const onDone = (objective: string): ChatterTrigger => ({ on: 'objective-done', objective });
export const onActive = (objective: string): ChatterTrigger => ({ on: 'objective-active', objective });
export const near = (tag: string, distance: number): ChatterTrigger => ({ on: 'near', tag, distance });
export const killsOf = (faction: FactionId, count: number): ChatterTrigger => ({ on: 'kills', faction, count });

export const ahead = (x: number, y: number, z: number): Placement => ({ at: 'player', offset: [x, y, z] });
export const by = (tag: string, x: number, y: number, z: number): Placement => ({ at: 'tag', tag, offset: [x, y, z] });

export const obj = (id: string, text: string, done: Pred, extra: Partial<CampaignObjective> = {}): CampaignObjective => ({ id, text, done, ...extra });
/** A hidden script cue: sets `flag` when `when` passes. */
export const cue = (id: string, flag: string, when: Pred): CampaignObjective => ({ id, text: `[cue] ${flag}`, hidden: true, optional: true, done: when, setsFlag: flag });

export const piece = (kind: SetPieceKind, tag: string, place: Placement, params?: Record<string, number | string | boolean>): SetPieceSpec =>
  params ? { kind, tag, place, params } : { kind, tag, place };

type SquadId = 'kade' | 'jackpot' | 'candle' | 'sparrow' | 'salt';
export const SQUAD: Record<SquadId, { name: string; blueprint: string; slot: [number, number, number] }> = {
  kade: { name: 'Vanguard 2 · Abbess', blueprint: KESTREL, slot: [-45, 8, -55] },
  jackpot: { name: 'Vanguard 3 · Jackpot', blueprint: KESTREL, slot: [45, 8, -55] },
  candle: { name: 'Vanguard 4 · Candle', blueprint: HARRIER, slot: [-95, -6, -110] },
  sparrow: { name: 'Vanguard 5 · Sparrow', blueprint: KESTREL, slot: [95, -6, -110] },
  salt: { name: 'Vanguard 6 · Salt', blueprint: HARRIER, slot: [0, 20, -150] },
};
export const squad = (...who: SquadId[]): SpawnSpec[] =>
  who.map((id) => ({ blueprint: SQUAD[id].blueprint, faction: 'concord', count: 1, place: ahead(...SQUAD[id].slot), tag: id, name: SQUAD[id].name, role: 'wing' }));

export const spawn = (blueprint: string, faction: FactionId, count: number, place: Placement, tag: string, name: string, role: SpawnSpec['role'], extra: Partial<SpawnSpec> = {}): SpawnSpec => ({
  blueprint,
  faction,
  count,
  place,
  tag,
  name,
  role,
  ...extra,
});

/** Psalm withdraws (depart) when hurt or when her Measure is broken. */
export const psalmWithdraws = (id: string, killsNeeded: number): CampaignObjective =>
  cue(id, 'depart:psalm', (c) => c.alive('psalm') && (c.hull('psalm') < 0.45 || c.kills('choir') >= killsNeeded));

export const briefing = (...paras: string[]): string => paras.join('\n\n');

