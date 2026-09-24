import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { CATALOG, CATALOG_BY_ID } from '../src/game/shipyard/catalog.ts';
import { LOADOUTS, SHIP_STATS } from '../src/sim/Loadouts.ts';
import { newLedger, type TradeLedger } from '../src/game/economy.ts';
import { ITEMS, ITEM_BY_ID, MAKERS, itemId, type Item } from '../src/game/outfitting/items.ts';
import { computeFit, fits, normaliseFit, ratedPower, slotsFor, stockFit, type Fit } from '../src/game/outfitting/fit.ts';
import {
  activeShip,
  buyHull,
  buyItem,
  hullsAt,
  itemsAt,
  newHangar,
  normaliseHangar,
  sellItem,
  sellShip,
  shipValue,
  stocks,
  switchShip,
  type Hangar,
  type StationLike,
} from '../src/game/outfitting/hangar.ts';

/**
 * Shipyard & outfitting: the equipment catalogue, slots and stock fits for
 * every flyable hull, what a fit does to the numbers, the power budget, the
 * hangar save format and the shop operations; then (through Vite SSR) the
 * runtime side — applyFit on a live ship and the fitted turrets firing.
 */

const BASTION: StationLike = { id: 'meridian-bastion-2', kind: 'bastion', faction: 'concord' };
const REFINERY: StationLike = { id: 'meridian-refinery-1', kind: 'refinery', faction: 'concord' };
const FREEPORT: StationLike = { id: 'rustwake-freeport-0', kind: 'freeport', faction: 'rustwake' };
const CARRIER: StationLike = { id: 'carrier:Hesperus Dawn', kind: 'carrier', faction: 'concord' };
const rich = (credits = 2_000_000, rep: Partial<TradeLedger['rep']> = {}): TradeLedger => ({ ...newLedger(), credits, cargo: {}, rep: { concord: 80, choir: 70, rustwake: 60, ...rep } });
const FLYABLE = CATALOG.filter((e) => e.flyable);

test('equipment catalogue: unique ids, Mk I–IV of every family, makers per faction, standing climbs with Mk', () => {
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  assert.ok(ITEMS.length > 300, `${ITEMS.length} items`);
  const fam = new Map<string, Item[]>();
  for (const i of ITEMS) {
    assert.ok(i.price > 0 && i.power >= 0, i.id);
    assert.equal(ITEM_BY_ID[i.id], i);
    const k = i.id.replace(/-mk\d$/, '');
    fam.set(k, [...(fam.get(k) ?? []), i]);
  }
  for (const [k, list] of fam) {
    if (list[0].kind === 'hangar') continue;
    assert.deepEqual(list.map((i) => i.mk).sort(), [1, 2, 3, 4], k);
    const byMk = [...list].sort((a, b) => a.mk - b.mk);
    for (let n = 1; n < 4; n++) {
      assert.ok(byMk[n].price > byMk[n - 1].price, `${k} price climbs`);
      assert.ok(byMk[n].power >= byMk[n - 1].power, `${k} power climbs`);
      assert.ok((byMk[n].requires?.standing ?? -100) >= (byMk[n - 1].requires?.standing ?? -100), `${k} standing climbs`);
    }
  }
  // Every slot kind has items from all three yards (Directorate, Hegemony, Rustwake).
  for (const kind of ['gun', 'missile', 'turret', 'shield', 'armour', 'engine', 'reactor', 'bay'] as const) {
    const factions = new Set(ITEMS.filter((i) => i.kind === kind).map((i) => MAKERS[i.maker].faction));
    assert.deepEqual([...factions].sort(), ['choir', 'concord', 'rustwake'], kind);
  }
  // The new heavy guns exist in the right sizes.
  for (const [key, size] of [['g-rail', 'L'], ['g-flak', 'M'], ['t-twin', 'S'], ['t-pd', 'S'], ['t-lance', 'M'], ['m-harpoon', 'M'], ['m-torp', 'L'], ['m-micro', 'S']] as const) {
    const it = ITEM_BY_ID[itemId(key)];
    assert.ok(it && 'size' in it && it.size === size, key);
  }
});

