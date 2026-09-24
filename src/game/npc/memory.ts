/**
 * Nemesis-lite memory: people and rivals bring up specific things you did,
 * read back out of the world log (src/game/world/WorldState.ts).
 *
 *   recall(w, { about, kinds, seed })  → the most relevant remembered event,
 *                                         phrased as a sentence ("You were at
 *                                         Halaedon when the Kittiwake burned.")
 *   memoryLine(w, about, seed)          → the same, with a fallback line, for
 *                                         `{memory}` in dialog and radio
 *
 * Relevance: events that name the speaker (data.rival / data.npc, or scope
 * npc:<id>) outrank the rest; then kinds the speaker cares about; then
 * recency. Ties break on a seed so a speaker doesn't repeat themselves.
 *
 * Event kinds this knows how to say (written by src/game/npc/live.ts and the
 * rival director; others are ignored rather than garbled):
 *
 *   ambush.broken   { sys, victim, band }          you broke a lane ambush
 *   ambush.lost     { sys, victim, band }          a hauler burned near you
 *   contract.done   { kind, sys, title, freighter?, mark?, dest? }
 *   contract.failed { kind, sys, title, freighter?, mark? }
 *   rival.met / rival.beaten / rival.killed / rival.won / rival.wing-down
 *                   { rival, name, sys, wingman? }
 *   npc.arc         { arc, step, outcome? }        (only endings are told)
 *
 * Pure: tests/rivals.test.ts checks the phrasing.
 */
import type { WorldEvent, WorldState } from '../world/WorldState.ts';

type Data = NonNullable<WorldEvent['data']>;
type Tpl = (d: Data) => string | null;

const s = (d: Data, k: string): string | null => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : null);

const ARC_ENDS: Record<string, Partial<Record<string, string>>> = {
  odile: { good: 'You put Odile\'s board back over a bar.', bad: 'Odile opened without her board. People noticed.' },
  magpie: { good: 'You squared Magpie\'s paper.', bad: 'Crane took the Due, and you were the one she asked.' },
  pell: { good: 'You stood up at the Cloister with an auditor.' },
  nadia: { good: 'You found Tomas Sorel in a ration registry.' },
  toma: { good: 'You talked a picket ensign home from the Null Lantern.' },
  imre: { good: 'You flew Class Four to Lysowick.' },
  maud: { good: 'You fetched a core so a warden could ask why.' },
};

/** Templates per event kind; each returns a sentence or null (not enough detail). */
const TEMPLATES: Record<string, Tpl[]> = {
  'ambush.broken': [
    (d) => (s(d, 'sys') && s(d, 'victim') ? `You were at ${s(d, 'sys')} when the ${s(d, 'victim')} ran for it, and made it.` : null),
    (d) => (s(d, 'victim') && s(d, 'band') ? `You pulled the ${s(d, 'victim')} out of ${s(d, 'band')}'s teeth.` : null),
  ],
  'ambush.lost': [(d) => (s(d, 'sys') && s(d, 'victim') ? `You were at ${s(d, 'sys')} when the ${s(d, 'victim')} burned.` : null)],
  'contract.done': [
    (d) => {
      const k = s(d, 'kind');
      const sys = s(d, 'sys');
      if (k === 'escort' && s(d, 'freighter')) return `You saw the ${s(d, 'freighter')} through${sys ? ` at ${sys}` : ''}.`;
      if (k === 'bounty' && s(d, 'mark')) return `You took ${s(d, 'mark')}'s bounty${sys ? ` in ${sys}` : ''}.`;
      if (k === 'salvage' && sys) return `You brought a flight core home from ${sys}.`;
      if (k === 'courier' && s(d, 'dest')) return `You carried a sealed case to ${s(d, 'dest')} and didn't open it.`;
      if (k === 'recon' && sys) return `You sat in ${sys} with the tape running while they came for you.`;
      if (k === 'sortie' && sys) return `You broke a Choir Measure at ${sys}, off the Schedule.`;
      return null;
    },
  ],
  'contract.failed': [
    (d) => {
      const k = s(d, 'kind');
      const sys = s(d, 'sys');
      if (k === 'escort' && s(d, 'freighter') && sys) return `You were at ${sys} when the ${s(d, 'freighter')} burned.`;
      if (k === 'bounty' && s(d, 'mark')) return `${s(d, 'mark')} is still out there, and you were paid to fix that.`;
      return null;
    },
  ],
  'rival.met': [(d) => (s(d, 'name') && s(d, 'sys') ? `You met ${s(d, 'name')} over ${s(d, 'sys')} and lived.` : null)],
  'rival.beaten': [(d) => (s(d, 'name') && s(d, 'sys') ? `You ran ${s(d, 'name')} off at ${s(d, 'sys')}.` : null)],
  'rival.killed': [(d) => (s(d, 'name') && s(d, 'sys') ? `You put ${s(d, 'name')} in the dark at ${s(d, 'sys')}.` : null)],
  'rival.won': [(d) => (s(d, 'name') && s(d, 'sys') ? `${s(d, 'name')} sent you home on a salvage tug from ${s(d, 'sys')}.` : null)],
  'rival.wing-down': [(d) => (s(d, 'wingman') && s(d, 'sys') ? `You killed ${s(d, 'wingman')} at ${s(d, 'sys')}.` : null)],
  'npc.arc': [(d) => (s(d, 'arc') && s(d, 'outcome') ? (ARC_ENDS[s(d, 'arc')!]?.[s(d, 'outcome')!] ?? null) : null)],
};

