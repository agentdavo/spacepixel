import { CIVILIZATIONS, POLITIES, TRADITIONS, isPolity } from '../content/civilizations';
import { REGIONS } from '../content/regions';
import { PILOT_HULLS } from '../content/pilotHulls';
import { EXPANSION_MILESTONES } from '../content/production';
import { CONTACT_LINES, LANGUAGES, interpretContact, type TranslationLevel } from '../content/languages';
import { buildAtlas, regionalEconomy, sectorRoute, type SectorAtlas } from '../universe/expansion';
import { generateUniverse } from '../universe/generate';
import { browserExpansionStorage, loadExpansion, parseExpansionSave, saveExpansion, type ExpansionSave } from '../game/expansion/save';
import { message, type LocaleId, type MessageId } from '../i18n/messages';
import './frontier.css';

/** DOM-only survey workbench: the atlas does not create a renderer or instantiate distant fleets. */
export function mountFrontierAtlas(root: HTMLElement): void {
  const loaded = loadExpansion(browserExpansionStorage);
  let save: ExpansionSave = loaded.save;
  let region = save.selected.split(':')[0];
  if (!REGIONS.some(r => r.id === region)) region = 'reach';
  let atlas: SectorAtlas;
  let status = loaded.error ? 'invalid' : '';
  const makeAtlas = () => {
    const reach = generateUniverse(save.seed);
    atlas = buildAtlas(save.seed, [...reach.systems.values()].map(s => ({ id: s.id, region: 'reach', name: s.name,
      owner: isPolity(s.faction) ? s.faction : 'mixed', x: s.map.x, y: s.map.y, links: s.gates.map(g => g.to), anchor: !!s.blurb, description: s.blurb ?? 'Existing Reach system.' })));
  };
  makeAtlas();
  document.getElementById('viewport')?.setAttribute('hidden', '');
  const shell = document.createElement('main'); shell.id = 'frontier-atlas'; root.append(shell);
  const t = (id: MessageId, values?: Record<string, string | number>) => message(save.preferences.ui, id, values);
  const persist = () => { status = loaded.writable && saveExpansion(browserExpansionStorage, save) ? 'saved' : 'failed'; };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  const button = (label: string, click: () => void) => { const b = el('button', label); b.type = 'button'; b.onclick = click; return b; };
  const select = (label: string, options: [string, string][], value: string, change: (v: string) => void) => {
    const wrap = el('label', label); const input = el('select');
    input.setAttribute('aria-label', label);
    for (const [id, name] of options) { const o = el('option', name); o.value = id; input.append(o); }
    input.value = value; input.onchange = () => { change(input.value); persist(); draw(); }; wrap.append(input); return wrap;
  };
  const link = (label: string, href: string) => { const a = el('a', label); a.href = href; return a; };
  const draw = () => {
    shell.replaceChildren(); shell.lang = save.preferences.ui === 'qps-ploc' ? 'en-GB' : save.preferences.ui;
    const head = el('header'); head.append(el('p', 'VANGUARD / OPEN HORIZON'), el('h1', t('title')), el('p', t('subtitle')));
    const actions = el('nav'); actions.append(link(t('home'), '/'), link('Fly the six-system prototype', '/?scene=flight&expansion=pilot'));
    head.append(actions); shell.append(head);
    const scope = el('p', t('scope')); scope.className = 'frontier-scope'; shell.append(scope);
    const settings = el('div'); settings.className = 'frontier-settings';
    const locales: [string, string][] = [['en-GB', 'English'], ['ja-JP', '日本語 — draft'], ['qps-ploc', 'Expanded text test']];
    settings.append(select(t('uiLocale'), locales, save.preferences.ui, v => save.preferences.ui = v as LocaleId),
      select(t('subLocale'), locales, save.preferences.subtitles, v => save.preferences.subtitles = v as LocaleId),
      select(t('spoken'), [['nacric', 'Nacric'], ['orunic', 'Orunic']], save.preferences.speech, v => save.preferences.speech = v as 'nacric' | 'orunic'));
    const native = el('label', t('native')), check = el('input'); check.type = 'checkbox'; check.checked = save.preferences.native;
    check.onchange = () => { save.preferences.native = check.checked; persist(); draw(); }; native.prepend(check); settings.append(native); shell.append(settings);
    const regions = el('nav'); regions.className = 'frontier-regions';
    for (const r of REGIONS) { const b = button(`${r.name} · ${r.count}`, () => { region = r.id; draw(); }); b.setAttribute('aria-pressed', String(region === r.id)); regions.append(b); } shell.append(regions);
    const grid = el('div'); grid.className = 'frontier-grid';
    const map = el('section'); map.append(el('h2', REGIONS.find(r => r.id === region)!.name), el('p', t('count', { count: atlas.systems.length })));
    const systems = atlas.systems.filter(s => s.region === region), list = el('div'); list.className = 'frontier-systems';
    for (const s of systems) {
      const b = button(`${s.anchor ? '◆' : '·'} ${s.name}`, () => { save.selected = s.id; if (!save.charted.includes(s.id)) save.charted.push(s.id); persist(); draw(); });
      b.setAttribute('aria-pressed', String(s.id === save.selected)); list.append(b);
    }
    map.append(list); grid.append(map);
    const dossier = el('section'); const current = atlas.systems.find(s => s.id === save.selected);
    if (current) {
      dossier.append(el('h2', current.name), el('p', current.description));
      const route = sectorRoute(atlas, 'rustwake', current.id);
      dossier.append(el('h3', t('route')), el('p', route.length ? t('hops', { count: route.length - 1 }) : t('noRoute')), el('p', route.map(id => atlas.systems.find(s => s.id === id)!.name).join(' → ')));
      if (current.owner !== 'mixed') {
        const p = POLITIES[current.owner], c = CIVILIZATIONS.cultures.find(c => c.id === p.culture)!, tr = TRADITIONS[p.tradition];
        for (const [label, text] of [[t('owner'), p.name], [t('people'), p.people.map(id => CIVILIZATIONS.peoples.find(x => x.id === id)!.name).join(', ')], [t('culture'), c.custom], [t('dispute'), c.disagreement], [t('ships'), tr.silhouette], [t('doctrine'), tr.doctrine], [t('weakness'), tr.limitation], [t('language'), LANGUAGES.find(l => l.id === p.language)!.name]]) {
          dossier.append(el('h3', label), el('p', text));
        }
      }
      const economy = regionalEconomy(atlas.seed, current.region, 0);
      dossier.append(el('h3', t('economy')), el('p', `${economy.supply} / ${economy.demand} · prototype baseline`));
    } else dossier.append(el('p', t('empty')));
    grid.append(dossier); shell.append(grid);
    const phrasebook = el('section'); phrasebook.append(el('h2', t('contact')));
    const lang = save.preferences.speech;
    phrasebook.append(select(t('translation'), ['unknown', 'identified', 'contactLevel', 'fluent', 'nuance'].map((key, i) => [String(i), t(key as MessageId)]), String(save.translators[lang]), value => save.translators[lang] = Number(value) as TranslationLevel));
    const corpus = el('div'); corpus.className = 'frontier-phrases';
    for (const line of CONTACT_LINES) { const sample = interpretContact(line.id, lang, save.translators[lang], save.preferences.subtitles); const p = el('p', sample.text); if (save.preferences.native) p.append(el('small', sample.native)); corpus.append(p); }
    phrasebook.append(corpus); shell.append(phrasebook);
    const hulls = el('section'); hulls.append(el('h2', t('pilot'))); const hullGrid = el('div'); hullGrid.className = 'frontier-hulls';
    for (const h of PILOT_HULLS) { const card = el('article'); card.append(el('h3', h.name), el('p', `${POLITIES[h.polity].name} · ${h.role} · ${h.length} m`), el('p', h.notes), link(t('inspect'), `/?scene=hangar&ship=${h.id}`)); hullGrid.append(card); }
    hulls.append(hullGrid); shell.append(hulls);
    const production = el('details'); production.append(el('summary', t('progress')));
    for (const m of EXPANSION_MILESTONES) production.append(el('h3', `${m.id} · ${m.name} · ${m.status}`), el('p', m.remaining)); shell.append(production);
    const foot = el('footer'); foot.append(button(t('export'), () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }));
      const a = link('', url); a.download = 'vanguard-survey.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    file.onchange = async () => {
      try {
        const f = file.files?.[0]; if (!f || f.size > 1000000) throw new Error('Invalid file size');
        const candidate = parseExpansionSave(JSON.parse(await f.text()));
        if (!loaded.writable || !saveExpansion(browserExpansionStorage, candidate)) throw new Error('Save protected');
        save = candidate; makeAtlas(); region = REGIONS.some(r => r.id === save.selected.split(':')[0]) ? save.selected.split(':')[0] : 'reach'; status = 'imported';
      } catch { status = 'invalid'; } draw();
    };
    foot.append(button(t('import'), () => file.click()), file);
    const live = el('p', status ? t(status as MessageId) : ''); live.setAttribute('role', 'status'); foot.append(live); shell.append(foot);
  };
  draw();
}
