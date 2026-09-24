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

test('bridge camera looks over the bow: the forward battery sits in the bottom sixth', { timeout: 240_000 }, async () => {
  server ??= await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const THREE = await server.ssrLoadModule('three');
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { bridgeFraming, hasBowBattery } = await server.ssrLoadModule('/src/game/shipyard/flight.ts');
  for (const e of CATALOG.filter((x) => x.camera === 'bridge')) {
    const model = buildShip(BLUEPRINTS[e.blueprint]);
    model.root.updateMatrixWorld(true);
    const s = model.sockets.get('bridge');
    const f = bridgeFraming([s.position.x, s.position.y, s.position.z], model.length, hasBowBattery(e));
    // The flight camera at rest: 58° vertical FOV, 16:9, aimed down the bow.
    const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 1e6);
    cam.position.set(...f.offset);
    cam.lookAt(0, 0, f.lookAhead);
    cam.updateMatrixWorld(true);
    const bow = new Set(e.hardpoints.turrets.filter((t) => t.arc === 'bow').map((t) => t.socket));
    let turretTop = Infinity;
    let hullTop = Infinity;
    model.root.traverse((o: { isMesh?: boolean; name: string }) => {
      if (!o.isMesh) return;
      const part = o.name.split(':').pop() ?? '';
      const b = new THREE.Box3().setFromObject(o);
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(cam);
            if (p.z >= 1) continue;
            const py = (-p.y * 0.5 + 0.5) * 720;
            if (bow.has(part)) turretTop = Math.min(turretTop, py);
            else if (part === 'hull') hullTop = Math.min(hullTop, py);
          }
    });
    if (bow.size) assert.ok(Number.isFinite(turretTop), `${e.id}: bow turrets in view`);
    if (bow.size) assert.ok(turretTop > 720 * (5 / 6), `${e.id}: bow turrets reach up to y=${turretTop.toFixed(0)} of 720 (want the bottom sixth)`);
    assert.ok(hullTop < 720 * 0.75, `${e.id}: the hull reads below the horizon (top at y=${hullTop.toFixed(0)})`);
  }
});

test('bow camera clears the bow battery: every mount, at any bearing, sits behind the eye', { timeout: 240_000 }, async () => {
  server ??= await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const THREE = await server.ssrLoadModule('three');
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { framingFor, hasBowBattery } = await server.ssrLoadModule('/src/game/shipyard/flight.ts');
  const hulls = CATALOG.filter((x) => x.camera === 'bridge' && hasBowBattery(x));
  assert.ok(hulls.length > 0, 'a bridge hull with a bow battery to test');
  for (const e of hulls) {
    const model = buildShip(BLUEPRINTS[e.blueprint]);
    const f = framingFor(model, e, 'bow');
    const eye = new THREE.Vector3(...f.offset);
    const cam = new THREE.PerspectiveCamera(58, 16 / 9, f.near, 1e6);
    cam.position.copy(eye);
    cam.lookAt(0, 0, f.lookAhead);
    cam.updateMatrixWorld(true);

    // Forward of the bridge, on the deck: a ray up from the eye leaves the hull, one down lands close by.
    assert.ok(eye.z > model.sockets.get('bridge').position.z, `${e.id}: bow eye forward of the bridge`);
    const probe = new THREE.Mesh(model.hull.geometry);
    const ray = new THREE.Raycaster();
    ray.set(eye, new THREE.Vector3(0, 1, 0));
    assert.equal(ray.intersectObject(probe).length, 0, `${e.id}: bow eye is outside the hull`);
    ray.set(eye, new THREE.Vector3(0, -1, 0));
    const deck = ray.intersectObject(probe)[0];
    assert.ok(deck && deck.distance < model.length * 0.05, `${e.id}: bow eye sits on the deck (${deck?.distance.toFixed(1)} m up)`);

    // Train every bow mount right round: no vertex may come in front of the near plane.
    const bow = e.hardpoints.turrets.filter((t) => t.arc === 'bow').flatMap((t) => (t.mirror ? [t.socket, `${t.socket}.L`] : [t.socket]));
    const v = new THREE.Vector3();
    for (let deg = 0; deg < 360; deg += 15) {
      for (const id of bow) model.setArticulation(id, (deg * Math.PI) / 180);
      model.root.updateMatrixWorld(true);
      for (const id of bow) {
        const mesh = model.articulations.get(id)?.mesh;
        assert.ok(mesh, `${e.id}: bow mount ${id} has a turret mesh`);
        const pos = mesh.geometry.getAttribute('position');
        let nearest = -Infinity;
        for (let i = 0; i < pos.count; i++) nearest = Math.max(nearest, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse).z);
        assert.ok(nearest > -f.near, `${e.id}: ${id} trained ${deg}° reaches ${(-nearest).toFixed(1)} m in front of the bow eye`);
      }
    }
  }
});

test('framingFor keeps every hull on the camera it rode before; the bow view is for bridge hulls only', { timeout: 240_000 }, async () => {
  server ??= await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { framingFor, viewFor, bridgeFraming, chaseFraming, hasBowBattery } = await server.ssrLoadModule('/src/game/shipyard/flight.ts');
  for (const e of CATALOG) {
    const model = buildShip(BLUEPRINTS[e.blueprint]);
    const sock = model.sockets.get('bridge');
    const bridge = e.camera === 'bridge' && !!sock;
    const view = viewFor(model, e);
    assert.equal(view, bridge ? 'bridge' : 'chase', `${e.id}: default view`);
    const was = bridge ? bridgeFraming([sock.position.x, sock.position.y, sock.position.z], model.length, hasBowBattery(e)) : model.length > 20 ? chaseFraming(model.length) : null;
    assert.deepEqual(framingFor(model, e, view), was, `${e.id}: framing unchanged`);
    assert.equal(viewFor(model, e, true), bridge ? 'bow' : 'chase', `${e.id}: bow view only on bridge hulls`);
    assert.equal(viewFor(model, e, true, '0'), 'chase', `${e.id}: ?bridge=0 forces the chase cam`);
  }
});
