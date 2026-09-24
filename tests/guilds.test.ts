import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { createServer, type ViteDevServer } from 'vite';
import { emptyWorld, fact, recall, tick, type WorldState } from '../src/game/world/WorldState.ts';
import { DUES_PERIOD, GUILDS, GUILD_CAST, GUILD_IDS, MAX_RANK, RANK_MERIT, hallAt, hostility, type GuildId } from '../src/game/guilds/guilds.ts';
import { awardMerit, canJoin, checkArrears, duesOwed, duesPeriods, expel, greeting, isExpelled, join, leave, meritOf, payDues, promote, promotionBlock, rankOf, titleIn } from '../src/game/guilds/membership.ts';
import { guildOffers, workMerit, GRAM_PRICE } from '../src/game/guilds/board.ts';
import { ARCS, arcContract, arcOf, arcState, buildArcOp, choose, completeStep, pendingChoice, type ArcStep } from '../src/game/guilds/arcs.ts';
import { buyFromQuartermaster, stockFor, stockOf } from '../src/game/guilds/quartermaster.ts';
import { CLIENTS, MARK_CAST, acceptContract, markReady, newBook, settleAt, type Contract, type ReachMap } from '../src/game/contracts/contracts.ts';
import { buildOp } from '../src/game/contracts/ops.ts';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import { CAST } from '../src/game/campaign/cast.ts';
import { COMMODITIES, newLedger, type TradeLedger } from '../src/game/economy.ts';
import { ITEMS, ITEM_BY_ID } from '../src/game/outfitting/items.ts';
import { computeFit } from '../src/game/outfitting/fit.ts';
import { activeShip, entryOf, newHangar, stocks } from '../src/game/outfitting/hangar.ts';
import { STAGES, build, claim, claimBlock, deliver, hasService, nextNeeds, outpostOf, outpostSites, raidBegins, raidContract, raidDue, raidResolved, stow, siteById } from '../src/game/outposts/outposts.ts';

/**
 * Guilds, guild arcs and outposts (batch 5 · milestones 1–3): the five
 * guilds' data, the membership rules over the shared WorldState (merit,
 * conflicts, exclusive top ranks, dues, leaving and expulsion), guild work,
 * the quartermaster, every arc mission flown end to end in the real
 * CampaignRunner against the real seed-1994 Reach, the finales' choices, and
 * an outpost from claim to guns on the rim.
 */

const REP = { concord: 60, choir: 40, rustwake: 30 };
const rich = (credits = 200_000): TradeLedger => ({ ...newLedger(), credits, cargo: {}, rep: { ...REP } });

/** Join and set a rank/merit directly (test setup). */
function member(w: WorldState, g: GuildId, rank: number, merit = RANK_MERIT[rank]): WorldState {
  if (rankOf(w, g) === 0) w = join(w, g, REP).world;
  return { ...w, facts: { ...w.facts, [`guild.${g}.rank`]: String(rank) }, counters: { ...w.counters, [`guild.${g}.merit`]: merit } };
}

// ── the real Reach (Vite SSR: the generator imports render presets) ──

let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});
let reachCache: ReachMap | null = null;
async function realReach(): Promise<ReachMap> {
  if (reachCache) return reachCache;
  server ??= await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const gen = await server.ssrLoadModule('/src/universe/generate.ts');
  const u = gen.generateUniverse(1994);
  const a = (v: { x: number; y: number; z: number }): [number, number, number] => [v.x, v.y, v.z];
  reachCache = {
    systems: [...u.systems.values()].map((s: any) => ({
      id: s.id,
      name: s.name,
      faction: s.faction,
      threat: s.threat,
      stations: s.stations.map((st: any) => ({ id: st.id, name: st.name, kind: st.kind, faction: st.faction, pos: a(st.position), axis: a(st.axis), planet: st.planet })),
      gates: s.gates.map((g: any) => ({ to: g.to, pos: a(g.position), normal: a(g.normal) })),
    })),
  };
  return reachCache;
}

