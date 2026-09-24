import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCS, allArcConversations, arcConversationFor, arcKey, arcPlacement, arcView, resolveAt, stepConversation, tickArcs, validateArcs, type Arc } from '../src/game/npc/arcs.ts';
import { ARC_CONTRACT_IDS, arcContract, isArcContract } from '../src/game/npc/arcContracts.ts';
import { ARC_CLIENTS, ARC_GUESTS, RIVAL_GUESTS } from '../src/game/npc/people.ts';
import { memoryLine, recall } from '../src/game/npc/memory.ts';
import { advance, begin, newDialogState, validate } from '../src/dialog/engine.ts';
import { EXTRAS, GUESTS, ROSTER, peopleAt, personById, type StationRef } from '../src/dialog/people.ts';
import { namedContract, namedKey, isNamed } from '../src/game/contracts/named.ts';
import { acceptContract, newBook, type ReachMap, type ReachSystem } from '../src/game/contracts/contracts.ts';
import { buildOp } from '../src/game/contracts/ops.ts';
import { newLedger } from '../src/game/economy.ts';
import { emptyWorld, fact, record, setFact, type WorldState } from '../src/game/world/WorldState.ts';
import type { DialogWorld } from '../src/dialog/types.ts';

const M = 60;

/** Station ids of the real seeded Reach (generateUniverse(1994)); every arc place must resolve here. */
const REAL_STATIONS = `meridian-orbital-0 meridian-refinery-1 meridian-bastion-2 anchorage-bastion-0 anchorage-salvage-1 anchorage-orbital-2 tessaly-refinery-0 tessaly-bastion-1
hesper-orbital-0 hesper-freeport-1 rustwake-freeport-0 rustwake-salvage-1 rustwake-refinery-2 null-bastion-0 corouhold-freeport-0 corouhold-salvage-1 corouhold-refinery-2
yoriamere-freeport-0 yoriamere-salvage-1 yoriamere-refinery-2 oryrin-salvage-0 oryrin-bastion-1 noviwick-orbital-0 coraex-freeport-0 pelourin-freeport-0 pelourin-bastion-1
pelourin-orbital-2 yorimere-orbital-0 yorimere-bastion-1 uliaban-orbital-0 zephacis-freeport-0 zephacis-bastion-1 zephacis-orbital-2 lysowick-salvage-0 lysowick-bastion-1
quilegard-freeport-0 quilegard-salvage-1 quilegard-refinery-2 iseadon-orbital-0 iseadon-bastion-1 iseadon-refinery-2 pelestead-orbital-0 pelestead-bastion-1 pelestead-salvage-2
rhoagard-salvage-0 fenazar-orbital-0 fenazar-bastion-1 fenazar-salvage-2 halaedon-orbital-0 halaedon-refinery-1 halaedon-bastion-2`
  .split(/\s+/)
  .map((id) => ({ id }));

