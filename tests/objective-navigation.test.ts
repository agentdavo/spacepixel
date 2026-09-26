import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import type { CampaignMission, CampaignObjective } from '../src/game/campaign/types.ts';
import { EP04 } from '../src/game/campaign/episodes/ep04-black-light.ts';
import { EP05 } from '../src/game/campaign/episodes/ep05-whispers-in-the-static.ts';
import { flightNavigation } from '../src/ui/FlightNavigation.ts';

// CPU runner/presentation fixtures. Positions and kills below are test inputs,
// not an ordinary-input flight or a proof of combat/mission clearance.
function fixture(mission: CampaignMission, snapshot?: unknown) {
  const host: CampaignHost = {
    playerPosition: new Vector3(1_000_000, 200_000, -300_000), playerAlive: true, playerHull: 1,
    systemId: mission.system, jumps: 0, ships: [], gatePosition: () => new Vector3(99, 0, 0),
    spawnShip: (spec, member, position) => ({
      name: spec.name ? `${spec.name}${spec.count > 1 ? ` ${member + 1}` : ''}` : spec.blueprint,
      faction: spec.faction, alive: true, hull: 100, hullMax: 100,
      flight: { position: position.clone(), velocity: new Vector3() },
    }) as never,
    // The real beacon default is 200 m; distanceTo subtracts the piece radius.
    spawnSetPiece: (spec, position) => ({ tag: spec.tag, position, radius: Number(spec.params?.radius ?? 200) }),
    playChatter: () => {}, unlockCodex: () => {},
  };
  const runner = new CampaignRunner(mission, host);
  if (snapshot) runner.restore(snapshot);
  runner.begin();
  return { host, runner };
}

function kill(runner: CampaignRunner, tag: string) {
  for (const ship of runner.shipsTagged(tag)) {
    if (!ship.alive) continue;
    ship.alive = false;
    runner.onKill(ship);
  }
}

const gate = { label: 'Unrelated live gate', position: new Vector3(99, 0, 0) };
const current = (runner: CampaignRunner) => runner.mission.objectives.find((o, i) => !o.optional && runner.state[i] === 'active')?.id;

test('EP04 follows the live Magpie, then a stable surviving tanker; reads cannot change simulation state', () => {
  const { host, runner } = fixture(EP04);
  const magpie = runner.shipsTagged('magpie')[0];
  assert.equal(runner.navigation()?.tag, 'magpie');
  assert.equal(runner.navigation()?.label, "Magpie's Due");
  magpie.flight.position.add(new Vector3(400, 30, 200));
  assert.deepEqual(runner.navigation()?.position, magpie.flight.position, 'the marker follows current position, not initial placement');
  const before = runner.snapshot();
  runner.navigation()!.position.set(0, 0, 0);
  assert.deepEqual(runner.snapshot(), before, 'returned navigation points do not expose mutable simulation vectors');
  host.playerPosition.copy(magpie.flight.position).add(new Vector3(800, 0, 0));
  runner.update(0);
  assert.equal(current(runner), 'formup', 'existing strict 800 m predicate remains intact');
  host.playerPosition.x -= 1;
  runner.update(0);
  assert.equal(current(runner), 'raid');
  assert.equal(runner.navigation()?.tag, 'tankers-1');
  assert.equal(runner.navigation()?.label, 'Marsh Tanker 1');
  const [one, two, three] = runner.shipsTagged('tankers');
  two.flight.position.copy(host.playerPosition);
  assert.equal(runner.navigation()?.tag, 'tankers-1', 'nearer members do not make the escort marker jump');
  one.alive = false;
  assert.equal(runner.navigation()?.tag, 'tankers-2', 'dead member is replaced immediately');
  two.flight.position.add(new Vector3(25, -17, 800));
  assert.deepEqual(runner.navigation()?.position, two.flight.position);
  runner.update(0);
  assert.equal(runner.outcome, 'running', 'losing one tanker is permitted by the existing objective');
  two.alive = false;
  runner.update(0);
  assert.equal(runner.outcome, 'failure');
  assert.equal(runner.navigation(), undefined, 'remaining third tanker does not leave a marker after failure');
  assert.equal(flightNavigation(runner, gate), undefined, 'failure does not substitute an unrelated gate');
  three.alive = false;
  assert.equal(runner.navigation(), undefined);
  assert.equal(fixture(EP04).runner.navigation()?.tag, 'magpie', 'fresh retry starts with the correct target');
});

