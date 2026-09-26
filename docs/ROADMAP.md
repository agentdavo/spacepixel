# Roadmap

## Current checkpoint — 25 September 2026

Audited default branch: `claude/vanguard-space-combat-0l3bfi` at `72ced42`.
PRs #1–#4 are merged: batch 6 combat, Kessen models/viewer, gameplay polish,
and soundtrack/recorded voices. Older pending-PR and ownership notes below
are historical. See [the continuation audit](AUDIT-2026-09-25.md) for branch
ancestry, verified checks and remaining gaps.

The revised **720p MP4 trailer (V2)** is delivered with native WebGPU,
Symphony of Gates, recorded voices and captured combat audio. Point defence,
voice tooling and V2 trailer changes are integrated locally on
`codex/integrate-audit-trailer-combat-voices`: 301 tests, build, balance,
ten-minute determinism, AI sim and voice coverage pass. Native WebGPU
[capital](screenshots/integration-2026-09-25/capital.jpg) and
[broadside](screenshots/integration-2026-09-25/broadside.jpg) samples were
captured from the combined code. These changes are not yet on the remote default.
The user's original 20 technical milestones followed by the 20-episode story
remain the mandate; Kessen are **cameos first** in Episodes 10/19. General
faction expansion, boarding, consists and the side arc are deferred.
See [GAME-DIRECTION.md](GAME-DIRECTION.md) for the chief architect's decisions.
Existing completion marks describe implementation; live experience and
performance verification must be recorded separately.

First-session follow-up (`2c284ab`): fixed EP01's missing waypoint markers and
unintended opening gate transit; 303 tests and build pass. Normal-control
survey flight, UI trade/refit, manual redocking and native-profile save/resume
have been exercised. The run used failure recovery after an unattended combat
loss; successful EP01 completion is still an acceptance gap. See the
[first-session report and screenshots](FIRST-SESSION-2026-09-25.md).
Trailer V2 remains the current review artifact; the chief's
[editorial review](TRAILER_EDITORIAL_REVIEW.md) records pending voice/script work.

The chief has now accepted and activated the **EP10/19 Kessen environmental
cameos** on this local integration branch. Combined validation: 308 tests/build
and native WebGPU default-on versus `kessenCameos=0` comparisons pass, including
mission progress and navigation. They add no combat, collision, economy or save
mechanics. See [cameo evidence](KESSEN-CAMEO-PREVIEW.md) for timing, motion
provenance and the 108.4 m lifeboat clearance check.

Guiding rules (after Carmack): one ship flying well first; performance and
latency measured from day one with pass/fail numbers; camera-relative
rendering designed in; direct code over architecture; strict TypeScript;
lore last.

Scale rule: space is huge — lay it out in kilometres. Physics runs in
metres, but anything placed in the world (strata, belts, set pieces,
spawn rings, HUD ranges) is thought of in 1 km steps.

## Batch 1 — engine & game (first versions: all in)

