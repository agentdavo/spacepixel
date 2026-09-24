import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, applyEffects, begin, choicesAt, entryNode, evalCond, fill, newDialogState, offered, validate } from '../src/dialog/engine.ts';
import { CONVERSATIONS, conversationsWith } from '../src/dialog/conversations.ts';
import { EXTRAS, PEOPLE_SLOT, ROSTER, localPerson, peopleAt, whereIs, type StationRef } from '../src/dialog/people.ts';
import { smallTalk } from '../src/dialog/smalltalk.ts';
import { BANTER, BarkLimiter, barkLine, orderKind, pickBanter, trafficCargo, trafficHail, type BarkKind } from '../src/dialog/barks.ts';
import { MAX_CPS, cps, lineHold, readTime, scheduleCues, typeDuration } from '../src/ui/subtitleTiming.ts';
import { numberWords, planUtterance, revealAt, sample, syllabify } from '../src/audio/voice/plan.ts';
import { CAST_VOICES, NARRATOR, npcVoice } from '../src/audio/voice/voices.ts';
import { narrationCues } from '../src/cinema/narration.ts';
import { PROLOGUE } from '../src/cinema/prologue.ts';
import { CAST } from '../src/game/campaign/cast.ts';
import { CODEX } from '../src/game/campaign/codex.ts';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import type { Conversation, DialogWorld, DLedger } from '../src/dialog/types.ts';

const ledger = (o: Partial<DLedger> = {}): DLedger => ({ credits: 2500, cargo: { rations: 2 }, capacity: 16, rep: { concord: 20, choir: -20, rustwake: 0 }, ...o });
const world = (o: Partial<DialogWorld> = {}): DialogWorld => ({
  state: newDialogState(),
  ledger: ledger(),
  episode: 1,
  station: { id: 'meridian-orbital-0', faction: 'concord', kind: 'orbital' },
  vars: { rumour: 'the Ember dims', tip: 'buy rations here', station: 'Castellan Highport' },
  ...o,
});

// ── engine ──────────────────────────────────────────────────────────────

test('conditions: flags, episode, standing, credits, cargo, station, combinators', () => {
  const w = world({ state: { ...newDialogState(), flags: { a: true }, seen: { x: 2 } } });
  assert.ok(evalCond({ flag: 'a' }, w));
  assert.ok(!evalCond({ flag: 'b' }, w));
  assert.ok(evalCond({ notFlag: 'b' }, w));
  assert.ok(evalCond({ episode: { min: 1, max: 3 } }, w));
  assert.ok(!evalCond({ episode: { min: 2 } }, w));
  assert.ok(evalCond({ standing: 'concord', min: 10 }, w));
  assert.ok(!evalCond({ standing: 'choir', min: 0 }, w));
  assert.ok(evalCond({ credits: 2500 }, w) && !evalCond({ credits: 2501 }, w));
  assert.ok(evalCond({ cargo: 'rations' }, w) && !evalCond({ cargo: 'ebon' }, w) && evalCond({ cargo: 'rations', min: 2, max: 2 }, w));
  assert.ok(evalCond({ cargoSpace: 14 }, w) && !evalCond({ cargoSpace: 15 }, w));
  assert.ok(evalCond({ stationFaction: ['choir', 'concord'] }, w) && !evalCond({ stationKind: 'salvage' }, w));
  assert.ok(evalCond({ seen: 'x', min: 2 }, w) && !evalCond({ seen: 'y' }, w));
  assert.ok(evalCond({ all: [{ flag: 'a' }, { not: { flag: 'b' } }] }, w));
  assert.ok(evalCond({ any: [{ flag: 'b' }, { flag: 'a' }] }, w));
  assert.ok(evalCond(undefined, w));
});