/** Kinds this module can phrase. */
export const MEMORY_KINDS = Object.keys(TEMPLATES);

export interface Recall {
  text: string;
  event: WorldEvent;
}

export interface RecallQuery {
  /** Speaker id (rival id or person id): events naming them come first. */
  about?: string;
  /** Kinds this speaker cares about (ranked after events about them). */
  kinds?: readonly string[];
  /** Only these kinds at all. */
  only?: readonly string[];
  seed?: number;
  /** Look back this many events (default 80). */
  depth?: number;
}

function names(e: WorldEvent, id: string): boolean {
  if (e.scope === `npc:${id}`) return true;
  const d = e.data;
  return !!d && (d.rival === id || d.npc === id || d.arc === id);
}

/** The most relevant remembered event for a speaker, as a sentence. */
export function recall(w: WorldState, q: RecallQuery = {}): Recall | null {
  const depth = q.depth ?? 80;
  const cands: { r: Recall; score: number }[] = [];
  for (let i = w.log.length - 1, n = 0; i >= 0 && n < depth; i--, n++) {
    const e = w.log[i];
    if (q.only && !q.only.includes(e.kind)) continue;
    const tpls = TEMPLATES[e.kind];
    if (!tpls || !e.data) continue;
    const variant = ((q.seed ?? 0) + i) % tpls.length;
    let text: string | null = null;
    for (let k = 0; k < tpls.length && !text; k++) text = tpls[(variant + k) % tpls.length](e.data);
    if (!text) continue;
    let score = 100 - n; // recency
    if (q.about && names(e, q.about)) score += 400;
    if (q.kinds?.includes(e.kind)) score += 200;
    cands.push({ r: { text, event: e }, score });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  // A little variety among near-equals (within 12 points of the best).
  const top = cands.filter((c) => c.score >= cands[0].score - 12).slice(0, 3);
  return top[(q.seed ?? 0) % top.length].r;
}

const FALLBACKS = [
  'They say you fly airframe 0413 like it owes you money.',
  'Nobody tells me much about you. In the Reach, that\'s a kind of reputation.',
  'The deck crews talk about your airframe more than about you. Give them time.',
];

/** `{memory}` for dialog: the recalled sentence, or a gentle fallback. */
export function memoryLine(w: WorldState, about?: string, seed = 0, kinds?: readonly string[]): string {
  return recall(w, { about, seed, kinds })?.text ?? FALLBACKS[seed % FALLBACKS.length];
}