test('every flyable hull: slots from its hardpoints, a stock fit that fills them and fits the power budget', () => {
  for (const e of FLYABLE) {
    const slots = slotsFor(e);
    const stock = stockFit(e);
    assert.equal(slots.filter((s) => s.kind === 'gun').length, e.hardpoints.guns.length, e.id);
    assert.equal(slots.filter((s) => s.kind === 'turret').length, e.hardpoints.turrets.length, e.id);
    for (const s of slots) {
      const id = stock[s.id];
      if (s.kind === 'bay') continue;
      assert.ok(id, `${e.id} ${s.id} stocked`);
      assert.ok(fits(ITEM_BY_ID[id!], s), `${e.id} ${s.id} ← ${id}`);
    }
    const r = computeFit(e, stock);
    assert.ok(r.power.draw <= r.power.output, `${e.id} stock ${r.power.draw}/${r.power.output} MW`);
    assert.equal(r.power.output, ratedPower(e));
    assert.equal(r.cargo, e.stats.cargo, `${e.id} cargo`);
    assert.deepEqual(r.flight, { speed: 1, accel: 1, turn: 1 }, e.id);
    assert.equal(r.loadout.mounts?.length ?? 0, e.hardpoints.turrets.length, `${e.id} turret mounts`);
  }
});

test('the stock Kestrel through the fit layer is the legacy Kestrel; legacy hulls keep their loadouts', () => {
  for (const id of ['vf27-kestrel', 'vf31-harrier', 'sb9-warhorse', 'rw-scrapjack']) {
    const e = CATALOG_BY_ID[id];
    const r = computeFit(e, stockFit(e));
    assert.deepEqual(r.stats, SHIP_STATS[id], id);
    assert.deepEqual(r.loadout.guns, LOADOUTS[id].guns, id);
    assert.deepEqual(r.loadout.missiles, LOADOUTS[id].missiles, id);
  }
});

test('fits change the numbers: shields, plate (and mass), drives, guns, bays, the reactor budget', () => {
  const k = CATALOG_BY_ID['vf27-kestrel'];
  const stock = stockFit(k);
  const base = computeFit(k, stock);
  const shield3 = computeFit(k, { ...stock, shield: itemId('shield-c1-aegis', 3) });
  assert.equal(shield3.stats.shield, Math.round(base.stats.shield * 1.3));
  assert.ok(shield3.stats.shieldRegen > base.stats.shieldRegen && shield3.stats.shieldDelay < base.stats.shieldDelay);
  const armour4 = computeFit(k, { ...stock, armour: itemId('armour-c1-castellan', 4) });
  assert.ok(armour4.stats.hull > base.stats.hull * 1.4);
  assert.ok(armour4.flight.accel < 1 && armour4.flight.turn < 1, 'plate is heavy');
  const eng = computeFit(k, { ...stock, engine: itemId('engine-c1-anchorage', 4) });
  assert.ok(eng.flight.speed > 1.1 && eng.flight.accel > 1.25);
  const guns = computeFit(k, { ...stock, 'gun:gun': itemId('g-twin', 4) });
  assert.deepEqual(guns.loadout.guns, ['laser', 'autocannon']);
  assert.ok(guns.loadout.gunMul!.every((m) => m === 1.4));
  assert.ok(guns.summary.gunDps > base.summary.gunDps);
  const bay = computeFit(k, { ...stock, 'bay-1': itemId('b-cargo', 2) });
  assert.ok(bay.cargo > base.cargo);
  const noShield = computeFit(k, { ...stock, shield: null });
  assert.equal(noShield.stats.shield, 0);
  assert.ok(noShield.power.draw < base.power.draw);
  // Everything Mk IV overdraws the stock reactor; a Mk IV reactor carries it.
  const all4: Fit = Object.fromEntries(Object.entries(stock).map(([s, id]) => [s, id && s !== 'reactor' ? id.replace(/-mk1$/, '-mk4') : id]));
  const hot = computeFit(k, all4);
  assert.ok(hot.power.draw > hot.power.output, `${hot.power.draw} > ${hot.power.output}`);
  const cool = computeFit(k, { ...all4, reactor: itemId('reactor-c1-castellan', 4) });
  assert.ok(cool.power.draw <= cool.power.output);
  // Bigger hulls: turrets are mounts; a gunship's mounts are assisted turrets with arcs.
  const bw = CATALOG_BY_ID['gs12-bulwark'];
  const m = computeFit(bw, stockFit(bw)).loadout.mounts!;
  assert.deepEqual(m.map((x) => x.arc).sort(), ['dorsal', 'ventral']);
  const up = computeFit(bw, { ...stockFit(bw), 'tur:turret-dorsal': itemId('t-heavy', 4) });
  assert.ok(up.summary.turretDps > computeFit(bw, stockFit(bw)).summary.turretDps);
});

