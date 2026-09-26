import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { MISSIONS } from '../src/game/campaign/missions.ts';

/**
 * Kessen cameo lifecycle on the production CampaignSession / CampaignRunner
 * in the headless FlightScene world (src/sim/episodeRoute.ts): release,
 * disposal after the first jump and at session end, retry on the same
 * scene, and runner-snapshot restore. The player's controls are left
 * neutral unless a test says otherwise; the Episode 10 release comes from
 * the Bastion set piece's own destruction flag, not from the test.
 */
const DT = 1 / 60;
let server: ViteDevServer;
let R: any;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  R = await server.ssrLoadModule('/src/sim/episodeRoute.ts');
});
after(async () => { await server?.close(); });

const EP10 = MISSIONS[9];
const EP19 = MISSIONS[18];
const cameoGroups = (S: any) => S.world.root.children.filter((c: any) => c.name.startsWith('setpiece:kessen-cameo'));
const cameoPieces = (session: any) => R.sessionPieces(session).filter((p: any) => p.kind === 'kessen-cameo');

/** Every geometry / material the cameo owns (FrameKit's shared frame material is excluded by the piece). */
function owned(piece: any) {
  const geometries = new Set<any>();
  const materials = new Set<any>();
  piece.group.traverse((o: any) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material && o.material !== piece.frames[0]?.meshes[0]?.material) materials.add(o.material);
  });
  let disposed = 0;
  for (const r of [...geometries, ...materials]) r.addEventListener('dispose', () => disposed++);
  return { total: geometries.size + materials.size, disposed: () => disposed };
}

function run(S: any, seconds: number, until?: () => boolean): number {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    S.simStep();
    if (until?.()) return S.simTick;
  }
  return S.simTick;
}

test('EP10: the Bastion releases one cameo after its own destruction; session end disposes it without leftovers', () => {
  const S = new R.HeadlessFlight(1994);
  const session = S.beginCampaign(EP10);
  const runner = session.runner;
  run(S, 120, () => cameoGroups(S).length > 0);
  assert.ok(runner.flags.has('bastion-destroyed'), 'Bastion timeline reached destruction');
  assert.equal(cameoGroups(S).length, 1);
  const releasedAt = runner.time;
  // Released on the runner update after the flag (set-piece flags are raised during pieces' update).
  assert.ok(releasedAt - runner.snapshot().flags.find(([f]: [string]) => f === 'bastion-destroyed')[1] <= DT * 1.5);
  const [piece] = cameoPieces(session);
  const res = owned(piece);
  run(S, 5);
  assert.equal(cameoGroups(S).length, 1, 'still exactly one after further flag/update cycles');
  assert.equal(cameoPieces(session).length, 1);
  S.disposeCampaign();
  assert.equal(cameoGroups(S).length, 0);
  assert.equal(S.world.root.children.filter((c: any) => c.name.startsWith('setpiece:')).length, 0, 'no set-piece group of the episode left under the world root');
  assert.equal(res.disposed(), res.total, 'all cameo-owned geometry and materials disposed');
  assert.equal(piece.group.children.length, 0);
});

test('retry on the same scene: old cameo disposed, one new cameo at the same mission time, no attempt-1 ships left', () => {
  // EP10: fresh attempt timeline.
  const fresh = new R.HeadlessFlight(1994);
  const f = fresh.beginCampaign(EP10);
  run(fresh, 120, () => cameoGroups(fresh).length > 0);
  const freshRelease = f.runner.time;
  fresh.disposeCampaign();

  const S = new R.HeadlessFlight(1994);
  const first = S.beginCampaign(EP10);
  run(S, 110);
  assert.equal(cameoGroups(S).length, 1);
  const oldPiece = cameoPieces(first)[0];
  const oldRes = owned(oldPiece);
  const attempt1 = S.fleet.ships.filter((s: any) => s.alive && first.runner.tagOf(s) !== undefined);
  assert.ok(attempt1.length > 0);
  const retry = S.beginCampaign(EP10); // main.ts "↺ RETRY" → FlightScene.startCampaign on the same scene
  assert.equal(cameoGroups(S).length, 0, 'old cameo left the world root');
  assert.equal(oldRes.disposed(), oldRes.total, 'old cameo resources disposed');
  assert.deepEqual(attempt1.filter((s: any) => s.alive).map((s: any) => s.name), [], 'attempt-1 ships parked');
  let staleKills = 0;
  for (let i = 0; i < 120 * 60 && !cameoGroups(S).length; i++) {
    S.simStep();
    for (const e of S.weapons.events) if (e.kind === 'kill' && attempt1.includes(e.ship)) staleKills++;
  }
  assert.equal(cameoGroups(S).length, 1, 'exactly one cameo in the retry');
  assert.equal(cameoPieces(retry).length, 1);
  assert.ok(Math.abs(retry.runner.time - freshRelease) < 1e-9, `retry releases at the fresh attempt's mission time (${retry.runner.time.toFixed(3)} vs ${freshRelease.toFixed(3)} s)`);
  assert.equal(staleKills, 0, 'no attempt-1 kills credited to the retry');
  S.disposeCampaign();

  // EP19: the witness module is present from the start of each attempt, once.
  const T = new R.HeadlessFlight(1994);
  const a = T.beginCampaign(EP19);
  run(T, 2);
  assert.equal(cameoGroups(T).length, 1);
  const witnessA = cameoPieces(a)[0];
  const b = T.beginCampaign(EP19);
  run(T, 2);
  assert.equal(cameoGroups(T).length, 1);
  assert.equal(witnessA.group.parent, null);
  assert.equal(witnessA.frames.length, 0, 'attempt-1 witnesses disposed');
  assert.equal(cameoPieces(b).length, 1);
  assert.equal(T.fleet.ships.filter((s: any) => s.alive && a.runner.tagOf(s) !== undefined).length, 0);
  T.disposeCampaign();
});

