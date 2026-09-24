import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, fact, counter, mod, type WorldState } from '../src/game/world/WorldState.ts';
import {
  BACKGROUND,
  NEWS_PERIOD,
  STORY_RULES,
  actAmbush,
  actContract,
  actKill,
  actTrade,
  attitude,
  backfillStory,
  boardWeights,
  completeEpisode,
  fastForward,
  lanternToll,
  piracyOffset,
  priceOffset,
  storyMod,
  sysMod,
  trafficOffset,
  type ReachInfo,
} from '../src/game/world/sim.ts';
import { stepWorld } from '../src/game/world/step.ts';
import { BURST_PERIOD, SIGNAL_ANCHORS, isPrime, primeIndex, signalState } from '../src/game/world/signal.ts';
import { worldNews, eventLine } from '../src/game/world/news.ts';
import { midPrice, newLedger, quote, setMarketWorld, dockingClearance, type MarketSpec } from '../src/game/economy.ts';
import { piracy, setTrafficWorld, systemVolume } from '../src/universe/traffic.ts';

export const REACH: ReachInfo = {
  seed: 1994,
  systems: [
    { id: 'meridian', name: 'Meridian Prime', faction: 'concord', threat: 0.2, gates: ['anchorage', 'lysowick'], stations: [{ id: 'meridian-orbital-0', name: 'Castellan Ring', kind: 'orbital', faction: 'concord' }, { id: 'meridian-refinery-1', name: 'Tey Refinery', kind: 'refinery', faction: 'concord' }] },
    { id: 'anchorage', name: 'Anchorage', faction: 'concord', threat: 0.1, gates: ['meridian'], stations: [{ id: 'anchorage-bastion-0', name: 'Anchorage Bastion', kind: 'bastion', faction: 'concord' }, { id: 'anchorage-orbital-2', name: 'Anchorage Orbital', kind: 'orbital', faction: 'concord' }] },
    { id: 'lysowick', name: 'Lysowick', faction: 'contested', threat: 0.6, gates: ['meridian', 'zephacis', 'rustwake'], stations: [{ id: 'lysowick-salvage-0', name: 'Lysowick Yard', kind: 'salvage', faction: 'rustwake' }] },
    { id: 'zephacis', name: 'Zephacis', faction: 'contested', threat: 0.5, gates: ['lysowick', 'tessaly'], stations: [{ id: 'zephacis-freeport-0', name: 'Zephacis Free Port', kind: 'freeport', faction: 'rustwake' }] },
    { id: 'rustwake', name: 'Rustwake Belt', faction: 'rustwake', threat: 0.05, gates: ['lysowick'], stations: [{ id: 'rustwake-refinery-2', name: 'Ember Works', kind: 'refinery', faction: 'rustwake' }, { id: 'rustwake-salvage-1', name: 'Moot-Hold Yard', kind: 'salvage', faction: 'rustwake' }] },
    { id: 'tessaly', name: 'Tessaly', faction: 'choir', threat: 0.9, gates: ['zephacis', 'null'], stations: [{ id: 'tessaly-refinery-0', name: 'Tessaly Fields', kind: 'refinery', faction: 'choir' }] },
    { id: 'null', name: 'Null Lantern', faction: 'unknown', threat: 1, gates: ['tessaly'], stations: [{ id: 'null-bastion-0', name: 'Null Picket', kind: 'bastion', faction: 'concord' }] },
  ],
};

const sysOf = (id: string) => REACH.systems.find((s) => s.stations.some((st) => st.id === id))?.id ?? 'meridian';

function install(w: () => WorldState): void {
  setMarketWorld({ price: (spec, cid) => priceOffset(w(), sysOf(spec.id), spec.id, cid, spec.kind), attitude: (spec) => attitude(w(), spec, sysOf(spec.id)) });
  setTrafficWorld({ volume: (id) => trafficOffset(w(), id), piracy: (id) => piracyOffset(w(), id), patrol: () => 0 });
}
function uninstall(): void {
  setMarketWorld(null);
  setTrafficWorld(null);
}

// ── story facts → lasting changes ────────────────────────────────────

test('every episode has a rule, 1..20, with a headline', () => {
  assert.deepEqual(STORY_RULES.map((r) => r.ep), Array.from({ length: 20 }, (_, i) => i + 1));
  for (const r of STORY_RULES) assert.ok(r.news.length > 20 && r.news.length < 200, `ep ${r.ep}`);
});