// ── data ─────────────────────────────────────────────────────────────

test('five guilds, six ranks each on rising merit, a master and a quartermaster, voices and seats', async () => {
  assert.deepEqual([...GUILD_IDS].sort(), ['allocation', 'continuity', 'houses', 'keeping', 'rustwake']);
  const known = new Set([...CLIENTS.map((c) => c.id), ...GUILD_CAST.map((c) => c.id)]);
  for (const g of GUILD_IDS) {
    const gd = GUILDS[g];
    assert.equal(gd.ranks.length, MAX_RANK, g);
    for (let r = 1; r < gd.ranks.length; r++) assert.ok(gd.ranks[r].merit > gd.ranks[r - 1].merit, `${g} rank ${r + 1}`);
    assert.ok(known.has(gd.master) && known.has(gd.quartermaster), `${g} people`);
    assert.ok(gd.ranks.every((r) => r.name && r.title && r.line && r.perk));
  }
  // The Keeping's ladder is the Seven Keepings.
  GUILDS.keeping.ranks.forEach((r, i) => assert.match(r.line, new RegExp(['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'][i])));
  const reach = await realReach();
  const halls = new Map<GuildId, string[]>();
  for (const s of reach.systems) for (const st of s.stations) {
    const g = hallAt(st);
    if (g) halls.set(g, [...(halls.get(g) ?? []), st.id]);
  }
  for (const g of GUILD_IDS) {
    assert.ok((halls.get(g)?.length ?? 0) >= 2, `${g} has halls: ${halls.get(g)}`);
    assert.ok(halls.get(g)!.includes(GUILDS[g].seat), `${g} seat ${GUILDS[g].seat} is a hall`);
  }
  assert.equal(hallAt({ id: 'anchorage-salvage-1', kind: 'salvage', faction: 'concord' }), 'keeping');
  assert.equal(hallAt({ id: 'outpost-anchorage', kind: 'salvage', faction: 'concord' }), null);
  assert.equal(hallAt({ id: 'x', kind: 'refinery', faction: 'choir' }), null);
});

// ── membership ───────────────────────────────────────────────────────

test('join, earn merit, petition for rank: facts and counters in the world, events on the log', () => {
  let w = emptyWorld();
  assert.equal(rankOf(w, 'keeping'), 0);
  w = join(w, 'keeping', REP).world;
  assert.equal(fact(w, 'guild.keeping.rank'), '1');
  assert.equal(fact(w, 'guild.keeping.title'), 'Postulant');
  assert.match(promotionBlock(w, 'keeping', REP)!, /MERIT 0\/100/);
  w = awardMerit(w, 'keeping', 100).world;
  const r = promote(w, 'keeping', REP);
  assert.ok(!r.error, r.error);
  w = r.world;
  assert.equal(rankOf(w, 'keeping'), 2);
  assert.equal(titleIn(w, 'keeping'), 'Feed-Keeper');
  assert.match(greeting(w, 'keeping'), /Feed-Keeper/);
  assert.deepEqual(recall(w, { scope: 'guild:keeping' }).map((e) => e.kind), ['guild.rank', 'guild.merit', 'guild.join']);
  // Standing gates the ladder.
  const cont = member(emptyWorld(), 'continuity', 3, 500);
  assert.match(promotionBlock(cont, 'continuity', { ...REP, concord: 10 })!, /STANDING/);
  assert.equal(join(emptyWorld(), 'continuity', { ...REP, concord: 0 }).error, 'NEEDS DIRECTORATE STANDING +10');
  // Rank-ups the rivals notice.
  const h = promote(member(emptyWorld(), 'houses', 1, 120), 'houses', REP);
  assert.equal(h.rep.concord, -3);
});

