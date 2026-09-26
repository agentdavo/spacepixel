# First-session route and Kessen cameo lifecycle: headless acceptance prep, 26 September 2026

Base: `7163537` on `codex/integrate-audit-trailer-combat-voices`. Tooling
`add1be7` and `8c791b2`, retry fix `0fe4f76`. Evidence was recorded on
`8c791b2`. **Everything here is headless CPU work.** No browser, WebGPU or
native capture was run, because the GPU is allocated to another team. The
native commands at the end are prepared but have not been run.

## Summary

- **An ordinary-input player can complete EP01, but only rarely.** Seed 22
  completes all six objectives in order and succeeds at **tick 5280
  (88.000 s)** with 15.9/110 hull. The fresh tape replays with **93/93**
  checkpoints matching and the same outcome tick. After that, dock, trade,
  refit, save, close and resume all pass: Episode 2 pending, 915 shares, the
  Mk II laser fitted, `story.ep1.done` recorded.
- **A first-time player cannot reasonably be expected to win EP01.** The
  same HUD-following pilot wins **1 of 100** seeds. A pilot that retreats to
  recharge its shields also wins **1 of 100**. The median survival after the
  cutters appear is 7.9 s and 14.4 s respectively. This is an acceptance
  finding for the mission owner. The mission was not changed.
- **A related defect:** in an episode, the wing-order keys are acknowledged
  but never reach the episode wingman. As a labelled counterfactual, giving
  Brother Oduya "engage at will" raises the win rate to 17/100 and 54/100.
- **Kessen cameos:** release timing, single release, disposal and
  jump/tunnel timing are correct in Episodes 10 and 19. Retrying on the same
  scene had a real defect: every ship from the previous attempt stayed
  alive. On an EP10 retry that meant 18 ships, and 2 of their deaths counted
  toward the retry's objective. `CampaignSession.dispose` now parks them.
  Four new lifecycle tests cover this. The retry test fails without the fix.

## Method and fidelity

`src/sim/episodeRoute.ts` builds FlightScene's world without a renderer:

- the Meridian start cast in FlightScene's spawn order, so entity ids and
  per-ship RNG streams match: player on a stock-fitted Kestrel from
  `newHangar`, free-flight wing, three bandits, Cathedral and carrier;
- `beginCampaign`'s system move, parking and EP01's stationary +Z start;
- the production `CampaignSession` spawn, set-piece, preStep, update and
  dispose methods, and the production `CampaignRunner`. Only the DOM radio
  and codex are replaced by silent stand-ins;
- the real `StarSystemView`, `HullCollisions` for stations, capitals and
  fighters, Lantern ring crossing, and FlightScene's jump phases and
  `arrive`.

Each tick follows the campaign branch of `FlightScene.simStep`. It leaves
out work that is presentation-only (particles, radio barks, kill-cam, audio)
or inert during an episode (traffic, contracts, guilds, rivals, salvage,
docking of the parked wing).

`src/sim/HudPilot.ts` is the only thing that flies the player. It sees:

- the mission marker, from the same `flightNavigation` call the HUD makes;
- the selected target box and its lead pip (`leadSpeedOf`, `intercept`);
- the lock ring;
- the shield, hull and boost bars.

It outputs the devices a player holds: a mouse virtual joystick, W/S, Shift,
Space, and edge presses of F and T. It builds `ControlState` exactly as
`Input.sample` does, with the same deadzone/expo curve and edges on the
first tick of a frame. It decides at 30 Hz, like the probe-mode capture
loop.

The pilot never writes flags, kills, positions, health or objectives. Its
policy is a plain novice one:

- fly to the marker at full throttle, boosting on long straight legs;
- press T until a hostile is boxed;
- aim at the lead pip and fire when the pip is within 0.06 rad and in range;
- press F every 3 s while locked;
- keep 70% throttle near the target.

The policy was not tuned until it passed. Its parameters are recorded in
each tape's header.

Limits:

- This is not a rendered or native run, and not a human playtest. No claim
  is made about control discovery, readability or feel.
- Whether the headless world stays bit-identical to the browser FlightScene
  has **not been checked**. The first native command below checks it.
