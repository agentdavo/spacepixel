# Point defence and collision events: headless regression

26 September 2026. Owner: Point Defence & Combat Verification (independent
reviewer, see [TEAM-OWNERSHIP.md](TEAM-OWNERSHIP.md)). This is a bounded
headless report. It does not change engine code and does not include native
GPU or browser captures.

## Source under test

- HEAD: `716353784e41c25734169f8804dd9f23deb3d0c7` (`7163537`, tip of
  `codex/integrate-audit-trailer-combat-voices`). It contains `2d8d559`
  (contact capture telemetry), the PD fixes `0df895c` / `dc07652`, and the
  accepted contact solver through `dee8042`.
- Node v24.20.0 on Windows 11.
- New test file: `tests/pd-collision-events.test.ts`. It is the only new test
  file. The report commit adds nothing else.

## Commands

```sh
node --experimental-transform-types --no-warnings --test tests/pd-collision-events.test.ts
npm test          # 406 tests: 405 pass, 0 fail, 1 todo (the one below)
npm run typecheck # passes (tests are outside tsconfig "include")
```

Each test prints its measured rows as one JSON line: `pdCrossingKinematic`,
`pdCrossingLoop`, `collisionKillDelivery`, `collisionSubsystemDelivery` and
`eventWindowPeak`. The tables below come from those lines.

## Evidence reused, not duplicated

These accepted tests still pass on this HEAD. The new tests do not repeat them.

- `tests/point-defence.test.ts`: a static missile below the deck, reversed
  candidate order, an impossible intercept, no firing through the deck, and
  one swept-crossing `Missiles.shoot` point case.
- `tests/capital-collision-runtime.test.ts`: two collision kills and two
  shield-downs in the contact tick. After one more `beginTick` +
  `step(dt, true)` the kill count is 0. EventTap keeps exactly one ordered
  copy across two ticks. Standalone `step(dt)` clears. Layer-aware GameAudio
  cues. Replay after a `.vgr` JSON round trip.
- `tests/event-tap.test.ts` and `tests/combat-audio.test.ts`: pooled copies
  and cue mapping.

What is new here: crossing and moving threats in the real Capitals loop,
selection with moving candidates, the whole run (not only the following tick),
every consumer read point in FlightScene order, subsystem delivery, a mixed
contact/bolt/missile tick, equivalence with the default caller, and the
capacity of the event window.

## Contract assumed (derived from code and docs)

