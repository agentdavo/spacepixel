import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { CIVILIZATIONS, POLITY_IDS, validateCivilizations, transferOwnership } from '../src/content/civilizations.ts';
import { REGIONS } from '../src/content/regions.ts';
import { PILOT_HULLS } from '../src/content/pilotHulls.ts';
import { buildRegion, buildAtlas, validateAtlas, sectorRoute, regionalEconomy } from '../src/universe/expansion.ts';
import { newExpansionSave, parseExpansionSave, loadExpansion, saveExpansion, EXPANSION_KEY } from '../src/game/expansion/save.ts';
import { CONTACT_ASSIGNMENTS, deliverContact } from '../src/game/expansion/contact.ts';
import { newLedger, normaliseLedger, quote, buy, sell } from '../src/game/economy.ts';
import { CONTACT_LINES, interpretContact, voiceAssetKey } from '../src/content/languages.ts';
import { message, JA, validateMessages } from '../src/i18n/messages.ts';
import { validateExpansion } from '../src/content/validateExpansion.ts';

test('content registry validates references and keeps people distinct from governments', () => {
  assert.deepEqual(validateExpansion(), []);
  assert.equal(CIVILIZATIONS.peoples.length, 8); assert.equal(CIVILIZATIONS.polities.length, 10);
  assert.equal(CIVILIZATIONS.polities.filter(p => p.people.includes('human')).length, 3);
  const bad = structuredClone(CIVILIZATIONS); bad.polities[0].culture = 'missing'; bad.peoples.push(bad.peoples[0]);
  assert.ok(validateCivilizations(bad).length >= 2);
});
test('captured hull retains its tradition and crew origin', () => {
  const ship = { owner: 'pelagic' as const, tradition: 'pelagic-tradition', crew: ['nacrean' as const], organization: 'pelagic-services' };
  const next = transferOwnership(ship, 'concord');
  assert.equal(next.owner, 'concord'); assert.equal(next.tradition, ship.tradition); assert.deepEqual(next.crew, ship.crew);
  assert.equal(ship.owner, 'pelagic'); assert.equal(next.organization, undefined);
});
test('region generation is independent of manifest order and new distant content', () => {
  const r = REGIONS[1], before = buildRegion(1994, r);
  buildRegion(1994, REGIONS[2]);
  assert.deepEqual(buildRegion(1994, r), before);
  assert.notDeepEqual(buildRegion(1995, r).map(s => [s.x, s.y]), before.map(s => [s.x, s.y]));
  assert.deepEqual(buildRegion(1995, r).map(s => s.id), before.map(s => s.id));
  assert.throws(() => buildRegion(1994, { ...r, count: 0 }));
});
test('routes reject missing endpoints and honor border closures without changing saved topology', () => {
  const systems = buildRegion(1994, { ...REGIONS[1], count: 6 });
  const a = { version: 1 as const, seed: 1994, systems };
  const from = systems[0].id, to = systems[1].id;
  assert.deepEqual(sectorRoute(a, 'missing', to), []); assert.deepEqual(sectorRoute(a, from, from), [from]);
  assert.equal(sectorRoute(a, from, to).length, 2);
  const closed = new Set([from, to].sort().join('|').split('\n'));
  assert.equal(sectorRoute(a, from, to, closed).length, 6);
  const broken = structuredClone(a); broken.systems[0].links.push('missing'); assert.ok(validateAtlas(broken).length);
  assert.equal(sectorRoute(a, from, to).length, 2);
});
test('background economy is coarse deterministic data', () => {
  assert.deepEqual(regionalEconomy(1994, 'pelagic', 1), regionalEconomy(1994, 'pelagic', 3599));
  assert.deepEqual(regionalEconomy(1994, 'pelagic', 7200), regionalEconomy(1994, 'pelagic', 7200));
});
test('save import validates before mutation; future and corrupt stores remain untouched', () => {
  const data = new Map<string, string>(); const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.equal(loadExpansion(storage).writable, true);
  const save = newExpansionSave(); assert.equal(saveExpansion(storage, save), true);
  const original = data.get(EXPANSION_KEY); save.selected = 'pelagic:basin'; assert.equal(saveExpansion(storage, save), true);
  assert.equal(data.get(`${EXPANSION_KEY}.backup`), original);
  assert.deepEqual(parseExpansionSave(JSON.parse(data.get(EXPANSION_KEY)!)), save);
  const future = JSON.stringify({ ...save, version: 9 }); data.set(EXPANSION_KEY, future);
  assert.equal(loadExpansion(storage).writable, false); assert.equal(saveExpansion(storage, save), false); assert.equal(data.get(EXPANSION_KEY), future);
  assert.throws(() => parseExpansionSave({ ...save, translators: { nacric: NaN, orunic: 0 } }));
  const blocked = { getItem: () => null, setItem: () => { throw new Error('Quota'); } }; assert.equal(saveExpansion(blocked, save), false);
});
test('legacy economy migration preserves assets and initializes independent standings', () => {
  const old = { credits: 12345, capacity: 32, cargo: { medical: 3 }, missiles: 4, clock: 123, rep: { concord: 42, choir: -16, rustwake: 12 }, lastDock: 'meridian-orbital-0', pressure: {} };
  const ledger = normaliseLedger(old);
  assert.equal(ledger.credits, old.credits); assert.deepEqual(ledger.cargo, old.cargo); assert.equal(ledger.lastDock, old.lastDock);
  assert.equal(ledger.rep.concord, 42); assert.equal(ledger.rep.pelagic, 0); assert.equal(ledger.rep.mantle, 0);
  assert.deepEqual(normaliseLedger(ledger), ledger);
});
test('all polity markets return finite quotes without profitable same-station round trips', () => {
  for (const faction of POLITY_IDS) {
    const station = { id: `market-${faction}`, kind: 'freeport' as const, faction };
    const ledger = newLedger(); ledger.credits = 10000;
    const q = quote(station, 'medical', ledger); assert.ok(Number.isFinite(q.buy)); assert.ok(q.buy > q.sell);
    const bought = buy(ledger, station, 'medical', 1); assert.equal(bought.units, 1);
    const sold = sell(bought.ledger, station, 'medical', 1); assert.equal(sold.units, 1);
    assert.ok(sold.ledger.credits < ledger.credits); assert.ok(Number.isFinite(sold.ledger.rep[faction]));
  }
});
test('contact agreements consume actual cargo and award once across reload', () => {
  let ledger = newLedger(); ledger.credits = 100000;
  for (const a of CONTACT_ASSIGNMENTS) {
    const previous = ledger;
    assert.equal(deliverContact(ledger, 'wrong', a.id).ledger, ledger);
    assert.equal(deliverContact(ledger, `${a.system}-freeport-0`, a.id).ledger, ledger);
    ledger = { ...ledger, cargo: { ...ledger.cargo, [a.cargo]: a.units } };
    const result = deliverContact(ledger, `${a.system}-freeport-0`, a.id); assert.equal(result.error, undefined);
    ledger = normaliseLedger(result.ledger); assert.equal(ledger.cargo[a.cargo] ?? 0, 0); assert.equal(ledger.credits, previous.credits + a.reward);
    assert.equal(deliverContact(ledger, `${a.system}-freeport-0`, a.id).ledger, ledger);
  }
  assert.deepEqual(ledger.contact, { version: 1, completed: CONTACT_ASSIGNMENTS.map(a => a.id) }); assert.equal(ledger.rep.pelagic, 15); assert.equal(ledger.rep.mantle, 15);
});
test('essential contact meanings survive unknown language; optional meanings unlock', () => {
  for (const line of CONTACT_LINES.filter(l => l.essential)) assert.equal(interpretContact(line.id, 'nacric', 0).text, line.meaning);
  assert.equal(interpretContact('contact.hail', 'nacric', 0).translated, false);
  assert.equal(interpretContact('contact.hail', 'nacric', 2, 'ja-JP').text, CONTACT_LINES[0].ja);
  assert.throws(() => interpretContact('invented', 'nacric', 4));
});
test('locale placeholders and voice asset revisions are explicit', () => {
  assert.deepEqual(validateMessages(JA), []);
  assert.match(message('qps-ploc', 'hops', { count: 12 }), /12/);
  assert.throws(() => message('en-GB', 'hops'));
  assert.ok(validateMessages({ ...JA, hops: 'no count' }).length);
  const v = { dialogue: 'contact.hail', revision: 1, language: 'nacric' as const, voice: 'pilot/a', pronunciation: 1 };
  assert.notEqual(voiceAssetKey(v), voiceAssetKey({ ...v, pronunciation: 2 })); assert.match(voiceAssetKey(v), /pilot%2Fa/);
});