test('stored fits and hangars are repaired; an old save means a stock Kestrel', () => {
  const h = normaliseHangar(undefined);
  assert.equal(activeShip(h).hull, 'vf27-kestrel');
  assert.deepEqual(activeShip(h).fit, stockFit(CATALOG_BY_ID['vf27-kestrel']));
  assert.deepEqual(normaliseHangar({ junk: 1 }), newHangar());
  const k = CATALOG_BY_ID['vf27-kestrel'];
  const bad = normaliseFit(k, { 'gun:gun': 't-rail-mk1', shield: 'nonsense', engine: null, 'bay-1': itemId('b-pd', 2) });
  assert.equal(bad['gun:gun'], stockFit(k)['gun:gun'], 'misfit → stock');
  assert.equal(bad.shield, stockFit(k).shield, 'unknown → stock');
  assert.equal(bad.engine, stockFit(k).engine, 'required slots cannot be emptied');
  assert.equal(bad['bay-1'], itemId('b-pd', 2));
  const round = normaliseHangar(JSON.parse(JSON.stringify({ v: 1, active: 's2', seq: 2, ships: [activeShip(newHangar()), { uid: 's2', hull: 'gs12-bulwark', fit: {}, condition: 0.5 }, { uid: 's3', hull: 'no-such-ship', fit: {} }] })));
  assert.equal(round.ships.length, 2);
  assert.equal(activeShip(round).hull, 'gs12-bulwark');
  assert.equal(activeShip(round).condition, 0.5);
});

test('yards: what sells where', () => {
  const bastion = hullsAt(BASTION).map((e) => e.id);
  assert.ok(bastion.includes('ffl3-valiant') && bastion.includes('cr5-resolute') && bastion.includes('vf27-kestrel'));
  assert.ok(!hullsAt(REFINERY).some((e) => e.tier >= 5), 'refineries sell small hulls');
  assert.ok(hullsAt(CARRIER).every((e) => e.tier <= 3 && e.length < 40));
  assert.ok(hullsAt(FREEPORT).some((e) => e.faction === 'rustwake') && !hullsAt(FREEPORT).some((e) => e.faction === 'concord'));
  const mk4 = ITEM_BY_ID[itemId('g-laser', 4)];
  assert.ok(stocks(BASTION, mk4) && !stocks(REFINERY, mk4), 'Mk IV at bastions only');
  assert.ok(!stocks(CARRIER, ITEM_BY_ID[itemId('shield-c1-aegis', 1)]), 'carriers: weapons only');
  assert.ok(stocks(FREEPORT, ITEM_BY_ID[itemId('g-scatter', 3)]) && !stocks(BASTION, ITEM_BY_ID[itemId('g-scatter', 1)]));
  const slot = slotsFor(CATALOG_BY_ID['vf27-kestrel']).find((s) => s.id === 'gun:gun')!;
  const offers = itemsAt(BASTION, slot, newLedger());
  assert.ok(offers.length >= 8);
  assert.ok(offers.some((o) => o.item.mk >= 3 && o.lock), 'Mk III+ locked for a fresh pilot');
});

