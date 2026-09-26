#!/usr/bin/env node
/**
 * Headless first-session route (CPU only, no browser or GPU):
 *
 *   EP01 flown by HudPilot (ordinary mouse/keyboard devices derived from
 *   what the HUD shows) → fresh input tape → deterministic replay of that
 *   tape → debrief "Continue" career bookkeeping → berth → market buy/sell →
 *   refit → save → close (fresh module graph) → resume with progress intact.
 *
 *   node scripts/first-session-route.mjs [--seed 22] [--out scratchpad/first-session-route]
 *   node scripts/first-session-route.mjs --sweep 100      # win rate per pilot policy
 *
 * The flight world is src/sim/episodeRoute.ts (FlightScene's cast and campaign
 * tick order without a renderer). Nothing forces flags, kills, positions,
 * health or objectives. The career steps call the same production functions
 * the dock screen and main.ts call (economy buy/sell, hangar buyItem,
 * Profile saveLedger/saveCareer/saveProfile, world episodeCompleted) against
 * an in-memory localStorage; they are not a UI or native storage proof.
 * Exit 1 on any failure.
 */
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const seed = Number(opt('seed', '22'));
const sweep = Number(opt('sweep', '0'));
const out = resolve(opt('out', 'scratchpad/first-session-route'));
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = () => createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

/** In-memory localStorage shared across "sessions" (module graphs). */
const values = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, String(v)), removeItem: (k) => void values.delete(k), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; } },
});