test('conflicts: the Office and the clans drain each other; a rival below zero expels you; seniors are refused', () => {
  let w = member(emptyWorld(), 'rustwake', 2, 120);
  w = join(w, 'continuity', REP).world;
  const r = awardMerit(w, 'continuity', 100);
  assert.equal(meritOf(r.world, 'rustwake'), 70, 'half of it, from the clans');
  const r2 = awardMerit(r.world, 'continuity', 200);
  assert.ok(isExpelled(r2.world, 'rustwake'));
  assert.equal(rankOf(r2.world, 'rustwake'), 0);
  assert.equal(canJoin(r2.world, 'rustwake', REP), 'THE MOOT SCRAPED YOUR MARK. IT DOES NOT PAINT TWICE.');
  // The Keeping is neutral-ish: Board work costs it nothing.
  assert.equal(hostility('keeping', 'allocation'), 0);
  assert.ok(hostility('houses', 'continuity') > 0 && hostility('continuity', 'houses') === hostility('houses', 'continuity'));
  // A Case Officer of the Office will not be admitted to a House, nor the Moot.
  const senior = member(emptyWorld(), 'continuity', 4);
  assert.match(canJoin(senior, 'houses', REP)!, /WILL NOT ADMIT/);
  assert.match(canJoin(senior, 'rustwake', REP)!, /WILL NOT ADMIT/);
  assert.equal(canJoin(senior, 'keeping', REP), null);
});

test('top ranks are exclusive, need the arc behind you — and the Houses’ need the Oath', () => {
  let w = member(emptyWorld(), 'keeping', 4, 800);
  assert.equal(promotionBlock(w, 'keeping', REP), 'COMPLETE THE GUILD’S ARC FIRST');
  w = { ...w, facts: { ...w.facts, 'arc.keeping.done': true, 'arc.allocation.done': true } };
  w = promote(w, 'keeping', REP).world;
  assert.equal(rankOf(w, 'keeping'), 5);
  w = member(w, 'allocation', 4, 800);
  assert.match(promotionBlock(w, 'allocation', REP)!, /EXCLUSIVE — YOU ARE WARDEN OF THE OLD WORDS/);
  let h = member(emptyWorld(), 'houses', 4, 800);
  h = { ...h, facts: { ...h.facts, 'arc.houses.done': true, 'houses.oath': 'declined' } };
  assert.equal(promotionBlock(h, 'houses', { ...REP, choir: 60 }), 'ONLY THE SWORN RISE FURTHER');
  h = { ...h, facts: { ...h.facts, 'houses.oath': 'sworn' } };
  assert.equal(promotionBlock(h, 'houses', { ...REP, choir: 60 }), null);
});

test('dues: owed by the period, paid in shares or in kind; arrears cost merit once a period, four periods expel', () => {
  let w = member(emptyWorld(), 'keeping', 2, 300);
  w = tick(w, DUES_PERIOD * 2 + 10);
  assert.equal(duesPeriods(w, 'keeping'), 2);
  assert.equal(duesOwed(w, 'keeping'), 2 * GUILDS.keeping.dues.perRank * 2);
  assert.match(promotionBlock(w, 'keeping', REP)!, /MERIT|ARREARS/);
  const a = checkArrears(w);
  assert.equal(meritOf(a.world, 'keeping'), 270);
  assert.equal(meritOf(checkArrears(a.world).world, 'keeping'), 270, 'once per period');
  const kind = payDues(a.world, 'keeping', { ...rich(), cargo: { spares: 1 } }, true);
  assert.ok(!kind.error);
  assert.equal(kind.ledger.cargo.spares, undefined);
  assert.equal(duesPeriods(kind.world, 'keeping'), 1);
  const paid = payDues(kind.world, 'keeping', rich(1000));
  assert.equal(paid.ledger.credits, 1000 - GUILDS.keeping.dues.perRank * 2);
  assert.equal(duesPeriods(paid.world, 'keeping'), 0);
  assert.ok(payDues(paid.world, 'keeping', rich()).error, 'nothing owed');
  const gone = checkArrears(tick(w, DUES_PERIOD * 2));
  assert.ok(isExpelled(gone.world, 'keeping'));
});