The code comments and CAPITAL-CONTACT-REVIEW.md ("Weapons.step clearing
collision … events", `beginTick`) state the event contract only partly. The
tests assume the following:

1. **Window.** One simulation tick is one event window. In FlightScene and the
   headless harness, `weapons.beginTick()` opens the window immediately before
   `fleet.step`. Everything emitted by `fleet.step` (reactor fuse / settle
   kills, wreck shock), capital contacts (`Weapons.contactHit`),
   `weapons.step(dt, true)` and `missiles.step` belongs to that tick.
2. **Exactly once.** Each per-tick consumer sees each `kill`, `subsystem`,
   `shield-down` and `reactor-critical` event exactly once over the whole run.
   The same-tick readers are `CampaignSession` / `ContractDesk` →
   `runner.onKill`, the FlightScene 4b kill and reputation bookkeeping, and
   the 4c presentation readers: CombatHud (kill feed and impacts), FlightRadio
   barks, KillCam's per-tick tap, and the frame EventTap that GameAudio
   drains once per frame. `Traffic.update` is a documented prior-tick
   consumer: it reads tick N's window at the start of tick N+1, still exactly
   once.
3. **Clearing.** Nothing from tick N remains after tick N+1's `beginTick`.
4. **Ordering.** Within a tick, contact consequences come before bolt
   consequences, and bolt consequences come before missile-detonation
   consequences.
5. **Default callers.** Standalone `weapons.step(dt)` (balance, cinema, test
   scenes, `lantern-pd.mjs`) still opens its own window. When nothing emits
   before it, it matches `beginTick(); step(dt, true)` exactly.
6. **Kill credit.** A contact kill's `shooter` is the other hull. This is
   observed behaviour, not a documented rule; see the contact questions below.
7. **Salvage / wrecks.** `Destruction.onKill` (breakup and salvage pieces)
   runs once per dead hull.

For PD: "reachable" means a lead solution exists
(`leadPoint(...) > 0` with the mount's bolt speed and velocity inheritance),
the lead direction is inside the mount's traverse and elevation limits, and
the current distance is within range. Among the reachable threats, the
nearest current distance wins. Only hostile, non-neutral ordnance counts
(`Missiles.nearestThreat` with the `turretSelectThreat` predicate).

## Outcomes

| # | Test | Seeds | Result |
|---|---|---|---|
| 1 | Swept PD bolt on the lead solution vs a crossing torpedo: 150/300/430/900 m/s lateral; mount stationary, closing 120 m/s, ±250 m/s parallel | 31 | **Pass.** 7/7 intercepted, each within 2 ticks of the predicted flight time (0.68–0.81 s). The no-lead control misses 7/7. |
| 2 | Real `Capitals` Lantern Guard vs 6 torpedoes crossing its bow at an ally, stationary and cruising guard | 31, 47, 59, 73, 89, 97 (each run twice) | **Pass.** Runs are deterministic, every torpedo resolves, and PD lays on a crossing threat. The zero-scatter control intercepts **72/72**. Live scatter: see the PD table below. |
| 3 | Nearest reachable threat with moving candidates | 47 | **Pass.** (a) The nearest wins over the first enumerated; friendly and neutral ordnance are ignored. (b) A nearer threat inside the arc but crossing *out* does not mask a reachable one. (c) A nearer threat outside the arc but crossing *in* is engaged on its lead. (d) An outrunning threat does not mask. (e) The range gate works. (f) A dying missile drops out immediately. |
| 4 | Head-on Indomitables at 180 m/s, all consumers, 120 ticks after contact | 1994, 7, 31 | **Pass.** Contact at tick 105: 2 `structural` kills and 2 fore `shield-down`, each exactly once to runner, bookkeeping, HUD, barks, KillCam tap, frame tap → audio (2 × `hullCrunch`) and traffic (next tick). The window is empty after the next `beginTick`. `Destruction.onKill` runs once per hull. Runner kills: `{concord: 1, choir: 1}`. |
| 5 | Stern contact at 60 m/s with shields down (engine deck) | 1994 | **Pass.** Tick 360: `subsystem:2:engine-0` exactly once per consumer, no kill, 1 audio `mountBlast`, cleared the next tick. |
| 6 | Contact, bolt and torpedo kills in the same tick | 1994 | **Pass.** Order is [contact A, contact B] then bolt, then missile. All 4 are delivered on the contact tick, exactly once per consumer. |
| 7 | Default caller: fighter duel with guns and a micro salvo, `step(dt)` vs `beginTick` + `step(dt, true)` | 7, 31 | **Pass.** Per-tick event streams and world hashes are identical over 600 ticks. `step(dt)` still clears a `contactHit` emitted before it. |
| 8 | Default caller: a torpedo kill after a standalone `weapons.step(dt)` | 59 | **Pass.** It is visible once after `missiles.step` and gone at the next `step(dt)`. |
| 9 | Event-window headroom in `runScenario` dogfight / capital / traffic, 60 s | 7 | **Pass.** Peak events in one tick: 5 / 5 / 8, against a pool of 384. |
| 10 | Kill emitted after the window is saturated (384 events) | 7 | **Fails (todo).** The kill event is dropped. See defect D1. |

### PD crossing interceptions in the real loop (test 2)

The six torpedoes launch at 2 s intervals and fly at an ally. The guard
engages them as they pass.

| Crossing line | Fire-control scatter | Guard | Intercepted / 36 | Per seed (31, 47, 59, 73, 89, 97) |
|---|---|---|---:|---|
| 900 m ahead | live | stationary | 1 | 1, 0, 0, 0, 0, 0 |
| 900 m ahead | live | cruising (2.7 km in 40 s) | 3 | 1, 0, 0, 1, 0, 0 |
| 400 m ahead | live | stationary | 30 | 3, 6, 5, 5, 5, 6 |
| 400 m ahead | live | cruising | 19 | 3, 2, 4, 3, 3, 4 |
| 900 m ahead | zeroed (test control) | stationary | **36** | 6 each |
| 900 m ahead | zeroed (test control) | cruising | **36** | 6 each |

**How to read this table.** The lead solution, slew, fire gate and swept hit
test are all sound for crossing and moving geometry. With scatter zeroed,
every crossing torpedo is intercepted; kinematic test 1 hits at the predicted
time. The low 900 m rate comes from dispersion. The burst scatter is
`0.03 / coordination` times `rng.centered()` (range ±0.5) on each axis. That
is up to about ±13 m per axis at 900 m, against a 6 m torpedo hit radius. The same defences stop every closing torpedo in the
same harness. For comparison, `docs/COMBAT_VERIFICATION.md` reports 176/180
for closing torpedoes. This is a **balance/tuning observation for the combat
owner, not a defect**. The zero-scatter control swaps `rng.centered` on that
capital's instance inside the test only.

## Defects and minimal reproductions

**D1: kill events are dropped when the per-tick pool is full (latent).**
`Weapons.emit` returns `null` once `events.length >= EVENT_POOL` (384,
`src/sim/Weapons.ts`). `Fleet.hit` still kills the ship and runs
`Destruction.onKill`, but no `kill` event exists. As a result,
`runner.onKill`, mission bookkeeping, the HUD, audio and KillCam never see
the death. Repro, in the todo test `a kill emitted after the per-tick event
pool is full…`:

```ts
weapons.beginTick();
for (let k = 0; k < 400; k++) weapons.contactHit(tank, 1, point, normal, shooter); // 384 'shield' events
fleet.hit(victim, 1000, 'laser', victim.flight.position, up, shooter).killed; // true
weapons.events.filter(e => e.kind === 'kill' && e.ship === victim).length;    // 0, expected 1
```

This is latent. The standard headless scenarios peak at 8 events per tick, so
it needs a very large battle in a single tick. Fixing it belongs to the
Combat & Spatial Audio owner (who owns weapon event semantics), with
Collisions consulted.

No other defect was found. Both verification gaps named by the Point Defence
owner on `2d8d559` are now covered by passing headless tests on this HEAD.

## Questions for the Collisions & Breakup owner

1. **Kill credit.** A contact kill credits `shooter` = the other hull. If the
   player rams a ship, FlightScene therefore counts the reputation loss, the
   KillCam `kill` offer and a CombatHud "… DESTROYED" line as the player's
   doing. A capital-vs-capital ram credits each capital for the other. Is that
   intended, or should contact kills carry a `collision` cause with no shooter?
2. **Pre-window emitters.** Anything emitted between the tick-N 4c consumers
   and tick N+1's `beginTick` is discarded unseen. That span covers
   `updateAI`, `capitals.step`, `turrets.step`, `campaign.preStep` and
   `contracts.preStep`. No current path emits kill or subsystem events there
   (turret muzzle flashes are queued). Should this be written down as a rule
   for future pre-step code?
3. **Post-consumer emitters.** Two staging hooks call `fleet.hit` or
   `fleet.damage` after the 4a/4b mission consumers have run in the same
   tick: `?killcam=` staging in FlightScene 4b′, and `ContractDesk` `?rescue=`
   staging. Those deaths reach presentation and traffic, but never
   `runner.onKill` or the bookkeeping. Are they out of contract as
   capture-only paths?
4. **Default window.** Standalone `weapons.step(dt)` silently clears
   `contactHit` events emitted before it. Today only FlightScene and
   `determinism.ts` run contacts, and both use `beginTick`. Should
   `contactHit` assert or document that a caller must use `beginTick` +
   `step(dt, true)`?
5. **Pool policy (D1).** Should `kill`, `subsystem` and `reactor-*` events
   bypass the 384 cap, for example by growing the pool or reserving slots,
   rather than share it with `fire` and `hit` presentation events?

Question for the combat owner (not collisions): omnidirectional PD clusters
(`Capitals.ts` for `Loadout.pd`, and fitted `r.pd` in
`src/game/outfitting/turrets.ts`) still take the nearest threat and then check
the lead. A nearer threat that outruns the gun therefore still idles the
cluster. COMBAT_VERIFICATION.md records that this behaviour was kept on
purpose. Confirm it should remain so.