| # | Milestone | Status | Where |
|---|---|---|---|
| 1 | WebGPU renderer bootstrap | ✅ | `src/render/RendererFactory.ts`, `src/core/Engine.ts` |
| 2 | Asset pipeline + cel material | ✅ | `src/assets/*`, `src/render/materials/CelMaterial.ts` |
| 3 | WGSL ink-line pass | ✅ | `src/render/post/shaders/inkEdge.wgsl.ts` |
| 4 | Flight physics, inertia, afterburner, cruise | ✅ | `src/sim/FlightModel.ts` |
| 5 | Spring chase camera, velocity zoom | ✅ | `src/sim/ChaseCamera.ts` |
| 6 | Cutaways & target-lock views | ✅ | `src/sim/CameraDirector.ts` |
| 7–9 | Fighters → carriers → dreadnoughts (11 designs, articulated) | ✅ | `src/assets/blueprints/*`, `?scene=hangar` |
| 10 | Lasers, beams, impacts, shields | ✅ | `src/sim/Weapons.ts`, `src/world/WeaponVisuals.ts` |
| 11 | Micro-missile swarms, lock HUD | ✅ | `src/sim/Missiles.ts`, `src/ui/FlightHud.ts` |
| 12 | GPU compute particles | ✅ | `src/fx/*`, `?scene=fx` |
| 13 | Wingman AI, formations, orders | ✅ | `src/sim/ai/Squadron.ts` |
| 14 | Enemy AI, maneuvers, turrets | ✅ | `src/sim/ai/*`, `npm run ai-sim` |
| 15 | Universe + star map | ✅ | `src/universe/*`, `src/ui/StarMap.ts` |
| 16 | Lantern jumps + hyperspace | ✅ | `src/world/Hyperspace.ts` |
| 17 | Tactical view + fleet command | ✅ | Tab in flight |
| 18 | Missions & objectives | ✅ | `src/game/*` |
| 19 | CRT HUD, title, briefing | ✅ | `src/ui/Screens.ts` |
| 20 | Perf: budgets, latency, dynamic resolution | ✅ (ongoing) | `src/core/Perf.ts`, `npm run perf` |

Docking & trade: seeded stations per system (refinery, salvage yard,
bastion, free port, orbital port), friendly carrier hangars, ILS approach +
auto-dock cutaway, docked market / repair / rearm / rumours, persisted
ledger (`src/game/economy.ts`, `src/world/Docking.ts`, `src/ui/DockScreen.ts`).
Hollow hangar bays with an atmosphere curtain (`src/assets/blueprints/bays.ts`,
`src/world/BayCurtain.ts`), hull collisions + AI avoidance from blueprint
proxies (`src/sim/Collision.ts`, `npm run ai-sim` station scenarios), wingmen
hold off the corridor (`src/world/WingDocking.ts`), balanced trade with
hazard premiums (`npm run econ-sim`).

Spatial depth: space dust streaks, asteroid belts, haze lanes (`?scene=spatial`),
and a **multiplane sky** — Disney's multiplane camera rebuilt for 6DOF: 16
painted cel strata, one per kilometre (`?planes=0|16|32`,
`src/world/MultiplaneSky.ts`). CPU cost is flat (p50 0.6 → 0.7 ms at 32 strata); GPU cost still to be measured on real hardware.

![Multiplane strata](screenshots/multiplane-16km.jpg)

## Batch 2 — narrative (in progress)

Canon: the Shattering, fossil technology, Terran Directorate vs Zenith
Hegemony, the Ebon-gas monopoly, the Signal, the Builders and the
compression wave. See `docs/LORE.md` and `docs/CAMPAIGN.md`.

| Chapter | Milestones | Delivery |
|---|---|---|
| I · The Myth and the Machine | 1–5 | codex, briefings, patrol logs, environmental storytelling |
| II · The Spark and the Frying Pan | 6–10 | missions: border skirmish, black box, ghost ship, fall of the Bastion |
| III · Into the Deep Void | 11–15 | Dead Zone nebula, the Monolith, the Oracle broadcast, the schism, siege of the Nexus |
| IV · The Epic Resolution | 16–20 | solo pilgrimage, the Zenith revelation, the key, the symphony of gates, the open horizon |

Systems: data contract `src/game/campaign/types.ts`, runtime
`src/game/CampaignRunner.ts` (tested: `npm test`), radio chatter with
procedural anime portraits, codex, eyecatches, narrative set pieces.

## Batch 3 — presentation, the frontier, the shared Reach

The campaign's chapters I–IV are the first four game chapters. Batch 3
opens the Reach up around them and gets the game in front of players.

