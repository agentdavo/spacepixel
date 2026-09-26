# Parallel sessions: who owns what

## Current continuation — 25 September 2026

The previous Claude session table and handoffs below are historical. The
default branch at `72ced42` includes PRs #1–#4. All seven named feature/session
branches are ancestors of it; the three paused `worktree-agent-*` prototypes
retain unique commits but were superseded by the documented ports.

New isolated Codex tasks cover: the finished 720p trailer and synchronized
soundtrack; point-defence investigation and combat visual QA; voice recording
coverage and Windows tooling; and a Kessen integration plan for approval.
The trailer uses already-merged features and does not depend on Kessen
integration. V2 is delivered; completed PD, voice and cinema changes are
combined and checked on `codex/integrate-audit-trailer-combat-voices` (code
checkpoint `2c25431`, followed by documentation/screenshots). No historical
branches were deleted and no remote push was made.
The chief task owns direction in [GAME-DIRECTION.md](GAME-DIRECTION.md).
The user's superseding scope is **Kessen cameos first**, preserving the
original technical milestones and twenty-episode campaign. The earlier
side-arc/faction-foundation sequence is deferred. The Kessen handoff through
`e75d68b` is now integrated. The chief accepted final EP10/19 motion and authorised
default activation after combined checks; these render-only cameos are on,
with `kessenCameos=0` for debug comparison. 308 tests/build and native mission,
state and navigation comparisons pass. No general faction/boarding changes.

Integration follow-up `2c284ab` fixes the reproduced EP01 waypoint/autojump
blocker. The [first-session report](FIRST-SESSION-2026-09-25.md) separates live
survey/trade/refit/manual-docking/persistence results from debug harness checks
and the still-unverified successful combat route. Changes remain local.
The chief's [trailer editorial review](TRAILER_EDITORIAL_REVIEW.md) is recorded
without modifying the current cast, clips or V2 export.

Read [AUDIT-2026-09-25.md](AUDIT-2026-09-25.md) for current evidence and scope.
Historical statements such as "draft PR #1", original-score-only exports and
unimplemented recorded voices must not override that checkpoint.

## Historical ownership and handoffs

Since 24 Sep all work runs as threads in one Claude project; the original
sessions have stopped and handed over (their notes are kept below). Each
thread owns an area. Leave requests for another owner under **Requests**,
pull before touching their files, and open PRs into the lead branch.

