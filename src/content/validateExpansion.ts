import { CIVILIZATIONS, validateCivilizations } from './civilizations.ts';
import { REGIONS } from './regions.ts';
import { LANGUAGES, CONTACT_LINES, PILOT_ROOTS } from './languages.ts';
import { PILOT_HULLS } from './pilotHulls.ts';
import { CONTACT_ASSIGNMENTS } from '../game/expansion/contact.ts';
import { EN, JA, validateMessages } from '../i18n/messages.ts';
export function validateExpansion(): string[] {
  const errors = validateCivilizations(CIVILIZATIONS);
  const languages = new Set(LANGUAGES.map(l => l.id));
  for (const c of CIVILIZATIONS.cultures) if (!languages.has(c.language)) errors.push(`Culture ${c.id}: missing language`);
  for (const p of CIVILIZATIONS.polities) if (!languages.has(p.language)) errors.push(`Polity ${p.id}: missing language`);
  if (languages.size !== LANGUAGES.length) errors.push('Duplicate language ID');
  for (const r of REGIONS) {
    if (r.owner !== 'mixed' && !CIVILIZATIONS.polities.some(p => p.id === r.owner)) errors.push(`${r.id}: missing polity`);
    if (new Set(r.anchors.map(a => a.id)).size !== r.anchors.length) errors.push(`${r.id}: duplicate anchor`);
  }
  if (new Set(REGIONS.map(r => r.id)).size !== REGIONS.length) errors.push('Duplicate region ID');
  if (new Set(PILOT_HULLS.map(h => h.id)).size !== PILOT_HULLS.length) errors.push('Duplicate hull ID');
  if (new Set(CONTACT_LINES.map(l => l.id)).size !== CONTACT_LINES.length) errors.push('Duplicate dialogue ID');
  for (const line of CONTACT_LINES) for (const language of ['nacric', 'orunic'] as const) {
    const roots = new Set(Object.values(PILOT_ROOTS[language]));
    for (const word of line[language].replace(/[.?!]/g, '').split(/\s+/)) if (!roots.has(word)) errors.push(`${line.id}: unknown ${language} root ${word}`);
  }
  const known = new Set<string>();
  for (const a of CONTACT_ASSIGNMENTS) {
    if (known.has(a.id) || a.after && !known.has(a.after)) errors.push(`${a.id}: duplicate or forward/cyclic prerequisite`);
    if (!Number.isSafeInteger(a.units) || a.units < 1 || !Number.isSafeInteger(a.reward) || a.reward < 0) errors.push(`${a.id}: invalid terms`);
    known.add(a.id);
  }
  errors.push(...validateMessages(EN), ...validateMessages(JA));
  return errors;
}