| # | Milestone | Pass/fail | Status |
|---|---|---|---|
| 1 | **Prologue** — 60 s scripted cold open: the gates, the Shattering, the Lanterns, two powers, the Signal (`?scene=prologue`) | plays at budget, skippable, first launch only (`npm run flow-check`) | ✅ |
| 2 | Cinema sequencer — timeline of shots, captions, cues (shared by prologue, cutscenes, trailer) | a shot list is data only (`src/cinema`) | ✅ |
| 3 | Attract mode / trailer — title idles into the prologue and the 90 s trailer (`?scene=trailer`), alternating; any input returns | runs unattended 10 min (`npm run attract-check`: GPU objects / heap / DOM flat cycle to cycle) | ✅ trailer + attract loop; live AI demo flight not yet |
| 4 | Photo mode + clip capture (headless webm/GIF from recorded input) | 1080p clip from a replay | 🔧 photo mode (F10 freeze / orbit / PNG); clips = `record.mjs` frame-stepped ranges → `make-video.mjs` (H.264 + soundtrack); from a replay waits on 14 |
| 5 | **Stations** — refineries, salvage yards, bastions, free ports, 1–3 per system | seeded, on star map | ✅ |
| 5b | **Living Reach** — painted planets (giants, terrestrial, volcanic, burning, Lantern-lit), moons, shattered moons, fly-through rings; timetable traffic, patrol wings, raider ambushes, arrivals flashes | seeded & deterministic, stations/gates untouched (`tests/reach.test.ts`) | 🔧 |
| 6 | **Docking** — request within 5 km, ILS corridor, auto-dock under 1 km, launch | hostiles within 10 km block it | ✅ |
| 7 | **Trade** — commodities, supply/demand per station, cargo, credits | pure, unit-tested economy; `npm run econ-sim` bands (safe 1.5–4k / hold, risky ≤ 9k) | ✅ |
| 8 | Repair, rearm, reputation per faction | persists in profile | ✅ |
| 9 | Planetary ports — orbital elevators / descent corridor to the surface port | seamless approach, no load screen | ✅ landing corridor → entry → cloud punch-through → local surface scene (world-root swap under the whiteout) → pad; `surface` station kind; every hull size docks (clamp gantries, moorings, carriers alongside) (`src/world/surface`, `src/world/berths`) |
| 10 | Contracts board — courier, escort, bounty jobs generated from station state | uses the campaign runner | ✅ 8 kinds, seeded boards, runner-driven ops (`src/game/contracts`) |
| 11 | Free-roam between episodes — the Reach stays open, episodes start from a station | save/resume anywhere docked | ✅ debrief → free flight → priority orders; title CONTINUE |
| 12 | Ship upgrades & hangar — guns, missiles, shields, engines; livery shop | visible on the model | ✅ |
| 13 | **MP-0 determinism** — fixed 60 Hz step, seeded RNG, sim/render split | bit-identical 10 min replay | ✅ `npm run determinism`: dogfight · capital battle · traffic ambush, 600/600 checkpoints each, recorded input replays to the bit; 0 `Math.random` in the sim |
| 14 | Replays + kill-cam from recorded input | replay matches live | ✅ always-on recorder, O saves a clip, `?replay=auto\|clip-N\|<url>` (SYNC checkpoints; `scripts/replay-check.mjs`), kill-cam on death / capital / bounty kills |
| 15 | Headless shard (Node) + bot clients | 200 ships < 8 ms tick | |
| 16 | Two-browser flight: prediction, interpolation, lag-compensated hits | < 2 m error at 150 ms RTT | |
| 17 | Lantern jump = shard handoff | < 3 s inside the tunnel | |
| 18 | Persistent economy + faction front on the star map | server-authoritative | |
| 19 | Co-op campaign (up to 4) | episodes playable with 2 | |
| 20 | Public playtest build + landing page | 100 concurrent | |

Design for 13–20: [docs/MULTIPLAYER.md](MULTIPLAYER.md) (MP-0 as built: fixed
step + render prediction, RNG streams, replay format, kill-cam, what still
couples).

![Kill-cam](screenshots/replay-killcam.jpg)

## Batch 4 — the hero's career (first versions: all in)

From a borrowed Kestrel to your own frigate: earn shares and standing, refit,
buy the next hull, take on bigger adversaries.

