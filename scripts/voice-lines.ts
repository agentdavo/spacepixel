/**
 * Every written line the game can speak, with the model voice that speaks it
 * (src/audio/voice/neural.ts). Prints JSON for scripts/voice-record.py:
 *
 *   node --experimental-transform-types --no-warnings scripts/voice-lines.ts > lines.json
 *
 * Lines with {placeholders} are filled at runtime and stay on the synth, except
 * the wing-down calls, which are recorded once per wingman callsign.
 */
import { MISSIONS } from '../src/game/campaign/missions.ts';
import { CAST } from '../src/game/campaign/cast.ts';
import { CONVERSATIONS } from '../src/dialog/conversations.ts';
import { EXTRAS, ROSTER } from '../src/dialog/people.ts';
import { ARC_GUESTS, RIVAL_GUESTS } from '../src/game/npc/people.ts';
import { GUILD_VOICES } from '../src/game/guilds/guilds.ts';
import { ARCS } from '../src/game/guilds/arcs.ts';
import { RIVALS, rivalPersonId } from '../src/game/rivals/rivals.ts';
import * as contracts from '../src/game/contracts/contracts.ts';
import * as defence from '../src/game/outposts/defence.ts';
import { BANTER, BARK_LINES, DOCK_LINES, type BarkKind } from '../src/dialog/barks.ts';
import { narrationCues } from '../src/cinema/narration.ts';
import { PROLOGUE } from '../src/cinema/prologue.ts';
import { TRAILER } from '../src/cinema/trailer.ts';
import { clipKey, hashStr, neuralVoiceFor, spokenText } from '../src/audio/voice/neural.ts';

const sex = new Map<string, 'f' | 'm'>();
for (const p of [...ROSTER, ...EXTRAS, ...ARC_GUESTS, ...RIVAL_GUESTS]) sex.set(p.id, p.voice.sex);
for (const [id, v] of Object.entries(GUILD_VOICES)) sex.set(id, v.sex);
for (const r of RIVALS) sex.set(rivalPersonId(r), r.voice.sex);
// voiceFor(): an unregistered id gets a generic voice of this sex.
const sexOf = (who: string) => sex.get(who) ?? (hashStr(who) & 1 ? 'f' : 'm');

const lines = new Map<string, { key: string; who: string; text: string; voice: object }>();
function add(who: string, text: string | undefined): void {
  if (!who || !text || who === 'self' || text.includes('{') || !spokenText(text)) return;
  const v = neuralVoiceFor(who, sexOf(who));
  if (!v) return;
  const key = clipKey(v, text);
  if (!lines.has(key)) lines.set(key, { key, who, text: spokenText(text), voice: v });
}

// Anything shaped like a spoken line, anywhere in the story data.
function walk(x: unknown, seen = new Set<unknown>()): void {
  if (!x || typeof x !== 'object' || seen.has(x)) return;
  seen.add(x);
  const o = x as Record<string, unknown>;
  if (typeof o.who === 'string') {
    if (typeof o.text === 'string') add(o.who, o.text);
    if (typeof o.line === 'string') add(o.who, o.line);
    if (typeof o.prompt === 'string') add(o.who, o.prompt);
  }
  for (const v of Array.isArray(x) ? x : Object.values(o)) walk(v, seen);
}
walk(MISSIONS);
walk(CONVERSATIONS);
walk(ARCS);
walk(contracts);
walk(defence);

for (const r of RIVALS) for (const list of Object.values(r.lines)) for (const t of list) add(rivalPersonId(r), t);

const WING = ['kade', 'jackpot', 'candle', 'sparrow', 'salt'];
const callsign = (id: string) => CAST.find((c) => c.id === id)?.callsign ?? id.toUpperCase();
for (const [kind, table] of Object.entries(BARK_LINES) as [BarkKind, Record<string, string[]>][]) {
  for (const [group, list] of Object.entries(table)) {
    if (!list) continue;
    const speakers = WING.includes(group)
      ? [group]
      : group === 'choir' || group === 'rustwake' || group === 'concord'
        ? [...[0, 1, 2, 3, 4, 5].map((n) => `enemy:${group}:${n}`), ...(group === 'choir' ? ['psalm'] : [])]
        : group === 'any' && kind.startsWith('enemy')
          ? [0, 1, 2, 3, 4, 5].map((n) => `enemy:concord:${n}`)
          : [];
    for (const who of speakers)
      for (const t of list) {
        if (t.includes('{name}')) for (const w of WING) add(who, t.replace('{name}', callsign(w)));
        else add(who, t);
      }
  }
}
for (const ex of BANTER) for (const [who, t] of ex) add(who, t);
for (const t of Object.values(DOCK_LINES.carrier)) add('control', t);
for (const c of [...narrationCues(PROLOGUE), ...narrationCues(TRAILER)]) add(c.who, c.caption.text);

process.stdout.write(JSON.stringify([...lines.values()], null, 0));
