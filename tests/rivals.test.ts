import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_COOLDOWN,
  RETREAT_COOLDOWN,
  RIVALS,
  RIVAL_TALKS,
  addGrudge,
  allies,
  beginEncounter,
  bountyTaken,
  endEncounter,
  grudgeFromEvent,
  markDown,
  pickEncounter,
  rivalByMark,
  rivalConversationFor,
  rivalHideouts,
  rivalLine,
  rivalPersonId,
  rivalState,
  rk,
  setStatus,
  tickRivals,
  wingDown,
  type LineKind,
} from '../src/game/rivals/rivals.ts';
import { CATALOG_BY_ID } from '../src/game/shipyard/catalog.ts';
import { MARK_CAST, markId } from '../src/game/contracts/contracts.ts';
import { advance, begin, choicesAt, newDialogState, validate } from '../src/dialog/engine.ts';
import { EXTRAS, GUESTS, ROSTER } from '../src/dialog/people.ts';
import '../src/game/npc/people.ts';
import { emptyWorld, fact, record, setFact, type WorldState } from '../src/game/world/WorldState.ts';
import { recall } from '../src/game/npc/memory.ts';
import type { DialogWorld } from '../src/dialog/types.ts';

const M = 60;
/** Fighter blueprints (src/assets/blueprints) that aren't shipyard catalogue hulls. */
const ENEMY_HULLS = new Set(['choir-cantor', 'choir-psalter', 'choir-vesper']);
const hull = (id: string) => !!CATALOG_BY_ID[id] || ENEMY_HULLS.has(id);
const RUST = { id: 'quilegard', faction: 'rustwake', name: 'Quilegard' };
const CHOIR = { id: 'halaedon', faction: 'choir', name: 'Halaedon' };
const hunting = (ids: string[], grudge = 0) => ids.reduce((w, id) => addGrudge(setStatus(w, id, 'hunting'), id, grudge), emptyWorld());

test('at least five rivals: faces, voices, ships per tier, a full set of lines', () => {
  assert.ok(RIVALS.length >= 5);
  const kinds: LineKind[] = ['intro', 'taunt', 'grudge', 'wing', 'retreat', 'back', 'death', 'win'];
  for (const r of RIVALS) {
    assert.ok(r.portrait && r.color && r.voice, r.id);
    for (const s of r.ships) {
      assert.ok(hull(s.blueprint), `${r.id}: ${s.blueprint} is a known hull`);
      assert.ok(hull(s.wing.blueprint), `${r.id}: wing ${s.wing.blueprint}`);
    }
    // They come back better, never worse.
    for (let t = 1; t < 3; t++) assert.ok(r.ships[t].skill >= r.ships[t - 1].skill && r.ships[t].hull > r.ships[t - 1].hull, `${r.id} tier ${t} is an upgrade`);
    for (const k of kinds) {
      assert.ok(r.lines[k].length, `${r.id}: ${k} lines`);
      for (const l of r.lines[k]) {
        assert.ok(l.length <= 140, `${r.id}/${k} ≤ 140 chars: ${l}`);
        if (k !== 'grudge') assert.ok(!l.includes('{memory}'), `${r.id}/${k}: {memory} only in grudge lines`);
      }
    }
    for (const l of r.lines.grudge) assert.ok(l.includes('{memory}'), `${r.id}: grudge lines quote a memory`);
    // Bounty marks keep their board face.
    if (r.mark) assert.deepEqual(MARK_CAST.find((c) => c.id === markId(r.mark!))?.portrait, r.portrait);
  }
  assert.ok(RIVALS.filter((r) => r.hides && RIVAL_TALKS[r.id]).length >= 2, 'two can be turned');
});

test('rivals wake on world conditions', () => {
  let w = tickRivals(emptyWorld(), { now: 5 * M, episode: 1 });
  assert.equal(rivalState(w, 'red-sabine').status, 'dormant');
  w = tickRivals(w, { now: 21 * M, episode: 1 });
  assert.equal(rivalState(w, 'red-sabine').status, 'hunting');
  assert.ok(w.log.some((e) => e.kind === 'rival.wakes' && e.data?.rival === 'red-sabine'));
  assert.equal(rivalState(w, 'knife').status, 'dormant', 'the Knife waits for Continuity business');
  w = tickRivals(setFact(w, 'contract.pell-witness', 'active'), { now: 22 * M, episode: 1 });
  assert.equal(rivalState(w, 'knife').status, 'hunting');
  // Crane wakes when he buys Magpie's paper (her arc).
  w = tickRivals(setFact(w, 'npc.ninefingers.hunting', 'magpie'), { now: 23 * M, episode: 1 });
  assert.equal(rivalState(w, 'ninefingers').status, 'hunting');
});

