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
    const ledger = newLedger(); ledger.cargo = { medical: 2 }; localStorage.setItem('vanguard.trade.v1', JSON.stringify(ledger));
    document.getElementById('frontier-atlas').remove();
    const { FlightScene } = await import('/src/world/scenes/FlightScene.ts');
    const scene = new FlightScene();
    for (let i = 0; i < 120; i++) scene.simStep();
    const station = scene.universe.systems.get('marches:threshold').stations[0].id;
    const docked = scene.berthAt(station);
    window.__frontierTestScene = scene;
    return { systems: scene.universe.systems.size, station, docked, finite: scene.fleet.ships.every(s => Number.isFinite(s.hull) && Number.isFinite(s.flight.position.x)) };
  });
  assert.equal(runtime.systems, 28); assert.equal(runtime.docked, true); assert.equal(runtime.finite, true);
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
  await page.reload(); await page.locator('#frontier-atlas').waitFor();
  const resumed = await page.evaluate(async () => {
    document.getElementById('frontier-atlas').remove();
    const { FlightScene } = await import('/src/world/scenes/FlightScene.ts');
    const scene = new FlightScene();
    return { dock: scene.ledger.lastDock, done: scene.ledger.contact.completed, credits: scene.ledger.credits, systems: scene.universe.systems.size };
  });
  assert.equal(resumed.dock, runtime.station); assert.deepEqual(resumed.done, ['pelagic-1']); assert.equal(resumed.credits, 3600);
  assert.deepEqual(errors, []);
  console.log('PASS: CPU-only FlightScene construction, 120 ticks, 28 systems, real dock/contact tab, unsupported issuer message, failed-save delivery rollback, successful keyboard retry, single payment and save/reload. Fixture supplies were injected; this is not a flown playthrough or renderer/performance validation.');
} finally { await browser?.close(); await server.close(); }
