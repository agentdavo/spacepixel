import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { CATALOG, CATALOG_BY_ID, PROGRESSION, TRAFFIC, canBuy, forSale, tradeIn, type CatalogEntry } from '../src/game/shipyard/catalog.ts';

/**
 * Ship catalogue: data sanity, the progression ladder, and — through Vite's
 * SSR loader, so the `@/` alias and extensionless imports resolve — that
 * every catalogued blueprint builds, carries the sockets the catalogue
 * names and is as long as the catalogue says.
 */

test('catalogue ids are unique and self-consistent', () => {
  const ids = new Set<string>();
  for (const e of CATALOG) {
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.equal(CATALOG_BY_ID[e.id], e);
    assert.ok(e.tier >= 1 && e.tier <= 6, `${e.id} tier`);
    assert.ok(e.length > 0 && e.crew > 0, `${e.id} length/crew`);
    if (e.purchasable) assert.ok(e.price > 0, `${e.id} purchasable but free`);
    else assert.equal(e.price, 0, `${e.id} not for sale but priced`);
    const s = e.stats;
    assert.ok(s.boost >= s.speed, `${e.id} boost < speed`);
    assert.ok(s.hull > 0 && s.shield >= 0 && s.cargo >= 0, `${e.id} stats`);
    assert.ok(s.agility > 0 && s.agility <= 1, `${e.id} agility`);
  }
});

test('the progression line gets bigger, pricier and slower to turn every tier', () => {
  const line = PROGRESSION.map((id) => CATALOG_BY_ID[id]);
  line.forEach((e, i) => assert.equal(e.tier, i + 1, `${e.id} tier`));
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    assert.ok(b.price > a.price, `${b.id} price`);
    assert.ok(b.length >= a.length, `${b.id} length`);
    assert.ok(b.stats.turn < a.stats.turn, `${b.id} turn`);
    assert.ok(b.stats.hull > a.stats.hull, `${b.id} hull`);
  }
  assert.ok(line[1].price >= 15_000 && line[1].price <= 30_000, 'T2 ≈ 20k');
  assert.ok(line[5].price >= 350_000 && line[5].price <= 500_000, 'T6 ≈ 400k');
  assert.equal(line[5].camera, 'bridge');
});

test('shop helpers: standing gates, trade-in, traffic list', () => {
  const seraph = CATALOG_BY_ID['choir-seraph'];
  assert.equal(canBuy(seraph, { choir: 0 }, 1e6), false);
  assert.equal(canBuy(seraph, { choir: 60 }, 1e6), true);
  assert.equal(canBuy(seraph, { choir: 60 }, 10), false);
  assert.equal(tradeIn(CATALOG_BY_ID['vf27s-super-kestrel']), Math.round(22_000 * 0.6));
  const sale = forSale('concord');
  assert.ok(sale.length >= 6 && sale.every((e, i) => i === 0 || e.price >= sale[i - 1].price));
  for (const id of TRAFFIC) assert.equal(CATALOG_BY_ID[id].faction, 'civil');
});

let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

/** Socket ids a catalogue entry expects on the built ship. */
function expectedSockets(e: CatalogEntry): string[] {
  const out: string[] = [];
  const add = (base: string, mirror?: boolean) => {
    out.push(base);
    if (mirror) out.push(`${base}.L`);
  };
  for (const g of e.hardpoints.guns) {
    if (g.count) for (let i = 0; i < g.count; i++) add(`${g.socket}-${i}`, g.mirror);
    else add(g.socket, g.mirror);
  }
  for (const m of e.hardpoints.missiles) add(m.socket, m.mirror);
  for (const t of e.hardpoints.turrets) add(t.socket, t.mirror);
  if (e.camera === 'bridge') out.push('bridge');
  return out;
}

test('every catalogued blueprint builds with its sockets and length', { timeout: 240_000 }, async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  for (const e of CATALOG) {
    const bp = BLUEPRINTS[e.blueprint];
    assert.ok(bp, `blueprint ${e.blueprint} registered`);
    const model = buildShip(bp);
    for (const s of expectedSockets(e)) assert.ok(model.sockets.has(s), `${e.id}: socket "${s}" (has ${[...model.sockets.keys()].join(', ')})`);
    const err = Math.abs(model.length - e.length) / e.length;
    assert.ok(err < 0.06, `${e.id}: catalogue length ${e.length} m vs built ${model.length.toFixed(1)} m`);
    // Turret joints (channel 'turret') are named after their socket.
    for (const [id, a] of model.articulations) if (a.channel === 'turret' && !id.endsWith('.L')) assert.ok(model.sockets.has(id), `${e.id}: turret joint ${id} has a socket`);
  }
});