test('grudges come from what you did, where they hunt', () => {
  let w = hunting(['red-sabine', 'ninefingers', 'metronome']);
  const broke = record(emptyWorld(), 'ambush.broken', 'system:quilegard', { sys: 'Quilegard', victim: 'Patient Ox', band: 'Blackwake' }).log[0];
  w = grudgeFromEvent(w, broke, RUST);
  assert.equal(rivalState(w, 'red-sabine').grudge, 1);
  assert.equal(rivalState(w, 'ninefingers').grudge, 1);
  w = grudgeFromEvent(w, broke, CHOIR);
  assert.equal(rivalState(w, 'red-sabine').grudge, 1, 'not her hunting ground');
  const sortie = record(emptyWorld(), 'contract.done', 'system:tessaly', { kind: 'sortie', sys: 'Tessaly' }).log[0];
  w = grudgeFromEvent(w, sortie, { id: 'tessaly', faction: 'choir' });
  assert.equal(rivalState(w, 'metronome').grudge, 3);
  w = bountyTaken(w, 'red-sabine');
  assert.equal(rivalState(w, 'red-sabine').grudge, 3);
  w = wingDown(w, 'red-sabine', 'Pelourin', 'Tuck');
  assert.equal(rivalState(w, 'red-sabine').grudge, 4);
  assert.equal(addGrudge(w, 'red-sabine', 99).counters[rk('red-sabine', 'grudge')], 10, 'capped');
});

test('encounters: deterministic, haunt-bound, cooldown-limited (never spammy)', () => {
  const w0 = hunting(RIVALS.map((r) => r.id), 10);
  const q = { now: 3600, system: RUST, mode: 'lane' as const, seed: 42 };
  assert.deepEqual(pickEncounter(w0, q)?.rival.id, pickEncounter(w0, q)?.rival.id, 'same world, same answer');
  // Choir space never gets a Rustwake outlaw.
  for (let s = 0; s < 40; s++) {
    const e = pickEncounter(w0, { ...q, system: CHOIR, seed: s });
    if (e) assert.ok(['ismene', 'metronome'].includes(e.rival.id), e.rival.id);
  }
  // Ambushes are led only by ambushers.
  for (let s = 0; s < 40; s++) {
    const e = pickEncounter(w0, { ...q, mode: 'ambush', seed: s });
    if (e) assert.ok(e.rival.ambusher, e.rival.id);
  }
  // Three hours of lane checks every 30 s at maximum grudge.
  let w = w0;
  const times: number[] = [];
  for (let t = 3600; t < 3 * 3600 + 3600; t += 30) {
    const e = pickEncounter(w, { now: t, system: RUST, mode: 'lane', seed: t });
    if (!e) continue;
    times.push(t);
    w = beginEncounter(w, e.rival.id, t, 'Quilegard');
    w = endEncounter(w, e.rival.id, 'lost-contact', t + 60, 'Quilegard');
  }
  assert.ok(times.length >= 3, `rivals do turn up (${times.length})`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= GLOBAL_COOLDOWN, 'global cooldown holds');
  assert.ok(times.length <= (3 * 3600) / GLOBAL_COOLDOWN + 1);
  // No grudge, no lane intercept (Skerry excepted: he wants your Ebon, not you).
  const cold = hunting(['red-sabine', 'ninefingers']);
  for (let s = 0; s < 30; s++) assert.equal(pickEncounter(cold, { ...q, seed: s }), null);
});

test('beaten, they retreat and come back upgraded; at their mortal tier they die for good', () => {
  let w = hunting(['red-sabine'], 5);
  w = beginEncounter(w, 'red-sabine', 1000, 'Pelourin');
  assert.ok(w.log.some((e) => e.kind === 'rival.met'));
  w = endEncounter(w, 'red-sabine', 'retreated', 1200, 'Pelourin');
  let st = rivalState(w, 'red-sabine');
  assert.deepEqual([st.status, st.tier, st.beaten, st.grudge], ['retreated', 1, 1, 8]);
  // Licking wounds: not back before the cooldown.
  assert.equal(pickEncounter(w, { now: 1300, system: RUST, mode: 'lane', seed: 1, force: undefined }), null);
  w = tickRivals(w, { now: 1200 + RETREAT_COOLDOWN, episode: 1 });
  assert.equal(rivalState(w, 'red-sabine').status, 'hunting');
  const back = pickEncounter(w, { now: 1200 + RETREAT_COOLDOWN, system: RUST, mode: 'lane', seed: 0, force: 'red-sabine' })!;
  assert.equal(back.ship.blueprint, 'rw-knuckleduster', 'a heavier hull');
  assert.ok(back.returning);
  // Shot down below the mortal tier: ejected (a beating, not a death).
  w = endEncounter(w, 'red-sabine', 'killed', 5000, 'Pelourin');
  st = rivalState(w, 'red-sabine');
  assert.deepEqual([st.status, st.tier], ['retreated', 2]);
  assert.equal(w.log[w.log.length - 1].data?.ejected, true);
  // At the mortal tier: dead, for good.
  w = endEncounter(w, 'red-sabine', 'killed', 9000, 'Zephacis');
  assert.equal(rivalState(w, 'red-sabine').status, 'dead');
  assert.equal(fact(w, 'npc.red-sabine.status'), 'dead');
  w = tickRivals(w, { now: 99_999, episode: 20 });
  assert.equal(pickEncounter(w, { now: 99_999, system: RUST, mode: 'lane', seed: 0, force: 'red-sabine' }), null, 'the dead stay dead');
  assert.equal(addGrudge(w, 'red-sabine', 3), w, 'and hold no grudges');
});

