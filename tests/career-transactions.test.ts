import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ViteDevServer } from 'vite';

const PAIR = 'vanguard.career.v1', LEDGER = 'vanguard.trade.v1', HANGAR = 'vanguard.hangar.v1';
let vite: ViteDevServer, profile: any, shop: any, Outfitter: any, ReplayDirector: any, DockScreen: any;
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
before(async () => {
  vite = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  profile = await vite.ssrLoadModule('/src/game/Profile.ts');
  shop = await vite.ssrLoadModule('/src/game/outfitting/hangar.ts');
  ({ Outfitter } = await vite.ssrLoadModule('/src/game/outfitting/Outfitter.ts'));
  ({ ReplayDirector } = await vite.ssrLoadModule('/src/game/ReplayDirector.ts'));
  ({ DockScreen } = await vite.ssrLoadModule('/src/ui/DockScreen.ts'));
});
after(async () => {
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  await vite?.close();
});
function storage() {
  const values = new Map<string, string>();
  const s = { values, failRead: false, failWrite: false, writes: 0,
    getItem(k: string) { if (s.failRead) throw Error('blocked'); return values.get(k) ?? null; },
    setItem(k: string, v: string) { s.writes++; if (s.failWrite) throw Error('quota'); values.set(k, v); },
    removeItem(k: string) { values.delete(k); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: s });
  const ledger = profile.loadLedger(); ledger.credits = 100000;
  values.set(LEDGER, JSON.stringify(ledger)); values.set(HANGAR, JSON.stringify(shop.newHangar()));
  return s;
}
function refit() {
  const hangar = profile.loadHangar(), ledger = profile.loadLedger();
  const r = shop.buyItem(hangar, ledger, hangar.active, 'engine', 'engine-c1-anchorage-mk2', { id: 'yard', kind: 'bastion', faction: 'concord' });
  assert.equal(r.error, undefined);
  return r;
}

test('migration commits the whole shop pair in one write; legacy copies and future contact data survive', () => {
  const s = storage();
  const future = { version: 99, completed: ['future'], opaque: { receipt: 1 } };
  const old = JSON.parse(s.values.get(LEDGER)!); old.contact = future;
  s.values.set(LEDGER, JSON.stringify(old));
  const legacy = new Map(s.values), r = refit();
  assert.equal(profile.saveCareer(r.ledger, r.hangar), true);
  assert.equal(s.writes, 1);
  assert.equal(s.values.get(LEDGER), legacy.get(LEDGER));
  assert.equal(s.values.get(HANGAR), legacy.get(HANGAR));
  assert.deepEqual(profile.loadLedger(), r.ledger);
  assert.deepEqual(profile.loadHangar(), r.hangar);
  assert.deepEqual(profile.loadLedger().contact, future);
  // Later ordinary writers must preserve the other half of the authoritative pair.
  const next = { ...profile.loadLedger(), credits: r.ledger.credits + 25 };
  assert.equal(profile.saveLedger(next), true);
  assert.deepEqual(profile.loadHangar(), r.hangar);
  const h = profile.loadHangar(); h.ships[0].condition = 0.4;
  assert.equal(profile.saveHangar(h), true);
  assert.deepEqual(profile.loadLedger(), next);
  assert.equal(profile.loadHangar().ships[0].condition, 0.4);
});

test('quota failure at first or subsequent pair commit preserves both halves on reload and retry charges once', () => {
  for (const migrated of [false, true]) {
    const s = storage();
    if (migrated) assert.equal(profile.saveCareer(profile.loadLedger(), profile.loadHangar()), true);
    const before = new Map(s.values), r = refit();
    s.failWrite = true;
    assert.equal(profile.saveCareer(r.ledger, r.hangar), false);
    assert.deepEqual(s.values, before);
    assert.equal(profile.loadLedger().credits, 100000);
    assert.notEqual(profile.loadHangar().ships[0].fit.engine, r.hangar.ships[0].fit.engine);
    s.failWrite = false;
    assert.equal(profile.saveCareer(r.ledger, r.hangar), true);
    assert.equal(profile.loadLedger().credits, r.ledger.credits);
    assert.equal(shop.buyItem(profile.loadHangar(), profile.loadLedger(), r.hangar.active, 'engine', r.hangar.ships[0].fit.engine, { id:'yard', kind:'bastion', faction:'concord' }).error, 'ALREADY FITTED');
  }
});

test('failed reads, malformed and future career records cannot be replaced with defaults', () => {
  const s = storage(), r = refit();
  s.failRead = true;
  assert.equal(profile.saveCareer(r.ledger, r.hangar), false);
  assert.equal(profile.saveLedger(r.ledger), false);
  assert.equal(profile.saveHangar(r.hangar), false);
  s.failRead = false;
  for (const raw of ['{broken', JSON.stringify({ version: 2, ledger: r.ledger, hangar: r.hangar }), JSON.stringify({ version: 1, ledger: [], hangar: {} })]) {
    s.values.set(PAIR, raw);
    assert.equal(profile.saveCareer(r.ledger, r.hangar), false);
    assert.equal(profile.saveLedger(r.ledger), false);
    assert.equal(profile.saveHangar(r.hangar), false);
    assert.equal(s.values.get(PAIR), raw);
  }
});