test('EP04 marker preserves authored raid/arrival transitions and resolves surviving members after JSON restore', () => {
  const { host, runner } = fixture(EP04);
  host.playerPosition.copy(runner.navigation()!.position);
  runner.update(0);
  runner.update(42);
  kill(runner, 'raidC');
  kill(runner, 'raidP');
  runner.update(0);
  assert.equal(current(runner), 'torpedoes');
  assert.equal(runner.navigation()?.tag, 'tankers-1');
  runner.shipsTagged('tankers')[0].alive = false;
  const snapshot = JSON.parse(JSON.stringify(runner.snapshot()));
  const restored = fixture(EP04, snapshot).runner;
  assert.deepEqual(restored.navigation(), runner.navigation(), 'no new save fields are needed for a group marker');
  runner.update(6);
  kill(runner, 'raidT');
  runner.update(0);
  assert.equal(current(runner), 'lantern');
  assert.equal(runner.navigation()?.tag, 'tankers-2');
  const arrival = runner.resolve({ at: 'tag', tag: 'rwbuoy', offset: [0, 0, 0] })!;
  for (const tanker of runner.shipsTagged('tankers')) tanker.flight.position.copy(arrival);
  runner.update(0);
  assert.equal(runner.outcome, 'success');
  assert.equal(runner.navigation(), undefined);
});

test('EP05 advances station → North → Void → throat, clears for combat, and returns to the station', () => {
  const { host, runner } = fixture(EP05);
  for (const [tag, label, radius] of [
    ['station', 'Null Picket Station 2', 1000],
    ['buoyN', 'Survey Buoy North', 200],
    ['buoyV', 'Survey Buoy Void', 200],
  ] as const) {
    const nav = runner.navigation()!;
    assert.equal(nav.tag, tag);
    assert.equal(nav.label, label);
    const id = current(runner);
    host.playerPosition.copy(nav.position).add(new Vector3(radius + 200, 0, 0));
    runner.update(0);
    assert.equal(current(runner), id, 'navigation does not enlarge the authored proximity predicate');
    host.playerPosition.x -= 1;
    runner.update(0);
    assert.notEqual(current(runner), id);
  }
  const throat = runner.navigation()!;
  assert.equal(throat.tag, 'throat');
  assert.equal(throat.label, 'Ring throat');
  host.playerPosition.copy(throat.position);
  runner.update(19);
  assert.equal(current(runner), 'listen');
  assert.equal(runner.flags.has('burst'), false);
  runner.update(1);
  assert.equal(current(runner), 'measure');
  assert.equal(runner.flags.has('burst'), true);
  assert.equal(runner.navigation(), undefined);
  assert.equal(flightNavigation(runner, gate), undefined, 'combat does not reuse the throat or a generic gate');
  runner.update(22);
  kill(runner, 'pmeasure');
  runner.update(0); // hidden withdrawal cue retains its original order
  runner.update(0);
  assert.equal(current(runner), 'home');
  assert.equal(runner.navigation()?.tag, 'station');
  host.playerPosition.copy(runner.navigation()!.position);
  runner.update(0);
  assert.equal(runner.outcome, 'success');
  assert.equal(runner.navigation(), undefined);
  assert.equal(flightNavigation(runner, gate), undefined);
});