- The career steps call the production `Profile`, `economy`, `hangar` and
  world functions against an in-memory `localStorage`, including a fresh
  module graph for "close and resume". This is not a UI or browser-storage
  proof. The 25 September native report already covers those for this
  route, and its method was unchanged by this work.

## A. EP01 by ordinary input

Reproduce with `npm run first-session-route`. Evidence is in
[reviews/first-session-2026-09-26](reviews/first-session-2026-09-26/):

- `route-output.txt`: 18/18 checks pass;
- `ep01-seed22.vgr`: 5,610 ticks, 5,507 bytes,
  SHA-256 `bd19d4b0f6553d5e955340f2039e1e1dd403b8c225f0342863abe7fc12c0b91c`;
- `ep01-seed22-result.json`: event log and statistics;
- `career-storage.json`: the saved career after the session.

| Stage | Tick | Time |
|---|---:|---:|
| Survey buoy 1 | 664 | 11.067 s |
| Survey buoy 2 | 1397 | 23.283 s |
| Survey buoy 3; `thieves` set, 3 cutters spawn 4 s later | 2241 | 37.350 s |
| Scav Cutter 1 / 2 / 3 destroyed by the player | 2725 / 3137 / 3425 | 45.417 / 52.283 / 57.083 s |
| Timetable beacon | 4393 | 73.217 s |
| Anchorage Yards: **success** | **5280** | **88.000 s** |

Other results from the seed 22 run:

- The player fired 136 gun shots and 36 missiles.
- There were no hull or station contacts and no Lantern crossing. The
  closest station was 10.3 km. At the Meridian gate plane the route stayed
  4.1 km from the ring axis.
- The tape's only command is `episode` at tick 0. Its header `boot` is the
  capture harness's default query with `seed=22`.

Career after success:

1. The debrief **Continue** step sets `profile.episode` from 1 to 2 and
   calls `episodeCompleted(1)`.
2. The player berths at the home Directorate station, `anchorage-bastion-0`,
   and `lastDock` is saved.
3. Buy one ration for 48, leaving 2,452 shares and 3 pallets. Sell it for 43,
   leaving 2,495 shares and 2 pallets.
4. Refit to `gun:gun = g-laser-mk2` in one atomic `saveCareer` write,
   leaving 915 shares.
5. Close and reopen with a fresh module graph over the same storage.
   Episode 2 pending, prologue seen, 915 shares, 2 pallets, same berth, same
   fit and `story.ep1.done` all persist.

### Difficulty: a first-time player loses EP01

From `node scripts/first-session-route.mjs --sweep 100` (`sweep-100.txt`),
seeds 1–100:

| Pilot policy | Wins | Median survival after the cutters appear | Mean cutters destroyed |
|---|---:|---:|---:|
| Charge: guns on the pip, missiles on lock | **1/100** (seed 22, 88.00 s) | 7.87 s | 1.05 |
| Retreat to recharge: break off below 50% shields, return above 95% | **1/100** (seed 13, 169.22 s) | 14.37 s | 0.28 |

The mechanism is the same in every trace. With `--trace` on seed 1994:

1. The three Rustwake Scrapjacks spawn about 1.6 km from the player.
2. Within about 0.8 s, two of them launch Harpoons, which hit 1.7 s later.
   Those hits collapse the Kestrel's fore shield (70 shield in two facings)
   and take 27 hull.
3. Two cutters then land 6-damage laser hits at about 12 per second each.
   From shield collapse to death takes 1.25 s.

Each Scrapjack has 200 hull and 30 shield, against the Kestrel's 110 and 70.
That is roughly 690 effective enemy HP against 180, with similar gun DPS.
Brother Oduya stays on `formUp` throughout and never fights.

The 25 September attended native attempt failed the same way: it died
16.6 s after reaching the third buoy. This is consistent with the CPU
result, but it is not a matched run.

**Wing-order defect, reported and not fixed.** In an episode, pressing 1–4
prints `VANGUARD 1 → WING: "ENGAGE AT WILL" · COPY, LEAD.` and plays the
radio acknowledgement. However, `FlightScene.onWingOrder` sends the order
only to the parked free-flight `wingmen`. The episode's wingman (EP01's
Candle) never receives it.