let server = await vite();
try {
  const route = await server.ssrLoadModule('/src/sim/episodeRoute.ts');
  const { DEFAULT_HUD_PILOT } = await server.ssrLoadModule('/src/sim/HudPilot.ts');

  if (sweep > 0) {
    const policies = [
      { name: 'charge (default)', pilot: DEFAULT_HUD_PILOT },
      { name: 'retreat to recharge', pilot: { ...DEFAULT_HUD_PILOT, breakBelow: 0.5, rejoinAbove: 0.95 } },
      // Ordinary input: one wing key the first time a hostile shows on the radar.
      { name: 'charge + 3 engage at will', pilot: { ...DEFAULT_HUD_PILOT, wingOrder: 'Digit3' } },
      { name: 'charge + 2 attack my target', pilot: { ...DEFAULT_HUD_PILOT, wingOrder: 'Digit2' } },
      { name: 'retreat + 3 engage at will', pilot: { ...DEFAULT_HUD_PILOT, breakBelow: 0.5, rejoinAbove: 0.95, wingOrder: 'Digit3' } },
    ];
    // --counterfactual candle-engage: DIAGNOSTIC what-if, not ordinary-input evidence — the
    // episode wingman receives "engage at will" (the order the wing keys acknowledge but never deliver to him).
    const { issueOrder } = await server.ssrLoadModule('/src/sim/ai/index.ts');
    const counterfactual = opt('counterfactual', '') === 'candle-engage'
      ? { name: 'candle-engage', tick: (S, runner) => { if (S.simTick === 0) issueOrder(runner.shipsTagged('candle'), 'engageAtWill', S.player); } }
      : undefined;
    if (counterfactual) console.log('COUNTERFACTUAL candle-engage — diagnostic only, not ordinary-input evidence');
    for (const p of policies) {
      const rows = [];
      for (let s = 1; s <= sweep; s++) {
        const r = route.runEpisode({ seed: s, pilot: p.pilot, counterfactual });
        const start = r.events.find((e) => e.kind === 'flag' && e.detail === 'thieves')?.t ?? NaN;
        const death = r.events.find((e) => e.kind === 'kill' && e.detail.startsWith('Vanguard 1'))?.t;
        rows.push({ seed: s, outcome: r.outcome, t: r.outcomeTick / 60, survived: death === undefined ? null : death - start, rustwake: r.stats.kills.rustwake ?? 0 });
      }
      const wins = rows.filter((r) => r.outcome === 'success');
      const surv = rows.filter((r) => r.survived !== null).map((r) => r.survived).sort((a, b) => a - b);
      console.log(`${p.name}: ${wins.length}/${sweep} wins${wins.length ? ` (seeds ${wins.map((r) => `${r.seed} @ ${r.t.toFixed(2)} s`).join(', ')})` : ''} · median survival after contact ${surv[surv.length >> 1]?.toFixed(2)} s · mean Rustwake kills ${(rows.reduce((a, r) => a + r.rustwake, 0) / sweep).toFixed(2)}`);
    }
    process.exitCode = 0;
  } else {
    mkdirSync(out, { recursive: true });
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: root, encoding: 'utf8' }).trim() !== '';

    // ── 1. EP01 by ordinary input, recorded ──
    const A = route.runEpisode({ seed, record: true });
    const at = (kind, detail) => A.events.find((e) => e.kind === kind && (!detail || e.detail.startsWith(detail)));
    const done = (id) => at('objective', `${id}: active → done`);
    for (const id of ['buoy1', 'buoy2', 'buoy3', 'thieves', 'beacon', 'yards']) check(`EP01 objective ${id} completed`, !!done(id), done(id) ? `tick ${done(id).tick} · ${done(id).t.toFixed(2)} s` : '');
    check('EP01 success by ordinary input', A.outcome === 'success', `outcome ${A.outcome} at tick ${A.outcomeTick} (${(A.outcomeTick / 60).toFixed(3)} s) · hull ${A.player.hull.toFixed(1)}/${A.player.hullMax} · Rustwake kills ${A.stats.kills.rustwake ?? 0} (player ${A.stats.playerKills})`);
    check('no Lantern jump, station contact or hull contact on the route', !A.jumped && A.stats.hullContacts === 0, `closest station ${A.stats.minStationDistance.toFixed(0)} m`);
    const tapePath = `${out}/ep01-seed${seed}.vgr`;
    const shown = relative(root, tapePath).split('\\').join('/');
    writeFileSync(tapePath, JSON.stringify(A.take));
    writeFileSync(`${out}/ep01-seed${seed}-result.json`, JSON.stringify({ source, dirtySrc: dirty, seed, pilot: DEFAULT_HUD_PILOT, outcome: A.outcome, outcomeTick: A.outcomeTick, ticks: A.ticks, player: A.player, stats: A.stats, objectives: A.objectives, flags: A.flags, events: A.events, checkpoints: A.take.checks.length }, null, 1));

    // ── 2. The tape alone, after a JSON round trip ──
    const tape = JSON.parse(JSON.stringify(A.take));
    const B = route.runEpisode({ seed, replay: tape });
    const mismatch = A.hashes.findIndex((h, i) => h !== B.hashes[i]);
    check('fresh tape replays deterministically', mismatch < 0 && A.hashes.length === B.hashes.length && B.outcome === A.outcome && B.outcomeTick === A.outcomeTick, `${A.hashes.length - (mismatch < 0 ? 0 : A.hashes.length - mismatch)}/${A.hashes.length} checkpoints · replay outcome ${B.outcome} at tick ${B.outcomeTick} · ${A.take.ticks} ticks · ${(tapePath.length, JSON.stringify(A.take).length)} bytes`);

    // ── 3. Career: debrief Continue → berth → trade → refit → save ──
    const P = await server.ssrLoadModule('/src/game/Profile.ts');
    const econ = await server.ssrLoadModule('/src/game/economy.ts');
    const shop = await server.ssrLoadModule('/src/game/outfitting/hangar.ts');
    const live = await server.ssrLoadModule('/src/game/world/live.ts');
    const { generateUniverse } = await server.ssrLoadModule('/src/universe/generate.ts');
    const profile = P.loadProfile();
    profile.seenPrologue = true; // the fresh run played the prologue before EP01
    P.saveProfile(profile);
    check('fresh career starts at Episode 1 with 2,500 shares', profile.episode === 1 && P.loadLedger().credits === 2500);
    // main.ts runCampaign: success + CONTINUE ▸
    live.episodeCompleted(1);
    profile.episode = 2;
    P.saveProfile(profile);
    // After an episode, free flight opens berthed at the nearest Directorate station (ContractDesk.homeStation: same system first).
    const anchorage = generateUniverse(1994).systems.get('anchorage');
    const home = anchorage.stations.find((s) => s.faction === 'concord');
    let ledger = P.loadLedger();
    ledger.lastDock = home.id; // FlightScene.berthed
    check('berthed and saved at the home Directorate station', P.saveLedger(ledger), home.id);
    const bought = econ.buy(P.loadLedger(), home, 'rations', 1);
    check('market buy committed', bought.units === 1 && P.saveLedger(bought.ledger), `${bought.total} sh → ${bought.ledger.credits} sh, ${bought.ledger.cargo.rations} pallets`);
    const sold = econ.sell(P.loadLedger(), home, 'rations', 1);
    check('market sell committed', sold.units === 1 && P.saveLedger(sold.ledger), `${sold.total} sh → ${sold.ledger.credits} sh, ${sold.ledger.cargo.rations} pallets`);
    const hangar = P.loadHangar();
    const gunSlot = Object.keys(hangar.ships[0].fit).find((k) => k.startsWith('gun:')) ?? 'gun:gun';
    const refit = shop.buyItem(hangar, P.loadLedger(), hangar.active, gunSlot, 'g-laser-mk2', home);
    check('refit Pulse Laser Pair Mk II affordable and committed atomically', !refit.error && P.saveCareer(refit.ledger, refit.hangar), refit.error ?? `${gunSlot} = ${refit.hangar.ships[0].fit[gunSlot]} · ${refit.ledger.credits} sh`);
    const expected = { credits: P.loadLedger().credits, rations: P.loadLedger().cargo.rations, fit: P.loadHangar().ships[0].fit, lastDock: P.loadLedger().lastDock };
    writeFileSync(`${out}/career-storage.json`, JSON.stringify(Object.fromEntries(values), null, 1));

    // ── 4. Close and resume: a new module graph over the same storage ──
    await server.close();
    server = await vite();
    const P2 = await server.ssrLoadModule('/src/game/Profile.ts');
    const r2 = { profile: P2.loadProfile(), ledger: P2.loadLedger(), hangar: P2.loadHangar() };
    check('resume: Episode 2 pending, prologue remembered', r2.profile.episode === 2 && r2.profile.seenPrologue === true);
    check('resume: balance, cargo and berth preserved', r2.ledger.credits === expected.credits && r2.ledger.cargo.rations === expected.rations && r2.ledger.lastDock === expected.lastDock, `${r2.ledger.credits} sh · ${r2.ledger.cargo.rations} pallets · ${r2.ledger.lastDock}`);
    check('resume: refit preserved', JSON.stringify(r2.hangar.ships[0].fit) === JSON.stringify(expected.fit), `${gunSlot} = ${r2.hangar.ships[0].fit[gunSlot]}`);
    const WS = await server.ssrLoadModule('/src/game/world/WorldState.ts');
    check('resume: world records Episode 1 as flown', !!WS.fact(WS.loadWorld(), 'story.ep1.done'), 'story.ep1.done');
    console.log(`\nsource ${source}${dirty ? ' (+ uncommitted src changes)' : ''} · tape ${shown}`);
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await server.close();
}
if (!sweep) console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL PASS');
process.exitCode = failed ? 1 : 0;
