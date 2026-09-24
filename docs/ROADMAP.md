# Roadmap

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
| 11 | Voices: procedural OVA voice synth (+ optional Web Speech), subtitles everywhere | < 17 chars/s | ✅ |
| 12 | Hollow hangar bays, collisions, economy rebalance | next ship in 30–60 min | ✅ |
### Combat depth ✅

| Piece | Pass/fail | Where |
|---|---|---|
| Ship stats per design (hull, shields, regen/delay, mass, agility, speed, signature) | table covers all 11 designs (`npm test`) | `src/sim/Loadouts.ts` |
| Weapon families + loadouts; R / Y cycle guns and missiles | damage-type ratios (`npm run balance`) | `Loadouts.ts`, `Weapons.ts`, `Missiles.ts` |
| Capital subsystems with effects; B sub-targets | turret to a wing of 4: 5–15 s | `src/sim/Damage.ts`, `Combat.ts`, `Capitals.ts` |
| Fighter damage zones (thrust, roll drift, smoke) | unit-tested routing | `Damage.ts`, `src/world/DamageFx.ts` |
| Directional capital shields, collapse / regen visuals | facing routing unit-tested | `WeaponVisuals.ts`, `CombatFx.ts` |
| Balance | Kestrel vs Cantor 3–8 s · capital to a squadron 60–180 s · Mk III Resolute vs Lantern Guard 60–120 s / 30–80 % hull · Mk III Valiant vs Vesper 45–120 s / 30–80 % hull · PD thins swarms | `npm run balance` |

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

## Batch 6 — guns you can see, shields you can break, ships that die well (carried by the batch 6 project thread on `claude/project-thread-dl05kd`, draft PR #1; see docs/SESSIONS.md)

| # | Milestone | Pass/fail | Status |
|---|---|---|---|
| 1 | Articulated turret rigs on every turreted hull and station: traverse/elevation limits and rates, own-hull arc blocking, recoil | turrets slew before they fire; determinism holds | ✅ 87 mounts / 17 designs rigged traverse + elevation (`src/sim/TurretRig.ts`); size-scaled slew, per-mount arcs masked by superstructure, 2° fire gate, idle scan, recoil, wreck pose · `tests/turret-rig.test.ts` |
| 2 | Identifiable origins: every bolt, beam and missile leaves a barrel, emitter or launcher cell (muzzle flash, hatches, tubes) | no shot from a hull centre | ✅ bolts leave alternating barrel tips, beams the emitter tip, missiles/torpedoes their launcher sockets; muzzle flashes scale per mount; trailer / prologue broadsides from the barrels (`src/cinema/gunnery.ts`) |
| 3 | Shields v2: fighter fore/aft with power shifting; big hulls by facing incl. dorsal/ventral; generators per facing; bleed-through; collapse and reboot | unit-tested; balance bands hold | ✅ fighters fore/aft, capitals 4 / 6 facings (dorsal/ventral), trim `.` `,` `/` AUTO with lossy transfer, per-facing emitters, bleed below 15 %, collapse cooldown, explosive splash · `tests/combat.test.ts` |
| 4 | Impacts: faction shield flares (hex / crystal / scrap), collapse shatter; hull hits per weapon family (scorch, sparks, shatter, craters, trenches) with persistent decals and per-surface audio | readable at chase distance | 🔧 hex shield-shell ripples per facing (strength-driven, harmonic crackle), collapse shatter, regen sweep, beam splash; hull hits per damage type; ship-local cooling hull marks + beam cut lines (`src/world/ImpactDecals.ts`); subsystem blasts + fire columns. impact sounds by damage type, shield return, mount blasts. Left: on-screen check of hull marks, tuning; faction-specific shell styles (crystal / scrap) |
| 5 | Subsystems v2: everything targetable once its facing is down (turrets, launchers, lances, PD, engines, generators, bridge, sensors, hangars, reactor; station batteries and arms) | exposure rules tested | 🔧 exposure by facing, hit spheres before plating, B / Shift+B / I pick, torpedo blast splash (70 % cap), hangar cook-offs, damage control, AI strips mounts (bombers → emitters/gen/engines), brackets + kill feed + barks · `tests/subsystems.test.ts`. Reactor (brownout below half: slower regen, fire and lances; destroyed → CRITICAL), sensors (lock range and coordination), launchers (no salvoes); bridge and reactor are citadels (no splash); blown / drooped mount wrecks. Left: station batteries (bastion has no sim turrets; the lead's `StationDefence` model is unwired and not ported) |
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
- Label declutter hides low-priority labels when the screen is crowded; the
  arrivals board can end up two rings out from the Lantern on a leader line.
  Off-screen edge arrows (target, nav, contracts, distress) are not packed yet.
- The bridge camera rides high over a forward battery; turrets training up at
  a target overhead still poke their barrels into the bottom of the frame
  (by design — it's the Yamato shot — but a bow-view toggle would help).
- Bay dust fades only for the docking target / nearest bay: a camera parked
  in another ship's hangar (cutaways of wingmen) still sees streaks.
- A stock (unfitted) Resolute loses a solo duel with a Lantern Guard (a stock
  Valiant scrapes past a Vesper with ~18 % hull; `npm run balance` INFO
  lines): fitting out is the intended answer, but the first T5 sortie can
  surprise.

Fixed in the edges pass (`docs/screenshots/edges-*.jpg`):

- **Hangar bays** — streaks across bay interiors were the space dust (motes
  between the camera and the dark liners, streaked by the host's cruise);
  it now fades out down the corridor and inside the bay (`src/world/BayDust.ts`).
  The bright collar / deck near the carrier mouth was bloom from the lip,
  door outline and the curtain's wide edge glow; all three toned down.
- **Label declutter** — one placement pass for every world-space label
  (`src/ui/HudLabels.ts`, pure packer `src/ui/labelPlacement.ts`, tested).
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
- **Valiant bridge camera** — eye 0.16 L above / 0.08 L behind the bridge over
  a forward battery; the mounts sit in the bottom sixth (tested).
- **Hires** — Magpie (wing) and Brennick (−30 % repairs) verified end to end
  by `npm run career-check` (new profile → free flight → hires → contract →
  launch → formation + fight → dock → repair → shipyard → reload).

- Replay tapes carry two kinds of out-of-tick world change: the world sim's
  small commands (`world-trade`, `world-take`, `world-episode`) and the
  guilds' `world` command, which snapshots the whole WorldState (a few KB
  per guild/outpost action). Migrate guild actions to small commands.