test('a bounty on a rival mark: taking it angers them, finishing it beats (then kills) them', () => {
  const crane = rivalByMark(markId("Hollis 'Ninefingers' Crane"))!;
  assert.equal(crane.id, 'ninefingers');
  let w = bountyTaken(hunting(['ninefingers']), crane.id);
  assert.equal(rivalState(w, crane.id).grudge, 2);
  w = markDown(w, crane.id, 100, 'Quilegard');
  assert.equal(rivalState(w, crane.id).status, 'retreated');
  w = { ...w, counters: { ...w.counters, [rk(crane.id, 'tier')]: 2 } };
  w = markDown(w, crane.id, 200, 'Quilegard');
  assert.equal(rivalState(w, crane.id).status, 'dead');
});

test('ally paths: Ismene and Skerry go to ground and can be turned in conversation', () => {
  const speakers = new Set([...ROSTER, ...EXTRAS, ...GUESTS].map((p) => p.id));
  assert.deepEqual(validate(Object.values(RIVAL_TALKS), speakers), []);
  let w = hunting(['ismene', 'skerry'], 2);
  w = endEncounter(w, 'ismene', 'retreated', 1000, 'Coraex');
  assert.equal(rivalState(w, 'ismene').status, 'hiding');
  const hide = rivalHideouts(w);
  assert.deepEqual(hide.map((h) => h.rival.id), ['ismene']);
  const ismene = rivalPersonId(hide[0].rival);
  const conv = rivalConversationFor(w, ismene)!;
  assert.ok(conv);
  const dw = (flags: Record<string, true>, facts = w.facts): DialogWorld => ({ state: { ...newDialogState(), flags }, ledger: { credits: 0, cargo: {}, capacity: 8, rep: { concord: 0, choir: 0, rustwake: 0 } }, episode: 3, facts, counters: w.counters });
  // Without Lucan's song the asking is locked (shown, with a hint).
  let s = begin(conv, dw({}));
  s = advance(conv, s.node!, s.world);
  const locked = choicesAt(conv, s.node!, s.world)[0];
  assert.equal(locked.available, false);
  assert.ok(locked.choice.locked);
  // With it: she sings, and flies your wing.
  s = begin(conv, dw({ 'lucan-sang': true }));
  s = advance(conv, s.node!, s.world);
  s = advance(conv, s.node!, s.world, 0);
  assert.equal(s.world.facts?.['npc.ismene.status'], 'ally');
  w = setFact(w, 'npc.ismene.status', 'ally');
  assert.deepEqual(allies(w).map((r) => r.id), ['ismene']);
  assert.equal(pickEncounter(w, { now: 1e6, system: CHOIR, mode: 'lane', seed: 0, force: 'ismene' }), null, 'an ally never intercepts');
  // Hiding too long: back to the hunt.
  w = endEncounter(w, 'skerry', 'retreated', 1000, 'Pelourin');
  assert.equal(rivalState(w, 'skerry').status, 'hiding');
  w = tickRivals(w, { now: 1000 + 91 * M, episode: 1 });
  assert.equal(rivalState(w, 'skerry').status, 'hunting', 'the window closed');
  // Skerry comes in if Kerrigan came home.
  const sk = RIVAL_TALKS.skerry;
  const wing = sk.nodes.hello2.choices![0];
  assert.deepEqual(wing.if, { any: [{ fact: 'npc.toma.home' }, { standing: 'rustwake', min: 15 }] });
});

test('nemesis-lite: rivals quote the world log back at you', () => {
  const r = RIVALS.find((x) => x.id === 'red-sabine')!;
  let w: WorldState = hunting(['red-sabine']);
  // Nothing remembered: a grudge line falls back to a taunt, never a bare placeholder.
  for (let s = 0; s < 6; s++) {
    const l = rivalLine(w, r, 'grudge', s);
    assert.ok(!l.includes('{'), l);
    assert.ok(r.lines.taunt.includes(l), 'falls back to a taunt');
  }
  w = wingDown(w, 'red-sabine', 'Pelourin', 'Tuck');
  const line = rivalLine(w, r, 'grudge', 0);
  assert.match(line, /^You killed Tuck at Pelourin\./, line);
  // About-them events outrank everything else in the log.
  w = record(w, 'ambush.lost', 'system:halaedon', { sys: 'Halaedon', victim: 'Kittiwake', band: 'Blackwake' });
  assert.equal(recall(w, { about: 'red-sabine' })?.text, 'You killed Tuck at Pelourin.');
  assert.equal(recall(w)?.text, 'You were at Halaedon when the Kittiwake burned.');
  // Specific lines for specific rivals: vars fill in.
  assert.ok(!rivalLine(w, r, 'intro', 0).includes('{'));
});