test('EP19: the real first jump removes the witnesses at arrival, inside the tunnel (fixture: player plot armour)', () => {
  // The HUD pilot holds in the tuning ring, then heads for the gate marker.
  // Fixture: plot armour on the player so this CPU run survives the holdouts
  // (ordinary runs die before the gate); no flags, positions or objectives are written.
  let presentAtLeg2: number | null = null;
  let phaseAtRemoval = '';
  let groupsAfter = -1;
  const r = R.runEpisode({
    mission: EP19, seed: 1994, allowJumps: true, seconds: 150,
    objectiveRoute: { jump1: '@gate!' },
    counterfactual: { name: 'player-plot-armour', tick: (S: any) => { S.player.plotArmour = true; } },
    observe: (S: any, runner: any) => {
      const n = cameoGroups(S).length;
      if (runner.flags.has('leg2') && presentAtLeg2 === null) {
        presentAtLeg2 = n;
        phaseAtRemoval = S.jumpPhase;
      }
      if (runner.flags.has('leg2')) groupsAfter = Math.max(groupsAfter, n);
    },
    stopWhen: (S: any, runner: any) => runner.flags.has('leg2') && S.jumpPhase === 'none',
  });
  assert.ok(r.flags.includes('tune-meridian-held'), 'dwell completed near the witnesses');
  assert.ok(r.flags.includes('leg2'), 'first jump reached');
  assert.equal(presentAtLeg2, 0, 'removed on the tick the jump objective completes');
  assert.equal(phaseAtRemoval, 'tunnel', 'while the world is hidden in the jump tunnel');
  assert.equal(groupsAfter, 0, 'never re-added after the jump');
  assert.equal(r.pieces >= 1, true);
});

test('runner-snapshot restore: released cameos come back once; post-jump EP19 restores without witnesses', () => {
  // EP10 snapshot after the Bastion fell.
  const S = new R.HeadlessFlight(1994);
  const s = S.beginCampaign(EP10);
  run(S, 120, () => cameoGroups(S).length > 0);
  const snap = JSON.parse(JSON.stringify(s.runner.snapshot()));
  S.disposeCampaign();
  const restored = R.headlessSession(EP10, S);
  S.campaign = restored;
  restored.runner.restore(snap);
  restored.begin();
  // Anchored on the lane beacon, which the same release pass builds: it resolves on the first update.
  run(S, DT);
  assert.equal(cameoGroups(S).length, 1, 'released from the restored flag');
  run(S, 3);
  assert.equal(cameoGroups(S).length, 1);
  S.disposeCampaign();
  assert.equal(cameoGroups(S).length, 0);

  // EP19 snapshots before and after the first jump.
  const T = new R.HeadlessFlight(1994);
  const t = T.beginCampaign(EP19);
  run(T, 2);
  const beforeJump = JSON.parse(JSON.stringify(t.runner.snapshot()));
  const afterJump = { ...beforeJump, flags: [...beforeJump.flags, ['leg2', beforeJump.time]] };
  for (const [snapshot, expected] of [[beforeJump, 1], [afterJump, 0]] as const) {
    T.disposeCampaign();
    const r = R.headlessSession(EP19, T);
    T.campaign = r;
    r.runner.restore(snapshot);
    r.begin();
    run(T, 1);
    assert.equal(cameoGroups(T).length, expected);
    assert.ok(cameoPieces(r).length <= 1);
  }
  T.disposeCampaign();
  assert.equal(cameoGroups(T).length, 0);
});
