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
| 3 | Attract mode / trailer — title idles into the prologue and flybys | runs unattended 10 min | 🔧 idle title → prologue reel |
| 4 | Photo mode + clip capture (headless webm/GIF from recorded input) | 1080p clip from a replay | |
| 5 | **Stations** — refineries, salvage yards, bastions, free ports, 1–3 per system | seeded, on star map | ✅ |
| 5b | **Living Reach** — painted planets (giants, terrestrial, volcanic, burning, Lantern-lit), moons, shattered moons, fly-through rings; timetable traffic, patrol wings, raider ambushes, arrivals flashes | seeded & deterministic, stations/gates untouched (`tests/reach.test.ts`) | 🔧 |
| 6 | **Docking** — request within 5 km, ILS corridor, auto-dock under 1 km, launch | hostiles within 10 km block it | ✅ |
| 7 | **Trade** — commodities, supply/demand per station, cargo, credits | pure, unit-tested economy; `npm run econ-sim` bands (safe 1.5–4k / hold, risky ≤ 9k) | ✅ |
| 8 | Repair, rearm, reputation per faction | persists in profile | ✅ |
| 9 | Planetary ports — orbital elevators / descent corridor to the surface port | seamless approach, no load screen | |
| 10 | Contracts board — courier, escort, bounty jobs generated from station state | uses the campaign runner | ✅ 8 kinds, seeded boards, runner-driven ops (`src/game/contracts`) |
| 11 | Free-roam between episodes — the Reach stays open, episodes start from a station | save/resume anywhere docked | ✅ debrief → free flight → priority orders; title CONTINUE |
| 12 | Ship upgrades & hangar — guns, missiles, shields, engines; livery shop | visible on the model | ✅ |
| 13 | **MP-0 determinism** — fixed 60 Hz step, seeded RNG, sim/render split | bit-identical 10 min replay | |
| 14 | Replays + kill-cam from recorded input | replay matches live | |
| 15 | Headless shard (Node) + bot clients | 200 ships < 8 ms tick | |
| 16 | Two-browser flight: prediction, interpolation, lag-compensated hits | < 2 m error at 150 ms RTT | |
| 17 | Lantern jump = shard handoff | < 3 s inside the tunnel | |
| 18 | Persistent economy + faction front on the star map | server-authoritative | |
| 19 | Co-op campaign (up to 4) | episodes playable with 2 | |
| 20 | Public playtest build + landing page | 100 concurrent | |

Design for 13–20: [docs/MULTIPLAYER.md](MULTIPLAYER.md).

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

## Known issues

- WebGL2 fallback lines are softer than the WGSL path.
- Large flat hulls (carrier deck) catch the rim light at grazing angles;
  a screen-space silhouette rim would fix it.
- SwiftShader timings are meaningless in absolute terms: run `npm run perf`
  on real hardware. Relative A/B on one machine is fine
  (`npm run perf -- --no-demo --query 'dynres=0&…'`).
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
- A stock (unfitted) Resolute loses a solo duel with a Lantern Guard and a
  stock Valiant a duel with a Vesper (`npm run balance` INFO lines): fitting
  out is the intended answer, but the first T5/T6 sortie can surprise.

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
  micro-missiles; Resolute Mk III vs Lantern Guard ~74 s / 56 % hull, Valiant
  Mk III vs Vesper ~65 s / 56 % hull, swarm vs PD bands (`npm run balance`).
- **Valiant bridge camera** — eye 0.16 L above / 0.08 L behind the bridge over
  a forward battery; the mounts sit in the bottom sixth (tested).
- **Hires** — Magpie (wing) and Brennick (−30 % repairs) verified end to end
  by `npm run career-check` (new profile → free flight → hires → contract →
  launch → formation + fight → dock → repair → shipyard → reload).
