#!/usr/bin/env node
/**
 * Career loop smoke test (headless, `npm run career-check`): one fresh
 * profile through the free-roam career —
 *
 *   new profile → free flight (berthed at home) → hire Magpie and Brennick
 *   (the dialog's recruit hook) → accept a contract → launch → Magpie flies
 *   in formation and fights → dock (auto-guidance) → repair at Brennick's
 *   discount → buy a ship and fit a gun → reload the page: everything kept.
 *
 *   node scripts/career-check.mjs [--port 5260] [--size 1280x720]
 *
 * The sim is stepped in-page (FlightScene.update at a fixed 1/30 s, no
 * rendering: `?record=30` stops the rAF loop), so flight seconds are cheap
 * even on a software adapter. Prints PASS/FAIL per step; exits non-zero on
 * any failure.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 5260));
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const T = 600_000;

const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
const check = (name, ok, extra = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const URL_ = `http://127.0.0.1:${port}/?scene=flight&record=30&planes=0`;

/** In-page helpers (installed once per load). */
function install() {
  const S = window.__VANGUARD__.hooks.scene;
  let t = 1000;
  let frame = 0;
  window.__cc = {
    S,
    /** Step the flight sim `sec` seconds at 1/30 s; `each` sees every frame. */
    sim(sec, each) {
      const n = Math.round(sec * 30);
      for (let i = 0; i < n; i++) {
        t += 1 / 30;
        S.update({ dt: 1 / 30, time: t, frame: ++frame });
        if (each && each() === true) return (i + 1) / 30;
      }
      return sec;
    },
    magpie() {
      return S.wingmen.map((w) => w.ship).find((s) => s.name === 'Magpie’s Due') ?? null;
    },
  };
}

async function boot(page) {
  await page.goto(URL_, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || (window.__VANGUARD__?.ready && window.__VANGUARD__?.hooks?.scene), null, { timeout: T, polling: 250 });
  const err = await page.evaluate(() => window.__VANGUARD__?.error ?? null);
  if (err) throw new Error(err);
  await page.evaluate(install);
}

