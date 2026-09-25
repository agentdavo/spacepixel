import { validateExpansion } from '../src/content/validateExpansion.ts';
import { CIVILIZATIONS } from '../src/content/civilizations.ts';
import { REGIONS } from '../src/content/regions.ts';
import { PILOT_HULLS } from '../src/content/pilotHulls.ts';
const errors = validateExpansion();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Expansion references valid: ${CIVILIZATIONS.peoples.length} peoples, ${CIVILIZATIONS.polities.length} polities, ${REGIONS.length} region manifests, ${PILOT_HULLS.length} prototype hulls. Art, language review and U08 acceptance remain open.`);