let server: ViteDevServer | undefined;
after(async () => { await server?.close(); });
test('192-system atlas and playable pilot preserve the Reach and supply valid ports/routes', { timeout: 240000 }, async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const { generateUniverse, generateFrontierUniverse } = await server.ssrLoadModule('/src/universe/generate.ts');
  const base = generateUniverse(1994), pilot = generateFrontierUniverse(1994);
  assert.equal(base.systems.size, 22); assert.equal(pilot.systems.size, 28);
  for (const [id, s] of base.systems) {
    const next = pilot.systems.get(id);
    assert.deepEqual(JSON.parse(JSON.stringify({ ...next, gates: next.gates.filter((g: { to: string }) => !g.to.startsWith('marches:')) })), JSON.parse(JSON.stringify(s)));
  }
  const reach = [...base.systems.values()].map((s: any) => ({ id: s.id, region: 'reach', name: s.name, owner: 'mixed' as const, x: s.map.x, y: s.map.y, links: s.gates.map((g: any) => g.to), anchor: !!s.blurb, description: s.blurb ?? '' }));
  const atlas = buildAtlas(1994, reach); assert.equal(atlas.systems.length, 192); assert.deepEqual(validateAtlas(atlas), []);
  for (const s of atlas.systems) assert.ok(sectorRoute(atlas, 'meridian', s.id).length, `${s.id} reachable`);
  for (const a of CONTACT_ASSIGNMENTS) {
    const sys = pilot.systems.get(a.system); assert.ok(sys?.stations.length);
    assert.ok(sys.stations.every((s: any) => s.faction === sys.faction && s.id.startsWith(a.system + '-')));
  }
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  for (const h of PILOT_HULLS) assert.equal(BLUEPRINTS[h.id].faction, h.polity);
});