// A slice of the Reach with the places the arcs name.
const st = (id: string, name: string, kind: StationRef['kind'], faction: StationRef['faction'], pos: [number, number, number]) => ({ id, name, kind, faction, pos, axis: [1, 0, 0] as [number, number, number] });
const sys = (id: string, name: string, faction: string, stations: ReturnType<typeof st>[], gates: string[]): ReachSystem => ({
  id,
  name,
  faction,
  threat: 0.3,
  stations,
  gates: gates.map((to, i) => ({ to, pos: [20_000 * Math.cos(i * 2), 0, 20_000 * Math.sin(i * 2)] as [number, number, number], normal: [Math.cos(i * 2), 0, Math.sin(i * 2)] as [number, number, number] })),
});
const REACH: ReachMap = {
  systems: [
    sys('meridian', 'Meridian Prime', 'concord', [st('meridian-orbital-0', 'Castellan Highport', 'orbital', 'concord', [9000, 0, 0]), st('meridian-bastion-2', 'Meridian Lantern Watch', 'bastion', 'concord', [8000, 0, -6000])], ['anchorage', 'lysowick', 'pelourin']),
    sys('anchorage', 'Anchorage', 'concord', [st('anchorage-bastion-0', 'Anchorage Fleet Yards', 'bastion', 'concord', [-10_000, 0, 5000]), st('anchorage-salvage-1', 'Graveyard Breakers', 'salvage', 'concord', [-12_000, 2000, -9000]), st('anchorage-orbital-2', 'Anchorage I Skyhook', 'orbital', 'concord', [5000, 0, 9000])], ['lysowick', 'meridian']),
    sys('lysowick', 'Lysowick', 'contested', [st('lysowick-salvage-0', 'Lysowick Boneyard', 'salvage', 'rustwake', [3000, 0, 3000]), st('lysowick-bastion-1', 'Lysowick Watch', 'bastion', 'concord', [-3000, 0, 3000])], ['meridian', 'fenazar', 'anchorage']),
    sys('fenazar', 'Fenazar', 'concord', [st('fenazar-orbital-0', 'Fenazar I Orbital', 'orbital', 'concord', [4000, 0, 0]), st('fenazar-salvage-2', 'Fenazar Breakers', 'salvage', 'concord', [0, 0, 4000])], ['lysowick']),
    sys('pelourin', 'Pelourin', 'contested', [st('pelourin-freeport-0', 'Pelourin Exchange', 'freeport', 'rustwake', [4000, 0, 0])], ['meridian', 'quilegard', 'pelestead']),
    sys('pelestead', 'Pelestead', 'concord', [st('pelestead-orbital-0', 'Pelestead I Orbital', 'orbital', 'concord', [4000, 0, 0]), st('pelestead-salvage-2', 'Pelestead Salvage Yard', 'salvage', 'concord', [0, 0, 4000])], ['pelourin', 'quilegard']),
    sys('quilegard', 'Quilegard', 'rustwake', [st('quilegard-freeport-0', 'Quilegard Moot', 'freeport', 'rustwake', [4000, 0, 0]), st('quilegard-salvage-1', 'Quilegard Boneyard', 'salvage', 'rustwake', [0, 0, 4000])], ['pelourin', 'rustwake', 'pelestead']),
    sys('rustwake', 'Rustwake Belt', 'rustwake', [st('rustwake-freeport-0', 'The Moot-Hold', 'freeport', 'rustwake', [4000, 0, 9000]), st('rustwake-refinery-2', 'Ember Skimworks', 'refinery', 'rustwake', [-6000, 500, 7000])], ['quilegard']),
    sys('null', 'Null Lantern', 'unknown', [st('null-bastion-0', 'Null Picket', 'bastion', 'concord', [4000, 0, 0])], ['meridian']),
  ],
};
const STATIONS: StationRef[] = REACH.systems.flatMap((s) => s.stations.map((x) => ({ id: x.id, faction: x.faction, kind: x.kind })));

const arc = (id: string): Arc => ARCS.find((a) => a.id === id)!;
const step = (w: WorldState, id: string) => fact(w, arcKey(id, 'step'));
const tick = (w: WorldState, now: number, episode = 1) => tickArcs(w, { now, episode }).world;

test('there are at least six arcs, all structurally sound', () => {
  assert.ok(ARCS.length >= 6, `${ARCS.length} arcs`);
  assert.deepEqual(validateArcs(), []);
  for (const a of ARCS) assert.ok(personById(a.person), `${a.id}: ${a.person} is a person`);
});

test('arc conversations are valid dialog, voiced by known people', () => {
  const speakers = new Set([...ROSTER, ...EXTRAS, ...GUESTS].map((p) => p.id));
  const convs = allArcConversations();
  assert.ok(convs.length >= 25, `${convs.length} arc conversations`);
  assert.deepEqual(validate(convs, speakers), []);
  for (const c of convs) assert.ok(personById(c.with), `${c.id} is with ${c.with}`);
  // Every step's host stands somewhere real (or nowhere, on purpose).
  for (const a of ARCS)
    for (const [sid, s] of Object.entries(a.steps)) {
      if (!s.at.length) continue;
      assert.ok(resolveAt(s.at, REAL_STATIONS), `${a.id}/${sid}: ${s.at.join('|')} resolves in the Reach`);
    }
  assert.ok(ARC_GUESTS.length && RIVAL_GUESTS.length && ARC_CLIENTS.length);
});

test('arcs start on their triggers and advance while you are away (catching up)', () => {
  let w = emptyWorld();
  w = tick(w, 5 * M);
  assert.equal(step(w, 'nadia'), undefined, 'not yet');
  w = tick(w, 20 * M);
  assert.equal(step(w, 'nadia'), 'lists');
  assert.equal(step(w, 'imre'), 'tour');
  // Ten hours away: every arc runs to an ending by itself — none of them good.
  w = tick(w, 10 * 3600);
  for (const a of ARCS) {
    const v = arcView(w, a)!;
    assert.ok(v, `${a.id} started`);
    assert.ok(v.outcome === 'missed' || v.outcome === 'bad', `${a.id} ignored → ${v.stepId} (${v.outcome})`);
  }
  // Catch-up dates each timed step from when it would have happened.
  const n = arcView(w, arc('nadia'))!;
  assert.equal(n.stepId, 'trail');
  assert.equal(n.since, 12 * M + 80 * M + 100 * M, 'began at 12 min (its start clock) + 80 min → moving + 100 min → trail');
  // The log remembers every move.
  assert.ok(w.log.filter((e) => e.kind === 'npc.arc' && e.data?.arc === 'nadia').length === 3);
});