| # | Milestone | Pass/fail | Status |
|---|---|---|---|
| 1 | Per-ship stats, faction weapon families, damage types | Kestrel vs Cantor TTK 3–8 s | ✅ |
| 2 | Locational damage: capital subsystems, fighter zones, visible damage | subsystem effects felt | ✅ |
| 3 | Directional shields, collapse/regen visuals | facings on HUD | ✅ |
| 4 | Progression line T1→T6: Kestrel → heavy fighter → gunship → corvette → frigate | each tier flyable | ✅ |
| 5 | Rustwake line, civilian freighters/tankers/liners, mid-tier warships | in hangar | ✅ |
| 6 | Shipyard + outfitting (hardpoints, shields, armour, engines, reactor) | fit changes stats & model | ✅ `src/game/outfitting`, SHIPYARD / OUTFITTING dock tabs, turrets fire, `npm run balance` *outfit* |
| 7 | Contracts board: courier, haul, escort, bounty, patrol, salvage, recon, sorties | seeded, tested | ✅ |
| 8 | Free-roam career loop between episodes | story resumes on demand | ✅ |
| 9 | Living Reach: ringed giants, moons, city lights, traffic lanes, patrols, pirates | perf budget holds | ✅ |
| 10 | People: concourse NPCs, branching dialog, rumours | ≥ 12 conversations | ✅ |
| 11 | Voices: recorded Piper cast with procedural fallback and optional Web Speech; subtitles | < 17 chars/s | 🔧 placeholder coverage and portable recording repaired on local integration branch (1,631 current lines covered); listening/live subtitle timing still needs review |
| 12 | Hollow hangar bays, collisions, economy rebalance | next ship in 30–60 min | ✅ |
### Combat depth ✅

| Piece | Pass/fail | Where |
|---|---|---|
| Ship stats per design (hull, shields, regen/delay, mass, agility, speed, signature) | table covers all 11 designs (`npm test`) | `src/sim/Loadouts.ts` |
| Weapon families + loadouts; R / Y cycle guns and missiles | damage-type ratios (`npm run balance`) | `Loadouts.ts`, `Weapons.ts`, `Missiles.ts` |
| Capital subsystems with effects; B sub-targets | turret to a wing of 4: 5–15 s | `src/sim/Damage.ts`, `Combat.ts`, `Capitals.ts` |
| Fighter damage zones (thrust, roll drift, smoke) | unit-tested routing | `Damage.ts`, `src/world/DamageFx.ts` |
| Directional capital shields, collapse / regen visuals | facing routing unit-tested | `WeaponVisuals.ts`, `CombatFx.ts` |
| Balance | Kestrel vs Cantor 3–8 s · capital to a squadron 60–180 s · Mk III Resolute vs Lantern Guard 60–120 s / 30–80 % hull · Mk III Valiant vs Vesper 45–120 s / 30–80 % hull · stock Resolute beats a Lantern Guard narrowly (5–35 % hull) · stock Valiant vs Vesper 15–40 % hull · PD thins swarms | `npm run balance` |

![Shield facing collapse](screenshots/combat-shield.jpg)

## Batch 5 — allegiance & a Reach that remembers (first versions: all in)

The sandbox and the story start talking to each other. One shared memory,
`src/game/world/WorldState.ts` (facts, counters, decaying per-system/station
modifiers, an event log), is read and written by everything below.

