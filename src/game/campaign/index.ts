import type { Campaign } from './types';
import { CAST } from './cast';
import { CODEX } from './codex';
import { MISSIONS } from './missions';

export { CAST, CODEX, MISSIONS };
export { PLOT_ARMOUR, SYSTEM_FALLBACK } from './missions';

/** PROJECT VANGUARD — the full campaign (see docs/CAMPAIGN.md, docs/LORE.md). */
export const CAMPAIGN: Campaign = {
  title: 'PROJECT VANGUARD: THE LONG DARK',
  cast: CAST,
  codex: CODEX,
  missions: MISSIONS,
};