test('completing an episode writes facts, anchors the Signal, is idempotent', () => {
  let w = { ...emptyWorld(), clock: 500 };
  w = completeEpisode(w, 10);
  assert.equal(fact(w, 'story.ep10.done'), true);
  assert.equal(fact(w, 'bastion.fallen'), true);
  assert.equal(counter(w, 'signal.anchor'), 500);
  assert.equal(w.log.at(-1)?.kind, 'story');
  assert.equal(completeEpisode(w, 10), w);
});

test('the Bastion falls: Anchorage wants rations and medical, traffic up, patrols thin — and it lasts', () => {
  const w0 = fastForward(9);
  const w = completeEpisode(w0, 10);
  assert.ok(priceOffset(w, 'anchorage', 'anchorage-orbital-2', 'rations') > 0.25);
  assert.ok(priceOffset(w, 'anchorage', 'anchorage-orbital-2', 'medical') > 0.3);
  assert.ok(trafficOffset(w, 'anchorage') > 0.3);
  assert.ok(sysMod(w, 'anchorage', 'patrol') < 0);
  assert.equal(priceOffset(w0, 'anchorage', 'anchorage-orbital-2', 'rations'), 0);
  // Story effects are derived from facts, not decaying mods: a day later they still hold.
  const later = stepWorld(w, 86_400, REACH).w;
  assert.ok(priceOffset(later, 'anchorage', 'anchorage-orbital-2', 'rations') >= 0.28 - 0.2, 'story mods do not decay away');
  assert.ok(storyMod(later, 'system:anchorage', 'price:rations') === 0.28);
});

test('the Schism contests Tessaly; the Symphony of Gates collapses Ebon and frees the Lanterns', () => {
  const w13 = fastForward(13);
  const w14 = fastForward(14);
  assert.ok(piracyOffset(w14, 'tessaly') > piracyOffset(w13, 'tessaly'));
  assert.ok(priceOffset(w14, 'tessaly', 'tessaly-refinery-0', 'ebon') > 0.15);
  const w18 = fastForward(18);
  const w19 = fastForward(19);
  assert.ok(priceOffset(w19, 'meridian', 'meridian-refinery-1', 'ebon', 'refinery') <= -0.6, 'Ebon collapses');
  assert.ok(priceOffset(w19, 'anchorage', 'anchorage-bastion-0', 'ebon', 'bastion') < priceOffset(w19, 'meridian', 'meridian-refinery-1', 'ebon', 'refinery') - 0.1, 'nobody needs it: the demand side falls furthest');
  assert.ok(priceOffset(w18, 'meridian', 'meridian-refinery-1', 'ebon') > -0.1);
  assert.ok(lanternToll(w18) > 50);
  assert.equal(lanternToll(w19), 0, 'gate fuel is free');
  assert.equal(fact(w19, 'gates.aligned'), true);
});

test('the Ebon floor holds dips until the Schedule is read aloud', () => {
  let w = fastForward(10);
  w = { ...w, mods: { 'system:*': { 'price:ebon': { value: -0.4, decay: 0 } } } };
  assert.equal(priceOffset(w, 'meridian', 'meridian-refinery-1', 'ebon'), -0.05);
  const read = completeEpisode(fastForward(17, 0, w), 18);
  assert.ok(priceOffset(read, 'meridian', 'meridian-refinery-1', 'ebon') < -0.3);
});

test('backfill completes every episode below the profile episode', () => {
  const w = backfillStory(emptyWorld(), 9);
  for (let e = 1; e <= 8; e++) assert.equal(fact(w, `story.ep${e}.done`), true);
  assert.equal(fact(w, 'story.ep9.done'), undefined);
});

// ── player actions → local changes ───────────────────────────────────

test('clearing raiders thins piracy and swells traffic on that system; three saves make it safe', () => {
  let w = emptyWorld();
  for (let i = 0; i < 3; i++) w = actAmbush(w, 'lysowick', 'concord', 3, true);
  assert.ok(piracyOffset(w, 'lysowick') <= -0.2);
  assert.ok(trafficOffset(w, 'lysowick') >= 0.3);
  assert.equal(fact(w, 'lane.lysowick.safe'), true);
  assert.equal(piracyOffset(w, 'zephacis'), 0, 'only there');
  // It decays over hours, not minutes.
  const hour = stepWorld(w, 3600, { ...REACH, systems: [] }).w;
  assert.ok(piracyOffset(hour, 'lysowick') < -0.15);
  const lost = actAmbush(emptyWorld(), 'zephacis', 'rustwake', 0, false);
  assert.ok(piracyOffset(lost, 'zephacis') > 0);
});

