/** Stable campaign entry point. Add/edit an episode in ./episodes; preserve IDs and order for saves. */
import type { CampaignMission } from './types.ts';
import { EP01 } from './episodes/ep01-the-long-dark.ts';
import { EP02 } from './episodes/ep02-fossil-fire.ts';
import { EP03 } from './episodes/ep03-two-heavens.ts';
import { EP04 } from './episodes/ep04-black-light.ts';
import { EP05 } from './episodes/ep05-whispers-in-the-static.ts';
import { EP06 } from './episodes/ep06-border-skirmish.ts';
import { EP07 } from './episodes/ep07-the-stolen-coordinates.ts';
import { EP08 } from './episodes/ep08-the-internal-rot.ts';
import { EP09 } from './episodes/ep09-the-ghost-ship.ts';
import { EP10 } from './episodes/ep10-the-fall-of-the-bastion.ts';
import { EP11 } from './episodes/ep11-crossing-the-dead-zone.ts';
import { EP12 } from './episodes/ep12-encounter-with-the-monolith.ts';
import { EP13 } from './episodes/ep13-the-oracle-broadcast.ts';
import { EP14 } from './episodes/ep14-the-schism.ts';
import { EP15 } from './episodes/ep15-the-siege-of-the-nexus.ts';
import { EP16 } from './episodes/ep16-the-solo-pilgrimage.ts';
import { EP17 } from './episodes/ep17-the-revelation-of-the-zenith.ts';
import { EP18 } from './episodes/ep18-the-key-not-the-sword.ts';
import { EP19 } from './episodes/ep19-the-symphony-of-gates.ts';
import { EP20 } from './episodes/ep20-the-open-horizon.ts';

export { PLOT_ARMOUR, SYSTEM_FALLBACK } from './runtimePolicy.ts';

export const MISSIONS: CampaignMission[] = [EP01, EP02, EP03, EP04, EP05, EP06, EP07, EP08, EP09, EP10, EP11, EP12, EP13, EP14, EP15, EP16, EP17, EP18, EP19, EP20];