test('effects are pure and clamped', () => {
  const w = world({ ledger: ledger({ credits: 100, cargo: { rations: 15 }, capacity: 16 }) });
  const w2 = applyEffects(
    [{ credits: -500 }, { cargo: 'ebon', delta: 5 }, { cargo: 'rations', delta: -20 }, { standing: 'concord', delta: 500 }, { setFlag: 'f' }, { rumour: 'heard {rumour}' }, { tip: '{tip}' }, { codex: 'tech-ebon' }, { contract: 'c1' }, { recruit: 'r1' }],
    w,
  );
  assert.equal(w.ledger.credits, 100, 'input untouched');
  assert.equal(w2.ledger.credits, 0);
  assert.equal(w2.ledger.cargo.ebon, 1, 'only one slot was free');
  assert.equal(w2.ledger.cargo.rations, undefined);
  assert.equal(w2.ledger.rep.concord, 100);
  assert.ok(w2.state.flags.f);
  assert.deepEqual(w2.state.rumours, ['heard the Ember dims']);
  assert.deepEqual(w2.state.tips, ['buy rations here']);
  assert.deepEqual(w2.state.codex, ['tech-ebon']);
  assert.deepEqual(w2.state.contracts, ['c1']);
  assert.deepEqual(w2.state.recruits, ['r1']);
  assert.equal(fill('at {station} {nope}', w.vars), 'at Castellan Highport {nope}');
});

test('advance: choices gate, effects apply, conversations end and are remembered', () => {
  const conv: Conversation = {
    id: 't',
    title: 'T',
    with: 'odile',
    entry: [{ if: { flag: 'x' }, node: 'b' }, { node: 'a' }],
    nodes: {
      a: { who: 'odile', line: 'A', choices: [{ text: 'pay', next: 'b', if: { credits: 99999 } }, { text: 'go', next: 'b', effects: [{ credits: -10 }] }, { text: 'bye', next: null }] },
      b: { who: 'odile', line: 'B', next: 'c' },
      c: { who: 'odile', line: 'C' },
    },
    repeatable: false,
  };
  let w = world();
  assert.equal(entryNode(conv, w), 'a');
  const s0 = begin(conv, w);
  assert.equal(s0.node, 'a');
  assert.equal(choicesAt(conv, 'a', w).length, 2, 'unavailable choice without `locked` is hidden');
  const refused = advance(conv, 'a', w, 0);
  assert.equal(refused.node, 'a');
  assert.equal(refused.world, w);
  const s1 = advance(conv, 'a', w, 1);
  assert.equal(s1.node, 'b');
  assert.equal(s1.world.ledger.credits, 2490);
  const s2 = advance(conv, 'b', s1.world);
  assert.equal(s2.node, 'c');
  const s3 = advance(conv, 'c', s2.world);
  assert.equal(s3.node, null);
  w = s3.world;
  assert.equal(w.state.seen.t, 1);
  assert.ok(!offered(conv, w), 'non-repeatable conversation is not offered again');
});

// ── content ─────────────────────────────────────────────────────────────

const speakers = new Set<string>([...ROSTER.map((p) => p.id), ...EXTRAS.map((p) => p.id), ...CAST.map((c) => c.id)]);
const codexIds = new Set(CODEX.map((c) => c.id));

test('conversations: at least 12, structurally valid, every roster person has one', () => {
  assert.ok(CONVERSATIONS.length >= 12, `${CONVERSATIONS.length} conversations`);
  assert.deepEqual(validate(CONVERSATIONS, speakers, codexIds), []);
  for (const p of ROSTER) assert.ok(conversationsWith(p.id).length > 0, `${p.id} has a conversation`);
});

test('conversations: every node can reach an ending (no traps), across episodes and wallets', () => {
  const worlds = [
    world(),
    world({ episode: 11, ledger: ledger({ credits: 0, cargo: {} }) }),
    world({ episode: 21, ledger: ledger({ credits: 99999, cargo: { relics: 3, ebon: 2, rations: 4 }, rep: { concord: 60, choir: 60, rustwake: 60 } }) }),
  ];
  for (const conv of CONVERSATIONS) {
    for (const w of worlds) {
      // BFS over (node) with available choices only; assert we can reach null from every reached node.
      const canEnd = new Map<string, boolean>();
      const ends = (id: string, stack: Set<string>): boolean => {
        if (canEnd.has(id)) return canEnd.get(id)!;
        if (stack.has(id)) return false;
        stack.add(id);
        const n = conv.nodes[id];
        let ok = false;
        if (!n.choices?.length) ok = !n.next || ends(n.next, stack);
        else for (const c of choicesAt(conv, id, w)) if (c.available && (c.choice.next === null || ends(c.choice.next, stack))) ok = true;
        stack.delete(id);
        canEnd.set(id, ok);
        return ok;
      };
      const start = entryNode(conv, w);
      assert.ok(ends(start, new Set()), `${conv.id} can end from ${start} at episode ${w.episode}`);
    }
  }
});