test('leaving: the Seventh Keeping — rank and merit gone, remembered; you may come back, the expelled may not', () => {
  let w = member(emptyWorld(), 'keeping', 3, 400);
  const r = leave(w, 'keeping');
  w = r.world;
  assert.equal(rankOf(w, 'keeping'), 0);
  assert.equal(fact(w, 'guild.keeping.left'), true);
  assert.match(r.notes[0].text, /SEVENTH KEEPING/);
  assert.equal(canJoin(w, 'keeping', REP), null);
  const x = expel(member(emptyWorld(), 'allocation', 2), 'allocation', 'theft');
  assert.ok(canJoin(x.world, 'allocation', REP));
});

// ── guild work ───────────────────────────────────────────────────────

test('guild work: members only, re-voiced by the quartermaster, merit on top of the fee, clan pay in grams — a rank in ~45 minutes', async () => {
  const reach = await realReach();
  const base = { reach, clock: 1200, rep: REP, tier: 1 as const, goods: COMMODITIES };
  assert.deepEqual(guildOffers({ ...base, station: 'anchorage-salvage-1', guild: 'keeping', rank: 0 }), []);
  let merit = 0;
  let jobs = 0;
  for (const g of GUILD_IDS) {
    for (const station of [GUILDS[g].seat]) {
      const a = guildOffers({ ...base, station, guild: g, rank: 1 });
      assert.deepEqual(a, guildOffers({ ...base, station, guild: g, rank: 1 }), 'deterministic');
      assert.ok(a.length >= 2, `${g} posts work`);
      assert.equal(new Set(a.map((k) => k.id)).size, a.length);
      for (const k of a) {
        assert.equal(k.guild, g);
        assert.equal(k.client, GUILDS[g].quartermaster);
        assert.ok(k.merit! >= 20 && k.merit === workMerit(k.kind, k.tier), `${k.kind} merit ${k.merit}`);
        if (g === 'rustwake') assert.ok(k.grams! >= 10 && k.grams! % 10 === 0);
        else assert.equal(k.grams, undefined);
        merit += k.merit!;
        jobs++;
      }
    }
  }
  // Four jobs at ~11 minutes each clear rank 2 (100 merit).
  assert.ok((merit / jobs) * 4 >= RANK_MERIT[2], `avg merit ${(merit / jobs).toFixed(1)}`);
  // A settled guild contract pays shares like any other (merit and grams are the runtime's).
  const k = guildOffers({ ...base, station: 'rustwake-freeport-0', guild: 'rustwake', rank: 3 })[0];
  const acc = acceptContract({ ...newBook(), clock: 1200 }, rich(), k);
  assert.ok(!acc.error, acc.error);
  const ready = k.kind === 'courier' || k.kind === 'haul' ? acc.book : markReady(acc.book, k.id);
  const paid = settleAt(ready, acc.ledger, k.payAt);
  assert.equal(paid.receipts?.[0]?.amount, k.reward);
  assert.ok(k.reward + (k.grams! / 10) * 10 * GRAM_PRICE > 0);
});

// ── quartermaster ────────────────────────────────────────────────────

