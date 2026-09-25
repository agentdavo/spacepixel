import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { CONTACT_ASSIGNMENTS, contactAvailable, deliverContact, normalizeContact } from '../src/game/expansion/contact.ts';
import { normaliseLedger, buy } from '../src/game/economy.ts';

const KEY = 'vanguard.trade.v1', BACKUP = `${KEY}.pre-expansion`;
const legacy = JSON.stringify({ credits: 9876, capacity: 32, cargo: { medical: 2 }, missiles: 4, clock: 123, rep: { concord: 42, choir: -16, rustwake: 12 }, lastDock: 'meridian-orbital-0', pressure: {} });
let server: ViteDevServer;
let profile: typeof import('../src/game/Profile.ts');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  profile = await server.ssrLoadModule('/src/game/Profile.ts');
});
after(async () => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  await server?.close();
});
function storage(limit = Infinity) {
  const values = new Map([[KEY, legacy]]);
  const s = {
    values, limit,
    getItem(key: string) { return values.get(key) ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) {
      const used = [...values].reduce((n, [k, v]) => n + (k === key ? 0 : v.length), 0);
      if (used + value.length > s.limit) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: s });
  return s;
}

test('ledger load is read-only; successful primary save makes an optional legacy backup', () => {
  const s = storage();
  const ledger = profile.loadLedger();
  assert.equal(ledger.credits, 9876); assert.equal(s.getItem(BACKUP), null);
  assert.equal(profile.saveLedger(ledger), true);
  assert.equal(s.getItem(BACKUP), legacy);
  assert.deepEqual(profile.loadLedger(), ledger);
});

test('quota permits the primary migration and delivery even when backup plus primary cannot fit', () => {
  const s = storage();
  const loaded = profile.loadLedger();
  const delivered = deliverContact(loaded, 'marches:threshold-freeport-0', 'pelagic-1').ledger;
  s.limit = Math.max(legacy.length * 2, JSON.stringify(delivered).length);
  s.setItem(BACKUP, legacy); // Reproduce the backup left by the previous build.
  assert.ok(legacy.length + JSON.stringify(delivered).length > s.limit);
  assert.equal(profile.saveLedger(delivered), true);
  assert.equal(s.getItem(BACKUP), null);
  const reloaded = profile.loadLedger();
  assert.equal(reloaded.credits, 10976); assert.equal(reloaded.cargo.medical ?? 0, 0);
  assert.deepEqual(reloaded.contact, { version: 1, completed: ['pelagic-1'] });
});

test('failed primary retry preserves old career and restores the optional copy', () => {
  const s = storage(legacy.length * 2);
  s.setItem(BACKUP, legacy);
  const ledger = profile.loadLedger();
  const oversized = { ...ledger, pressure: { veryLarge: 'x'.repeat(1000) } };
  assert.equal(profile.saveLedger(oversized as typeof ledger), false);
  assert.equal(s.getItem(KEY), legacy); assert.equal(s.getItem(BACKUP), legacy);
  assert.equal(profile.loadLedger().credits, 9876);
});

test('without an optional backup, failed save never deletes the primary', () => {
  const s = storage(legacy.length);
  assert.equal(profile.saveLedger(profile.loadLedger()), false);
  assert.equal(s.getItem(KEY), legacy); assert.equal(s.getItem(BACKUP), null);
});

test('future contact subdocument survives real load, ordinary trade, save and reload without enabling contact mutations', () => {
  const s = storage();
  const future = { version: 2, completed: ['pelagic-1', 'pelagic-4'], receipts: { 'pelagic-4': { reward: 3300, revision: 2 } } };
  s.setItem(KEY, JSON.stringify({ ...JSON.parse(legacy), contact: future }));
  const loaded = profile.loadLedger();
  assert.equal(loaded.credits, 9876); assert.deepEqual(loaded.contact, future);
  assert.deepEqual(normaliseLedger(loaded).contact, future);
  for (const assignment of CONTACT_ASSIGNMENTS) {
    assert.equal(contactAvailable(loaded, assignment), false);
    const result = deliverContact(loaded, `${assignment.system}-freeport-0`, assignment.id);
    assert.equal(result.ledger, loaded); assert.match(result.error!, /unsupported version/);
  }
  const traded = buy(loaded, { id: 'meridian-orbital-0', kind: 'freeport', faction: 'concord' }, 'medical', 1);
  assert.equal(traded.units, 1); assert.equal(profile.saveLedger(traded.ledger), true);
  assert.deepEqual(JSON.parse(s.getItem(KEY)!).contact, future);
  assert.deepEqual(profile.loadLedger().contact, future);
});

test('supported contact records still clean corrupt, duplicate and orphaned completions', () => {
  assert.deepEqual(normalizeContact({ version: 1, completed: ['pelagic-2', 'mantle-3', 'unknown', null, 1] }), { version: 1, completed: [] });
  assert.deepEqual(normalizeContact({ version: 1, completed: ['pelagic-2', 'pelagic-1', 'pelagic-1', 'mantle-1', 'unknown'] }), { version: 1, completed: ['pelagic-1', 'pelagic-2', 'mantle-1'] });
  assert.deepEqual(normalizeContact({ version: 1, completed: 'broken' }), { version: 1, completed: [] });
});
