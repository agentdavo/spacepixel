import type { LanguageId } from './civilizations.ts';
export interface LanguageProfile { id: LanguageId; name: string; channel: string; wordOrder: string; negation: string; question: string; status: 'existing-register' | 'pilot-lexicon' | 'brief'; }
export const LANGUAGES: LanguageProfile[] = [
  { id: 'common', name: 'Reach Common', channel: 'Speech', wordOrder: 'Subject–verb–object', negation: 'not', question: 'Interrogative clause', status: 'existing-register' },
  { id: 'hesper', name: 'High Hesper', channel: 'Speech', wordOrder: 'Reach Common ceremonial register', negation: 'not', question: 'Witnessed request', status: 'existing-register' },
  { id: 'cant', name: 'Rustwake Trade Cant', channel: 'Speech', wordOrder: 'Reach Common trade register', negation: 'not', question: 'Direct request', status: 'existing-register' },
  { id: 'works', name: 'Kessendra Works Tongue', channel: 'Speech and work signs', wordOrder: 'Existing lore governs authored lines', negation: 'Story-authored', question: 'Story-authored', status: 'existing-register' },
  { id: 'nacric', name: 'Nacric', channel: 'Harmonic pulses and clicks; radio transcription', wordOrder: 'Subject–object–verb; modifiers precede nouns', negation: 'nu before predicate', question: 'Final ki', status: 'pilot-lexicon' },
  { id: 'orunic', name: 'Orunic', channel: 'Percussion and vibration; radio transcription', wordOrder: 'Subject–verb–object; modifiers follow nouns', negation: 'dak before verb', question: 'Initial ka', status: 'pilot-lexicon' },
  { id: 'veyric', name: 'Veyric', channel: 'Whistled contours', wordOrder: 'Pending authored grammar', negation: 'Pending', question: 'Pending', status: 'brief' },
  { id: 'serevic', name: 'Serevic', channel: 'Parallel signs and serial radio', wordOrder: 'Pending authored grammar', negation: 'Pending', question: 'Pending', status: 'brief' },
  { id: 'aruunic', name: 'Aruunic', channel: 'Breath and overtones', wordOrder: 'Pending authored grammar', negation: 'Pending', question: 'Pending', status: 'brief' },
  { id: 'vorr', name: 'Vorr notation', channel: 'Packets and audible notation', wordOrder: 'Pending authored grammar', negation: 'Pending', question: 'Pending', status: 'brief' },
];
/** Authored vocabulary with fixed meaning. Not random syllables presented as translations. */
export const PILOT_ROOTS: Record<'nacric' | 'orunic', Record<string, string>> = {
  nacric: { I: 'mi', we: 'maa', you: 'ti', vessel: 'keli', port: 'saa', gate: 'oika', route: 'neli', pressure: 'ulu', medicine: 'sili', shelter: 'ama', fuel: 'oko', cargo: 'pali', safe: 'sei', damaged: 'ka', need: 'la', offer: 'ena', approach: 'tela', stop: 'ta', depart: 'lui', thank: 'eia', open: 'oa', wait: 'naa', repair: 'kala', ready: 'ei' },
  orunic: { I: 'en', we: 'om', you: 'ut', vessel: 'dor', port: 'bar', gate: 'gur', route: 'trak', pressure: 'dum', medicine: 'sel', shelter: 'bur', fuel: 'kar', cargo: 'pak', safe: 'tem', damaged: 'ruk', need: 'vek', offer: 'dakha', approach: 'tor', stop: 'tek', depart: 'dar', thank: 'rem', open: 'gor', wait: 'nak', repair: 'bak', ready: 'ket' },
};
export interface ContactLine { id: string; meaning: string; ja: string; nacric: string; orunic: string; essential: boolean; }
export const CONTACT_LINES: ContactLine[] = [
  { id: 'contact.hail', meaning: 'We offer safe shelter.', ja: '安全な避難場所を提供します。', nacric: 'maa sei ama ena', orunic: 'om dakha bur tem', essential: false },
  { id: 'contact.approach', meaning: 'Approach the port.', ja: '港に接近してください。', nacric: 'saa tela', orunic: 'tor bar', essential: true },
  { id: 'contact.hold', meaning: 'Stop. Wait.', ja: '停止して待機してください。', nacric: 'ta. naa.', orunic: 'tek. nak.', essential: true },
  { id: 'contact.medical', meaning: 'We need medicine.', ja: '医薬品が必要です。', nacric: 'maa sili la', orunic: 'om vek sel', essential: true },
  { id: 'contact.fuel', meaning: 'We need fuel.', ja: '燃料が必要です。', nacric: 'maa oko la', orunic: 'om vek kar', essential: true },
  { id: 'contact.damage', meaning: 'The vessel is damaged.', ja: '船が損傷しています。', nacric: 'keli ka', orunic: 'dor ruk', essential: true },
  { id: 'contact.repair', meaning: 'We offer repairs.', ja: '修理を引き受けます。', nacric: 'maa kala ena', orunic: 'om dakha bak', essential: false },
  { id: 'contact.open', meaning: 'The gate is open.', ja: 'ゲートは開いています。', nacric: 'oika oa', orunic: 'gur gor', essential: true },
  { id: 'contact.depart', meaning: 'You may depart.', ja: '出港できます。', nacric: 'ti lui', orunic: 'ut dar', essential: true },
  { id: 'contact.thanks', meaning: 'We thank you.', ja: '感謝します。', nacric: 'maa ti eia', orunic: 'om rem ut', essential: false },
  { id: 'contact.ready', meaning: 'The vessel is ready.', ja: '船の準備ができました。', nacric: 'keli ei', orunic: 'dor ket', essential: true },
  { id: 'contact.route', meaning: 'The route is safe.', ja: '航路は安全です。', nacric: 'neli sei', orunic: 'trak tem', essential: true },
];
export type TranslationLevel = 0 | 1 | 2 | 3 | 4;
/** Mission-critical meanings remain readable, irrespective of narrative translator progress. */
export function interpretContact(id: string, language: 'nacric' | 'orunic', level: TranslationLevel, locale = 'en-GB') {
  const line = CONTACT_LINES.find(l => l.id === id);
  if (!line) throw new Error(`Unknown contact meaning ${id}`);
  return { id, native: line[language], text: line.essential || level >= 2 ? (locale === 'ja-JP' ? line.ja : line.meaning) : (locale === 'ja-JP' ? '未翻訳の通信' : 'Untranslated transmission'), translated: line.essential || level >= 2 };
}
export interface VoiceAssetIdentity { dialogue: string; revision: number; language: LanguageId; voice: string; pronunciation: number; }
export function voiceAssetKey(v: VoiceAssetIdentity): string {
  if (!Number.isSafeInteger(v.revision) || v.revision < 1 || !Number.isSafeInteger(v.pronunciation) || v.pronunciation < 1) throw new Error('Invalid voice revision');
  return [v.dialogue, String(v.revision), v.language, v.voice, String(v.pronunciation)].map(encodeURIComponent).join('/');
}