test('quartermaster: relic-grade Mk V, rank-locked, discounted, never on a station yard, fitted on the spot', () => {
  for (const g of GUILD_IDS) assert.ok(stockOf(g).length >= 3, g);
  const all = GUILD_IDS.flatMap((g) => stockOf(g));
  for (const it of all) {
    assert.equal(it.mk, 5);
    assert.equal(ITEM_BY_ID[it.id], it);
    assert.ok(!ITEMS.includes(it));
    assert.ok(!stocks({ id: 'meridian-bastion-2', kind: 'bastion', faction: 'concord' }, it));
  }
  const h = newHangar();
  const lines = stockFor('keeping', 1, h);
  const heart = lines.find((x) => x.item.name.includes('SEALED HEART'))!;
  assert.ok(heart && heart.slot && heart.lock, 'fits the Kestrel, locked at rank 1');
  assert.ok(buyFromQuartermaster(h, rich(), 'keeping', 1, heart.item.id, { id: 'anchorage-salvage-1', kind: 'salvage', faction: 'concord' }).error);
  const r = buyFromQuartermaster(h, rich(), 'keeping', 3, heart.item.id, { id: 'anchorage-salvage-1', kind: 'salvage', faction: 'concord' });
  assert.ok(!r.error, r.error);
  const ship = activeShip(r.hangar);
  assert.equal(ship.fit[heart.slot!.id], heart.item.id);
  assert.ok(computeFit(entryOf(ship), ship.fit).power.output > computeFit(entryOf(activeShip(h)), activeShip(h).fit).power.output);
  assert.ok(stockFor('keeping', 3, h).find((x) => x.item.id === heart.item.id)!.price < heart.item.price, 'rank discount');
});

// ── arcs ─────────────────────────────────────────────────────────────

const PEOPLE = new Set(['system', ...CAST.map((c) => c.id), ...CLIENTS.map((c) => c.id), ...MARK_CAST.map((c) => c.id), ...GUILD_CAST.map((c) => c.id)]);

test('arcs: four hand-written steps per guild, gated by rank and episode, each finale a choice with a lasting fact', () => {
  assert.equal(ARCS.length, 20);
  for (const g of GUILD_IDS) {
    const steps = arcOf(g);
    assert.deepEqual(steps.map((s) => s.n), [1, 2, 3, 4], g);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].rank >= steps[i - 1].rank && steps[i].episode >= steps[i - 1].episode);
    const fin = steps[3];
    assert.ok(fin.choice && fin.choice.options.length === 2, `${g} finale chooses`);
    const keys = fin.choice!.options.map((o) => Object.keys(o.facts)[0]);
    assert.equal(keys[0], keys[1], 'both options write the same fact');
    assert.notEqual(fin.choice!.options[0].facts[keys[0]], fin.choice!.options[1].facts[keys[0]]);
    for (const s of steps) assert.ok(s.synopsis.length > 40 && s.brief.length > 200, s.id);
  }
  // Gating.
  let w = member(emptyWorld(), 'keeping', 1);
  let st = arcState(w, 'keeping', 1);
  assert.deepEqual(st.map((x) => x.status), ['available', 'locked', 'locked', 'locked']);
  w = completeStep(w, 'keeping-1');
  st = arcState(w, 'keeping', 1);
  assert.equal(st[1].status, 'locked');
  assert.match(st[1].why!, /RANK 2/);
  w = member(w, 'keeping', 2);
  assert.equal(arcState(w, 'keeping', 1)[1].status, 'available');
  assert.equal(arcState(w, 'keeping', 1, ['keeping-2'])[1].status, 'active');
  w = member(w, 'keeping', 3);
  w = completeStep(w, 'keeping-2');
  assert.match(arcState(w, 'keeping', 1)[2].why!, /EPISODE 02/);
  assert.equal(fact(w, 'keeping.core-rehoused'), true);
});

