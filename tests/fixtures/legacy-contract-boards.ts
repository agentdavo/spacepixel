import type { ReachMap } from '../../src/game/contracts/contracts';
/** Fixed legacy-only graph for pre-fix deterministic board parity. */
export const LEGACY_BOARD_REACH: ReachMap = {
  systems: (['concord', 'choir', 'rustwake'] as const).map((faction, i, factions) => ({
    id: `legacy-${faction}`, name: `Legacy ${faction}`, faction, threat: .2 + i * .2,
    stations: (['freeport', 'bastion', 'orbital'] as const).map((kind, j) => ({
      id: `${faction}-${kind}`, name: `${faction} ${kind}`, faction, kind,
      pos: [10000 + j * 20000, 0, 12000] as [number, number, number], axis: [0, 0, 1] as [number, number, number],
    })),
    gates: factions.filter(f => f !== faction).map((f, j) => ({ to: `legacy-${f}`, pos: [22000, 0, j * 30000] as [number, number, number], normal: [1, 0, 0] as [number, number, number] })),
  })),
};