test('unresolved, dead, hidden and optional targets cannot redirect the active required objective', () => {
  const objective: CampaignObjective = { id: 'track', text: 'Track', navigation: { kind: 'ship', tag: 'tankers-2' }, done: () => false };
  const mission: CampaignMission = {
    ...EP04, objectives: [objective], chatter: [], setpieces: [],
    spawns: [{ ...EP04.spawns[1], whenFlag: 'release' }],
  };
  const { runner } = fixture(mission);
  assert.equal(runner.navigation(), undefined, 'unreleased target has no marker');
  assert.equal(flightNavigation(runner, gate), undefined);
  runner.setFlag('release');
  runner.update(0);
  assert.equal(runner.navigation()?.tag, 'tankers-2', 'exact numbered ship becomes available');
  runner.shipsTagged('tankers-2')[0].alive = false;
  assert.equal(runner.navigation(), undefined, 'an exact dead ship does not silently switch to a different group member');
  for (const overrides of [{ hidden: true }, { optional: true }, { navigation: { kind: 'ship' as const, tag: 'missing' } }]) {
    const result = fixture({ ...mission, spawns: EP04.spawns, objectives: [{ ...objective, ...overrides }] });
    assert.equal(result.runner.navigation(), undefined);
  }
  const combat = fixture({ ...EP04, objectives: [
    { ...objective, id: 'combat', navigation: undefined },
    { ...objective, id: 'side', optional: true },
  ] }).runner;
  assert.equal(combat.navigation(), undefined, 'an active side objective does not masquerade as the required combat objective');
});

test('groups resolve only their declared members, and deferred pieces replace no stale point', () => {
  const mission: CampaignMission = {
    ...EP04, chatter: [],
    objectives: [{ id: 'group', text: 'Group', done: () => false, navigation: { kind: 'group', tag: 'tankers' } }],
    // Similar-prefix group deliberately appears first in authored spawn order.
    spawns: [{ ...EP04.spawns[1], tag: 'tankers-decoy' }, EP04.spawns[1]],
  };
  const { runner } = fixture(mission);
  assert.equal(runner.navigation()?.tag, 'tankers-1');
  kill(runner, 'tankers-1'); kill(runner, 'tankers-2'); kill(runner, 'tankers-3');
  assert.equal(runner.navigation(), undefined, 'a prefix match to another declared group is not a survivor');
  const pieceMission: CampaignMission = {
    ...EP05, spawns: [], chatter: [],
    objectives: [{ id: 'wait', text: 'Wait', done: () => false, navigation: { kind: 'setpiece', tag: 'station', label: 'Rendezvous' } }],
    setpieces: [{ ...EP05.setpieces[0], params: { whenFlag: 'piece-ready' } }],
  };
  const deferred = fixture(pieceMission).runner;
  assert.equal(deferred.navigation(), undefined);
  deferred.setFlag('piece-ready'); deferred.update(0);
  assert.equal(deferred.navigation()?.label, 'Rendezvous');
  deferred.outcome = 'failure';
  assert.equal(deferred.navigation(), undefined);
});

test('HUD uses mission navigation exclusively when authored and preserves free-flight/unannotated gate guidance', () => {
  const { runner } = fixture(EP04);
  assert.deepEqual(flightNavigation(runner, gate), { ...runner.navigation(), mission: true });
  assert.deepEqual(flightNavigation(undefined, gate), { ...gate, mission: false });
  assert.equal(flightNavigation(undefined), undefined, 'no gate while docking clearance owns navigation');
  const unannotated = fixture({ ...EP04, objectives: EP04.objectives.map(o => ({ ...o, navigation: undefined })) }).runner;
  assert.deepEqual(flightNavigation(unannotated, gate), { ...gate, mission: false });
  runner.shipsTagged('magpie')[0].alive = false;
  assert.equal(flightNavigation(runner, gate), undefined);
  assert.equal(runner.state[0], 'active', 'navigation cannot complete or fail objectives itself');
});