test('finales: completing the last step leaves the choice pending; choosing sets the fact, moves merit and standing, expels', () => {
  let w = member(emptyWorld(), 'continuity', 4, 600);
  w = member(w, 'rustwake', 1, 10);
  for (const n of [1, 2, 3]) w = completeStep(w, `continuity-${n}`);
  w = completeStep(w, 'continuity-4');
  assert.equal(pendingChoice(w, 'continuity')?.id, 'continuity-4');
  assert.equal(arcState(w, 'continuity', 9)[3].status, 'choice');
  const leak = choose(w, 'continuity-4', 'leaked');
  assert.ok(!leak.error);
  assert.equal(fact(leak.world, 'continuity.ledger'), 'leaked');
  assert.equal(fact(leak.world, 'schedule.leaked'), true);
  assert.equal(fact(leak.world, 'arc.continuity.done'), true);
  assert.ok(isExpelled(leak.world, 'continuity'));
  assert.equal(leak.rep.rustwake, 10);
  assert.equal(recall(leak.world, { kind: 'schedule.leaked' }).length, 1);
  assert.equal(pendingChoice(leak.world, 'continuity'), null);
  assert.ok(choose(leak.world, 'continuity-4', 'filed').error, 'decided once');
  // The Houses' Oath is a defection.
  let h = member(emptyWorld(), 'houses', 4, 600);
  h = member(h, 'allocation', 2, 200);
  for (const n of [1, 2, 3, 4]) h = completeStep(h, `houses-${n}`);
  const oath = choose(h, 'houses-4', 'sworn');
  assert.equal(fact(oath.world, 'player.defected'), true);
  assert.ok(isExpelled(oath.world, 'allocation'));
  assert.equal(oath.rep.concord, -35);
  assert.match(canJoin(oath.world, 'continuity', REP)!, /OATH/);
  // Diverting the quota costs the Board more merit than you have.
  let q = member(emptyWorld(), 'allocation', 4, 520);
  for (const n of [1, 2, 3, 4]) q = completeStep(q, `allocation-${n}`);
  const div = choose(q, 'allocation-4', 'diverted');
  assert.equal(fact(div.world, 'anchorage.fed'), true);
  assert.ok(isExpelled(div.world, 'allocation'));
});

/**
 * Fly an operation in the real runner with a scripted pilot: go to the
 * current objective's marker, pick up cores in reach, shoot anything hostile
 * that has been up for a couple of seconds, let escorts fly their lanes.
 */
function fly(k: Contract, maxSteps = 4000): { outcome: string; flags: Set<string> } {
  const b = buildOp(k, [0, 0, 0])!;
  assert.ok(b, `${k.id} builds`);
  const player = new Vector3(...(k.op!.start ?? k.op!.center)).add(new Vector3(0, 0, -3000));
  type S = { tag: string; role: string; faction: string; alive: boolean; hull: number; hullMax: number; age: number; flight: { position: Vector3; velocity: Vector3 } };
  const ships: S[] = [];
  const pieces: { kind: string; tag: string; position: Vector3; radius: number }[] = [];
  let runner: CampaignRunner;
  const host = {
    playerPosition: player,
    playerAlive: true,
    playerHull: 1,
    systemId: k.op!.system,
    jumps: 0,
    ships,
    gatePosition: () => null,
    spawnShip: (s: { tag?: string; role?: string; faction: string }, _i: number, p: Vector3) => {
      const x: S = { tag: s.tag ?? '', role: s.role ?? 'hostile', faction: s.faction, alive: true, hull: 100, hullMax: 100, age: 0, flight: { position: p.clone(), velocity: new Vector3() } };
      ships.push(x);
      return x;
    },
    spawnSetPiece: (s: { kind: string; tag: string; params?: Record<string, unknown> }, p: Vector3) => {
      const radius = typeof s.params?.radius === 'number' ? (s.params.radius as number) : s.kind === 'beacon' ? 200 : s.kind === 'blackbox' ? 60 : 100;
      const piece = { kind: s.kind, tag: s.tag, position: p.clone(), radius };
      pieces.push(piece);
      return piece;
    },
    playChatter: (beat: { lines: { who: string }[] }) => {
      for (const l of beat.lines) assert.ok(PEOPLE.has(l.who), `${k.id}: unknown speaker ${l.who}`);
    },
    unlockCodex: () => {},
    command: (verb: string, list: S[]) => {
      for (const s of list) s.alive = false;
      void verb;
    },
  };
  runner = new CampaignRunner(b.mission, host as unknown as CampaignHost);
  runner.begin();
  const dt = 0.5;
  for (let i = 0; i < maxSteps && runner.outcome === 'running'; i++) {
    // The pilot flies to the current objective's marker.
    const m = b.mission.objectives.findIndex((o, j) => !o.hidden && !o.optional && runner.state[j] === 'active');
    const tag = m >= 0 ? b.nav[b.mission.objectives[m].id] : undefined;
    const alive = tag ? ships.find((s) => s.alive && (s.tag === tag || s.tag.startsWith(tag + '-'))) : undefined;
    const target = alive?.flight.position ?? (tag ? runner.resolve({ at: 'tag', tag, offset: [0, 0, 0] }) : null);
    if (target) {
      const d = target.clone().sub(player);
      const len = d.length();
      player.add(d.multiplyScalar(Math.min(1, 900 / Math.max(1, len))));
    }
    // Cores in reach come aboard.
    for (const p of pieces) if (p.kind === 'blackbox' && p.position.distanceTo(player) < p.radius) runner.setFlag(`${p.tag}-recovered`);
    // Hostiles that have been up a moment go down.
    for (const s of ships) {
      s.age += dt;
      if (s.alive && s.role === 'hostile' && s.age > 2) {
        s.alive = false;
        runner.onKill(s as never);
      }
    }
    // Escorts fly their lanes at a barge's pace.
    for (const e of runner.escorts) {
      if (e.halted || !e.target) continue;
      for (const s of e.ships) {
        if (!s.alive) continue;
        const d = e.target.clone().sub(s.flight.position);
        s.flight.position.add(d.multiplyScalar(Math.min(1, 120 / Math.max(1, d.length()))));
      }
    }
    runner.update(dt);
  }
  return { outcome: runner.outcome, flags: runner.flags };
}