test('conversations change with campaign progress', () => {
  const at = (id: string, w: DialogWorld) => entryNode(CONVERSATIONS.find((c) => c.id === id)!, w);
  assert.equal(at('odile-last-timetable', world({ episode: 3 })), 'hello');
  assert.equal(at('odile-last-timetable', world({ episode: 11 })), 'after');
  assert.equal(at('maud-keepings', world({ episode: 19 })), 'broken');
  assert.equal(at('pell-audit', world({ episode: 9 })), 'rot');
  assert.equal(at('pell-audit', world({ ledger: ledger({ cargo: { ebon: 1 } }) })), 'audit');
  assert.equal(at('toma-signal', world({ episode: 6 })), 'heard');
  assert.equal(at('rosa-dawn', world({ episode: 12 })), 'after');
  const lettered = world({ episode: 11, state: { ...newDialogState(), flags: { 'nadia-letter': true } } });
  assert.equal(at('nadia-letter', lettered), 'grief');
});

test('lines are radio-length and read under the subtitle speed limit', () => {
  const lines: string[] = [];
  for (const c of CONVERSATIONS) for (const n of Object.values(c.nodes)) lines.push(n.line);
  for (const m of MISSIONS) for (const b of m.chatter) for (const l of b.lines) lines.push(l.text);
  for (const t of lines) {
    const hold = lineHold(t, 0);
    assert.ok(cps(t, hold) < MAX_CPS, `${cps(t, hold).toFixed(1)} cps: ${t}`);
    assert.ok(typeDuration(t, 0) < hold);
  }
  // With a voice, the hold covers the voice.
  const v = planUtterance('Keep the light, Vanguard.', CAST_VOICES.oyelaran);
  assert.ok(lineHold('Keep the light, Vanguard.', v.dur) >= v.dur + 0.4);
  assert.ok(readTime('Hi.') >= 1.8);
});

test('subtitle schedule never overlaps', () => {
  const slots = scheduleCues([
    { at: 0, text: 'First line of dialog.', voiceDur: 1.5 },
    { at: 0.5, text: 'Second, wants to start early.' },
    { at: 10, text: 'Third, later.' },
  ]);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].start >= slots[i - 1].end, 'no overlap');
  assert.equal(slots[2].start, 10);
});

// ── people ──────────────────────────────────────────────────────────────

const STATIONS: StationRef[] = [
  { id: 'meridian-orbital-0', faction: 'concord', kind: 'orbital' },
  { id: 'meridian-refinery-1', faction: 'concord', kind: 'refinery' },
  { id: 'meridian-bastion-2', faction: 'concord', kind: 'bastion' },
  { id: 'anchorage-salvage-1', faction: 'concord', kind: 'salvage' },
  { id: 'hesper-orbital-0', faction: 'choir', kind: 'orbital' },
  { id: 'hesper-freeport-1', faction: 'choir', kind: 'freeport' },
  { id: 'tessaly-bastion-1', faction: 'choir', kind: 'bastion' },
  { id: 'rustwake-freeport-0', faction: 'rustwake', kind: 'freeport' },
  { id: 'rustwake-salvage-1', faction: 'rustwake', kind: 'salvage' },
  { id: 'rustwake-refinery-2', faction: 'rustwake', kind: 'refinery' },
];

test('people: 2–4 per station, deterministic, rotating with the clock', () => {
  const seen = new Set<string>();
  for (const s of STATIONS) {
    for (let slot = 0; slot < 12; slot++) {
      const a = peopleAt(s, STATIONS, slot * PEOPLE_SLOT + 5, 4);
      const b = peopleAt(s, STATIONS, slot * PEOPLE_SLOT + 900, 4);
      assert.ok(a.length >= 2 && a.length <= 4, `${a.length} people`);
      assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id), 'same slot → same people');
      assert.equal(new Set(a.map((p) => p.id)).size, a.length, 'no duplicates');
      for (const p of a) seen.add(p.id);
    }
    const s0 = peopleAt(s, STATIONS, 0, 4).map((p) => p.id).join();
    const later = Array.from({ length: 6 }, (_, k) => peopleAt(s, STATIONS, (k + 1) * PEOPLE_SLOT, 4).map((p) => p.id).join());
    assert.ok(later.some((x) => x !== s0), `${s.id} rotates`);
  }
  const named = ROSTER.filter((p) => seen.has(p.id)).length;
  assert.ok(named >= 10, `${named} recurring people turned up somewhere`);
});

