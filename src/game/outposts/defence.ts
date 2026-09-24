/**
 * An outpost raid as a contract operation (run by the ContractDesk's LiveOp
 * like any other job): raiders come at the hub when you close on it; guns on
 * the rim (stage 5) put a picket in the fight on your side.
 *
 * Pure (type imports only): runs under node --test.
 */
import type { CampaignMission } from '../campaign/types';
import type { OpBuild, OpOptions } from '../contracts/ops';
import type { Contract, V3 } from '../contracts/contracts';

export function buildOutpostOp(k: Contract, offset: V3, opts: OpOptions = {}): OpBuild | null {
  const guns = k.tier === 3;
  const op = k.op;
  if (!op || !k.outpost) return null;
  const c = op.center;
  const at = (o: V3) => ({ at: 'point' as const, point: [c[0] + offset[0], c[1] + offset[1], c[2] + offset[2]] as V3, offset: o });
  const d = (n: number, s = 1) => (opts.stage ? s : n);
  const who = k.client;
  const mission: CampaignMission = {
    id: `contract:${k.id}`,
    chapter: 1,
    episode: 0,
    title: k.title,
    milestones: [],
    system: op.system,
    briefing: k.brief,
    tagline: '',
    objectives: [
      { id: 'reach', text: `Reach the ${k.payAtName}`, done: (x) => x.distanceTo('hub') < d(7000, 1e9), setsFlag: 'at-hub' },
      { id: 'break', text: `Break the raiders — ${op.hostiles * op.waves} ships`, done: (x) => x.flag('raid-seen') && x.aliveCount('raiders') === 0 },
      { id: 'cue-seen', text: '[cue] raid-seen', hidden: true, optional: true, done: (x) => x.alive('raiders'), setsFlag: 'raid-seen' },
    ],
    spawns: [
      { blueprint: op.enemy.blueprint, faction: op.enemy.faction, count: op.hostiles, place: at([2600, 500, 2400]), tag: 'raiders-w1', name: op.enemy.name, role: 'hostile', whenFlag: 'at-hub', delay: d(4) },
      ...(op.waves > 1 ? [{ blueprint: op.enemy.blueprint, faction: op.enemy.faction, count: op.hostiles, place: at([-2800, 300, 2000]), tag: 'raiders-w2', name: op.enemy.name, role: 'hostile' as const, whenFlag: 'at-hub', delay: d(40, 5) }] : []),
      ...(guns ? [{ blueprint: 'vf27-kestrel', faction: 'concord' as const, count: 2, place: at([0, 300, 900]), tag: 'picket', name: 'Outpost picket', role: 'wing' as const, whenFlag: 'at-hub' }] : []),
    ],
    setpieces: [{ kind: 'beacon', tag: 'hub', place: at([0, 0, 0]), params: { label: k.payAtName, color: '#ffae4f' } }],
    chatter: [
      { id: 'o-start', trigger: { on: 'start' }, lines: [{ who: 'system', text: `OUTPOST ALARM · ${k.payAtName.toUpperCase()} · DRIVE SIGNATURES CLOSING.` }, { who, text: 'They are coming for the hub. Get here.', delay: 2 }] },
      { id: 'o-seen', trigger: { on: 'flag', flag: 'raid-seen' }, lines: [{ who: 'system', text: guns ? 'RIM GUNS TRACKING. PICKET LAUNCHED.' : 'RAIDERS ON THE HUB. NO DEFENCES FITTED.' }], priority: 2 },
      { id: 'o-win', trigger: { on: 'success' }, lines: [{ who, text: 'Hub’s holding. The crews will buy you a drink — dock when you like.' }] },
    ],
    codex: [],
    debrief: '',
  };
  return { mission, nav: { reach: 'hub', break: 'raiders' }, labels: { hub: k.payAtName.toUpperCase() }, completes: true };
}