test('good paths: each arc can end well through facts and its named job', () => {
  const at = (facts: Record<string, string | boolean>, start: number) => Object.entries(facts).reduce((w, [k, v]) => setFact(w, k, v), tick(emptyWorld(), start, 11));
  // Odile: stake, then the board comes home.
  let w = at({}, 151 * M);
  assert.equal(step(w, 'odile'), 'shut', 'the Bastion has fallen (episode 11)');
  w = tick(setFact(w, 'npc.odile.stake'), 152 * M, 11);
  assert.equal(step(w, 'odile'), 'fitting');
  w = tick(setFact(w, 'contract.odile-board', 'done'), 160 * M, 11);
  assert.equal(step(w, 'odile'), 'open');
  assert.equal(fact(w, 'npc.odile.outcome'), 'good');
  // Magpie: hunted → Crane dead.
  w = tick(emptyWorld(), 26 * M);
  w = tick(w, 72 * M);
  assert.equal(step(w, 'magpie'), 'hunted');
  assert.equal(fact(w, 'npc.ninefingers.hunting'), 'magpie');
  w = tick(setFact(w, 'npc.ninefingers.status', 'dead'), 80 * M);
  assert.equal(step(w, 'magpie'), 'free');
  // Pell: courier, then testimony.
  w = tick(emptyWorld(), 1, 8);
  assert.equal(step(w, 'pell'), 'ledgers');
  w = tick(setFact(w, 'contract.pell-witness', 'done'), 30 * M, 8);
  assert.equal(step(w, 'pell'), 'testimony');
  w = tick(setFact(w, 'npc.pell.witness'), 40 * M, 8);
  assert.equal(fact(w, 'npc.pell.outcome'), 'good');
  // Toma: rest wins over the crack if he sleeps.
  w = tick(setFact(tick(emptyWorld(), 46 * M), 'npc.toma.rest'), 50 * M);
  w = tick(w, 90 * M);
  assert.equal(step(w, 'toma'), 'steady');
  // …or the picket captain's job brings him home.
  w = tick(tick(emptyWorld(), 46 * M), 90 * M);
  assert.equal(step(w, 'toma'), 'cracked');
  w = tick(setFact(w, 'contract.toma-null', 'ready'), 95 * M);
  assert.equal(step(w, 'toma'), 'home');
  // Dalca: tender escorted, then the essay.
  w = tick(setFact(tick(emptyWorld(), 16 * M), 'contract.dalca-tender', 'ready'), 40 * M);
  assert.equal(step(w, 'imre'), 'lysowick');
  w = tick(w, 71 * M);
  assert.equal(step(w, 'imre'), 'essay');
  // Nadia and Maud: their salvage jobs.
  w = tick(setFact(tick(emptyWorld(), 40 * M), 'contract.nadia-registry', 'done'), 41 * M);
  assert.equal(step(w, 'nadia'), 'found');
  w = tick(setFact(tick(emptyWorld(), 40 * M), 'contract.maud-core', 'ready'), 41 * M);
  assert.equal(step(w, 'maud'), 'asked');
});

test('placement: arcs put people on concourses (and take them off)', () => {
  let w = tick(emptyWorld(), 151 * M, 11);
  let place = arcPlacement(w, STATIONS);
  assert.equal(place.get('odile'), 'rustwake-freeport-0');
  const here = peopleAt(STATIONS.find((s) => s.id === 'rustwake-freeport-0')!, STATIONS, 151 * M, 11, place);
  assert.equal(here[0].id, 'odile', 'Odile is at the Moot-Hold, first in line');
  assert.ok(!peopleAt(STATIONS.find((s) => s.id === 'quilegard-freeport-0')!, STATIONS, 151 * M, 11, place).some((p) => p.id === 'odile'), 'and nowhere else');
  // Toma cracked: the picket captain hosts, Toma is on no concourse.
  w = tick(tick(emptyWorld(), 46 * M), 90 * M);
  place = arcPlacement(w, STATIONS);
  assert.equal(place.get('toma'), null);
  assert.equal(place.get('picket-okafor'), 'null-bastion-0');
  assert.equal(arcConversationFor(w, 'picket-okafor')?.id, 'arc-toma-cracked');
  // Missed: Odile is gone.
  w = tick(tick(emptyWorld(), 151 * M, 11), 400 * M, 11);
  assert.equal(step(w, 'odile'), 'gone');
  assert.equal(arcPlacement(w, STATIONS).get('odile'), null);
});