test('shop: buy & fit (old item sells back), power and standing gates, strip, buy hulls with trade-in, board, sell', () => {
  let h: Hangar = newHangar();
  let l = rich(20_000, { concord: 25 });
  const uid = h.active;
  // Mk III twin mount: allowed at concord +25 (needs +20).
  let r = buyItem(h, l, uid, 'gun:gun', itemId('g-twin', 3), BASTION);
  assert.ok(!r.error, r.error);
  const price = ITEM_BY_ID[itemId('g-twin', 3)].price;
  assert.ok(r.ledger.credits < l.credits && r.ledger.credits > l.credits - price, 'old item refunded');
  ({ hangar: h, ledger: l } = r);
  assert.equal(activeShip(h).fit['gun:gun'], itemId('g-twin', 3));
  // Mk IV needs +50.
  assert.match(buyItem(h, l, uid, 'gun:gun', itemId('g-twin', 4), BASTION).error ?? '', /STANDING/);
  // Not stocked at a refinery.
  assert.match(buyItem(h, l, uid, 'shield', itemId('shield-c1-aegis', 3), REFINERY).error ?? '', /NOT STOCKED/);
  // Power: pile on until the budget breaks.
  l = rich(1_000_000);
  let err = '';
  for (const [slot, id] of [['shield', 'shield-c1-aegis'], ['engine', 'engine-c1-anchorage'], ['msl:rail', 'm-railpair'], ['gun:gun', 'g-twin'], ['bay-1', 'b-pd']] as const) {
    const res = buyItem(h, l, uid, slot, itemId(id, 4), BASTION);
    if (res.error) err = res.error;
    else ({ hangar: h, ledger: l } = res);
  }
  assert.match(err, /POWER BUDGET/);
  // Strip a slot; drives can't be stripped.
  r = sellItem(h, l, uid, 'shield');
  assert.ok(!r.error && r.ledger.credits > l.credits);
  assert.match(sellItem(h, l, uid, 'engine').error ?? '', /SWAPPED/);
  // Buy a Bulwark trading the Kestrel in; then a Resolute keeping the Bulwark; board back.
  h = newHangar();
  l = rich(400_000);
  const kv = shipValue(activeShip(h));
  r = buyHull(h, l, 'gs12-bulwark', BASTION, { tradeIn: true });
  assert.ok(!r.error, r.error);
  assert.equal(r.ledger.credits, 400_000 - 125_000 + kv);
  assert.equal(r.hangar.ships.length, 1);
  assert.equal(activeShip(r.hangar).hull, 'gs12-bulwark');
  assert.equal(r.ledger.capacity, CATALOG_BY_ID['gs12-bulwark'].stats.cargo, 'hold follows the ship');
  ({ hangar: h, ledger: l } = r);
  r = buyHull(h, l, 'cr5-resolute', BASTION, { tradeIn: false });
  assert.ok(!r.error, r.error);
  assert.equal(r.hangar.ships.length, 2);
  ({ hangar: h, ledger: l } = r);
  const bul = h.ships.find((s) => s.hull === 'gs12-bulwark')!;
  r = switchShip(h, l, bul.uid, 0.7);
  assert.ok(!r.error);
  assert.equal(activeShip(r.hangar).uid, bul.uid);
  assert.equal(r.hangar.ships.find((s) => s.hull === 'cr5-resolute')!.condition, 0.7, 'the old hull keeps its damage');
  ({ hangar: h, ledger: l } = r);
  assert.match(sellShip(h, l, bul.uid).error ?? '', /ABOARD/);
  const res = h.ships.find((s) => s.hull === 'cr5-resolute')!;
  r = sellShip(h, l, res.uid);
  assert.ok(!r.error && r.hangar.ships.length === 1 && r.ledger.credits > l.credits);
  // Standing gates on hulls; cargo gates on smaller holds.
  assert.match(buyHull(newHangar(), rich(1e6, { concord: 10 }), 'ffl3-valiant', BASTION, { tradeIn: true }).error ?? '', /STANDING/);
  const full = { ...rich(1e6), cargo: { rations: 100 }, capacity: 120 };
  assert.match(buyHull({ ...h }, full, 'vf27-kestrel', BASTION, { tradeIn: true }).error ?? '', /SELL CARGO/);
  assert.match(buyHull(newHangar(), rich(1000), 'cr5-resolute', BASTION, { tradeIn: true }).error ?? '', /INSUFFICIENT/);
});