Counterfactual, **not ordinary-input evidence**:
`--sweep 100 --counterfactual candle-engage` gives Candle "engage at will"
at tick 0. Win rates rise to **17/100** (charge) and **54/100** (retreat).
See `sweep-100-counterfactual-candle-engage.txt`.

Options for the mission owner and the chief include:

- delivering wing orders to the episode wing;
- staggering the cutters or delaying their Harpoons;
- adding a combat marker or tutorial cue at `thieves`.

Choosing among these is a design decision. This work does not make it.

### Wing-order fix and re-measure

The chief fixed the wing-order defect. `CampaignSession` tracks its `wing`-role
ships. `FlightScene.onWingOrder` now also calls `campaign.orderWing(order)`, and
a story wingman joins on the lead's standing order. The headless route mirrors
FlightScene's 1–4 keys (`HeadlessFlight.simKey`). A pilot's wing key is stamped
on the take as a `key` command and replayed from the tape. The `HudPilot`
option `wingOrder` presses the key once, on the first HUD frame that shows a
hostile. That is ordinary input: one keypress the player can make.

Mission data and balance are unchanged. Existing tapes contain no wing keys,
so they are unaffected, and the seed-22 take still wins and replays exactly.

`node scripts/first-session-route.mjs --sweep 100`, seeds 1–100:

| Pilot policy | Wins | Median survival after the cutters appear | Mean cutters destroyed |
|---|---:|---:|---:|
| Charge (no order) | 1/100 | 7.87 s | 1.05 |
| Retreat to recharge (no order) | 1/100 | 14.37 s | 0.28 |
| Charge + **3 engage at will** | **75/100** | 14.65 s | 2.88 |
| Charge + 2 attack my target | 0/100 | 7.70 s | 1.17 |
| Retreat + **3 engage at will** | **83/100** | 17.47 s | 2.81 |

Key 2 is not broken. A trace of seed 5 shows Candle taking the order and
attacking the player's locked cutter. Focusing both ships on one cutter
leaves the other two free to kill the Kestrel. Key 3 lets Candle pick his
own target, which splits the cutters' attention.

EP01 is winnable once the player gives the wing an order, but nothing
in the episode tells the player to. The remaining design question is whether
EP01 should teach the order. For example, Candle could ask for "engage at
will" at `thieves`, or the objective text could mention the 3 key.

## B. Kessen cameos (Episodes 10 and 19)

Reproduce with `node scripts/kessen-cameo-route.mjs --fixture`. Output is in
`kessen-cameo-route.txt`.

| Check | Result |
|---|---|
| EP10 ordinary route: release | The Bastion's own `bastion-destroyed` flag is set at 97.033 s, and the cameo is released on the next tick, 97.050 s. The player is 12,388 m away, where the cameo projects to about 2.9 px at 1280×720 with the 58° chase field of view. It never appears before the flag. |
| EP10 lifeboat-stage visibility | **Not reached on CPU.** The HUD pilot dies to the strike wave (118 s at seed 1994). The accepted native staged approach clips remain the evidence for the lane view. |
| EP19 ordinary route | The cameo is present from tick 1 (0.017 s) at 4,918 m and about 7.6 px. The player comes within 59 m during the 20 s dwell, which completes at 44.217 s. The ordinary pilot then dies to the holdouts before the gate. |
| EP19 first jump (fixture: player plot armour, labelled) | The ring is crossed at 86.433 s. The system swap and `leg2` both happen at **88.617 s, in the `tunnel` phase** while the world is hidden. The cameo leaves the world root on that tick and never returns. |
| Disposal at session end (EP10) | No `setpiece:*` group is left under the world root. All geometry and materials the cameo owns are disposed. FrameKit's shared material is untouched, which the existing test also covers. |
| Retry on the same scene | The old cameo is removed and disposed. One new cameo is released at exactly the fresh attempt's mission time. In EP19 the witnesses are present once per attempt. |
| Runner-snapshot restore | Restoring after `bastion-destroyed` releases the cameo once, on the first update: its lane anchor is built in the same pass. EP19 restored before `leg2` has the witnesses. EP19 restored after `leg2` has none. Note that FlightScene does not currently restore campaign snapshots; only ContractDesk uses `restore`. |