test('conversation choices write world facts that move the arc', () => {
  let w = tick(emptyWorld(), 151 * M, 11);
  const conv = stepConversation(arc('odile'), 'shut')!;
  const dw: DialogWorld = { state: newDialogState(), ledger: { credits: 5000, cargo: {}, capacity: 16, rep: { concord: 0, choir: 0, rustwake: 0 } }, episode: 11, facts: w.facts, counters: w.counters };
  let s = begin(conv, dw);
  assert.equal(s.node, 'fall', 'the Bastion line');
  s = advance(conv, s.node!, s.world);
  assert.equal(s.node, 'hello');
  s = advance(conv, 'hello', s.world, 0); // the stake
  assert.equal(s.world.ledger.credits, 3000);
  assert.equal(s.world.facts?.['npc.odile.stake'], true);
  for (const e of s.applied) if ('fact' in e) w = setFact(w, e.fact, e.value ?? true);
  w = tick(w, 152 * M, 11);
  assert.equal(step(w, 'odile'), 'fitting');
  // Staked already: the choice hides itself.
  const again = begin(stepConversation(arc('odile'), 'shut')!, { ...dw, facts: w.facts });
  const hello = advance(stepConversation(arc('odile'), 'shut')!, again.node!, again.world);
  const staked = stepConversation(arc('odile'), 'shut')!.nodes.hello.choices![0];
  assert.equal(hello.node, 'hello');
  assert.ok(staked.if, 'stake is conditional');
});

test('arc jobs build as named contracts and fly as operations', () => {
  const from: Record<string, string> = {
    'odile-board': 'rustwake-freeport-0',
    'magpie-crane': 'quilegard-freeport-0',
    'pell-witness': 'meridian-orbital-0',
    'nadia-registry': 'lysowick-salvage-0',
    'toma-null': 'null-bastion-0',
    'dalca-tender': 'anchorage-salvage-1',
    'maud-core': 'anchorage-salvage-1',
  };
  assert.deepEqual(Object.keys(from).sort(), [...ARC_CONTRACT_IDS].sort());
  for (const id of ARC_CONTRACT_IDS) {
    assert.ok(isArcContract(id) && isNamed(id));
    const inp = { reach: REACH, station: from[id], clock: 1234, rep: { concord: 10, choir: 0, rustwake: 10 }, tier: 2 as const };
    const k = namedContract(id, inp);
    assert.ok(k, `${id} builds`);
    assert.deepEqual(k, arcContract(id, inp), 'named.ts delegates');
    assert.equal(namedKey(k!), id);
    assert.equal(k!.named, id);
    assert.ok(k!.reward > 0 && k!.brief.length > 80);
    const r = acceptContract(newBook(), newLedger(), k!);
    assert.equal(r.error, undefined, `${id} accepted`);
    if (k!.op) {
      const op = buildOp(k!, [0, 0, 0]);
      assert.ok(op && op.mission.objectives.length, `${id} flies`);
    }
  }
  // Every job an arc offers is one of these.
  const offered = new Set<string>();
  for (const c of allArcConversations()) for (const n of Object.values(c.nodes)) for (const e of [...(n.effects ?? []), ...(n.choices ?? []).flatMap((x) => x.effects ?? [])]) if ('contract' in e) offered.add(e.contract);
  assert.deepEqual([...offered].sort(), [...ARC_CONTRACT_IDS].sort());
});

test('{memory}: NPCs recall specific events from the world log', () => {
  let w = emptyWorld();
  assert.match(memoryLine(w, 'odile', 0), /./, 'a fallback when nothing happened');
  w = record(w, 'contract.failed', 'system:halaedon', { kind: 'escort', sys: 'Halaedon', freighter: 'Kittiwake', title: 'x' });
  assert.equal(recall(w)?.text, 'You were at Halaedon when the Kittiwake burned.');
  w = record(w, 'npc.arc', 'npc:magpie', { arc: 'magpie', step: 'free', outcome: 'good' });
  assert.equal(recall(w, { about: 'magpie' })?.text, 'You squared Magpie\'s paper.');
  assert.equal(recall(w, { about: 'odile' })?.text, 'You squared Magpie\'s paper.', 'newest wins when nothing names the speaker');
  w = record(w, 'unknown.kind', undefined, { sys: 'x' });
  assert.ok(recall(w)!.text.length > 10, 'unknown kinds are skipped, not garbled');
});
