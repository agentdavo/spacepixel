/**
 * The named jobs NPC arcs offer in conversation (`{ contract: '<key>' }`).
 * Same shape as src/game/contracts/named.ts — one of the generator's kinds
 * with fixed, lore-true terms — so the contracts runtime books, flies and
 * pays them like any other; named.ts delegates the keys listed here.
 *
 *   odile-board     courier  Odile's claim ticket to Old Cass at the Graveyard Breakers
 *   magpie-crane    bounty   Hollis "Ninefingers" Crane, who bought Magpie's paper
 *   pell-witness    courier  a sealed copy of the Schedule ledgers to Anchorage; Vosk's wing hunts it
 *   nadia-registry  salvage  the ration-registry core in the Lysowick Engagement 114 layer
 *   toma-null       recon    sit with Ens. Kerrigan at the Null and hold while he talks
 *   dalca-tender    escort   the school tender Slate and Chalk out to the Lysowick Lantern
 *   maud-core       salvage  a golden-age flight core from the Anchorage hulk, so Maud can ask
 *
 * Pure (type imports + contracts.ts), runs under node --test.
 */
import { BOARD_PERIOD, boardEpoch, contractFee, contractRep, findStation, hops, markId, type Contract, type ContractKind, type ReachMap, type ReachStation, type ReachSystem, type Tier, type V3 } from '../contracts/contracts.ts';
import type { EconFaction } from '../economy';

export type ArcContractId = 'odile-board' | 'magpie-crane' | 'pell-witness' | 'nadia-registry' | 'toma-null' | 'dalca-tender' | 'maud-core';
export const ARC_CONTRACT_IDS: readonly ArcContractId[] = ['odile-board', 'magpie-crane', 'pell-witness', 'nadia-registry', 'toma-null', 'dalca-tender', 'maud-core'];

export function isArcContract(id: string): id is ArcContractId {
  return (ARC_CONTRACT_IDS as readonly string[]).includes(id);
}

/** Who offers each job (comms speaker for its radio lines). */
export const ARC_CONTRACT_CLIENT: Record<ArcContractId, string> = {
  'odile-board': 'odile',
  'magpie-crane': 'magpie',
  'pell-witness': 'pell',
  'nadia-registry': 'nadia',
  'toma-null': 'picket-okafor',
  'dalca-tender': 'imre',
  'maud-core': 'maud',
};

/** Short job names for the THREADS tab. */
export const ARC_JOB_LABEL: Record<ArcContractId, string> = {
  'odile-board': 'Courier: Odile\'s claim ticket to the Graveyard Breakers',
  'magpie-crane': 'Bounty: Hollis "Ninefingers" Crane',
  'pell-witness': 'Courier: sealed ledgers to the Cloister at Anchorage',
  'nadia-registry': 'Salvage: the ration registry at Lysowick',
  'toma-null': 'Recon: sit with Kerrigan at the Null',
  'dalca-tender': 'Escort: the Slate and Chalk to the Lysowick Lantern',
  'maud-core': 'Salvage: a golden-age core from the Anchorage hulk',
};

export const CRANE = "Hollis 'Ninefingers' Crane";

export interface ArcContractInput {
  reach: ReachMap;
  station: string;
  clock: number;
  rep: Record<EconFaction, number>;
  tier: Tier;
}

const addV = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (v: V3): V3 => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])];
const round50 = (v: number) => Math.max(50, Math.round(v / 50) * 50);

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stationBy(reach: ReachMap, prefixes: readonly string[]): { station: ReachStation; system: ReachSystem } | null {
  for (const p of prefixes)
    for (const system of reach.systems) {
      const station = system.stations.find((s) => s.id === p || s.id.startsWith(p + '-'));
      if (station) return { station, system };
    }
  return null;
}

/** A point `inward` m inside a system's gate (toward `to` if it has one), `side` m off the lane. */
function nearGate(sys: ReachSystem, to: string | null, inward: number, side: number): V3 {
  const g = (to && sys.gates.find((x) => x.to === to)) || sys.gates[0];
  if (!g) return sys.stations[0]?.pos ?? [0, 0, 0];
  const n = g.normal;
  const lat: V3 = [-n[2], 0.1, n[0]];
  return round(addV(addV(g.pos, n, -inward), lat, side));
}

/** Nearest system (gate hops, then id) passing `ok`. */
function nearest(reach: ReachMap, from: string, ok: (s: ReachSystem) => boolean): { sys: ReachSystem; jumps: number } | null {
  const h = hops(reach, from);
  let best: { sys: ReachSystem; jumps: number } | null = null;
  for (const sys of reach.systems) {
    const j = h.get(sys.id);
    if (j === undefined || !ok(sys)) continue;
    if (!best || j < best.jumps || (j === best.jumps && sys.id < best.sys.id)) best = { sys, jumps: j };
  }
  return best;
}