test('Outfitter failure never changes the live money/fit or settles; successful repair survives reload', () => {
  const s = storage(), o = new Outfitter(), r = refit();
  const ledger = profile.loadLedger(), hangar = o.hangar;
  const host = { ledger, player: { hull: 55, hullMax: 110 } };
  o.bind(host); o.flying = { uid: hangar.active, hull: hangar.ships[0].hull, fit: hangar.ships[0].fit };
  let settles = 0; o.settle = () => { settles++; };
  s.failWrite = true;
  assert.equal(o.commit(r), false);
  assert.equal(o.hangar, hangar); assert.equal(host.ledger, ledger); assert.equal(settles, 0);
  assert.equal(o.commitRepair({ ...ledger, credits: 99500 }, 1), false);
  assert.equal(host.ledger, ledger); assert.equal(o.hangar, hangar);
  s.failWrite = false;
  assert.equal(o.commit(r), true); assert.equal(settles, 1);
  assert.equal(profile.loadHangar().ships[0].condition, 0.5);
  assert.equal(o.commitRepair({ ...host.ledger, credits: host.ledger.credits - 100 }, 1), true);
  assert.equal(profile.loadHangar().ships[0].condition, 1);
  assert.equal(profile.loadLedger().credits, host.ledger.credits);
});

test('shop replay records only successful commits and suppresses nested ledger commands', () => {
  const commands: unknown[] = [];
  const d = Object.create(ReplayDirector.prototype);
  Object.assign(d, { mode: 'record', booting: false, suppress: 0, applying: false, host: { inTick: false }, take: { command: (...args: unknown[]) => commands.push(args) } });
  assert.equal(d.transaction('outfit', { id: 1 }, () => false), false);
  assert.equal(commands.length, 0);
  assert.equal(d.transaction('outfit', { id: 2 }, () => { d.note('ledger', {}); return true; }), true);
  assert.deepEqual(commands, [['outfit', { id: 2 }]]);
  assert.throws(() => d.transaction('outfit', {}, () => { throw Error('unexpected'); }));
  assert.equal(d.suppress, 0); assert.equal(commands.length, 1);
  d.mode = 'play'; let called = false;
  assert.equal(d.transaction('outfit', {}, () => { called = true; return true; }), false);
  assert.equal(called, false);
});

test('durable refit applies to the actual flying ship only after storage accepts it', async () => {
  const s = storage();
  const { Group, Vector3 } = await vite.ssrLoadModule('three');
  const { Fleet } = await vite.ssrLoadModule('/src/sim/Fleet.ts');
  const fleet = new Fleet(new Group()), o = new Outfitter();
  const player = o.spawn(fleet, new Vector3(), new Vector3(0, 0, 1), {}, {});
  const host = { fleet, player, ledger: profile.loadLedger(), inEpisode: () => false, turrets: { setHangar() {} } };
  o.bind(host); player.hull = player.hullMax * 0.5;
  const oldSpeed = player.flight.spec.maxSpeed, oldFit = JSON.stringify(o.current());
  const r = refit(); s.failWrite = true;
  assert.equal(o.commit(r), false);
  assert.equal(player.flight.spec.maxSpeed, oldSpeed);
  assert.equal(JSON.stringify(o.current()), oldFit);
  s.failWrite = false;
  assert.equal(o.commit(r), true);
  assert.ok(player.flight.spec.maxSpeed > oldSpeed);
  assert.equal(host.player, player);
  assert.equal(player.hull / player.hullMax, 0.5);
  assert.deepEqual(profile.loadHangar(), o.hangar);
  assert.deepEqual(profile.loadLedger(), host.ledger);
});

test('market, rearm and repair failure never applies world-trade/hull effects or success acknowledgement', () => {
  const s = storage();
  const d = Object.create(DockScreen.prototype);
  let ledger = profile.loadLedger(); ledger.missiles = 0;
  let worldTrades = 0, hullWrites = 0;
  Object.assign(d, { log: [], render() {}, ctx: {
    ledger: () => ledger, station: { id: 'yard', kind: 'bastion', faction: 'concord' },
    commitLedger: (l: any) => { if (!profile.saveLedger(l)) return false; ledger = l; return true; },
    commitRepair: () => false,
    setLedger: () => { throw Error('non-durable path'); },
    onTrade: () => { worldTrades++; }, hull: () => 0.5, setHull: () => { hullWrites++; },
  } });
  s.failWrite = true;
  d.trade('medical', 'buy', 1); d.rearm(); d.repair();
  assert.equal(worldTrades, 0); assert.equal(hullWrites, 0); assert.equal(ledger.credits, 100000);
  assert.equal(d.log.length, 3);
  assert.ok(d.log.every((l: any) => l.cls === 'err' && l.text.includes('COULD NOT SAVE')));
  s.failWrite = false;
  d.trade('medical', 'buy', 1);
  assert.equal(worldTrades, 1); assert.equal(ledger.cargo.medical, 1);
  assert.equal(profile.loadLedger().cargo.medical, 1);
});
