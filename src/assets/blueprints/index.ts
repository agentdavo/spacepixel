import type { Blueprint } from '../Blueprint';
import { KESTREL } from './concord';
import { CANTOR } from './choir';
import { HARRIER, WARHORSE } from './concord-strike';
import { LANTERN_GUARD, HESPERUS_DAWN, INDOMITABLE } from './concord-fleet';
import { PSALTER, VESPER, CATHEDRAL } from './choir-fleet';
import { SCRAPJACK } from './rustwake';
import { SHIPYARD_ROSTER } from './shipyard';

export { KESTREL, CANTOR, CATHEDRAL, HARRIER, WARHORSE, SCRAPJACK, PSALTER, VESPER, LANTERN_GUARD, HESPERUS_DAWN, INDOMITABLE };

/** Every design, in roster order (fighters → capital ships). */
export const ROSTER: Blueprint[] = [
  KESTREL,
  HARRIER,
  CANTOR,
  SCRAPJACK,
  WARHORSE,
  PSALTER,
  LANTERN_GUARD,
  VESPER,
  HESPERUS_DAWN,
  INDOMITABLE,
  CATHEDRAL,
  // Shipyard: progression line, Rustwake clans, civilian traffic, mid-tier warships.
  ...SHIPYARD_ROSTER,
];

export const BLUEPRINTS: Record<string, Blueprint> = Object.fromEntries(ROSTER.map((b) => [b.id, b]));
