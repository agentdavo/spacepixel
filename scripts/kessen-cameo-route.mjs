#!/usr/bin/env node
/**
 * Kessen cameo timing on headless ordinary routes (CPU only):
 *
 *   node scripts/kessen-cameo-route.mjs [--seed 1994]
 *
 * Episode 10 and 19 flown by HudPilot in the headless FlightScene world
 * (src/sim/episodeRoute.ts). Reports when each cameo enters and leaves the
 * world root, how far the player is at those moments, and the projected
 * size at 1280×720 with the chase camera's 58° vertical field of view.
 * Ordinary runs write nothing. The optional `--fixture` run adds player plot
 * armour (labelled) so the CPU pilot survives to Episode 19's first jump.
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const seed = Number(opt('seed', '1994'));
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
const PX_PER_RAD = 720 / ((58 * Math.PI) / 180);
try {
  const R = await server.ssrLoadModule('/src/sim/episodeRoute.ts');
  const { MISSIONS } = await server.ssrLoadModule('/src/game/campaign/missions.ts');
  const { Box3, Sphere } = await server.ssrLoadModule('three');
  const routes = {
    10: { cap: 'bastion:2500', intercept: 'bastion:2500', lifeboats: 'lifeboats', jump: '@gate' },
    19: { jump1: '@gate!', jump2: '@gate!' },
  };
  const runs = [[10, false], [19, false], ...(args.includes('--fixture') ? [[19, true]] : [])];
  for (const [ep, fixture] of runs) {
    const lines = [];
    let present = 0;
    let closest = Infinity;
    const r = R.runEpisode({
      mission: MISSIONS[ep - 1], seed, allowJumps: true, seconds: 240, objectiveRoute: routes[ep],
      counterfactual: fixture ? { name: 'player-plot-armour', tick: (S) => { S.player.plotArmour = true; } } : undefined,
      observe: (S, runner) => {
        const groups = S.world.root.children.filter((c) => c.name.startsWith('setpiece:kessen-cameo'));
        if (groups[0]) closest = Math.min(closest, groups[0].position.distanceTo(S.player.flight.position));
        if (groups.length === present) return;
        const g = groups[0];
        const d = g ? g.position.distanceTo(S.player.flight.position) : NaN;
        const radius = g ? new Box3().setFromObject(g).getBoundingSphere(new Sphere()).radius : 0;
        lines.push(`  t=${runner.time.toFixed(3)} s (tick ${S.simTick}) · cameo groups ${present} → ${groups.length}` + (g ? ` · player ${d.toFixed(0)} m · ≈${(2 * Math.atan(radius / d) * PX_PER_RAD).toFixed(1)} px tall-equivalent (bounding radius ${radius.toFixed(1)} m)` : ` · system ${S.systemId}, jump phase ${S.jumpPhase}`) + ` · flags ${[...runner.flags].filter((f) => /bastion-destroyed|leg2|held/.test(f)).join(',') || '-'}`);
        present = groups.length;
      },
    });
    console.log(`EP${ep}${fixture ? ' [FIXTURE: player plot armour]' : ''} seed ${seed}: outcome ${r.outcome}${r.outcomeTick >= 0 ? ` at ${(r.outcomeTick / 60).toFixed(2)} s` : ''} · closest approach to cameo ${closest.toFixed(0)} m`);
    for (const l of lines) console.log(l);
    const flags = r.events.filter((e) => e.kind === 'flag' || e.kind === 'arrive' || e.kind === 'jump').map((e) => `${e.t.toFixed(3)} ${e.kind} ${e.detail}`);
    console.log(`  events: ${flags.join(' · ')}`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await server.close();
}