function money(kind: ContractKind, tier: Tier, jumps: number, rep: number, mul: number) {
  const reward = round50(contractFee(kind, tier, jumps, rep) * mul);
  const r = contractRep(kind, tier);
  return { reward, rep: r, penalty: round50(reward * 0.3), repPenalty: Math.round(r * 15) / 10 };
}

/** Build arc job `id` as offered at `inp.station` now, or null if the Reach can't host it. */
export function arcContract(id: string, inp: ArcContractInput): Contract | null {
  if (!isArcContract(id)) return null;
  const here = findStation(inp.reach, inp.station);
  if (!here) return null;
  const epoch = boardEpoch(inp.clock);
  const seed = hash(`${id}@${epoch}`);
  const tier = inp.tier;
  const client = ARC_CONTRACT_CLIENT[id];
  const jumpsTo = (sys: string) => hops(inp.reach, here.system.id).get(sys) ?? 0;
  const base = (faction: EconFaction) => ({
    id: `named:${id}@${epoch}`,
    named: id,
    client,
    faction,
    tier,
    origin: here.station.id,
    originName: here.station.name,
    originSystem: here.system.id,
    payAt: here.station.id,
    payAtName: here.station.name,
    payAtSystem: here.system.id,
    expires: (epoch + 1) * BOARD_PERIOD,
    state: 'offered' as const,
  });
  const courier = (faction: EconFaction, destPrefixes: string[], title: (d: string) => string, brief: (d: string, j: number) => string, enemy: NonNullable<Contract['op']>['enemy'], always: boolean, mul: number): Contract | null => {
    const d = stationBy(inp.reach, destPrefixes.filter((p) => !here.station.id.startsWith(p)));
    if (!d || d.station.id === here.station.id) return null;
    const jumps = jumpsTo(d.system.id);
    const m = money('courier', tier, jumps, inp.rep[faction], mul);
    const op = always || tier >= 2 ? { system: d.system.id, center: d.station.pos, hostiles: Math.max(1, tier), waves: 1, enemy, seed } : undefined;
    return {
      ...base(faction),
      kind: 'courier',
      title: title(d.station.name),
      brief: brief(d.station.name, jumps),
      dest: d.station.id,
      destName: d.station.name,
      destSystem: d.system.id,
      payAt: d.station.id,
      payAtName: d.station.name,
      payAtSystem: d.system.id,
      jumps,
      ...(op ? { op } : {}),
      ...m,
      duration: Math.round(420 + 300 * jumps),
    };
  };

  switch (id) {
    case 'odile-board':
      return courier(
        'rustwake',
        ['anchorage-salvage', 'anchorage-bastion'],
        (d) => `Odile's claim ticket to ${d}`,
        (d, j) =>
          [
            'From the Last Timetable, currently a corner of somebody else\'s bar:',
            `Take my claim ticket to Old Cass at ${d}, ${j === 1 ? 'one Lantern out' : `${j} Lanterns out`}. He has the board crated. He\'ll ship it on your say-so and not a moment before.`,
            'Don\'t let him talk you into a relic. He will try. Service will resume shortly.',
          ].join('\n\n'),
        { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Scrapjack' },
        false,
        1.1,
      );
    case 'pell-witness':
      return courier(
        'concord',
        here.system.id === 'anchorage' ? ['meridian-orbital'] : ['anchorage-bastion', 'anchorage-salvage'],
        (d) => `Sealed ledgers for the Cloister at ${d}`,
        (d, j) =>
          [
            'Office of Continuity. Not purely routine.',
            `A sealed copy of nine years of Engagement ledgers, for the wardens at ${d}, ${j === 1 ? 'one Lantern out' : `${j} Lanterns out`}. They keep records the Board cannot reallocate.`,
            'Continuity will send Vosk. He does not file reports; he files people. Do not stop to talk to him.',
          ].join('\n\n'),
        { blueprint: 'vf31-harrier', faction: 'concord', name: 'Vosk\'s wing' },
        true,
        1.4,
      );
    case 'magpie-crane': {
      const where = here.system.faction === 'rustwake' && here.system.gates.length ? { sys: here.system, jumps: 0 } : nearest(inp.reach, here.system.id, (s) => s.faction === 'rustwake' && s.gates.length > 0);
      if (!where) return null;
      const m = money('bounty', tier, where.jumps, inp.rep.rustwake, 1.35);
      return {
        ...base('rustwake'),
        kind: 'bounty',
        title: `Paper burns: ${CRANE}`,
        brief: [
          'Channel nine, sweetheart. No names on this one but his:',
          `${CRANE} sits in the wrecks off the ${where.sys.name} Lantern with a wing of cutters and my paper in his pocket. Outlawed by the Moot, which means nobody minds what happens to him.`,
          'Bring me his transponder. The paper burns with it. Mind his left hand; that\'s the one with all the fingers.',
        ].join('\n\n'),
        jumps: where.jumps,
        op: {
          system: where.sys.id,
          center: nearGate(where.sys, null, 7500 + (seed % 3000), 2500),
          hostiles: tier + 1,
          waves: 1,
          enemy: { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Cutter' },
          mark: { id: markId(CRANE), name: CRANE, blueprint: tier >= 2 ? 'rw-knuckleduster' : 'rw-scrapjack', faction: 'rustwake' },
          seed,
        },
        ...m,
        duration: 1500 + 300 * where.jumps,
      };
    }
    case 'nadia-registry':
    case 'maud-core': {
      const nadia = id === 'nadia-registry';
      const sys = inp.reach.systems.find((s) => s.id === (nadia ? 'lysowick' : 'anchorage'));
      if (!sys || !sys.gates.length) return null;
      const jumps = jumpsTo(sys.id);
      const m = money('salvage', tier, jumps, inp.rep.concord, nadia ? 0.9 : 1.1);
      return {
        ...base('concord'),
        kind: 'salvage',
        title: nadia ? 'The ration registry in the Engagement 114 layer' : 'A core for Warden-Sister Maud',
        brief: nadia
          ? [
              'Nadia Sorel, reading lists:',
              `A registry tender went down in the Engagement 114 layer at ${sys.name}. Its core remembers where every ration card was moved. Survey the debris, find the core, bring it back to me.`,
              'Scavengers strip anything that still blinks. Please get there first.',
            ].join('\n\n')
          : [
              'Order of the Keeping, Warden-Sister Maud on circuit:',
              `A golden-age hulk turns in the ${sys.name} belt, core still sealed. Survey her, recover the core, bring it to me. I mean to ask it a question the Keepings forbid.`,
              'Handle it gently. It is holy, and very probably furious.',
            ].join('\n\n'),
        jumps,
        op: {
          system: sys.id,
          center: nearGate(sys, nadia ? 'meridian' : 'lysowick', 9000 + (seed % 2500), nadia ? -3000 : 3500),
          hostiles: tier,
          waves: nadia || tier >= 2 ? 1 : 0,
          enemy: { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Scav Cutter' },
          wreck: nadia ? 'wreckage' : 'derelict',
          hold: 8 + tier * 2,
          seed,
        },
        ...m,
        duration: 1500 + 300 * jumps,
      };
    }
    case 'toma-null': {
      const sys = inp.reach.systems.find((s) => s.id === 'null');
      if (!sys) return null;
      const jumps = jumpsTo(sys.id);
      const m = money('recon', tier, jumps, inp.rep.concord, 1);
      return {
        ...base('concord'),
        kind: 'recon',
        title: 'Talk Ensign Kerrigan home from the Null',
        brief: [
          'Lantern Watch, Picket Captain Okafor:',
          `Kerrigan is holding off the Lantern at ${sys.name} with his transponder dark, counting back at the Signal. Fly out, sit inside his ring, and hold while he talks himself out of it.`,
          'A Choir picket will notice. When they come, break contact and bring him home. That is the whole job, and it is not a small one.',
        ].join('\n\n'),
        jumps,
        op: {
          system: sys.id,
          center: nearGate(sys, null, 8000, 1800),
          hostiles: tier + 1,
          waves: 1,
          enemy: { blueprint: 'choir-cantor', faction: 'choir', name: 'Null Picket Cantor' },
          hold: 18 + tier * 4,
          seed,
        },
        ...m,
        duration: 1800 + 300 * jumps,
      };
    }
    case 'dalca-tender': {
      const home = stationBy(inp.reach, ['anchorage-salvage', 'anchorage-bastion']);
      if (!home) return null;
      const sys = home.system;
      const gate = sys.gates.find((g) => g.to === 'lysowick') ?? [...sys.gates].sort((a, b) => dist(a.pos, home.station.pos) - dist(b.pos, home.station.pos))[0];
      if (!gate) return null;
      const inward: V3 = [-gate.normal[0], -gate.normal[1], -gate.normal[2]];
      const start = round(addV(home.station.pos, home.station.axis, 2600));
      const end = round(addV(gate.pos, inward, 500));
      const endName = `${inp.reach.systems.find((s) => s.id === gate.to)?.name ?? gate.to} Lantern`;
      const jumps = jumpsTo(sys.id);
      const m = money('escort', tier, jumps, inp.rep.concord, 1.1);
      return {
        ...base('concord'),
        kind: 'escort',
        title: `Class Four: the Slate and Chalk to the ${endName}`,
        brief: [
          'Schoolmistress Imre Dalca, Class Four heritage tour:',
          `The Slate and Chalk leaves ${home.station.name} for the ${endName} with nineteen children, one teacher and a great many sketchbooks. The Board reallocated our escort.`,
          'Please keep the raiders off her hull. Pieter will be watching on the radio. He has questions.',
        ].join('\n\n'),
        jumps,
        op: {
          system: sys.id,
          center: start,
          start,
          end,
          endKind: 'gate',
          endName,
          hostiles: tier + 1,
          waves: 2,
          enemy: { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Lane Raider' },
          freighter: { name: 'Slate and Chalk', blueprint: 'civ-swallow' },
          seed,
        },
        ...m,
        duration: 1200 + 300 * jumps,
      };
    }
  }
  return null;
}
