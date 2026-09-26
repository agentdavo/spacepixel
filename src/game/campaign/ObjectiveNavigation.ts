import type { Vector3 } from 'three';
import type { CampaignMission, ObjectiveNavigation, SetPieceSpec } from './types.ts';

export interface NavigationDestination {
  /** The actual resolved member tag for group targets. */
  tag: string;
  label: string;
  position: Vector3;
}

interface NavigationShip {
  tag: string;
  spawn: number;
  member: number;
  ship: { alive: boolean; name: string; flight: { position: Vector3 } };
}

interface NavigationPiece {
  tag: string;
  position: Vector3;
  spec: Pick<SetPieceSpec, 'params'>;
}

/**
 * Read-only presentation of the current required objective. Hidden cues and
 * optional objectives cannot redirect its marker. A group follows the first
 * surviving authored member, not a moving centroid or a dead ship's last pose.
 * Recomputed from runner facts: no marker state is added to saves or replays.
 */
export function resolveObjectiveNavigation(
  mission: Pick<CampaignMission, 'objectives' | 'spawns'>,
  states: readonly string[],
  outcome: 'running' | 'success' | 'failure',
  ships: readonly NavigationShip[],
  pieces: readonly NavigationPiece[],
): NavigationDestination | undefined {
  if (outcome !== 'running') return;
  const objective = mission.objectives.find((o, i) => !o.hidden && !o.optional && states[i] === 'active');
  if (!objective) return;
  const nav: ObjectiveNavigation | undefined = objective.navigation ?? (objective.navTag ? { kind: 'setpiece', tag: objective.navTag } : undefined);
  if (!nav) return;
  if (nav.kind === 'setpiece') {
    const piece = pieces.find(p => p.tag === nav.tag);
    if (!piece) return;
    const name = piece.spec.params?.label;
    return { tag: piece.tag, label: nav.label ?? (typeof name === 'string' ? name : objective.text), position: piece.position.clone() };
  }
  let target: NavigationShip | undefined;
  for (const candidate of ships) {
    if (!candidate.ship.alive) continue;
    const spec = mission.spawns[candidate.spawn];
    const tag = nav.kind === 'group' ? (spec?.tag || spec?.blueprint) : candidate.tag;
    if (tag !== nav.tag) continue;
    if (!target || candidate.spawn < target.spawn || (candidate.spawn === target.spawn && candidate.member < target.member)) target = candidate;
  }
  if (!target) return;
  return { tag: target.tag, label: nav.label ?? target.ship.name ?? objective.text, position: target.ship.flight.position.clone() };
}
