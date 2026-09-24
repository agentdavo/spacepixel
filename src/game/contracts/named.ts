/**
 * Named contracts — work offered in conversation (the concourse) rather than
 * posted on a board. Each is one of the generator's kinds (courier, escort)
 * with fixed, lore-true terms: who is asking, where the work is, who shoots
 * at you. Accepting in conversation creates the contract and books it
 * straight away (ContractDesk.acceptNamed).
 *
 *   continuity-courier   Inspector Pell Varga, Office of Continuity: sealed
 *                        dispatches between Castellan and Anchorage.
 *   magpie-escort        Magpie (Tem Marsh): a clan convoy down a lane in
 *                        Scrapjack space; outlaw Scrapjacks jump it.
 *   choir-line-escort    Measure-Captain Idris Solenne: an unofficial escort
 *                        out of the Treaty Line Watch; off-Schedule Directorate
 *                        Kestrels would rather it never arrived.
 *
 * Pure (type imports + plain data), runs under node --test.
 */
import type { Character } from '../campaign/types';
import type { EconFaction } from '../economy';
import { ROSTER } from '../../dialog/people.ts';
import { ARC_CONTRACT_IDS, arcContract, isArcContract, type ArcContractId } from '../npc/arcContracts.ts';
import { BOARD_PERIOD, boardEpoch, contractFee, contractRep, findStation, hops, type Contract, type ContractOp, type ReachMap, type ReachStation, type ReachSystem, type Tier, type V3 } from './contracts.ts';

export type NamedId = 'continuity-courier' | 'magpie-escort' | 'choir-line-escort';
export const NAMED_IDS: readonly NamedId[] = ['continuity-courier', 'magpie-escort', 'choir-line-escort'];

/** The people who offer named work, as comms characters (portraits, callsigns). */
export const NAMED_CLIENTS: Character[] = ROSTER.filter((p) => p.id === 'pell' || p.id === 'magpie' || p.id === 'idris').map((p) => ({
  id: p.id,
  callsign: p.callsign,
  name: p.name,
  role: p.role,
  faction: p.faction === 'none' ? 'unknown' : p.faction,
  voice: p.greeting,
  portrait: p.portrait,
  commsColor: p.color,
}));

export interface NamedInput {
  reach: ReachMap;
  /** Station the conversation happened at. */
  station: string;
  clock: number;
  rep: Record<EconFaction, number>;
  tier: Tier;
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (v: V3): V3 => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])];
const round50 = (v: number) => Math.round(v / 50) * 50;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Is `id` one of the named contracts (including the jobs NPC arcs offer, src/game/npc/arcContracts.ts)? */
export function isNamed(id: string): id is NamedId | ArcContractId {
  return isStanding(id) || isArcContract(id);
}

function isStanding(id: string): id is NamedId {
  return (NAMED_IDS as readonly string[]).includes(id);
}

/** Every key `namedContract` can build (the three standing jobs + the arc jobs). */
export const ALL_NAMED_IDS: readonly string[] = [...NAMED_IDS, ...ARC_CONTRACT_IDS];

/** Named contracts carry their key in the id: `named:<key>@<board epoch>`. */
export function namedKey(k: Pick<Contract, 'id'>): NamedId | ArcContractId | null {
  const m = /^named:([a-z-]+)@\d+$/.exec(k.id);
  return m && isNamed(m[1]) ? m[1] : null;
}

/**
 * The escort lane at a gate station: from the station's bay out to its
 * nearest Lantern, or in from the Lantern to the bay (like the board's
 * escorts). Null if the system has no gate station or no Lantern.
 */