| # | Milestone | Pass/fail | Status |
|---|---|---|---|
| 1 | Guilds: Order of the Keeping, Office of Continuity, Board of Allocation, Rustwake clans, Ascendant Houses — halls, ranks, quartermasters, guild contracts | a rank-up in ~45 min of guild work | ✅ `src/game/guilds`, GUILD HALL dock tab, Mk V quartermaster stock, conflicts, dues (`tests/guilds.test.ts`) |
| 2 | Guild arc missions (hand-written, 3–5 per guild) and conflicting loyalties | arcs complete end to end | ✅ 20 missions, each flown end to end in the runner; five finale choices write world facts |
| 3 | Outposts: restore a hulk as your guild's base | build → upgrade → defend | ✅ `src/game/outposts`: six stages, dockable from stage 2, raids as defence contracts |
| 4 | World state driven by story flags and player actions: prices, traffic, patrols, station attitude | effects visible within one session | ✅ `src/game/world/sim.ts`: STORY_RULES (20 episodes), deeds (ambushes, kills, trading, contracts), ~4 background events/h; readers on prices, tariffs, berths, lanes, boards, ticker; econ-sim world scenarios pass |
| 5 | The Schedule on the star map: fixed engagements to fly or break | breaking one has consequences | ✅ `schedule.ts` + `ui/ScheduleOverlay.ts`: seeded quarterly Schedule, staged op (fly as ordered / kill the conductor / refuse to withdraw); broken → Ebon +25 %, Continuity hostile, correction next quarter |
| 6 | The Signal countdown between chapters | visible, advances with the story | ✅ `signal.ts` + `ui/SignalCounter.ts`: pinned to each debrief, a prime per 15 min of free flight, Breath ETA after Ep 13, stops at 2, counts up; map, HUD, title, intercept banners |
| 7 | Persistent NPC arcs that advance while you're away | ≥ 6 arcs | ✅ 7 arcs (Odile, Magpie, Pell, Nadia, Toma, Dalca & Pieter, Maud), 7 arc jobs, THREADS tab |
| 8 | Rivals: named aces and bounty targets that remember and escalate | ≥ 5 rivals | ✅ 6 rivals (2 can be turned), grudge meters, tiers, world-log memory in their lines |

## Batch 6 — guns you can see, shields you can break, ships that die well (PR #1 merged; remaining QA and station work below)