test('every arc mission, taken at its guild’s seat in the real Reach, flies end to end', async () => {
  const reach = await realReach();
  for (const s of ARCS) {
    const k = arcContract(s.id, { reach, station: GUILDS[s.guild].seat, clock: 1200 })!;
    assert.ok(k, `${s.id} resolves`);
    assert.equal(k.op!.system, reach.systems.some((x) => x.id === s.where.system) ? s.where.system : k.originSystem, `${s.id} flies in ${s.where.system}`);
    assert.equal(k.payAt, GUILDS[s.guild].seat);
    assert.equal(k.arc, s.id);
    const b = buildArcOp(k, [0, 0, 0])!;
    const tags = new Set([...b.mission.spawns.map((x) => x.tag), ...b.mission.setpieces.map((x) => x.tag)]);
    for (const [obj, tag] of Object.entries(b.nav)) assert.ok([...tags].some((t) => t === tag || t?.startsWith(tag + '-') || t?.startsWith(tag)), `${s.id}: nav ${obj} → ${tag}`);
    const r = fly(k);
    assert.equal(r.outcome, 'success', `${s.id} (${s.title}) completes; flags: ${[...r.flags].join(' ')}`);
  }
});

// ── outposts ─────────────────────────────────────────────────────────

test('outposts: quiet systems only; rank 3 to claim; stage by stage from a dead hulk to guns on the rim', async () => {
  const reach = await realReach();
  const sites = outpostSites(reach);
  assert.ok(sites.length >= 4);
  for (const s of sites) {
    assert.ok(s.threat <= 0.35 && s.faction !== 'choir', s.id);
    const sys = reach.systems.find((x) => x.id === s.system)!;
    for (const st of sys.stations) assert.ok(Math.hypot(st.pos[0] - s.pos[0], st.pos[1] - s.pos[1], st.pos[2] - s.pos[2]) >= 14_000, `${s.id} clear of ${st.id}`);
  }
  assert.ok(outpostSites(reach, 'houses').some((s) => s.faction === 'choir'), 'a House convert may claim in Hegemony space');
  let w = member(emptyWorld(), 'keeping', 2);
  assert.match(claimBlock(w)!, /RANK 3/);
  w = member(w, 'keeping', 3);
  const site = siteById(reach, 'anchorage')!;
  let c = claim(w, rich(), site, 'keeping');
  assert.ok(!c.error, c.error);
  w = c.world;
  let l = c.ledger;
  assert.equal(outpostOf(w)!.stage, 0);
  assert.equal(claimBlock(w), 'YOU ALREADY HOLD AN OUTPOST');
  assert.ok(!hasService(outpostOf(w), 'storage'));
  for (let n = 1; n < STAGES.length; n++) {
    assert.ok(build(w, l).error, `stage ${n} wants goods first`);
    l = { ...l, capacity: 40, cargo: { ...STAGES[n].goods } };
    const d = deliver(w, l);
    w = d.world;
    l = d.ledger;
    assert.deepEqual(nextNeeds(outpostOf(w)!)!.goods, {});
    const b = build(w, l);
    assert.ok(!b.error, b.error);
    w = b.world;
    l = b.ledger;
    assert.equal(outpostOf(w)!.stage, n);
    for (const svc of STAGES[n].services) assert.ok(hasService(outpostOf(w), svc), `${svc} at stage ${n}`);
  }
  assert.equal(nextNeeds(outpostOf(w)!), null);
  assert.deepEqual(recall(w, { kind: 'outpost.stage' }).map((e) => e.data!.stage), [5, 4, 3, 2, 1]);
  // Storage.
  const s1 = stow(w, { ...l, cargo: { relics: 3 } }, 'relics', 3);
  assert.equal(s1.moved, 3);
  const s2 = stow(s1.world, s1.ledger, 'relics', -2);
  assert.equal(s2.ledger.cargo.relics, 2);
  assert.equal(outpostOf(s2.world)!.store.relics, 1);
});