**Defect demonstrated and fixed (`0fe4f76`).** `FlightScene.beginCampaign`
parks only the free-flight cast. A retry therefore left every ship from the
previous attempt alive:

- **EP10 retry after the Bastion fell:** 18 stale ships stayed in the fight,
  including a second Kade/Jackpot/Sparrow/Salt squad, lifeboats, Choir
  Strike, Psalters and both Cathedrals. 2 stale choir deaths were credited
  to the retry's intercept objective.
- **EP19 retry:** 2 stale ships (Kade and Sparrow).

`CampaignSession.dispose()` now parks the ships its runner tagged, the same
way the free-flight cast is parked. After the fix, 0 stale ships remain and
0 stale kills are credited. The cameos and mission outcomes are otherwise
unchanged, and the existing cameo equivalence tests still pass. Wrecks from
the previous attempt in the same system were not examined.

**Authoring observations, no change made.** EP10 and EP19 have no authored
objective navigation. The HUD therefore shows the generic nearest-gate
marker. In the fixture run, following it for "Jump again" jumped straight
back to Meridian, and that satisfies `jumps >= 2`.

## Tests and validation (source `8c791b2`)

- `npm test`: **402 passed, 0 failed**. This includes 6 new tests: 2 in
  `tests/first-session-route.test.ts` and 4 in
  `tests/kessen-cameo-lifecycle.test.ts`.
- `npm run typecheck` passes.
- `npm run build` passes, including both content validators and the Vite
  production build.
- Not run, because they need a browser: `flow-check`, `career-check` and any
  capture scripts.

## Native commands for the later recorded run

Run these from the repository root at the integrated commit, one GPU capture
at a time. Use a new `--out` directory for every run. These commands have
**not** been run.

1. **Replay the headless tape natively.** If it matches, the native run is a
   formality. A desynchronization is also informative: it measures the gap
   between the headless world and FlightScene. It is not an EP01 failure.

   ```sh
   node scripts/objective-navigation-proof.mjs --scenario route --replay docs/reviews/first-session-2026-09-26/ep01-seed22.vgr --replay-from-start --seconds 93.5 --probe --port 5444 --out scratchpad/first-session-native/ep01-headless-tape-replay
   ```

   The harness itself throws if `desyncAt >= 0`. If it passes, all 93
   checkpoints matched and the success at 88.000 s was reproduced natively.

2. **Record a fresh native take with the same HUD-only pilot, using real
   mouse and keyboard events:**

   ```sh
   node scripts/objective-navigation-proof.mjs --scenario route --episode ep01-the-long-dark --hud-pilot --query seed=22 --seconds 120 --probe --port 5444 --out scratchpad/first-session-native/ep01-take-1
   ```

   If the native world differs from the headless one, this is a new attempt
   at the roughly 1% win rate above. In that case, report a loss as it
   happened rather than retrying seeds until one passes.

3. **Replay that take from tick 0.** Use `ticks / 60` from `take.vgr` as
   `--seconds`:

   ```sh
   node scripts/objective-navigation-proof.mjs --scenario route --replay scratchpad/first-session-native/ep01-take-1/take.vgr --replay-from-start --seconds <ticks/60> --probe --port 5444 --out scratchpad/first-session-native/ep01-replay-1
   ```

4. **Run the career part through the normal UI.** Follow the 25 September
   method: fresh isolated Edge profile, `npm run dev`, title → Launch →
   EP01 → debrief **Continue**, then berth, market buy/sell, refit, close,
   and reopen the same profile. After EP01 succeeds, confirm that
   `vanguard.profile.v1` has `episode: 2`.

## Files

- `src/sim/HudPilot.ts`: the HUD-only pilot.
- `src/sim/episodeRoute.ts`: the headless FlightScene world, `runEpisode`,
  `hudViewOf` and `pilotView`.
- `scripts/first-session-route.mjs`: the EP01 route, tape, replay, career
  and sweep.
- `scripts/kessen-cameo-route.mjs`: cameo timing.
- `scripts/objective-navigation-proof.mjs`: adds `--hud-pilot`.
- `src/game/CampaignSession.ts`: the retry fix.
- `tests/first-session-route.test.ts` and
  `tests/kessen-cameo-lifecycle.test.ts`.
