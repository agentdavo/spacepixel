/** Only the scoped frontier atlas has translations here. Existing campaign text is not yet extracted. */
export const EN = {
  title: 'Open Horizon — frontier atlas', subtitle: 'Survey the regions, civilizations and contact languages beyond the Reach.',
  scope: 'Development atlas. New regions are survey data; flight encounters, ports and story arcs are still in production.',
  region: 'Region', destination: 'Destination', route: 'Plot route', noRoute: 'No open route', hops: '{count} gate hops',
  owner: 'Government', people: 'People', culture: 'Culture', ships: 'Shipbuilding tradition', language: 'Language',
  doctrine: 'Fleet doctrine', weakness: 'Engineering trade-off', dispute: 'Internal debate', economy: 'Regional supply / demand',
  uiLocale: 'Interface language', subLocale: 'Subtitle language', spoken: 'Contact language', native: 'Show native transcription',
  translation: 'Translator knowledge', contact: 'Contact phrasebook', source: 'English source', draft: 'Japanese draft',
  export: 'Export survey notes', import: 'Import survey notes', saved: 'Survey notes saved', failed: 'Could not save survey notes; existing data was preserved.',
  imported: 'Survey notes imported', invalid: 'Invalid or newer save. Existing survey notes were preserved.',
  home: 'Return to Vanguard', pilot: 'Pilot hull prototypes', inspect: 'Inspect hull', progress: 'Production status',
  sample: 'Translation sample', unknown: 'Unidentified', identified: 'Identified', contactLevel: 'Contact vocabulary', fluent: 'Interpretation', nuance: 'Cultural nuance',
  empty: 'Select a system to read its survey.', count: '{count} mapped systems', pending: 'Content production pending',
} as const;
export type MessageId = keyof typeof EN;
export type LocaleId = 'en-GB' | 'ja-JP' | 'qps-ploc';
export const PLANNED_LOCALES = ['en-GB', 'ja-JP', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR', 'zh-Hans'] as const;
export const JA: Record<MessageId, string> = {
  title: 'オープン・ホライズン — フロンティア星図', subtitle: 'リーチの外に広がる地域、文明、交信用言語を調査します。',
  scope: '開発中の星図です。新地域は調査データのみで、飛行中の遭遇、港、物語は制作中です。',
  region: '地域', destination: '目的地', route: '航路を設定', noRoute: '通行可能な航路がありません', hops: 'ゲート通過 {count} 回',
  owner: '政府', people: '人々', culture: '文化', ships: '造船の伝統', language: '言語',
  doctrine: '艦隊の戦術', weakness: '設計上の制約', dispute: '社会内部の議論', economy: '地域の供給 / 需要',
  uiLocale: '表示言語', subLocale: '字幕言語', spoken: '交信用言語', native: '原語の表記を表示',
  translation: '翻訳機の知識', contact: '交信用フレーズ集', source: '英語原文', draft: '日本語草稿',
  export: '調査記録をエクスポート', import: '調査記録をインポート', saved: '調査記録を保存しました', failed: '保存できませんでした。既存の記録は保持されています。',
  imported: '調査記録をインポートしました', invalid: '無効、または新しい版の記録です。既存の記録は保持されています。',
  home: 'Vanguard に戻る', pilot: '試作船体', inspect: '船体を見る', progress: '制作状況',
  sample: '翻訳例', unknown: '未識別', identified: '識別済み', contactLevel: '交信用語', fluent: '通訳', nuance: '文化的な意味',
  empty: '星系を選択すると調査情報が表示されます。', count: '登録星系数 {count}', pending: 'コンテンツ制作待ち',
};
export function isLocale(v: unknown): v is LocaleId { return v === 'en-GB' || v === 'ja-JP' || v === 'qps-ploc'; }
export function pseudo(text: string): string {
  // Preserve named interpolation tokens so the same validation and callers work in every locale.
  return '⟦' + text.split(/(\{\w+\})/g).map(s => s.startsWith('{') ? s : s.replace(/[aeiouAEIOU]/g, c => c + '́' + c)).join('') + ' ⟧';
}
export function message(locale: LocaleId, id: MessageId, values: Record<string, string | number> = {}): string {
  const template = locale === 'ja-JP' ? JA[id] : locale === 'qps-ploc' ? pseudo(EN[id]) : EN[id];
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`Missing ${id}.${key}`);
    return typeof values[key] === 'number' ? new Intl.NumberFormat(locale === 'qps-ploc' ? 'en-GB' : locale).format(values[key]) : String(values[key]);
  });
}
export function validateMessages(bundle: Record<string, string>): string[] {
  return Object.keys(EN).flatMap(id => {
    const expected = [...EN[id as MessageId].matchAll(/\{\w+\}/g)].map(x => x[0]).sort().join();
    const got = bundle[id];
    return !got || [...got.matchAll(/\{\w+\}/g)].map(x => x[0]).sort().join() !== expected ? [`Missing or invalid message ${id}`] : [];
  });
}