// ── runtime (Vite SSR: three, the sim, the builder) ──────────────────

let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

async function ssr(): Promise<ViteDevServer> {
  if (!server) {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'error',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null },
    });
  }
  return server;
}

test('applyFit on a live ship: stats, pools, flight, loadout; fitted turrets fire at a target in arc', async () => {
  const vite = await ssr();
  const { Group, Vector3 } = await vite.ssrLoadModule('three');
  const { Fleet } = await vite.ssrLoadModule('/src/sim/Fleet.ts');
  const { Weapons } = await vite.ssrLoadModule('/src/sim/Weapons.ts');
  const { Capitals } = await vite.ssrLoadModule('/src/sim/Capitals.ts');
  const { applyFit } = await vite.ssrLoadModule('/src/game/outfitting/apply.ts');
  const { ShipTurrets } = await vite.ssrLoadModule('/src/game/outfitting/turrets.ts');
  const fleet = new Fleet(new Group());
  const weapons = new Weapons(fleet);
  const capitals = new Capitals(fleet, weapons);
  const turrets = new ShipTurrets(fleet, weapons, capitals);

  // The Kestrel: stock fit changes nothing.
  const k = fleet.spawn('vf27-kestrel', 'concord', new Vector3(), new Vector3(0, 0, 1), { isPlayer: true });
  const spec0 = { ...k.flight.spec };
  const kc = CATALOG_BY_ID['vf27-kestrel'];
  applyFit(k, kc, stockFit(kc));
  assert.equal(k.hullMax, 110);
  assert.deepEqual({ ...k.flight.spec }, spec0);
  // Mk IV drive + plate: faster top speed, heavier.
  applyFit(k, kc, { ...stockFit(kc), engine: itemId('engine-c1-anchorage', 4), armour: itemId('armour-c1-castellan', 4) });
  assert.ok(k.flight.spec.maxSpeed > spec0.maxSpeed && k.hullMax > 150);

  // A Bulwark with turrets vs a Cantor sitting in its dorsal arc.
  const bw = CATALOG_BY_ID['gs12-bulwark'];
  const g = fleet.spawn('gs12-bulwark', 'concord', new Vector3(), new Vector3(0, 0, 1), { isPlayer: true });
  applyFit(g, bw, stockFit(bw));
  assert.equal(g.hullMax, 600);
  assert.equal(g.combat.loadout.mounts.length, 2);
  const c = fleet.spawn('choir-cantor', 'choir', new Vector3(60, 250, 500), new Vector3(0, 0, 1));
  c.flight.velocity.set(0, 0, 0);
  let fired = 0;
  // Ten seconds: scattered flak at a small target lands ~0.4 rounds/s, so a
  // shorter window only passes on a lucky dice stream (the world seed's).
  for (let i = 0; i < 600; i++) {
    c.flight.velocity.set(0, 0, 0);
    g.flight.velocity.set(0, 0, 0);
    k.alive = false;
    turrets.step(1 / 60, c);
    fleet.step(1 / 60);
    weapons.step(1 / 60);
    for (const ev of weapons.events) if (ev.kind === 'fire' || ((ev.kind === 'hit' || ev.kind === 'shield') && ev.shooter === g)) fired++;
  }
  assert.ok(c.shield < c.shieldMax || c.hull < c.hullMax, 'turret rounds landed on the Cantor');
  assert.equal(turrets.status(g).mounts, 2);
  turrets.mode = 'hold';
  weapons.life.fill(0); // rounds already in the air aren't the turrets' HOLD to recall
  const before = c.shield + c.hull;
  c.shield = c.shieldMax;
  for (let i = 0; i < 120; i++) {
    turrets.step(1 / 60, c);
    fleet.step(1 / 60);
    weapons.step(1 / 60);
  }
  assert.ok(c.shield + c.hull >= Math.min(before, c.shieldMax + c.hull) - 1e-6, 'HOLD: turrets silent');
  void fired;
});