test('outpost raids: scheduled once the bay opens, flown as a defence contract, or the hub is holed until patched', async () => {
  const reach = await realReach();
  let w = member(emptyWorld(), 'rustwake', 3);
  w = claim(w, rich(), siteById(reach, 'corouhold')!, 'rustwake').world;
  assert.ok(!raidDue(tick(w, 1e6), false), 'nobody raids a dead hulk');
  w = { ...w, counters: { ...w.counters, 'outpost.stage': 1 } };
  const b = build({ ...w, counters: { ...w.counters, 'outpost.got.spares': 4, 'outpost.got.rations': 6, 'outpost.got.medical': 3 } }, rich());
  w = b.world;
  assert.equal(outpostOf(w)!.stage, 2);
  assert.ok(outpostOf(w)!.raidAt > w.clock);
  assert.ok(!raidDue(w, false));
  w = tick(w, 3 * 3600);
  assert.ok(raidDue(w, false));
  assert.ok(!raidDue(w, true), 'one at a time');
  w = raidBegins(w);
  assert.ok(!raidDue(w, false), 'the next one is further out');
  const k = raidContract(w, reach, 5000)!;
  assert.equal(k.outpost, 'corouhold');
  assert.equal(k.payAt, 'outpost-corouhold');
  assert.equal(fly(k).outcome, 'success');
  const held = raidResolved(w, true);
  assert.ok(held.held && !outpostOf(held.world)!.damaged);
  const hit = raidResolved(w, false);
  assert.ok(outpostOf(hit.world)!.damaged);
  assert.ok(!hasService(outpostOf(hit.world), 'market') && hasService(outpostOf(hit.world), 'berth'));
  assert.match(nextNeeds(outpostOf(hit.world)!)!.stage.name, /PATCH/);
  const fixed = build({ ...hit.world, counters: { ...hit.world.counters, 'outpost.got.spares': 4 } }, rich());
  assert.ok(!fixed.error);
  assert.equal(outpostOf(fixed.world)!.damaged, false);
  assert.equal(outpostOf(fixed.world)!.stage, 2, 'patching does not cost a stage');
});
void ({} as ArcStep);