test('people: a recurring person is in one place (or in transit) at a time, and travels', () => {
  for (const p of ROSTER) {
    const places = new Set<string>();
    for (let slot = 0; slot < 40; slot++) {
      const clock = slot * PEOPLE_SLOT;
      const at = whereIs(p.id, STATIONS, clock, 4);
      const here = STATIONS.filter((s) => peopleAt(s, STATIONS, clock, 4).some((x) => x.id === p.id));
      assert.ok(here.length <= 1, `${p.id} in ${here.length} places`);
      if (here.length) assert.equal(here[0].id, at?.id);
      if (at) places.add(at.id);
    }
    if (places.size) assert.ok(places.size >= 1);
  }
  const odile = new Set<string>();
  for (let slot = 0; slot < 40; slot++) {
    const at = whereIs('odile', STATIONS, slot * PEOPLE_SLOT, 4);
    if (at) odile.add(at.id);
  }
  assert.ok(odile.size >= 3, 'the bartender moves around');
});

test('locals: varied archetypes and valid small talk', () => {
  const kinds = new Set<string>();
  for (const s of STATIONS) {
    for (let slot = 0; slot < 8; slot++) {
      for (let k = 0; k < 3; k++) {
        const p = localPerson(s, slot, k);
        kinds.add(p.archetype);
        assert.ok(p.name.length > 3 && p.role.length > 3);
        const conv = smallTalk(p);
        assert.deepEqual(validate([conv], new Set([p.id])), []);
        const st = begin(conv, world());
        assert.equal(st.node, 'hello');
      }
    }
  }
  for (const a of ['dock', 'trader', 'officer', 'broker', 'refugee', 'pilot', 'cantor']) assert.ok(kinds.has(a), `archetype ${a}`);
});

// ── barks ───────────────────────────────────────────────────────────────

test('barks: cooldowns, a global gap and a rolling cap; urgent calls skip the gap', () => {
  const lim = new BarkLimiter(4, 3, 30);
  assert.ok(lim.allow('splash-player', 0));
  assert.ok(!lim.allow('player-hit', 1), 'global gap');
  assert.ok(lim.allow('missile', 1), 'urgent skips the gap');
  assert.ok(!lim.allow('splash-player', 5), 'per-kind cooldown');
  assert.ok(lim.allow('player-hit', 6));
  assert.ok(!lim.allow('engage', 11), 'rolling cap of 3 in 30 s');
  assert.ok(lim.allow('engage', 32));
  // A 60 s dogfight with events every frame never exceeds the cap.
  const l2 = new BarkLimiter();
  const kinds: BarkKind[] = ['splash-player', 'splash-wing', 'player-hit', 'wing-hit', 'enemy-taunt', 'enemy-down', 'engage'];
  let n = 0;
  for (let t = 0; t < 60; t += 1 / 60) for (const k of kinds) if (l2.allow(k, t)) n++;
  assert.ok(n <= 12, `${n} barks in a minute`);
  assert.match(barkLine('wing-down', 'kade', 1, { name: 'JACKPOT' }), /JACKPOT/);
  assert.ok(barkLine('enemy-taunt', 'choir', 3).length > 3);
  assert.ok(trafficHail('Anselm\'s Patience', 'concord', trafficCargo('Anselm\'s Patience', 'concord'), 'Anchorage').includes('Anselm'));
});

test('wing orders get a spoken answer from each wingman, and banter only uses who is flying', () => {
  const wing = ['kade', 'jackpot', 'candle', 'sparrow', 'salt'];
  const orders = ['formUp', 'attackMyTarget', 'engageAtWill', 'coverMe'] as const;
  const kinds = new Set(orders.map((o) => orderKind(o, true)));
  assert.equal(kinds.size, 4);
  assert.equal(orderKind('attackMyTarget', false), 'order-no-target');
  const lines: string[] = [];
  for (const k of [...kinds, 'order-no-target' as const]) for (const w of wing) for (let n = 0; n < 4; n++) lines.push(barkLine(k, w, n));
  // Personal lines, not the generic fallback.
  assert.notEqual(barkLine('order-cover', 'jackpot', 0), barkLine('order-cover', 'any', 0));
  // Answers cut in after a bark, and the player can't spam them.
  const lim = new BarkLimiter();
  assert.ok(lim.allow('engage', 0));
  assert.ok(lim.allow('order-form', 0.5), 'an answer skips the global gap');
  assert.ok(!lim.allow('order-form', 1), 'but not its own cooldown');
  const ids = new Set(CAST.map((c) => c.id));
  for (const ex of BANTER) {
    assert.ok(ex.length >= 2 && ex.length <= 3);
    for (const [who, text] of ex) {
      assert.ok(ids.has(who), who);
      lines.push(text);
    }
  }
  for (const t of lines) assert.ok(cps(t, lineHold(t, 0)) < MAX_CPS, t);
  // Only speakers in the air; fresh exchanges before repeats.
  assert.equal(pickBanter([], new Set(), 0), -1);
  const i = pickBanter(['sparrow', 'salt'], new Set(), 3);
  assert.ok(BANTER[i].every(([w]) => w === 'sparrow' || w === 'salt'));
  const used = new Set<number>();
  for (let n = 0; n < BANTER.length; n++) {
    const k = pickBanter(wing, used, n);
    assert.ok(!used.has(k), 'repeat before the pool ran out');
    used.add(k);
  }
});

