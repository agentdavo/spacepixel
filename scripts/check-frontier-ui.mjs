/** DOM-only checks; disables GPU and refuses any WebGPU adapter request. */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const server = await createServer({ cacheDir: 'node_modules/.vite-frontier-ui', logLevel: 'error', server: { port: 0, host: '127.0.0.1', strictPort: true, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chromium', args: ['--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await context.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await context.addInitScript(() => {
    if (navigator.gpu) navigator.gpu.requestAdapter = async () => { throw new Error('Atlas requested a GPU adapter'); };
  });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?atlas=1`);
  await page.locator('#frontier-atlas h1').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.frontier-regions button').count(), 8);
  assert.equal(await page.locator('.frontier-hulls article').count(), 8);
  assert.equal(await page.locator('.frontier-hulls article a').first().getAttribute('href'), '/?scene=hangar&ship=pa-skimmer');
  assert.match(await page.locator('.frontier-grid').innerText(), /192 mapped systems/);
  await page.getByRole('button', { name: 'Pelagic Expanse · 26', exact: true }).click();
  assert.equal(await page.locator('.frontier-systems button').count(), 26);
  await page.getByRole('button', { name: '◆ First Basin', exact: true }).click();
  assert.match(await page.locator('.frontier-grid').innerText(), /Pelagic Assemblies/);
  await page.getByLabel('Interface language', { exact: true }).selectOption('ja-JP');
  assert.match(await page.locator('h1').innerText(), /フロンティア/);
  assert.match(await page.locator('.frontier-phrases').innerText(), /Approach the port/); // subtitle locale independent
  await page.locator('.frontier-settings select').nth(1).selectOption('ja-JP');
  assert.match(await page.locator('.frontier-phrases').innerText(), /港に接近/);
  await page.reload(); await page.locator('#frontier-atlas').waitFor();
  assert.equal(await page.locator('.frontier-settings select').first().inputValue(), 'ja-JP');
  assert.equal(await page.locator('.frontier-systems button[aria-pressed=true]').innerText(), '◆ First Basin');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('.frontier-settings select').first().selectOption('qps-ploc');
    const layout = await page.locator('#frontier-atlas').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `Horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: atlas navigation, 192 systems, eight hull cards, EN/JA independence, persistence, 1280/390 expanded-text layouts; no renderer requested and no page/console errors.');
  // Instantiate the real flight scene without Engine/createRenderer: exercise game wiring on CPU.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/?atlas=1&expansion=pilot&voice=off`);
  await page.locator('#frontier-atlas').waitFor();
  const runtime = await page.evaluate(async () => {
    localStorage.removeItem('vanguard.expansion.v1');
    const { newLedger } = await import('/src/game/economy.ts');
    const { generateUniverse } = await import('/src/universe/generate.ts');
    const ledger = newLedger(); ledger.cargo = { medical: 2 };
    ledger.lastDock = generateUniverse(1994).systems.get('rustwake').stations[0].id;
    localStorage.setItem('vanguard.trade.v1', JSON.stringify(ledger));
    document.getElementById('frontier-atlas').remove();
    const { FlightScene } = await import('/src/world/scenes/FlightScene.ts');
    const scene = new FlightScene();
    for (let i = 0; i < 120; i++) scene.simStep();
    const entry = { system: scene.currentSystemId(), phase: scene.docking.phase, open: scene.dockScreen.isOpen };
    const station = scene.universe.systems.get('marches:threshold').stations[0].id;
    const docked = scene.berthAt(station);
    window.__frontierTestScene = scene;
    return { entry, systems: scene.universe.systems.size, station, docked, finite: scene.fleet.ships.every(s => Number.isFinite(s.hull) && Number.isFinite(s.flight.position.x)) };
  });
  assert.equal(runtime.systems, 28); assert.equal(runtime.docked, true); assert.equal(runtime.finite, true);
  assert.deepEqual(runtime.entry, { system: 'marches:threshold', phase: 'free', open: false });
  await page.getByRole('button', { name: /CONTRACTS$/ }).click();
  assert.match(await page.locator('.ct').innerText(), /No local contract issuers.*FIRST CONTACT/);
  assert.doesNotMatch(await page.locator('.ct').innerText(), /Halloran|REPOST IN/);
  assert.equal(await page.locator('.ct-list .ct-row').count(), 0);
  await page.getByRole('button', { name: /FIRST CONTACT/ }).click();
  const deliver = page.getByRole('button', { name: 'Deliver supplies', exact: true }).first();
  const beforeFailure = await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'vanguard.trade.v1') throw new DOMException('Test storage quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    return JSON.stringify(window.__frontierTestScene.ledger);
  });
  await deliver.click();
  assert.equal(await page.getByText('Delivery not saved. Cargo and reward are unchanged. Free storage and try again.', { exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__frontierTestScene.ledger)), beforeFailure);
  const failedSave = await page.evaluate(() => {
    window.__restoreStorage();
    return JSON.parse(localStorage.getItem('vanguard.trade.v1'));
  });
  assert.equal(failedSave.cargo.medical, 2); assert.equal(failedSave.credits, 2500);
  assert.equal(failedSave.contact, undefined);
  await deliver.focus(); await page.keyboard.press('Enter');
  const settled = await page.evaluate(() => JSON.parse(localStorage.getItem('vanguard.trade.v1')));
  assert.deepEqual(settled.contact.completed, ['pelagic-1']); assert.equal(settled.cargo.medical ?? 0, 0);
  assert.equal(settled.credits, 3600); assert.equal(settled.rep.pelagic, 5);
  assert.equal(await page.locator('.dock-panel').isVisible(), true); // Enter did not launch.
  const reloadFlight = async (url = `${base}/?atlas=1&expansion=pilot&voice=off`) => {
    await page.goto(url); await page.locator('#frontier-atlas').waitFor();
    return page.evaluate(async () => {
      document.getElementById('frontier-atlas').remove();
      const { FlightScene } = await import('/src/world/scenes/FlightScene.ts');
      const scene = new FlightScene();
      window.__frontierTestScene = scene;
      return { dock: scene.ledger.lastDock, frontierDock: scene.ledger.frontierDock, done: scene.ledger.contact.completed, credits: scene.ledger.credits, systems: scene.universe.systems.size,
        system: scene.currentSystemId(), phase: scene.docking.phase, target: scene.docking.target?.id, open: scene.dockScreen.isOpen };
    });
  };
  const assertBerth = async (state, system, station) => {
    assert.equal(state.system, system); assert.equal(state.phase, 'docked'); assert.equal(state.target, station);
    assert.equal(state.open, true); assert.equal(state.frontierDock, station);
    assert.equal(await page.locator('.dock-screen').isVisible(), true);
    assert.equal(await page.locator('.dock-body').isVisible(), true);
  };
  const resumed = await reloadFlight();
  assert.equal(resumed.dock, runtime.station); assert.deepEqual(resumed.done, ['pelagic-1']); assert.equal(resumed.credits, 3600);
  await assertBerth(resumed, 'marches:threshold', runtime.station);
  let reachBerth;
  for (const system of ['marches:stillwater', 'rustwake']) {
    const station = await page.evaluate(system => {
      const scene = window.__frontierTestScene;
      const station = scene.universe.systems.get(system).stations[0].id;
      if (!scene.berthAt(station)) throw new Error(`Could not berth at ${station}`);
      return station;
    }, system);
    await assertBerth(await reloadFlight(), system, station);
    if (system.startsWith('marches:')) {
      // Migrate an earlier prototype save which only had the shared Marches lastDock.
      await page.evaluate(() => { delete window.__frontierTestScene.ledger.frontierDock; });
      await assertBerth(await reloadFlight(), system, station);
    } else reachBerth = station;
  }
  // A normal campaign visit changes shared lastDock, but cannot move the prototype berth.
  await reloadFlight(`${base}/?atlas=1&voice=off`);
  await page.evaluate(() => {
    const scene = window.__frontierTestScene;
    if (!scene.berthAt(scene.universe.systems.get('meridian').stations[0].id)) throw new Error('Normal Reach berth failed');
  });
  await assertBerth(await reloadFlight(), 'rustwake', reachBerth);
  const futureContact = { version: 2, completed: ['pelagic-1', 'pelagic-4'], receipts: { 'pelagic-4': { reward: 3300, revision: 2 } } };
  await page.evaluate(async contact => {
    const scene = window.__frontierTestScene;
    const { normaliseLedger } = await import('/src/game/economy.ts');
    scene.ledger = normaliseLedger({ ...scene.ledger, contact });
    scene.berthAt(scene.universe.systems.get('marches:threshold').stations[0].id);
    scene.dockScreen.showTab('contact');
  }, futureContact);
  assert.equal(await page.locator('.dock-panel').getByRole('status').isVisible(), true);
  assert.match(await page.locator('.dock-panel').innerText(), /unsupported version.*saved records are preserved/);
  assert.equal(await page.getByRole('button', { name: 'Deliver supplies', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('vanguard.trade.v1')).contact), futureContact);
  await page.evaluate(() => { window.__frontierTestScene.ledger.frontierDock = 'missing-station'; });
  const invalidResume = await reloadFlight();
  assert.equal(invalidResume.system, 'marches:threshold'); assert.equal(invalidResume.phase, 'free'); assert.equal(invalidResume.open, false);
  assert.equal(invalidResume.credits, 3600);
  assert.deepEqual(errors, []);
  console.log('PASS: CPU-only FlightScene, 120 ticks, 28 systems, issuer guard, failed-save delivery rollback/retry, future contact protection, actual Threshold/Stillwater/Rustwake berth restore, legacy Marches migration, campaign/prototype location independence and invalid-berth fallback. Fixture supplies and forced berths were used; this is not a flown playthrough or renderer/performance validation.');
} finally { await browser?.close(); await server.close(); }