try {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);

  // 1. New profile.
  const fresh = await page.evaluate(() => {
    const { S } = window.__cc;
    return { hull: S.player.model.blueprint.id, credits: S.ledger.credits, crew: localStorage.getItem('vanguard.crew.v1') };
  });
  check('new profile: stock Kestrel, no crew', fresh.hull === 'vf27-kestrel' && !fresh.crew, `(${fresh.hull}, ${fresh.credits} sh)`);

  // 2. Free flight: the career starts berthed at the home station.
  const home = await page.evaluate(() => {
    const { S } = window.__cc;
    const home = S.contracts.homeStation();
    void S.startFreeRoam(home, null);
    return { home, phase: S.docking.phase, open: S.dockScreen.isOpen };
  });
  check('free flight: berthed at home, dock screen open', home.phase === 'docked' && home.open, `(${home.home}, ${home.phase})`);

  // 3. Hires, through the dialog's recruit hook (what a conversation's `{ recruit }` effect calls).
  const hires = await page.evaluate(async (st) => {
    const { dialogHooks } = await import('/src/dialog/state.ts');
    const a = dialogHooks.onRecruit?.('magpie-due', st);
    const b = dialogHooks.onRecruit?.('brennick-mechanic', st);
    const m = window.__cc.magpie();
    return { a, b, magpie: !!m, alive: m?.alive ?? false, blueprint: m?.model.blueprint.id ?? '', crew: JSON.parse(localStorage.getItem('vanguard.crew.v1') ?? '{}') };
  }, home.home);
  check('hire Magpie via dialog → she joins the wing (Gaff)', hires.a?.ok && hires.magpie && hires.alive && hires.blueprint === 'rw-gaff', JSON.stringify(hires.a));
  check('hire Brennick via dialog → saved to the crew', hires.b?.ok && hires.crew.hired?.includes('brennick-mechanic'), JSON.stringify(hires.b));

  // 4. Accept a contract from the board.
  const k = await page.evaluate((st) => {
    const { S } = window.__cc;
    const offers = S.contracts.offers(st);
    const pick = offers.find((o) => o.kind === 'courier' || o.kind === 'haul' || o.kind === 'patrol') ?? offers[0];
    if (!pick) return { err: 'NO OFFERS', n: 0 };
    const err = S.contracts.acceptById(st, pick.id);
    return { err, id: pick.id, kind: pick.kind, n: S.contracts.book.active.length };
  }, home.home);
  check('accept a contract from the board', !k.err && k.n >= 1, `(${k.kind ?? ''} ${k.err ?? ''})`);

  // 5. Launch.
  const launched = await page.evaluate(() => {
    const { S, sim } = window.__cc;
    document.querySelector('.dock-launch')?.click(); // the dock screen's LAUNCH button
    const t = sim(12, () => S.docking.phase === 'free');
    return { phase: S.docking.phase, t, alive: S.player.alive };
  });
  check('launch: back in free flight', launched.phase === 'free' && launched.alive, `(${launched.t.toFixed(1)} s)`);

  // 6. Magpie flies in formation.
  const form = await page.evaluate(() => {
    const { S, sim, magpie } = window.__cc;
    const m = magpie();
    let worst = 0;
    let sum = 0;
    let n = 0;
    sim(25, () => {
      const d = m.flight.position.distanceTo(S.player.flight.position);
      n++;
      sum += d;
      if (n > 30 * 10) worst = Math.max(worst, d); // after 10 s to settle in
    });
    return { alive: m.alive, mean: sum / n, worst };
  });
  check('Magpie flies in formation (worst gap after 10 s < 600 m)', form.alive && form.worst < 600, `(mean ${form.mean.toFixed(0)} m, worst ${form.worst.toFixed(0)} m)`);

  // 7. …and fights: a hostile Cantor 1.6 km ahead, wing order ENGAGE AT WILL (key 3).
  const fight = await page.evaluate(() => {
    const { S, sim, magpie } = window.__cc;
    const m = magpie();
    const pf = S.player.flight;
    const fwd = pf.forward(pf.position.clone().set(0, 0, 0));
    const pos = pf.position.clone().addScaledVector(fwd, 1600);
    const bandit = S.fleet.spawn('choir-cantor', 'choir', pos, fwd.clone().negate(), { name: 'Check Cantor' });
    S.onKey('Digit3');
    let shots = 0;
    let hits = 0;
    sim(40, () => {
      for (const e of S.weapons.events) {
        if (e.shooter !== m) continue;
        if (e.kind === 'fire') shots++;
        if (e.kind === 'hit' || e.kind === 'shield' || e.kind === 'beam-hit') hits++;
      }
      for (const e of S.missiles.events) if (e.shooter === m && e.kind === 'launch') shots++;
      return !bandit.alive && shots > 0;
    });
    S.onKey('Digit1');
    return { shots, hits, banditAlive: bandit.alive, alive: m.alive };
  });
  check('Magpie engages: fires on a hostile and lands hits', fight.shots > 0 && fight.hits > 0, `(${fight.shots} shots, ${fight.hits} hits, bandit ${fight.banditAlive ? 'alive' : 'down'}, Magpie ${fight.alive ? 'alive' : 'lost'})`);

  // 8. Dock (auto-guidance) with a damaged hull.
  const docked = await page.evaluate((st) => {
    const { S, sim } = window.__cc;
    S.player.hull = S.player.hullMax * 0.5;
    S.dockFlag('auto', st, false);
    const t = sim(20, () => S.docking.phase === 'docked');
    return { phase: S.docking.phase, t, open: S.dockScreen.isOpen };
  }, home.home);
  check('dock: auto-guidance berths, dock screen opens', docked.phase === 'docked' && docked.open, `(${docked.t.toFixed(1)} s)`);

  // 9. Repair at Brennick's discount.
  const rep = await page.evaluate(async () => {
    const { S } = window.__cc;
    const econ = await import('/src/game/economy.ts');
    const d = S.docking.target;
    const size = Math.sqrt(Math.max(1, S.player.hullMax / 110));
    const full = econ.repairCost(d, S.ledger, 0.5, size, 1);
    const disc = econ.repairCost(d, S.ledger, 0.5, size, 0.7);
    S.ledger = { ...S.ledger, credits: Math.max(S.ledger.credits, full * 2) };
    S.dockScreen.render();
    const btn = document.querySelector('[data-act="repair"]');
    const label = btn?.textContent ?? '';
    const before = S.ledger.credits;
    btn?.click();
    return { full, disc, label, paid: before - S.ledger.credits, hull: S.player.hull / S.player.hullMax };
  });
  check('Brennick: repair costs 30% less', rep.disc < rep.full && rep.paid === rep.disc && rep.hull > 0.99, `(full ${rep.full} sh, paid ${rep.paid} sh · "${rep.label.trim()}")`);

  // 10. Buy a ship and fit a gun.
  const yard = await page.evaluate(async () => {
    const { S } = window.__cc;
    const H = await import('/src/game/outfitting/hangar.ts');
    const o = S.outfit;
    const st = S.docking.target;
    S.ledger = { ...S.ledger, credits: 2_000_000, rep: { ...S.ledger.rep, concord: 80, choir: 80, rustwake: 80 } };
    const cur = S.player.model.blueprint.id;
    const hulls = H.hullsAt(st).filter((e) => e.id !== cur && e.purchasable && !H.hullLock(e, st, S.ledger));
    if (!hulls.length) return { err: `no hull for sale at ${st.id}` };
    // The next step up the fighter line if this yard sells it, else the cheapest hull on offer.
    const pick = hulls.find((e) => e.id === 'vf27s-super-kestrel' || e.id === 'vf40-gauntlet') ?? hulls.sort((a, b) => a.price - b.price)[0];
    const r = H.buyHull(o.hangar, S.ledger, pick.id, st, { tradeIn: false, condition: o.condition() });
    if (r.error) return { err: r.error };
    o.commit(r);
    const flying = S.player.model.blueprint.id;
    // Fit: the first slot with a different item for sale.
    const ship = H.activeShip(o.hangar);
    const { slotsFor } = await import('/src/game/outfitting/fit.ts');
    let fitted = null;
    for (const s of slotsFor(H.entryOf(ship))) {
      const it = H.itemsAt(st, s, S.ledger).find((x) => !x.lock && x.item.id !== ship.fit[s.id]);
      if (!it) continue;
      const fr = H.buyItem(o.hangar, S.ledger, ship.uid, s.id, it.item.id, st);
      if (fr.error) continue;
      o.commit(fr);
      fitted = { slot: s.id, item: it.item.id };
      break;
    }
    const fit = H.activeShip(o.hangar).fit;
    return { pick: pick.id, flying, fitted, applied: fitted ? fit[fitted.slot] === fitted.item : false, credits: S.ledger.credits, uid: H.activeShip(o.hangar).uid };
  });
  check('buy a ship: the new hull is the one flying', !yard.err && yard.flying === yard.pick, yard.err ?? `(${yard.pick})`);
  check('fit an item: the fit changes', !!yard.fitted && yard.applied, yard.fitted ? `(${yard.fitted.slot} ← ${yard.fitted.item})` : '');

  // 11. Save / reload the profile.
  const before = await page.evaluate(() => {
    const { S } = window.__cc;
    return { credits: S.ledger.credits, contracts: S.contracts.book.active.map((c) => c.id), lastDock: S.ledger.lastDock };
  });
  await boot(page);
  const after = await page.evaluate(() => {
    const { S, magpie } = window.__cc;
    return {
      hull: S.player.model.blueprint.id,
      credits: S.ledger.credits,
      contracts: S.contracts.book.active.map((c) => c.id),
      lastDock: S.ledger.lastDock,
      crew: JSON.parse(localStorage.getItem('vanguard.crew.v1') ?? '{}').hired ?? [],
      magpie: !!magpie(),
    };
  });
  check('reload: the bought hull is still the active ship', after.hull === yard.pick, `(${after.hull})`);
  check('reload: shares, contract book and last berth kept', after.credits === before.credits && after.contracts.join() === before.contracts.join() && after.lastDock === before.lastDock, `(${after.credits} sh, ${after.contracts.length} contract(s), ${after.lastDock})`);
  check('reload: both hires still aboard, Magpie back in the wing', after.crew.includes('magpie-due') && after.crew.includes('brennick-mechanic') && after.magpie);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await browser.close();
  await server.close();
}
const ok = results.length > 0 && results.every(Boolean);
console.log(ok ? 'ALL PASS' : 'FAILURES');
process.exit(ok ? 0 : 1);