// ── voice ───────────────────────────────────────────────────────────────

test('voice planner: syllables, numbers, finite tracks, typewriter marks', () => {
  assert.equal(syllabify('Lantern', () => 0.9).length, 2);
  assert.equal(syllabify('LIT', () => 0.9).length, 1);
  assert.equal(numberWords(1009), 'one thousand nine');
  for (const [id, prof] of Object.entries(CAST_VOICES)) {
    const p = planUtterance('Vanguard, form on me. Is that a Cathedral?', prof);
    assert.ok(p.dur > 0.8 && p.dur < 8, `${id}: ${p.dur}`);
    for (const tr of Object.values(p.tracks)) {
      for (let i = 0; i < tr.length; i++) {
        assert.ok(Number.isFinite(tr[i][0]) && Number.isFinite(tr[i][1]));
        if (i) assert.ok(tr[i][0] >= tr[i - 1][0], 'times non-decreasing');
      }
    }
    let last = -1;
    for (const m of p.marks) {
      assert.ok(m[1] >= last);
      last = m[1];
    }
    assert.equal(revealAt(p, p.dur + 1), p.chars);
    assert.equal(revealAt(p, 0), 0);
  }
  // A question rises at the end.
  const q = planUtterance('Is that really a Cathedral?', NARRATOR);
  const f0 = q.tracks.f0;
  assert.ok(f0[f0.length - 1][1] > sample(f0, q.dur * 0.3));
  // Sung lines are flagged and slower.
  const sung = planUtterance('(sung) Out of the dust we were lifted.', CAST_VOICES.psalm);
  const spoken = planUtterance('Out of the dust we were lifted.', CAST_VOICES.psalm);
  assert.ok(sung.sung && sung.dur > spoken.dur * 1.4);
  // Deterministic.
  assert.deepEqual(planUtterance('Keep the light.', CAST_VOICES.kade).tracks, planUtterance('Keep the light.', CAST_VOICES.kade).tracks);
  const v = npcVoice(42, { sex: 'f', age: 'old', faction: 'rustwake' });
  assert.equal(v.accent, 'rustwake');
});

test('voice planner squeezes to fit, and the prologue narration fits its captions', () => {
  const long = 'For twenty-two centuries we rode them, on a timetable, to the minute, every day.';
  const free = planUtterance(long, NARRATOR);
  const fit = planUtterance(long, NARRATOR, { maxDur: free.dur * 0.7 });
  assert.ok(Math.abs(fit.dur - free.dur * 0.7) < 1e-6);
  const cues = narrationCues(PROLOGUE);
  assert.ok(cues.filter((c) => c.who === 'narrator').length >= 12, `${cues.length} cues`);
  for (const c of cues) {
    const p = planUtterance(c.caption.text, c.who === 'narrator' ? NARRATOR : CAST_VOICES['relight-pilot'], { maxDur: c.maxDur, maxSqueeze: c.maxSqueeze });
    assert.ok(p.dur <= c.caption.dur + 1e-6, `"${c.caption.text}" ${p.dur.toFixed(2)} s in a ${c.caption.dur} s caption`);
  }
});

test('real speech is gracefully absent headless', async () => {
  const { speechAvailable, speak, stopSpeech } = await import('../src/audio/voice/Speech.ts');
  assert.equal(speechAvailable(), false);
  assert.equal(speak('kade', 'Keep the light.', CAST_VOICES.kade), null);
  stopSpeech();
});