function lane(sys: ReachSystem, prefer: string, outbound: boolean): { home: ReachStation; start: V3; end: V3; endKind: 'gate' | 'station'; endName: string; gateTo: string } | null {
  const gateStations = sys.stations.filter((s) => s.planet === undefined);
  const home = gateStations.find((s) => s.id === prefer) ?? gateStations[0];
  if (!home || !sys.gates.length) return null;
  const gate = [...sys.gates].sort((a, b) => dist(a.pos, home.pos) - dist(b.pos, home.pos))[0];
  const inward: V3 = [-gate.normal[0], -gate.normal[1], -gate.normal[2]];
  const bay = add(home.pos, home.axis, 2600);
  return outbound
    ? { home, start: bay, end: add(gate.pos, inward, 500), endKind: 'gate', endName: '', gateTo: gate.to }
    : { home, start: add(gate.pos, inward, 900), end: bay, endKind: 'station', endName: home.name, gateTo: gate.to };
}

/** Nearest system (by gate hops, then id) passing `ok`, starting with `from`. */
function nearestSystem(reach: ReachMap, from: string, ok: (s: ReachSystem) => boolean): { sys: ReachSystem; jumps: number } | null {
  const h = hops(reach, from);
  let best: { sys: ReachSystem; jumps: number } | null = null;
  for (const sys of reach.systems) {
    const j = h.get(sys.id);
    if (j === undefined || !ok(sys)) continue;
    if (!best || j < best.jumps || (j === best.jumps && sys.id < best.sys.id)) best = { sys, jumps: j };
  }
  return best;
}

function base(id: NamedId, inp: NamedInput, client: string, faction: EconFaction, origin: { station: ReachStation; system: ReachSystem }) {
  const epoch = boardEpoch(inp.clock);
  return {
    id: `named:${id}@${epoch}`,
    named: id,
    client,
    faction,
    origin: origin.station.id,
    originName: origin.station.name,
    originSystem: origin.system.id,
    payAt: origin.station.id,
    payAtName: origin.station.name,
    payAtSystem: origin.system.id,
    expires: (epoch + 1) * BOARD_PERIOD,
    state: 'offered' as const,
  };
}

/**
 * Build the named contract `id` as offered at `station` now, or null if the
 * Reach can't host it (no such station, no lane).
 */