| # | Milestone | Pass/fail | Status |
|---|---|---|---|
| 1 | Articulated turret rigs on every turreted hull and station: traverse/elevation limits and rates, own-hull arc blocking, recoil | turrets slew before they fire; determinism holds | ✅ 87 mounts / 17 designs rigged traverse + elevation (`src/sim/TurretRig.ts`); size-scaled slew, per-mount arcs masked by superstructure, 2° fire gate, idle scan, recoil, wreck pose · `tests/turret-rig.test.ts` |
| 2 | Identifiable origins: every bolt, beam and missile leaves a barrel, emitter or launcher cell (muzzle flash, hatches, tubes) | no shot from a hull centre | ✅ bolts leave alternating barrel tips, beams the emitter tip, missiles/torpedoes their launcher sockets; muzzle flashes scale per mount; trailer / prologue broadsides from the barrels (`src/cinema/gunnery.ts`) |
| 3 | Shields v2: fighter fore/aft with power shifting; big hulls by facing incl. dorsal/ventral; generators per facing; bleed-through; collapse and reboot | unit-tested; balance bands hold | ✅ fighters fore/aft, capitals 4 / 6 facings (dorsal/ventral), trim `.` `,` `/` AUTO with lossy transfer, per-facing emitters, bleed below 15 %, collapse cooldown, explosive splash · `tests/combat.test.ts` |
| 4 | Impacts: faction shield flares (hex / crystal / scrap), collapse shatter; hull hits per weapon family (scorch, sparks, shatter, craters, trenches) with persistent decals and per-surface audio | readable at chase distance | 🔧 faction shells (Concord hex, Choir crystal facets, Rustwake holed scrap plates; `stage=impacts&faction=`) with ripples per facing (strength-driven, harmonic crackle), collapse shatter, regen sweep, beam splash; hull hits per damage type; ship-local cooling hull marks + beam cut lines (`src/world/ImpactDecals.ts`); subsystem blasts + fire columns. impact sounds by damage type, shield return, mount blasts. Left: on-screen check of hull marks, tuning |
| 5 | Subsystems v2: everything targetable once its facing is down (turrets, launchers, lances, PD, engines, generators, bridge, sensors, hangars, reactor; station batteries and arms) | exposure rules tested | 🔧 exposure by facing, hit spheres before plating, B / Shift+B / I pick, torpedo blast splash (70 % cap), hangar cook-offs, damage control, AI strips mounts (bombers → emitters/gen/engines), brackets + kill feed + barks · `tests/subsystems.test.ts`. Reactor (brownout below half: slower regen, fire and lances; destroyed → CRITICAL), sensors (lock range and coordination), launchers (no salvoes); bridge and reactor are citadels (no splash); blown / drooped mount wrecks. Station batteries: the bastion's six mounts are sim turrets on the capitals' machinery (`src/sim/StationDefence.ts`: TurretRig drive + fire gate, ai/Turret targeting, `turret` subsystems under six station shield facings, aimed hits through `Fleet.installations`, damage control; silenced, never destroyed; free-flight ROE holds fire until fired on or its side is attacked) · `tests/station-batteries.test.ts`, determinism `station` scenario. Left: player lock / B-cycle and HUD brackets on station batteries (stations aren't ShipEntities), missiles and beams vs stations, docking arms / comms from the lead's model, native look at the posed batteries |
| 6 | Kill paths: structural break-up, reactor detonation, bridge kill (drifting wreck), rolling chain; wrecks stay as salvage | each path in `npm run balance` bands | ✅ bow / midships / stern sections (`src/sim/Structure.ts`): rake the spine → broken in two (two burning pieces); core destroyed → CRITICAL fuse vs crew venting, hits near the core set the vent back → detonation (flash, shockwave that damages ships it crosses, one charred piece); bridge gone under 35 % hull → she strikes and drifts dark whole; hull depletion → rolling chain, three sections. Wrecks persist as salvage (`src/game/salvage.ts`), cleared on jumps. HUD keel bars + callouts, blown gun houses, debris (`src/world/DestructionFx.ts`, `src/world/destruction/`), `stage=kill&path=…` · `npm run balance` killpath · `tests/destruction.test.ts` |

## Known issues

- WebGL2 fallback lines are softer than the WGSL path.
- Large flat hulls (carrier deck) catch the rim light at grazing angles;
  a screen-space silhouette rim would fix it.
- SwiftShader timings are meaningless in absolute terms: run `npm run perf`
  on real hardware. Relative A/B needs a quiet machine and frame-stepped
  timing (`npm run perf -- --stepped --query 'planetlod=0&…'`); on the
  shared box run-to-run drift is ±25 %.
- Planet LOD savings are unmeasured on real hardware (the shared SwiftShader
  box's load swamps the A/B); run the `--stepped` A/B above on a GPU.
- Planet LOD switches compile the mid / far surface pipeline the first time a
  body crosses a threshold (a one-off hitch per body kind); prewarming them
  with `compileAsync` at system load would hide it.
- Label declutter hides low-priority labels when the screen is crowded (by
  design: the lowest priorities fade out first).
- Bay dust fades only for the docking target / nearest bay: a camera parked
  in another ship's hangar (cutaways of wingmen) still sees streaks.

Fixed in the edges pass (`docs/screenshots/edges-*.jpg`):

- **Hangar bays** — streaks across bay interiors were the space dust (motes
  between the camera and the dark liners, streaked by the host's cruise);
  it now fades out down the corridor and inside the bay (`src/world/BayDust.ts`).
  The bright collar / deck near the carrier mouth was bloom from the lip,
  door outline and the curtain's wide edge glow; all three toned down.
- **Label declutter** — one placement pass for every world-space label
  (`src/ui/HudLabels.ts`, pure packer `src/ui/labelPlacement.ts`, tested).
- **Edge arrows** — off-screen target, nav, contract and distress arrows share
  one track inset round the screen edge and are packed before the labels
  (`HudLabels.edge()`, pure packer `src/ui/edgePlacement.ts`, tested): true
  spot where the ray from the centre crosses the track, priority order,
  bounded slides, HUD panels pushed clear of, same-kind collisions folded
  into one arrow with a ×N badge, target and nav pinned, eased movement and
  per-arrow hysteresis. The target arrow pointed the wrong way for ships
  behind the camera (its angle came from the projected point); fixed. The
  arrivals board now sits under the nav diamond, one ring out at most
  (`docs/screenshots/edge-arrows-*.jpg`).
- **Planet shader LOD** — full / mid / far impostor by disc size
  (`src/world/planets/lod.ts`, tested). Per pixel, a terrestrial world with
  clouds and cities drops from 16 fBm octaves (+ cell noise; + Worley on
  cratered / Lantern kinds) at full detail to 10 at mid and 2 in the far
  impostor (40×20 sphere instead of 128×64). Measured with
  `npm run perf -- --stepped --query 'planetlod=N&reach=body&dist=12'` on
  the shared SwiftShader box (load ≈ 45): disc filling a 640×360 frame,
  full 6.1 / 6.3 / 4.6 s per frame over three runs, mid 5.2, far 5.0 — the
  run-to-run drift (±25 %) swamps the difference; needs a real GPU.
- **Balance** — corvette main batteries, PD cadence and clusters, shootable
  micro-missiles; Resolute Mk III vs Lantern Guard ~78 s / 49 % hull, Valiant
  Mk III vs Vesper ~68 s / 52 % hull, swarm vs PD bands (`npm run balance`);
  Cantor shield 80 → 95 brings the 96-seed dogfight sweep from 69 % to 53 %
  Concord (`npm run ai-sim`). Directional shields (fore / aft halves on
  fighters, 4 / 6 facings with emitters on capitals, trim + transfer, bleed,
  collapse cooldown) pushed it to 74 %; the Choral ward (Cantor shield 110,
  1.5× transfer) brings it back to 54 % (51 % with the turret rigs merged).
  With both: Resolute Mk III vs Lantern Guard ~74 s / 43 % hull, Valiant
  Mk III vs Vesper ~78 s / 44 %.
- **Stock warship fits** — an all-Mk I Resolute lost a solo duel with a
  Lantern Guard (0 % hull) and a stock Valiant scraped past a Vesper with
  ~18 % hull. Both now leave the yard with Mk II kit (`STOCK_OVERRIDE` in
  `src/game/outfitting/fit.ts`): Resolute Mk II mounts, driver, torpedoes,
  shield and plate; Valiant Mk II rail mounts and shield. Utility ratios are
  now taken against the Mk I stock item (`baselineFit`), so the Mk II kit
  counts. Mk II alone doesn't save the Resolute (the picket's PD takes
  nearly every Mk I/II torpedo), so its catalogue hull goes 3000 → 4500.
  Stock Resolute vs Lantern Guard ~110 s / ~22 % hull (band 5–35 %, 6 of 6
  seeds; 12 of 12 on a wider sweep at ~32 %), stock Valiant vs Vesper ~81 s /
  ~24 % hull (band 15–40 %). Mk III Resolute now ~78 s / ~66 % hull (was
  49 %, band 30–80 % unchanged); Mk III Valiant unchanged.
- **Valiant bridge camera** — eye 0.16 L above / 0.08 L behind the bridge over
  a forward battery; the mounts sit in the bottom sixth (tested).
- **Bow view** — V on a bridge hull goes bridge → bow → lock → …: the eye
  sits on the foredeck forward of the bow battery's full traverse, so mounts
  training up overhead stay behind the camera (`bowFraming` in
  `src/game/shipyard/flight.ts`, tested; `docs/screenshots/bow-view-*.jpg`).
- **Hires** — Magpie (wing) and Brennick (−30 % repairs) verified end to end
  by `npm run career-check` (new profile → free flight → hires → contract →
  launch → formation + fight → dock → repair → shipyard → reload).

- **Replay tapes** — guild hall, outpost and conversation changes used to
  put the whole WorldState on the tape (a few KB each); they are now a
  `world-patch` with only what changed (facts, counters, mods, clock, the
  log's new tail; `src/game/world/diff.ts`, tested). Older tapes' `world`
  commands still play. `node scripts/replay-check.mjs --dock` compares the world
  at the end of record and playback.
