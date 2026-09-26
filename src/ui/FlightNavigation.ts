import type { Vector3 } from 'three';
import type { CampaignObjective } from '../game/campaign/types.ts';
import type { NavigationDestination } from '../game/campaign/ObjectiveNavigation.ts';

interface NavPoint { label: string; position: Vector3 }
interface NavigableCampaign {
  mission: { objectives: readonly CampaignObjective[] };
  navigation(): NavigationDestination | undefined;
}

/** Authored mission navigation owns the HUD slot, including when it has no fix. */
export function flightNavigation(campaign: NavigableCampaign | undefined, gate?: NavPoint): (NavPoint & { mission: boolean }) | undefined {
  const destination = campaign?.navigation();
  if (destination) return { ...destination, mission: true };
  if (campaign?.mission.objectives.some(o => o.navigation || o.navTag)) return;
  if (gate) return { ...gate, mission: false };
}