export function namedContract(id: string, inp: NamedInput): Contract | null {
  if (isArcContract(id)) return arcContract(id, inp);
  if (!isStanding(id)) return null;
  const here = findStation(inp.reach, inp.station);
  if (!here) return null;
  const seed = hash(`${id}@${boardEpoch(inp.clock)}`);
  const tier = inp.tier;

  if (id === 'continuity-courier') {
    // Castellan ↔ Anchorage: whichever end you are not at.
    const atAnchorage = here.system.id === 'anchorage';
    const destSys = inp.reach.systems.find((s) => s.id === (atAnchorage ? 'meridian' : 'anchorage'));
    const pick = (s: ReachSystem) => (atAnchorage ? s.stations.find((x) => /castellan/i.test(x.name)) : s.stations.find((x) => x.kind === 'bastion')) ?? s.stations.find((x) => x.faction === 'concord') ?? s.stations[0];
    const dest = destSys ? pick(destSys) : undefined;
    if (!destSys || !dest || dest.id === here.station.id) return null;
    const jumps = hops(inp.reach, here.system.id).get(destSys.id) ?? 1;
    const reward = round50(contractFee('courier', tier, jumps, inp.rep.concord) * 1.25);
    const rep = contractRep('courier', tier);
    const op: ContractOp | undefined =
      tier >= 2 ? { system: destSys.id, center: dest.pos, hostiles: tier, waves: 1, enemy: { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Hired Knife' }, seed } : undefined;
    return {
      ...base(id, inp, 'pell', 'concord', here),
      kind: 'courier',
      tier,
      title: `Continuity dispatches to ${dest.name}`,
      brief: [
        'Office of Continuity. Purely routine.',
        `A sealed dispatch case for ${dest.name}, ${jumps === 1 ? 'one Lantern out' : `${jumps} Lanterns out`}. Do not open it, do not scan it, do not let anyone else hold it. The consignee signs, the consignee pays.`,
        tier >= 2 ? 'Someone has been asking which pilot carries Continuity’s post. I have told them nothing. Assume they found out anyway.' : 'I have put your name forward. Please do not make me regret the paperwork.',
      ].join('\n\n'),
      dest: dest.id,
      destName: dest.name,
      destSystem: destSys.id,
      payAt: dest.id,
      payAtName: dest.name,
      payAtSystem: destSys.id,
      jumps,
      op,
      reward,
      rep,
      penalty: round50(reward * 0.3),
      repPenalty: Math.round(rep * 15) / 10,
      duration: Math.round(300 + 240 * jumps),
    };
  }

  // Escorts.
  const magpie = id === 'magpie-escort';
  const want = (s: ReachSystem) => s.gates.length > 0 && s.stations.some((x) => x.planet === undefined && (magpie ? x.faction === 'rustwake' : x.faction === 'choir'));
  const treaty = !magpie ? inp.reach.systems.find((s) => s.stations.some((x) => /treaty line/i.test(x.name))) : undefined;
  const where = want(here.system) ? { sys: here.system, jumps: 0 } : treaty && want(treaty) ? { sys: treaty, jumps: hops(inp.reach, here.system.id).get(treaty.id) ?? 0 } : nearestSystem(inp.reach, here.system.id, want);
  if (!where) return null;
  const prefer = magpie ? (where.sys.stations.find((x) => /scrapjack/i.test(x.name))?.id ?? here.station.id) : (where.sys.stations.find((x) => /treaty line/i.test(x.name))?.id ?? here.station.id);
  const l = lane(where.sys, prefer, true);
  if (!l) return null;
  const gateName = inp.reach.systems.find((s) => s.id === l.gateTo)?.name ?? l.gateTo;
  const endName = `${gateName} Lantern`;
  const reward = round50(contractFee('escort', tier, where.jumps, inp.rep[magpie ? 'rustwake' : 'choir']) * 1.2);
  const rep = contractRep('escort', tier);
  const op: ContractOp = {
    system: where.sys.id,
    center: round(l.start),
    start: round(l.start),
    end: round(l.end),
    endKind: 'gate',
    endName,
    hostiles: tier + 1,
    waves: 2,
    enemy: magpie ? { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Scrapjack' } : { blueprint: 'vf27-kestrel', faction: 'concord', name: 'Unscheduled Kestrel' },
    freighter: magpie ? { name: 'Kittiwake', blueprint: 'rw-scrapjack' } : { name: 'Seventh Witness', blueprint: 'choir-vesper' },
    seed,
  };
  const k: Contract = {
    ...base(id, inp, magpie ? 'magpie' : 'idris', magpie ? 'rustwake' : 'choir', here),
    kind: 'escort',
    tier,
    title: magpie ? `Clan convoy: the Kittiwake to the ${endName}` : `The Line, unofficially: the Seventh Witness to the ${endName}`,
    brief: magpie
      ? [
          'Word on channel nine, sweetheart:',
          `The Kittiwake is a clan tender, full of other people's gas and nobody's paperwork. She runs from ${l.home.name} out through the ${endName}. Scrapjacks work that lane, and Scrapjacks shoot anything wearing only one kind of paint.`,
          'Stay close, keep the cutters off her hull, and come find me for your fee. Twice, probably. They always come twice.',
        ].join('\n\n')
      : [
          'Be witnessed, pilot.',
          `The Seventh Witness leaves ${l.home.name} for the ${endName} with a cargo the Treasury has not written down. Pilots who dislike schedules have been told she is worth intercepting — some of them fly Directorate paint.`,
          'You are not on anyone’s list for this. Fly as if you were. Return to me for payment.',
        ].join('\n\n'),
    jumps: where.jumps,
    op,
    reward,
    rep,
    penalty: round50(reward * 0.3),
    repPenalty: Math.round(rep * 15) / 10,
    duration: 900 + 300 * where.jumps,
  };
  // The Choir's unofficial work is still work against the Directorate.
  if (!magpie) k.enemy = { faction: 'concord', rep: -1 };
  return k;
}