| Area | Owner (project thread · branch) | Files |
|---|---|---|
| Engine, world, campaign, merges, this file | **Vanguard lead** thread · `claude/vanguard-space-combat-0l3bfi` | everything not listed below |
| Turrets, shields, weapon impacts, subsystems, kill paths (batch 6) | **Turrets, shields and subsystems** thread · `claude/project-thread-dl05kd` (took over from the turrets session 24 Sep ~10:40; draft PR #1 into the lead branch) | `src/sim/TurretRig.ts`, `Subsystems.ts`, `Weapons.ts`, `Damage.ts`, `Combat.ts`, `Capitals.ts`, `ai/Turret.ts`, `src/fx/impacts.ts`, `src/world/{WeaponVisuals,CombatFx,ImpactDecals,ShieldGeometry}.ts`, impact SFX, `src/cinema/gunnery.ts` |
| Character voices, chat, soundtrack | **Soundtrack and voices** thread (continues `claude/ova-soundtrack-voices`) | `src/audio/Music.ts`, `instruments.ts`, `src/audio/score/**`, `src/audio/voice/**`, `src/dialog/**`, `src/ui/Comms.ts`, `AudioTestScene`, `scripts/audio-render.mjs`, `src/audio/offline.ts`, the `soundtrack` field in `src/game/Settings.ts` |
| Kessen mecha race (design approved 24 Sep; now in code) | **Kessen mecha race** thread · `claude/project-thread-t748fw` (continues `claude/mecha-race-design-qtw680`) | `src/kessen/**`, `src/world/scenes/KessenTestScene.ts` (+ its one line in `scenes/index.ts`), `tests/kessen.test.ts`, `docs/KESSEN.md`, `docs/concepts/kessen/**`, `scripts/concepts/kessen/**` |
| Gameplay polish: stock warship fits, bridge bow view, off-screen edge arrows | **Spacepixel gameplay improvements** thread · `claude/project-thread-k48ga1` (PRs into the lead branch) | stock fits in `src/game/outfitting/fit.ts` + outfit bands in `src/sim/balance.ts`; camera framing in `src/game/shipyard/flight.ts`, `Outfitter.frame`, `shipyardFlight.ts`, V-key handling in `FlightScene`/`DogfightScene`; edge arrows in `src/ui/edgePlacement.ts` (new), `HudLabels.ts`, and the arrow code in `FlightHud`, `ContractHud`, `ReachHud` |

The paused lead batch 6 worktrees (`worktree-agent-*`) have been ported onto
`claude/project-thread-dl05kd`; nothing left to mine there.

## Batch 6 handover (turrets session, 24 Sep; now owned by the batch 6 project thread on `claude/project-thread-dl05kd`): done / left

Everything below is merged on `claude/ship-turrets-shields-weapons-8lz4su`,
which also carries `claude/vanguard-space-combat-0l3bfi` up to b917a5d.
Typecheck clean, 258 tests, `npm run determinism`, `balance`, `ai-sim` all
pass (4v4 sweep 51 % Concord). Milestone status is in ROADMAP *Batch 6*.

**Done**
- Turret rigs (`src/sim/TurretRig.ts`, `ShipBuilder` auto-rig, `Part.rig`):
  every turret socket gets a traverse joint (`<socket>`) and elevation joint
  (`<socket>/el`); slew, arcs, fire gate, barrel-tip muzzles, recoil, wreck
  pose. `turretWorldPosition(ship, socket, out)`; subsystem id = socket id.
  Missiles launch from launcher sockets; `Weapons.muzzleFlash()` queues
  turret 'fire' events.
- Shields v2 (`Damage.ts`): FACING FORE/AFT/PORT/STBD/DORSAL/VENTRAL,
  `ShipStats.facings` 1 | 2 | 4 | 6, `facingOf` / `facingUp` /
  `facingStrength`, trim + transfer (keys `.` `,` `/`), shield emitters
  (`kind: 'shieldEmitter'`, `facing`), bleed, collapse cooldown, splash.
- Subsystems (`src/sim/Subsystems.ts`): exposure, aimed hit spheres,
  `Fleet.blast` splash, hangar cook-off, damage control, AI stripping,
  B / Shift+B / I picking, HUD brackets + kill feed.
- Impact FX (`src/fx/impacts.ts`, `src/world/ShieldGeometry.ts`,
  `ImpactDecals.ts`, `WeaponVisuals.ts`, `CombatFx.ts`). Test stage:
  `?scene=combat&stage=impacts&side=hull|shield|collapse|regen|subsystem&cam=0|1|2`.

**Done since, by the project thread** (`claude/project-thread-dl05kd`)
- Impact audio: `hullScorch` / `hullCrunch` / `hullHit` by damage type,
  thinner shield hits on a failing facing, shielded beams, bleed, `shieldUp`,
  `mountBlast` by `sub.kind`; player turret shots flagged `WeaponEvent.turret`
  and played as turret fire. `audio-render --only sfx-batch6`.
- Trailer / prologue broadsides fire from barrel tips (`src/cinema/gunnery.ts`).
- Faction shield shells: Choir crystal facets, Rustwake bent / holed scrap
  plates (`WeaponVisuals` `style` uniform; `?scene=combat&stage=impacts&side=shield&faction=choir`).
- Subsystems v2 finished: `reactor` (brownout below half hp: regen, fire
  rate and lance cooldown scale by `powerLevel`; destroyed → CRITICAL),
  `sensors` (lock range and AI coordination × `CapitalEffects.sensors`),
  `launcher` (was `missile`; all gone → no salvoes). Bridge / reactor are
  citadels (no torpedo splash). Knocked-out mounts carry `sub.wreck`
  `'droop' | 'blown'` (explosive or >30 % of hp in one hit blows the house off).
- Kill paths (ported from the lead's `worktree-agent-a936121b44b53858f` onto
  our Damage / Fleet model): `src/sim/Structure.ts` (pure: sections, reactor
  fuse vs vent, shockwave, `settleDeath`), `src/sim/Destruction.ts` (wreck
  pieces, shockwave damage), `src/game/salvage.ts` (wrecks as salvage, cleared
  on jumps), `src/world/DestructionFx.ts` + `src/world/destruction/`
  (HullSplit, DebrisField, MountWrecks; rigged turrets droop by
  `TurretRig.wreckDrive`, blown ones throw a merged gun house). HUD keel bars
  and callouts. `npm run balance` killpath, `tests/destruction.test.ts`,
  test stage `?scene=combat&stage=kill&path=reactor|structural|bridge|hull`
  (`&t=` seconds after the kill, `&ship=`, `&cam=`). Structure state is in
  `StateHash`.

**Left**
- Screenshot-verify and tune: hull marks (`ImpactDecals`, TSL instanced
  shader rewritten, final look unconfirmed), capital facing outline / low-cell
  density, collapse, regen, fire columns, beam cut lines. Faction shell
  styles (crystal Choir, scrap Rustwake). Run `npm run perf` on a GPU.
- Station batteries: now sim turrets (`src/sim/StationDefence.ts`, ported
  from the lead's model onto the capitals' rig / targeting / subsystem
  machinery). Still left: player lock and HUD brackets on them, missiles and
  beams vs stations, docking arms / comms, and a native look at the posed
  batteries and their muzzle flashes.
- Kill paths: wreck pieces only for capitals (fighters / gunships keep the
  wing-shear death); pieces do not collide; launchers only on capitals.
- Balance watch: stock Valiant vs Vesper now loses ~1–2 / 10 seeds (INFO);
  Cantor shield 110 + 1.5× transfer offsets fore/aft halves.
- Turret drive state is not in `StateHash` (it reaches the world via bolts).

**Events for the voices session** (`WeaponEvent`, `src/sim/Weapons.ts`)
- `shield` (facing held; `facing`, `strength` 0..1, `bleed`),
  `shield-bleed` (leak to hull), `shield-down` (facing collapsed),
  `shield-up` (facing coming back). Fighters report facing 0 fore / 1 aft.
- `subsystem` with `sub.kind` turret | lance | hangar | engine | shieldGen |
  shieldEmitter | bridge (+ `sub.facing` on emitters); also fired for splash
  and cook-off kills. `hit` / `beam-hit` carry the struck `sub` and optional
  `subHp`, `type`, `amount`, `shielded`.
- `subsystem` also for `sub.kind` launcher | sensors | reactor, with
  `sub.wreck` 'droop' | 'blown' on mounts.
- `reactor-critical` (core breached, fuse lit; `shooter` did it) and
  `reactor-vented` (crew vented in time). Current audio: critical →
  shieldDown + mountBlast; vented → shieldUp.
- `kill` carries `cause` hull | structural | reactor | bridge. Audio:
  reactor → two explosionLarge + shieldDown, structural → hullCrunch +
  explosionLarge, bridge → a lone mountBlast (she goes dark), hull → as before.
  Suggested barks: "her core's going critical", "she's venting", "she's
  broken her back", "she's struck — drifting dead".
- Existing barks: `mount-player`, `mount-wing` (`src/dialog/barks.ts`).
  Suggested: `shield-down` on the player → wingman "your shields are down",
  shieldGen destroyed on a capital → "their shields are gone", hangar
  cook-off → Cantor / station control alarm.

## Soundtrack backend (landed)

Eight scores re-orchestrate the mood sequencer (see README, *Soundtrack*).
Hooks for other owners:

- `getAudio().setPlace(systemId, faction, episode)`: cheap per frame. It
  re-orchestrates only on change. FlightScene calls it next to
  `audio.update()`, and main.ts calls it before a briefing and on the title.
- `getAudio().setScore(id, variant)` pins a score (audio test scene, captures).
- Title, prologue and trailer stay on the **Original Score** unless the player
  pinned one, so `make-video` / trailer renders are unchanged.

## Voices / chat / soundtrack handoff (24 Sep, `claude/ova-soundtrack-voices`)

The voices/score session is stopping here. A project thread continues from
this file. Everything is merged into `claude/vanguard-space-combat-0l3bfi`.

**Done** (`tsc` clean, `npm test` 227/227 incl. `tests/score.test.ts`, every
score scenario in `scripts/audio-render.mjs` renders with 0 clipped samples,
live-checked in Chromium: faction pick, `?score=`, Shift+F7, `?scene=audio`):

- `src/audio/score/`: `rack.ts` (strings / FM / analog / drum-kit patches),
  `palette.ts` (routes the mood scripts' instrument calls to each score's
  patches), `scores.ts` (8 scores: palettes, per-mood rewrites, score parts),
  `catalog.ts` (pure resolver: pinned > episode > special system > faction >
  original, plus a stable per-system/episode variant).
- `Music.setScore` crossfade, ensemble chorus (its LFOs are stopped in
  `Strip.dispose`), swing, per-score reverb rooms, score-aware stings.
  `GameAudio.setPlace` is called per frame in FlightScene and in `main.ts`
  (briefing, title).
- Settings: `soundtrack` field, Shift+F7, `?score=`. The hotkeys now install
  from the audio layer, so they work in every scene.
- Original Score (title, prologue, trailer) renders identically to before.
- Samples: `docs/audio/score-reel.mp3`, `score-reel-cruise.mp3`. README
  *Soundtrack* section.

**Left / known issues:**

- The mix is tuned from level and spectrum analysis only; nobody has listened
  to it. Orchestral scores (Cathedral, Long Dark, Anchor) are darker in
  battle than the synth ones, so the string/timpani levels may want a pass.
- Only cruise and combat are rendered per score. Title, briefing, dread,
  sublime, victory and defeat under non-original scores are untested by ear
  (they run and don't clip in the audio test scene).
- No per-frame CPU measurement of the heavier scores (Symphony of Gates
  combat) on a real device. Offline renders run faster than real time on
  SwiftShader.
- The batch 6 barks (Requests below) are waiting on event names from the
  turrets session.
- Voices and dialog: no changes in this session beyond ownership. The
  procedural voice, barks and concourse dialog are as the lead left them.

## Lead session handoff (24 Sep, `claude/vanguard-space-combat-0l3bfi`)

The lead session is stopping here; a project thread continues from this file.

**Done and merged on this branch** (all checks green at `b02c1e6`: `tsc`,
`npm test` 221/221, `ai-sim`, `balance`, `econ-sim`, `determinism`,
`flow-check`, `career-check`, `attract-check` 3 cycles):

- Batches 1–2: engine, ink/cel pipeline, flight, AI, campaign (20 episodes).
- Batch 3: prologue + cinema sequencer, 90 s trailer, attract mode, photo
  mode, `record` → `make-video` clip pipeline; stations, docking for every
  hull size (bays, clamp arms, moorings), planetary ports (descent to surface
  cities), trade, repair/rearm, contracts, free-roam career loop; MP-0
  (fixed 60 Hz step, seeded RNG, bit-exact replays, kill-cam).
- Batch 4: combat depth, 28 hulls T1–T6, shipyard + outfitting (398 items),
  living Reach (planets, moons, traffic, ambushes), people/dialog/voices,
  collisions, economy balance, integration polish, rough-edges pass.
- Batch 5: WorldState memory, guilds (5) + 20 arc missions + outposts, world
  sim (story → economy, player actions, news), the Schedule, the Signal
  countdown, NPC arcs (7) + rivals (6).
- Last fixes: attract-loop leaks (planet LOD caches; renderer RenderObjects
  retaining old scenes).

**Left / known issues** (details in `docs/ROADMAP.md` → Known issues):

- Batch 6 (turrets, shields v2, impacts, subsystems, kill paths): turrets
  session. The lead's paused batch 6 WIP is listed under Requests.
- Never flown live, only exercised headless: breaking the Schedule, rival
  fights end to end (retreat/eject, rival-led ambushes), desert/ice/volcanic
  surface descents, the traffic/rival encounter mix over a long session.
- Replay tapes: guild/outpost actions record a full WorldState snapshot
  (`world` command); migrate to small commands like the world sim's.
- Balance: story-rule economy effects are hand-tuned; stock T5 loses to a
  Lantern Guard (by design, may surprise).
- Perf: everything measured on SwiftShader only; planet LOD savings, first
  LOD-switch hitch, and all budgets need a real-GPU pass (`npm run perf`).
- Multiplayer roadmap items 15–20 (headless shard, two-browser flight,
  Lantern-jump handoff, persistent economy, co-op, playtest):
  `docs/MULTIPLAYER.md`.
- Batch 3 items still open: attract/trailer "10 min unattended" is verified
  (3 cycles); photo mode exists; planetary ports have no contract kinds.

## Recorded voices (voices session)

- Every written line is pre-recorded with Piper neural voices into
  `public/voice/` (clips + `manifest.json`); `VoiceBox` plays the clip in the
  new default voice mode `cast` and falls back to the synth for lines without
  one. **After adding or changing spoken lines, run `npm run voices`** (see
  README, *People, voices & subtitles*) or they stay on the synth.
- Touches outside this area: `VoiceMode` gained `'cast'` in
  `src/game/Settings.ts` (old saves move to it once); `DOCK_LINES` moved from
  `FlightRadio.ts` into `barks.ts`; `package.json` has a `voices` script.

## Wing chat (voices session)

- Wing orders (keys 1–4) get a spoken answer from the lead wingman, in
  character (`order-*` barks in `src/dialog/barks.ts`); "attack my target"
  with no lock gets a "which one?". The only touch outside this area is one
  line in `FlightScene.onKey`: `this.radio.order(this.wingOrder, !!this.lock.target)`.
- On a long quiet leg (30 s clear of hostiles, 90 s between exchanges, never
  during an episode) the wing chats among itself: `BANTER` in `barks.ts`.

## Requests

- **Batch 6 overlap, resolved (user, 24 Sep ~10:20).** Batch 6 (turrets,
  shields, impacts, subsystems, kill paths) stays with the turrets session.
  The lead session's three batch 6 agents are **paused** and it will start no
  new batch 6 work. Their unfinished, unverified work is **pushed to origin**
  (24 Sep, at the user's request), unmerged and not re-verified, on:
  `worktree-agent-a9181dba8d1e07ff0` (turret rigs + muzzles, 6 commits),
  `worktree-agent-ad2e6ed36bfec934d` (shields v2 + impact decals, 2 commits),
  `worktree-agent-a936121b44b53858f` (subsystems v2 + kill paths: structural
  break-up, reactor, bridge kill, wrecks/salvage, 14 commits). Mine what fits;
  they'll need a merge with the current turrets/shields code and a full
  re-verify (`tsc`, `npm test`, `ai-sim`, `balance`, `determinism`).

- **Voices → batch 6 owner (turrets session):** once shields v2, subsystems and kill paths emit
  events, list their `WeaponEvent.kind` names here (e.g. `facing-down`,
  `reactor-critical`, `bridge-kill`, `turret-destroyed`). The voices session
  will add wingman / Cantor / station-control barks for them (voiced,
  subtitled, rate-limited) and a music stinger for reactor detonations.
  Impact SFX in `Sfx.ts` stay yours.
- Want a new bark or voice line for a gameplay event? Add it here as
  "event name → who says it, tone". The voices session wires it into
  `src/dialog/barks.ts`.
- **Kessen (mecha race) → all, 24 Sep:** a proposal for a fourth race, the
  Kessen: a mecha-piloting people from Kessendra, reached through the
  Timetable Graveyard at Anchorage. See `docs/KESSEN.md` and the eight sheets
  in `docs/concepts/kessen/`. **The user approved the design on 24 Sep** (the
  name may still change, so it lives behind one id). The Kessen thread is
  building it self-contained in `src/kessen/` first, with no `FactionId`
  change yet (that union feeds many `Record<FactionId, …>` tables in
  outfitting and the shipyard). Later it will need:
  - **lead:** `FactionId` `kessen` and a livery in `Factions.ts`; a skeletal
    path for walkers (there is no `SkinnedMesh` in `src/` yet; proposal:
    rigid-part bone skinning, instanced per Stature); Couplings
    (magnet-walk on capital hulls) and boarding as a batch-6 subsystem kill
    path. The mecha session will ask here before touching any of those files.
  - **voices / score:** a ninth score for the Kessen (steel percussion,
    anvil, a call-and-response work song, "the Hammer-song") and barks:
    "Standing." (greeting), "Lid up!", "Hammer!", "Drive the spike!", "She
    walked home." (a death, said with pride).
- **Kessen handover (24 Sep).** Everything is on
  `claude/mecha-race-design-qtw680`: `docs/KESSEN.md` (the full proposal),
  eight PNG sheets in `docs/concepts/kessen/`, and the three.js prototype in
  `scripts/concepts/kessen/` (`mechkit.js` holds the 42-bone rig, 14
  variants, poses and walk cycle; `node scripts/concepts/kessen/render.mjs`
  re-renders the sheets). Still open for the user: sign-off on the name
  ("Kessen" is also a 2000 Koei PS2 title) and whether "5 levels" means five
  size classes (as drawn) or five upgrade tiers per frame. The next step is
  implementation, which touches lead-owned files (see the request above).
  **Answered (user, 24 Sep):** keep "Kessen" for now (it may be renamed
  later) and five size classes. The Kessen project thread now carries the
  work on `claude/project-thread-t748fw` (see the table).