test('killing a faction\'s ships brings patrols and cools its stations; contracts warm a station', () => {
  let w = emptyWorld();
  for (let i = 0; i < 5; i++) w = actKill(w, 'tessaly', 'choir');
  assert.ok(sysMod(w, 'tessaly', 'patrol') > 0.5);
  assert.ok(attitude(w, { id: 'tessaly-refinery-0', faction: 'choir', kind: 'refinery' }, 'tessaly') < -0.15);
  assert.equal(w.log.at(-1)?.kind, 'kills');
  let c = emptyWorld();
  for (let i = 0; i < 4; i++) c = actContract(c, 'meridian-orbital-0', 'concord');
  assert.ok(attitude(c, { id: 'meridian-orbital-0', faction: 'concord', kind: 'orbital' }, 'meridian') > 0.25);
});

test('heavy selling sags a station\'s price for hours; a run of eight makes the news', () => {
  let w = emptyWorld();
  for (let i = 0; i < 8; i++) w = actTrade(w, 'meridian-refinery-1', 'meridian', 'ebon', 2); // sold in pairs
  assert.equal(priceOffset(w, 'meridian', 'meridian-refinery-1', 'relics'), 0);
  assert.ok(mod(w, 'station:meridian-refinery-1', 'price:ebon') < -0.1);
  assert.equal(w.log.filter((e) => e.kind === 'trade.dump').length, 1, 'one headline per run');
  const later = stepWorld(w, 2 * 3600, { ...REACH, systems: [] }).w;
  assert.ok(mod(later, 'station:meridian-refinery-1', 'price:ebon') < -0.05, 'still there two hours on');
  assert.equal(mod(later, 'station:meridian-refinery-1', 'vol:ebon'), 0, 'the run tally drains');
  const bought = actTrade(emptyWorld(), 'meridian-refinery-1', 'meridian', 'ebon', -10);
  assert.ok(priceOffset(bought, 'meridian', 'meridian-refinery-1', 'ebon') > 0.05);
  assert.equal(bought.log.at(-1)?.kind, 'trade.corner');
});

// ── background drift ─────────────────────────────────────────────────

test('background news: about four events an hour, deterministic, logged', () => {
  const a = stepWorld(fastForward(2), 3600, REACH);
  const b = stepWorld(fastForward(2), 3600, REACH);
  const news = a.events.filter((e) => e.kind === 'news');
  assert.equal(news.length, 3600 / NEWS_PERIOD);
  assert.deepEqual(a.events, b.events, 'same world, same Reach');
  for (const e of news) assert.ok(BACKGROUND.some((t) => t.id === e.data!.k));
  for (const e of news) assert.ok(eventLine(e, REACH, a.w), `a line for ${e.data!.k}`);
  // Stepped in frames, the same events happen.
  let w = fastForward(2);
  const kinds: string[] = [];
  for (let t = 0; t < 3600; t += 50) {
    const r = stepWorld(w, 50, REACH);
    w = r.w;
    kinds.push(...r.events.filter((e) => e.kind === 'news').map((e) => String(e.data!.k)));
  }
  assert.deepEqual(kinds, news.map((e) => String(e.data!.k)));
});

test('chapter gates background events: refugees after the Fall, humming Lanterns after the Symphony', () => {
  const kinds = (ep: number) => {
    let w = fastForward(ep);
    const out = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = stepWorld(w, NEWS_PERIOD, REACH);
      w = r.w;
      for (const e of r.events) if (e.kind === 'news') out.add(String(e.data!.k));
    }
    return out;
  };
  const early = kinds(3);
  const fall = kinds(10);
  const open = kinds(19);
  assert.ok(!early.has('refugees') && fall.has('refugees'));
  assert.ok(!fall.has('lantern-hums') && open.has('lantern-hums'));
  assert.ok(!open.has('ember-flare'));
});

// ── the Signal ────────────────────────────────────────────────────────

test('the Signal: hidden before Episode 5, pinned to each debrief, ticks primes in free flight', () => {
  assert.equal(signalState(fastForward(4)).count, null);
  for (const [ep, n] of Object.entries(SIGNAL_ANCHORS)) {
    assert.ok(isPrime(n), `${n} is prime`);
    assert.equal(signalState(fastForward(Number(ep))).count, n, `ep ${ep}`);
  }
  let w = fastForward(5);
  assert.equal(signalState(w).count, 1009);
  w = stepWorld(w, BURST_PERIOD, REACH).w;
  assert.equal(signalState(w).count, 997);
  assert.ok(w.log.some((e) => e.kind === 'signal.burst' && e.data!.count === 997));
  // Never reaches the next episode's count on its own.
  w = stepWorld(w, BURST_PERIOD * 50, REACH).w;
  assert.equal(signalState(w).count, 991, 'held above 983 (Episode 6)');
  assert.equal(signalState(w).nextIn, null);
  // Episode 13: the Breath countdown (fifty-six days at 241).
  assert.equal(signalState(fastForward(13)).breathDays, 56);
  assert.equal(signalState(fastForward(12)).source, 'monolith');
  assert.equal(signalState(fastForward(19)).mode, 'stopped');
  const up = stepWorld(fastForward(20), BURST_PERIOD * 2 + 1, { ...REACH, systems: [] }).w;
  assert.deepEqual([signalState(fastForward(20)).count, signalState(up).count], [2, 5]);
  assert.equal(primeIndex(1009) - primeIndex(2), 168);
});

// ── readers wired into economy + traffic ───────────────────────────────

test('economy reader: world price offsets reach quotes; a cold station charges a tariff and can refuse a berth', () => {
  let w: WorldState = fastForward(18);
  install(() => w);
  try {
    const spec: MarketSpec = { id: 'meridian-refinery-1', kind: 'refinery', faction: 'concord', risk: 0.2 };
    const l = { ...newLedger(), clock: 600 };
    const before = midPrice(spec, 'ebon', l);
    w = completeEpisode(w, 19);
    const after = midPrice(spec, 'ebon', l);
    assert.ok(after < before * 0.35, `Ebon ${before.toFixed(0)} → ${after.toFixed(0)}`);
    const warm = quote(spec, 'spares', l)!;
    w = { ...w, mods: { ...w.mods, 'guild:continuity': { attitude: { value: -1, decay: 0 } } } };
    const cold = quote(spec, 'spares', l)!;
    assert.ok(cold.buy > warm.buy && cold.sell < warm.sell, 'tariff widens the spread');
    const bastion: MarketSpec = { id: 'anchorage-bastion-0', kind: 'bastion', faction: 'concord' };
    const att = attitude(w, bastion, 'anchorage');
    assert.ok(att <= -0.8);
    assert.equal(dockingClearance(l, 'concord', att).ok, false);
    assert.equal(dockingClearance(l, 'concord').ok, true, 'no attitude given: standing alone decides');
  } finally {
    uninstall();
  }
});

test('traffic reader: a cleared lane sails more and raids less', () => {
  let w = emptyWorld();
  install(() => w);
  try {
    const sys = { id: 'lysowick', faction: 'contested' as const, threat: 0.6 };
    const v0 = systemVolume(sys);
    const p0 = piracy(sys);
    for (let i = 0; i < 3; i++) w = actAmbush(w, 'lysowick', 'concord', 3, true);
    assert.ok(systemVolume(sys) > v0 * 1.25);
    assert.ok(piracy(sys) < p0 * 0.5);
    assert.equal(piracy({ faction: 'contested', threat: 0.6 }), p0, 'no id: the default Reach');
  } finally {
    uninstall();
  }
});

test('board weights follow the lanes: raided systems post bounties, busy ones hauls, open gates recon', () => {
  const raided = { ...emptyWorld(), mods: { 'system:zephacis': { piracy: { value: 0.2, decay: 0 } } } };
  assert.ok(boardWeights(raided, 'zephacis').bounty! > 2);
  assert.deepEqual(boardWeights(emptyWorld(), 'zephacis'), {});
  assert.ok(boardWeights(fastForward(19), 'meridian').recon! > 1);
  assert.ok(boardWeights(fastForward(10), 'anchorage').haul! > 1);
});

test('news: the chapter headline, the count and local events lead the ticker', () => {
  let w = fastForward(10, 0);
  w = actAmbush(actAmbush(actAmbush(w, 'anchorage', 'concord', 2, true), 'anchorage', 'concord', 2, true), 'anchorage', 'concord', 2, true);
  const lines = worldNews(w, REACH, { sysId: 'anchorage', stationId: 'anchorage-orbital-2' });
  assert.match(lines[0], /BASTION/);
  assert.ok(lines.some((l) => /NULL COUNT: 887/.test(l)), lines.join(' | '));
  assert.ok(lines.some((l) => /Anchorage run safe/.test(l)), lines.join(' | '));
  assert.deepEqual(worldNews(emptyWorld(), REACH, { sysId: 'meridian' }), []);
});
