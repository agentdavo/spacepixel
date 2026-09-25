# Kessen — cameo-first integration plan

## Current mandate — supersedes the archived proposal below

**25 September 2026: cameos first.** David clarified through chief architect task `01a0d930-0d92-75d1-b902-7f5e53b75ca2` that the initial Kessen release should preserve Vanguard and the twenty-episode campaign and introduce the Kessen through restrained cameos. The chief withdrew initial side-arc delivery and directed discussion of the least invasive implementation before widening shared types.

The race design, provisional name and five Statures remain approved. The chief's earlier D1 approval of an initial four-step arc is **superseded**. D2 (successful material intervention, not mere presence, makes one active engagement decisive) and D3 (validated slow hull-relative entry with a real breach) remain **future design directions only**. They authorise no current combat, Schedule or shield implementation. The suggested 2 m/s and 30 ticks are unvalidated tuning hypotheses.

**Current bounded deliverable: an isolated, default-off environmental cameo preview, authorised by the chief after this scope correction.** The implementation is on `codex/kessen-faction-foundation`, rebased onto integration's combined work and navigation fix `2c284ab`; its branch name records the earlier scope, not a promise to deliver it. The only shared type addition is a set-piece kind. General faction types and other canon files remain unchanged. The chief accepted the revised service-module design/local contrast for gated integration; release enablement awaits final motion/navigation review, without another routine design approval request to David. See [the preview evidence and reproduction notes](KESSEN-CAMEO-PREVIEW.md).

## Least invasive cameo proposal for the chief

Use the existing `KessenFrame` models as **render-only narrative set pieces**. They do not join `Fleet`, receive damage, target ships, emit weapons, grant kills, change collision, or create world consequences. Existing `data.ts` already supplies identity, sizes, variant names and livery; no `FactionId` change is necessary to show a frame. Keep at most **two to four** visible frames in an authored tableau, using existing idle/held poses. No new moving-hull coupling or foot IK is required: build a small static piece of support geometry in the same local group.

The existing `SetPiece` contract supplies world positioning, mission flags, lifecycle and disposal; adding one dedicated kind is narrower than adding a new combat actor. Proposed class: `src/world/setpieces/KessenCameo.ts`. This entails a small **set-piece kind** extension, not a general faction/economy union expansion. Keep the piece free of simulation/world mutations and do not call `ctx.setFlag` for story progress.

| Appearance | Proposed treatment | Protected campaign behavior |
|---|---|---|
| Episode 10, Graveyard evacuation lane | After `bastion-destroyed`, a pair of frames braces a damaged span beside the lifeboat route. A low, steady Loom glow and recognisable industrial silhouettes provide the introduction. No voiced interruption is needed. | Bastion/carrier destruction, Oyelaran's death, Ada's chart, the two lifeboat objectives, escape and the count-off remain unchanged. This is background evacuation work, not an attack that breaks Engagement 131. |
| Episode 19, an existing tuning approach | Two to four frames stand on local support structure near a tuning approach already on the player's route; exact site/offset is selected in a screenshot review. The visual echoes “still standing” without a new radio speech or a Train battle. | Do not move the mission to the Nexus: it begins at Meridian and spans two jumps. Kessen neither tune the road nor replace Psalm, Candle, Kade or the Zenith's choice. Preserve the prime count, dwell/jump requirements, Ada's sky and the climax. |

Real stature is 2.6–11.5 m in a world of kilometre-scale routes. Placement and framing, rather than inflated model scale or an intrusive camera takeover, must make the cameo readable. If ordinary flight cannot read a proposed site, show that failure in the screenshot review and adjust the nearby support silhouette/site. Do not add a required approach objective just to force the player to see it. Episode 20 stays quiet and unchanged.

**No-appearance path:** author the cameo specs separately from mandatory objectives, spawns and chatter. Provide a captured, explicit presentation toggle for development A/B checks; absence/off must preserve the existing mission behavior and seeded simulation. The chief should settle the release default after seeing screenshots, as a technical presentation review rather than a new user design approval. Do not gate this first introduction on completion of the deferred side arc or add invented relationship facts to old saves. With the cameo omitted, the existing mission must still run unmodified.

Use existing deferred set-piece flags and resolved local placement; never wall-clock randomness. Verify Episode 19 cleanup/recreation across jumps before approving a site. Frame animation is cosmetic and must not affect replay hashes. The replay's existing boot/query capture may carry a presentation toggle if suitable; verify that route before adding any persistence field. No new save schema, world facts, rewards, reputations or Schedule callbacks are needed.

## Exact file boundary and minimum canon support

**Touched by this preview:** this plan, `KessenCameo.ts`, its registry and `SetPieceKind`, two mission specs, isolated `SetPieceScene.ts` inspection presets, focused tests, an independent native capture script, and the preview report/screenshots. Dependency installation has not changed the lockfile or package manifest. No existing cinema/capture script was edited.

**Approved preview boundary (implemented unless noted):**

- New `src/world/setpieces/KessenCameo.ts`; register it in `src/world/setpieces/index.ts`; add its kind to `src/game/campaign/types.ts`.
- `src/game/campaign/missions.ts`: optional presentation-only placements for Episodes 10/19. If the current mission construction cannot cleanly carry the A/B toggle, propose the smallest session-construction edit to the chief before touching `CampaignSession.ts` or `main.ts`.
- Five focused cameo tests covering mission boundaries, runner equivalence, absolute-time posing, cleanup/material ownership, and actual lifeboat-route clearance; screenshots and native approach clips of actual Episode 10/19 sites with matching off baselines. The toggle is contained in the registry; no session or main entry edit was needed.
- Deferred until a release/canon review needs them: `docs/LORE.md` fossil-tech/Standing qualification, `docs/CAMPAIGN.md` optional appearance notes, and `docs/KESSEN.md` release-status notes. These files have not been edited for a default-off preview.

**Deferred entirely:** `FactionId`, faction/team numeric indices, ship/equipment/market types, economy and save changes, general NPC identity plumbing, side-arc registry, dialogue/voices, score, PD, weapons, collision, boarding, consist AI and Train batching. No mechanical shield bypass. No 200-frame delivery or performance promise. The archived engineering audit below remains useful if a later reviewed scope needs those systems.

Integration task `01a0d8f2-bc9d-7713-8f66-cf8baee8ec58` owns `docs/ROADMAP.md` and `docs/SESSIONS.md`; both remain untouched. Chief owns `docs/GAME-DIRECTION.md`. The preview was rebased first onto combined PD/voice/trailer base `cafc28b`, then navigation fix `2c284ab`, before final validation. Integration's EP01 `CampaignObjective.navTag`, objective metadata and flight navigation changes were preserved without conflicts. Avoid `package.json`, `public/voice`, dialogue/audio and cinema/capture behavior changes.

## Verification, screenshot and commit checkpoints

For this plan revision, baseline `npm run typecheck` passed on `72ced42`. Captured SHA-256 baselines before any source edits for generated universes at seeds 1994, 42 and 7, and for catalogue/items; these are available in task output for later comparison. They show a reference state, not that an unimplemented feature passes tests.

For the proposed cameo slice, run typecheck and focused campaign/cameo tests, then the existing suite and flow checks where mission construction changes. Verify enable/disable produces identical mandatory objectives, spawning, outcomes, kill counts, world facts and gameplay replay hashes. Check no duplicated tableau on mission reload/jump, no retained Kessen meshes after disposal, and no interference with existing frame-material ownership. Measure the small tableau's incremental render cost on the available backend and report the device honestly; no inference from that measurement to large crowds.

Supply screenshot pairs at each meaningful visual checkpoint: Episode 10 composition on/off, Episode 19 composition on/off, and a closer inspection of true frame scale/support contact. Identify the trigger, mission state and backend with each capture. A Kessen viewer image is a baseline art reference only. Keep chief informed with those images and narrow commits; do not represent an image from the viewer as campaign integration.

Rebased review checkpoints on `2c284ab`: scope correction `3da9e05`; gated preview/tests `6075374`; service modules/local contrast `98fde84`; lifeboat clearance `86e6a6d`; motion evidence/report `420f4ad`. Stop and report if further implementation requires a broader actor/type, save or camera change than described here. No PR, push or merge has been requested for this task.

## Archived full-integration proposal — reference only

Everything below is preserved from the original planning work. Its initial-release recommendation, D1–D3 decision table, phase authorisation language, 200-frame gates and requests for David's approval are **historical and superseded by the current mandate above**. They are not current delivery commitments. Reopen individual items only when a later chief-reviewed scope actually needs them.

### Original proposal (before the cameo-first clarification)

Prepared 25 September 2026 against checkout `72ced42`. **Planning only; gameplay implementation is not authorised by this document.** The only change in this task is this plan. No PR, push or merge is required.

## 1. Approval boundary and intended result

The recorded approvals are the race design, keeping **Kessen** for now, and **five size classes**, not five upgrade tiers per frame. The fourteen models, shared rig, animations and viewer have landed through PR #2. Neither those approvals nor the proposal language in [KESSEN.md](KESSEN.md) approves the integration choices below. In particular, faction membership, Schedule effects, the Seam's fate, player access and campaign interventions remain proposals.

Recommended first integration: a non-playable faction encountered through a four-step Anchorage side arc, with a small, functional consist that can fight, attach to hulls and damage subsystems. Its consequences persist in the existing world memory. Increase combat scale only after measurements, ultimately targeting a 200-frame Train. Add restrained, conditional Episode 10/19 appearances. Kessendra travel, player-piloted frames, a sixth guild, Kessen markets, frame purchases and permanent Corin wingman recruitment are outside this first integration.

Sources read: [LORE.md](LORE.md), [CAMPAIGN.md](CAMPAIGN.md), [KESSEN.md](KESSEN.md), [ROADMAP.md](ROADMAP.md), [SESSIONS.md](SESSIONS.md), and the source surfaces identified below. Historical session test counts are historical reports, not verification of this proposed feature. No gameplay tests or performance benchmarks were run for this document-only task.

## 2. What exists, and what integration must add

| Repository evidence | Implication |
|---|---|
| `src/kessen/{data,rig,clips,FrameKit}.ts`, `KessenTestScene.ts`, `tests/kessen.test.ts`: fourteen variants, five Statures, 42 named bones, cel meshes merged per bone, time-based clips, ground-height correction and pistons | Reuse the art and naming. There is no walker combat simulation, consist AI, hull attachment or 200-frame renderer yet. Ground correction is not curved-hull foot IK. |
| `Blueprint.ts` defines only `concord`, `choir`, `rustwake`; `Fleet.Team` adds `renegade` and `neutral` | `unknown` in lore is a campaign/universe classification, not a current `FactionId`. The minimal change adds `kessen` without quietly redefining these domains. |
| `Fleet.spawn` constructs a ship model and `FlightModel`; mission `SpawnSpec` requires a ship blueprint; `CampaignRunner.onKill` accepts `ShipEntity` | A frame cannot become a combat actor by adding a livery or pretending its variant ID is a ship blueprint. Both campaign and contract spawning need an explicit walker path. |
| `Fleet.hostile` is unequal teams except neutral; all faction pairs otherwise fight | Allied Kessen require the player's team with Kessen identity retained. Their cultural independence cannot be represented by leaving allies on team `kessen`. |
| Guilds are exactly five; Breakers are within `rustwake`. Magnus Ure already exists as `gd-breaker`, wanting a twelfth hulk | Reuse him. Do not invent another guild or replace the existing Rustwake story. |
| `guilds/arcs.ts` keys progression by `arc.<guild>.<n>` and one pending choice per guild | A second four-step Rustwake arc would collide if appended using the same step numbers or overwrite finale state. |
| `rustwake.seam = tey | breakers` already means the Ember's rich Ebon seam | Never migrate or overwrite it as the Kessen spatial Seam. |
| `Damage`, `Subsystems`, `Structure`, `Fleet` and `Destruction` already implement facings, emitters, citadels, cook-offs, bridge strikes, reactor fuses and wrecks | Extend their validated damage path; do not create a parallel capital death implementation. |
| `HullGrid` is rest-pose occupancy at about 72 cells along the hull's longest axis | On a 2 km hull, cells are roughly 28 m across: useful for coarse collision, not metre-scale boots or hull navigation. |
| Schedule contracts commit outcomes through `ContractDesk` → `world/live.ts` → `schedule.ts` | Add Kessen outcomes to this route, with explicit engagement identity and replay handling. A spawn callback is not a world consequence. |

## 3. Lore reconciliation before scripting

Lead and Kessen owners should update the bible and proposal together after approval:

- Add the Standing, Kessendra, the two halves of TAW-9 *The Appointed Hour*, the Seam, the Roster, Threading, the Loom and five Statures to `LORE.md`; retain the detailed fourteen-frame catalogue in `KESSEN.md`. The stern is **one of the forty**, not a forty-first wreck. The ship is a works tender, not a twelfth Clavis key.
- Qualify the bible's absolute fossil-technology statements as the known, shipborne Reach's condition. Kessen understand their own frame engineering; they have neither the Builders' complete knowledge nor a substitute for the Clavis. Their warning about fold-cores corroborates the Oracle after its reveal; it must not solve Episodes 5–13 in advance.
- Reconcile “ships in transit were never seen again” with surviving stern wrecks and the hidden bow. Contact reveals an exception previously unknown to the public, not a rewrite of what everyone already knew.
- Correct “the one power whose battles are decisive”: Episode 8 already has Vanguard destroy the conductor and make Engagement 114 decisive. Proposed wording: **Kessen doctrine rejects scheduled attrition; a committed Train fights to settle its objective, at a real cost.** This is a doctrine, not guaranteed victory.
- Preserve the 14 m Seam limit, roughly ninefold time, 840 bow survivors, one pilot/heartcase for life, and upright death poses. The pitch's “two thousand” frames is a rounded description of the detailed 2,300; label it approximate. Explain that inability to use fold-cores prevents conventional ship travel, while the Stair still reaches orbit.
- Do not convert the ×9 home clock into accelerated free-roam economy, Signal ticks or mission expiry. It is narrative time until actual Kessendra travel exists. Corin's eleven-month absence and daughter's age remain approximate calendar statements, not a second gameplay clock.
- Resolve the motto discrepancy explicitly: the document calls “What walks, returns” the motto and “I will not be carried” the creed; `data.ts` currently puts the creed in `motto`. Recommended: preserve both named strings, use the motto for faction metadata and the creed in dialogue. Keep the stable `kessen` ID if the display name changes later.
- The Kessen's Stair and the campaign's Episode 7 “Stair” coordinates are distinct unless David chooses otherwise. Qualify the former as “Mount Vey's Stair”; do not quietly make it the road to the Nexus.

The momentum-gated shield claim needs an explicit mechanic. Recommended first rule: only a frame executing a validated, slow **relative-to-hull** approach can pass an intact capital facing; fired ordnance still strikes the shield. Start tuning at ≤2 m/s normal approach, with speed/orientation/contact validation over 30 fixed ticks. This is a proposed tuning value, not existing lore or code. Small fast frames, fighters, torpedoes and ordinary melee hits do not acquire a universal shield bypass. The Hammer remains useful to suppress fire and admit a larger group quickly. Alternative: require a collapsed facing for all attachment and revise the proposed lore; see decision D3.

## 4. Minimal faction: actual table and compatibility audit

Repository searches covered `FactionId`, `Record<…Faction…>`, `Record<Team,…>`, explicit three-faction arrays, indexed faction reads and faction fallbacks across `src`, `tests` and `scripts`. These are all seven directly exhaustive table declarations found for `FactionId` or its `Team` alias (the utility-name declaration contains four maps). The catalogue and campaign are consumers, not additional exhaustive faction tables.

| Declaration / owned file | Proposed treatment |
|---|---|
| `FACTIONS` — `src/assets/Factions.ts` | Add `kessen`, using `KESSEN` and `KESSEN_LIVERY` as the canonical source; map `glass` to Loom teal and explicitly provide `plumeCore` for the ship livery interface. No second drifting palette. |
| `HOUSE`, `STANDING`, `UTIL_NAME` — `src/game/outfitting/items.ts` | Narrow these to an explicit legacy equipment/manufacturer faction domain shared with the existing three yards. Narrow maker, item and standing-requirement types that feed them. Do not invent Kessen engines, shop prices or standing thresholds just to satisfy TypeScript. |
| `DEFAULT_LOADOUT` — `src/sim/Loadouts.ts` | Keep ship defaults exhaustive over the three ship factions. Guard/narrow `createCombat` in `Combat.ts`; reject accidental Kessen ship construction. Frames receive explicit per-variant loadouts from a separate walker catalogue. |
| `FACTION_INDEX` — `src/sim/Weapons.ts` | Append `kessen: 3`, preserving existing faction indices 0–2. The bolt faction/team buffers are `Uint8Array`, so the new values fit without a storage-width change. Audit all readers of the numeric payload and visual styles. |
| `TEAM_INDEX` — `src/sim/Weapons.ts` | Append `kessen: 5`; retain `renegade: 3`, `neutral: 4`. Append to adjacent `TEAM_LIST` in the same order. Test both directions and neutral/friendly-fire behavior. |

The indirect and runtime audit is equally necessary:

| Surface | Finding and concrete action |
|---|---|
| `shipyard/catalog.ts`, `outfitting/{fit,hangar,apply,Outfitter}.ts` | `CatalogFaction = FactionId | civil` currently widens implicitly; `fit.ts` casts that into three-member `Yard` before indexing `UTIL_MAKER`. Constrain ship catalogue and purchase requirements to ship/economy factions, remove that unsafe widening/cast, and preserve all current hull/item IDs. No Kessen hull enters hangar normalisation. |
| `economy.ts`, `dialog/types.ts`, guild definitions | `EconFaction` and `DFaction` are independent three-member unions. Keep them so. Kessen relationship is explicit world facts; first arc payment comes from the existing Rustwake client. Named Kessen radio characters use campaign `Character`, whose faction will accept `kessen`; no generated Kessen concourse population yet. |
| `CampaignSession.ts`, `contracts/ContractDesk.ts`, `CampaignRunner.ts`, `campaign/types.ts` | Add a discriminated walker spawn form and tagged actor interface for alive/count/hull/position/kill events. Existing ship specs keep their default path. Retain livery faction separately from team; handle allied, neutral and hostile walkers in both runtimes. Do not route walkers through fighter formation code. |
| `ShipBuilder.ts`, `WeaponVisuals.ts`, `CombatFx.ts`, `DestructionFx.ts`, `Sfx.ts` | Current ternaries classify non-Choir/non-Rustwake as Directorate or use the Rustwake ink range. Frames already use region IDs 3000+. Give walker shots/shields an explicit teal presentation and stable region ownership; preserve existing ship visuals. Named fallback impact sounds are acceptable pending audio work. |
| `FlightRadio.ts`, `barks.ts`, voice traits, `ReachHud.ts`, `ContractsTab.ts`, `StarMap.ts`, `OutfittingTab.ts` | Several string-keyed maps and ternaries silently label unknown factions Directorate/Rustwake. Add Kessen display identity wherever walkers are visible. Route named Kessen lines to their character IDs; no Directorate enemy voice fallback. Market-only labels can remain three-faction after the type boundary is narrowed. |
| `universe/{generate,bodies,stations,traffic}.ts`, `surface/City.ts`, `world/{Station,Docking,Traffic}.ts` | Procedural systems/stations use independent economic domains and string fallback palettes. Do not generate Kessen systems, stations, haulers, ports or docking offers. Test identical seeded Reach output and three-faction market totals. Kessendra remains codex geography. |
| `FlightScene.ts` kill accounting, `world/live.ts`, `universe/traffic.ts` | Free-roam reputation kills explicitly accept only the three economic factions. Preserve those ledger operations; Kessen casualties need their own actor/team-aware relationship event, not a cast to `EconFaction`. |
| `audio/score/catalog.ts`, audio test selectors, `scripts/voice-lines.ts` | Faction score lookup is a separate string map; explicit existing-score fallback initially. Add named-line collection when dialogue lands; ninth-score selection is deferred. |

**Save audit and policy.** `Profile.ts` persists separate `vanguard.profile.v1`, `trade.v1`, `contracts.v1` and `hangar.v1` keys; `WorldState.ts` uses `vanguard.world.v1`. Profile stores no faction enum. `normaliseLedger` reconstructs only default rep keys, so merely writing `rep.kessen` would be discarded on load. Keep the three rep keys and all existing progression unchanged. `normaliseHangar` drops unknown/unflyable catalogue IDs: never put a frame there.

`sanitizeWorld` already retains string/boolean facts and finite numeric counters, so additive `kessen.*` facts require no world schema bump. Absence means undiscovered/uncommitted, never automatically allied. `normaliseBook` only shallow-filters active contracts and retains their objects; add validation for the proposed optional `sideArc` field and explicit unknown-step handling rather than assuming the existing parser validates it. Old active guild jobs, receipts, pending choices and `rustwake.seam` must round-trip unchanged.

Docked career saves need arc progress, decisions and contract receipts, not an arbitrary mid-combat walker snapshot. Replay/kill-cam reconstruction does need the full deterministic walker state. `Replay.ts` is format v1 and checks an exact version; `StateHash.ts` currently hashes ships, ordnance and destruction, not walkers. Introduce a versioned Kessen simulation/hash capability before new tapes are written, retain a legacy reader/path, and test old no-Kessen tapes. File decoding compatibility is distinct from cross-build bit-identical simulation; do not promise the latter without an archived-tape result. Preserve old `world` commands and current `world-patch` commands in `FlightScene`/`ReplayDirector` and test dock resynchronisation.

## 5. Combat slice, determinism and hull attachment

### Simulation contract

Add pure walker state and stepping under `src/kessen/sim/` (proposed new files: `state.ts`, `step.ts`, `consists.ts`, `couplings.ts`, `weapons.ts`, `stats.ts`). Keep render Groups, IK, wall time and audio out of authoritative decisions. Use the engine's existing fixed 60 Hz tick; stable actor IDs share an allocator/namespace with ships so targets, shooter credit and replay commands cannot collide. Fork `Rng` streams by stable actor/consist ID, with stable tie-breaking by ID.

Use a small common combat-target/shooter interface at the Fleet/weapons boundary and adapters for ships and walkers. Cover bolts, beams, missiles, PD, target locks, turrets, HUD brackets, damage credit and mission kill events. Do not force all `ShipEntity` fields onto a frame or refactor unrelated ship flight. First acceptance test is one frame that can both hurt and be hurt by an existing ship through real weapon collision.

Authoritative walker state includes variant, team, pilot status, health, ammunition, cooldowns, shield resources, movement mode, transform/velocity, target IDs, attachment, action phase and tick, orders, Loom membership and RNG state. Hash every field read on the next tick, including pending volleys, breached entry routes, Piledriver charges and death/recovery transitions. Animation samples `tick / 60` plus render interpolation; changing render FPS or hiding a frame must not alter combat.

### Gang and consist behavior

One consist retains the specified 1 Gantry, 2 Derricks, 5 Linesmen, 7 Shunters and 10 Fettlers. Proposed resolution of the 8-versus-25 organisation question: three eight-frame working gangs plus the Gantry foreman. Assign jobs by capability, not Stature alone. Eight consists form the Train; no hidden extra command frame makes it 201.

Use explicit phases: cold approach → screen/Lid → mark facing → Hammer volley → couple → disable assigned subsystem/drive spike → disengage/recover. A consist owns target allocation and resource reservations; gangs execute local work. Use preassigned hull slots and deterministic reassignment after casualties. Loss of an Anvil interrupts that consist's coordinated volley; surviving gang leaders fall back to local cover/withdrawal orders instead of inheriting an unexplained full-Train buff.

The Hammer is coordinated firing of real guns. At 60 Hz, fire within the same tick or a maximum two-tick spread (33.3 ms), satisfying the proposal's ~40 ms window. Do not multiply every gun by the proposal's ambiguous “gang-fire ×25”; interpret it as coordination of up to 25 members pending balance. Empty guns, blocked lines of fire and dead pilots do not contribute. Initial planning cadence: gang/consist decisions every six ticks, staggered by stable ID, with immediate death/order invalidation and movement/collision every tick.

Zero-g approach uses bounded acceleration and limited boost resources; hull movement uses local surface coordinates. Cold frames can be hard to detect until near, not immune to collision or targeting once revealed. Buffers absorb directional physical attacks with finite durability; Lids are finite projected shields with a clear owner and overlap rule (nearest intersected active barrier absorbs once). Repairs consume time/resources and cannot resurrect pilots or rebuild destroyed capital citadels. Unimplemented variant abilities stay disabled in the combat roster until their tests pass.

### Couplings and subsystem damage

1. Build a small authored or deterministically generated hull-surface graph for the first capital test hull. Use HullGrid for broad-phase rejection and cached local collision surfaces/contact normals for exact support. Moving turrets are obstacles, not walking platforms. No per-frame traversal of every render triangle for every boot.
2. Store host entity ID, stable surface/patch ID, local anchor, local normal and tangent heading. Reconstruct world motion from the host's simulation transform; match its velocity before attaching. Camera-origin shifts and renderer LOD cannot move the anchor. Detachment inherits host linear and angular surface velocity.
3. Keep visual two-foot IK separate from the authoritative root/contact. Reject invalid approaches, gaps, occupied slots and host jumps. On host destruction, detach to deterministic drift before wreck cleanup; first version does not walk on detached wreck pieces, which currently do not collide. Never leave a stale host reference.
4. Add a narrowly validated contact/boarding attack route through `Combat.ts`/`Damage.ts` and `Fleet` event settlement. Current `HitInput.onShield` is a geometric input, not a public permission to bypass shields. Validate actual attachment and a reachable subsystem/entry point before allowing an interior hit. External fire continues to respect facing exposure.
5. Mauls attack reachable external mounts. Rivet gangs spend a telegraphed breach interval at an entry point before reaching a generator or bridge; no instant nearest-citadel kill. Boarding is an abstract timed operation, not a new interior level. Piledriver attacks require coupling, alignment, a wind-up and one of six charges. Interruptions and destroyed objectives consume/retain resources by a documented, tested rule.
6. Reuse subsystem effects, `checkStrike`, reactor critical/vent, structural damage, plot armour and `settleDeath`; emit subsystem/kill events exactly once with walker shooter identity. Preserve the existing bridge hull threshold and citadel splash immunity. Do not directly set hull to zero or call `hitSubsystem` without the Fleet aftermath path.

The proposal's Train-versus-*Indomitable* arithmetic is a hypothesis: directional shield transfer, PD, charge delivery, subsystem damage multipliers and losses all affect it. Use an isolated benchmark instance, never the campaign's Rook/Indomitable, to tune toward roughly 180 s and 30–45% frame loss under the stated ambush conditions. Record a seed distribution rather than claiming a scripted 48,600 damage total proves balance. Prepared defenders, range, broken Loom links and failed coupling must be credible counters.

## 6. The Twelfth Hulk — four-step Graveyard side arc

Implement an independent `sideArc: { id: 'twelfth-hulk', step: 1..4 }` contract extension and registry, with pure progression/builders in proposed `src/game/sidearcs/{arcs,kessen}.ts`. Reuse `guilds/arcs.ts`'s `Kit` and ordinary contract settlement, but not its guild-number fact keys. Offer it through Anchorage's existing salvage/Breakers contact and expose a separate side-arc section in `GuildTab`; no new guild rank ladder. Ure remains `gd-breaker`. The existing `rustwake-1..4` story, its pending choice and the Ember ownership outcome remain valid concurrently.

Recommended availability: first two steps after Episode 4 (`story.ep4.done`, next episode ≥5); steps 3–4 after Episode 8. No rank grind, automatic expiry of the door, or irreversible punishment for ignoring optional content. Later saves can play it: after Episode 10 use displaced-yard dialogue; after Episode 18 Continuity's seizure party is a remnant without lawful authority, and no new Schedule correction is generated. Past cameos are not retroactively injected. Map placement must resolve Anchorage and the dead Great Lantern specifically; if unavailable for a nonstandard seed, suppress with a clear reason rather than place the Seam at a random live gate.

| Step | Playable objective and encounter | Persistent result / failure |
|---|---|---|
| **1. Graveyard Shift** | Ure hires a survey of the twelfth hulk before cutting. Identify three structural marks and recover the TAW-9 plate. A small cutter encounter lets the player stop unsafe work; a Fettler emerges from the stern. Ure wants valuable salvage, not a secret genocidal objective he already understands. | On settlement: `kessen.contact`, step 1. Failing the survey or withdrawing offers a retry; no destroyed Seam. One or two visible frames suffice. |
| **2. Running Late** | Return with the plate; hold a scan while Corin's gang stabilises a damaged access span and the player screens scavengers. 0413 recognises the heartcase: “WORKS CONSIST 9. YOU ARE RUNNING LATE.” Corin answers. The player sees the mouth, not Kessendra, and learns why cutting the stern closes it. | On settlement: `kessen.seam.known`, step 2; optional saved-worker acknowledgement. Do not reveal the Builders' solution, let 0413 use “I” before Episode 16, or require a permanent wingman. Maximum eight frames. |
| **3. The Appointed Hour** | Escort Ure's survey launch back for joint inspection. His cutters mark the spine; Continuity arrives claiming the stern as Authority property. Scan the claim and stop a local assault on the access span while Corin/Dray demonstrate one gang's mount-disabling attack. End at a stable stand-off and return evidence to the contact. | Step 3 and a pending custody decision. This local coercion is not silently assigned an `E` number or treated as a generated Schedule battle. Keep Ure's earlier Ember choice in his greeting, not as a gate that locks out this arc. Up to 25 frames only after the consist gate passes. |
| **4. What Walks, Returns** | At the contact, choose the stern's custody with consequences displayed before launch. **Protect:** reject seizure; defend the withdrawal corridor while Kessen disable the seizure ship's weapons and Ure's surviving cutters stand down. **Cede custody:** cover a negotiated Kessen withdrawal through the Seam and escort the Office survey team into position. Both branches require successful play; choosing is not instant completion. | On successful operation/settlement: terminal custody outcome and step 4. Protect leaves an autonomous open door and a limited future support relationship. Custody leaves the door physically intact but controlled, blocks allied deployment and yields an Office payment/favour. Failure/retry retains the selected branch without awarding the outcome. |

Proposed custody tradeoff: protection earns no seizure bounty, keeps Corin's trust and permits explicitly requested, eligible Kessen support; Continuity's local pressure rises. Custody earns a one-time 4,000-share Office payment, loses Kessen trust and produces visible inspections at the stern. Earlier work pays normal small survey/escort fees through the existing Rustwake ledger; final tuning must remain inside career economy bands. Treat refusal of seizure as local guild/Anchorage modifiers, not automatic global Schedule panic. No automatic expulsion from every Directorate guild. Limit local modifier magnitudes to the existing arc range and assert the chosen numbers in economy fixtures.

Recommended first release omits a “cut the Seam forever” player choice. That irreversible homeland isolation warrants its own writing, casualty and finale treatment. It is present as the threat the player learns about, not a surprise timer or incidental stray-bullet outcome. The stern is an explicit story landmark excluded from salvage payouts/outpost claiming; it is not a generic claimable hulk or a reskinned *Long Patience*.

### Facts, settlement and idempotence

Use `sidearc.twelfth-hulk.step.<n>` completion facts; `sidearc.twelfth-hulk.pending` and `.choice` for the preflight choice; `kessen.seam.custody = standing | continuity` for the sole terminal custody value. Derive allied eligibility from custody, completed step 4 and later relationship facts, rather than writing independent booleans that can disagree. Do not use the event log as the authority: it is capped at 400 entries.

Give each operation/decision a stable semantic ID independent of board epoch. An outcome reducer must be a no-op if its completion/receipt token already exists: facts, counters, modifiers, money, merit and news all belong to the same guarded settlement. Existing `completeStep` is guarded, but `GuildRuntime.onReceipt` awards merit before that guard; copying it blindly would allow duplicate side effects.

Because world, ledger and contracts use separate storage keys, add a small replayable settlement journal with an outcome ID and committed snapshot/receipt checks. Recover interrupted writes on load; repeated application must neither pay twice nor lose a completed choice. Record the same decision/outcome as a tick-stamped command/world patch for replay. Test interruption after each persisted component, duplicate receipts, reload while a choice is pending, and new board epochs. Mission failure cannot consume a terminal custody fact. A historical committed outcome survives leaving a system, retries and campaign progression.

## 7. Does Kessen participation make an engagement decisive?

**Recommendation: an opted-in, committed Kessen intervention can make a particular engagement decisive when it materially defeats the scheduled outcome. Presence alone does not.** “Breaking the Schedule” here means violating one engagement's prescribed result, not abolishing the entire institution; Episode 18 still suspends it through `schedule.read`.

The causal chain is player request → visible Kessen commitment → successful objective beyond the prescribed quota/withdrawal → loss of the controlled outcome → market panic and a named correction. The player must be warned before requesting support: “The Standing will not fly the quota. A decisive intervention voids payment and draws a correction.” Hold, commit and withdraw orders remain meaningful. No surprise all-map trigger from a cameo, repairer or cold frame passing nearby.

After the protected-door outcome, offer limited support in eligible free-roam Schedule operations only. Spawn at a feasible, authored approach point, with finite travel/cooldown and a visible objective; no teleporting a Train or unlimited reinforcements. The player must open the approach/suppress defenders and can decline support, fly as ordered or break the engagement themselves. If the Kessen fail before defeating the planned outcome, arrival alone causes no break. Once the conductor is disabled beyond continuation, withdrawal is materially prevented, or the protected objective is destroyed, retreat cannot undo that committed fact. Ordinary quotas are insufficient evidence.

| Case | World consequence |
|---|---|
| Neutral sighting, repair gang, rescue cameo, support held off or defeated without decisive result | Kessen encounter facts as appropriate; no `schedule.broken` mutation. |
| Authorised intervention succeeds in an active generated engagement | Commit one `schedule.broken.<E-id>` outcome with Kessen provenance; void Schedule payment. Keep existing Ebon +0.25 and munitions/piracy/attitude modifier deltas, Continuity hostility, break counter and next-quarter correction. These are modifier inputs with decay/caps, not a promise of exactly 25% final shop-price increase. |
| Player also kills the conductor/refuses withdrawal on the same tick | One canonical engagement outcome and one set of costs; retain additional provenance separately without multiplying effects. |
| Arc fight without an engagement ID | Only arc/local consequences. Do not fabricate a generated engagement or reuse reserved Engagement 131. |
| After `schedule.read`, or Episode 19 | No new market panic/correction from Kessen presence. The Schedule is suspended; local combat facts can still be recorded. |

Add a break reason such as `kessen` through `schedule.ts`, `world/live.ts`, `ContractDesk.ts`, operation flags, news and map descriptions. Current news treats every non-`protected` break as refusal: update it explicitly. Keep `protected`/`refused` old values readable. Save commitment and provenance under engagement-scoped `kessen.engagement.<id>.*` keys; store the actual accepted engagement identity/parameters so a later lookup cannot substitute another regenerated field.

Strengthen outcome guards: `breakEngagement` currently guards only repeated breaks, while `flyAsOrdered` guards both flown and broken. Prevent a completed paid/flown engagement becoming a newly penalised break on reload. `foughtAsScheduled` has no durable per-engagement guard; add a fought fact if new asynchronous intervention resolution can overlap clock-window resolution. Apply a mutually exclusive terminal outcome, resolving simultaneous events deterministically (decisive combat before scheduled withdrawal settlement). Honour `schedule.read` at commit, not just offer time. A failed player mission must still preserve a decisive result already achieved before death; the current success-only `ContractDesk` outcome branch needs an explicit terminal-world-result path.

Corrections change the following quarter; do not regenerate the current posted Schedule. Existing correction state stores a count and one destination per quarter, not a queue for every broken engagement. Preserve that behavior initially, document which final break supplies the destination, and test it. Never silently promise a separate retaliatory mission for each Kessen casualty.

The stricter alternative—any Kessen on the field guarantees decisiveness—would remove useful counterplay, punish incidental encounters, contradict a losing Train, and require either removing Episode 10 participation entirely or rewriting its fixed outcome. It is not recommended. A faction doctrine with observable, consequential success fits both player agency and the existing campaign.

## 8. Restrained campaign appearances

**Episode 10:** a brief Graveyard-lane image of a few frames bracing a damaged span or shielding lifeboat access after `bastion-destroyed`. If contact is known, one Corin acknowledgement; otherwise an unidentified visual. If custody is already hostile/ceded, omit allied help. Never stop the attack, save the carriers/Oyelaran, change the two lifeboat objectives, add kills to the bomber quota, or label this a Schedule break. This is evacuation work outside a committed assault on Engagement 131. Give Oyelaran, Ada's chart and the count-off uninterrupted priority; skip the cameo line if the radio queue is busy.

**Episode 19:** conditional on the autonomous-door/support relationship, one short report from a Kessen defensive detachment at the Nexus and/or a few visible frames guarding a tuning approach. The mission actually runs from Meridian across two jumps; do not move it to the Nexus to literalise the proposal's Train image. A remote report can establish the rest of the Train without rendering 200 actors in every system. Kessen do not tune the road, replace Psalm's Hymn or Candle's knowledge, fire the Zenith's decision, or introduce a new enemy “through the gate.” No free kills toward mandatory objectives. Prefer “Still standing” as a witness line before the protected climax window. Preserve the prime count, Ada's sky and all tuning dwell/jump requirements.

No Episode 20 Kessen combat, explanatory monologue or new cue. The ending retains its quiet and seven-word debrief. Mission variants are built from saved facts at session creation with replay capture; missing side-arc facts always produce the existing campaign path. Test both cameos absent as the default and all three custody/contact branches.

## 9. Delivery phases, file ownership and gates

Ownership below follows `SESSIONS.md`; historical branch names do not prove current availability. At implementation start, refresh the base and agree the cross-owner interface changes. That coordination does not grant this planning task permission to edit gameplay.

| Phase | Deliverable and owned files | Exit gate |
|---|---|---|
| **0 — approve scope** | This document only. David decides D1–D3 below. | Recorded approval of specific decisions; unanswered items remain proposals. |
| **1 — canon and faction boundary** | **Lead + Kessen:** `docs/{LORE,CAMPAIGN,KESSEN,ROADMAP,SESSIONS}.md`, `assets/{Blueprint,Factions}.ts`, Kessen strings/livery; **lead with gameplay-polish coordination:** outfitting/catalogue type narrowing. **Combat owner:** numeric faction/team maps and guarded ship loadout boundary. | `typecheck`, existing faction/economy/outfitting/shipyard/campaign tests; old save fixtures and seeded universe snapshots unchanged. Re-run the audit after edits, including runtime fallbacks. |
| **2 — 1 → 8 actors** | **Kessen:** new sim state, minimal weapons, gang AI, view adapter and viewer test modes. **Lead:** proposed `sim/CombatActor.ts`, Fleet ID/target registry, `FlightScene`, campaign/contract actor adapters, `StateHash`, `ReplayDirector`/replay version handling, HUD. **Combat owner:** weapon/missile/AI-turret target adapters. | Bidirectional damage, team rules, deterministic 10-minute replay with different render cadences, save/replay fixtures; one gang navigates and withdraws without scene dependence. |
| **3 — 25 actors / real coupling** | **Kessen:** consist phases, coupling/surface graph, variant ability modules; **combat owner:** `Combat`, `Damage`, `Subsystems`, `Structure`, `Fleet` aftermath and `Destruction`; **lead:** collision/mission event integration. | Moving/rotating host, shield-entry, breach and death-path tests; 25-frame fight completes headless and live; seed-based balance/counterplay and perf gates below. |
| **4 — arc and world consequences** | **Lead:** new side-arc registry/builders/settlement journal; `contracts/{contracts,ops,ContractDesk}`, `guilds/{guilds,GuildRuntime}`, `ui/GuildTab`, `world/{WorldState,sim,live,schedule,news,diff}`, `ScheduleOverlay`; new named Appointed Hour set piece with `setpieces/index.ts`/types registration; salvage/outpost exclusion. **Kessen:** encounter loadouts. | All four steps and both custody routes, local-vs-Schedule effects, failure/retry, interrupted-save recovery, duplicate settlement and old Rustwake arc coexistence tests; live playthrough. |
| **5 — scale 50 → 100 → 200** | **Kessen + renderer lead:** proposed instanced `FrameBatch.ts`, geometry/material cache and bone palette; necessary `CelMaterial`/ink integration; performance scenario tooling, `sim/balance.ts` fixtures with combat owner. | Advance one tier at a time after deterministic, performance and visual gates. Campaign use stays at the last measured supported tier. |
| **6 — campaign and presentation** | **Lead:** `campaign/{missions,cast,codex}`, conditional session construction and cameo set pieces. **Voice owner:** named text/traits/line collector and later recordings; **score owner:** later ninth score. | Episode 10/19 with every gate state, no-cameo baseline, Episode 20 restraint; subtitle limits, live visuals, flow/career regression. Ninth score is not a prerequisite for mechanical acceptance. |

### Measured progression to a Train

The current ~40 draws per frame implies roughly 8,000 for 200 before weapon/FX passes; it is not a usable performance claim. A 200 × 42 palette is 8,400 matrices (~0.54 MB for float32 4×4 matrices per complete palette), before upload/layout overhead. It does not eliminate CPU pose work or draw calls by itself.

Reuse geometry and batch compatible variant parts with per-instance bone transforms, colour/region data and damage visibility. Batch by actual compatible mesh/kit, not an assumption that all fourteen variants have identical topology. Distance LOD may reduce pose sampling, fingers, pistons and effects, but never authoritative actor count, timing or aim/hit rules. Preserve unique ink boundaries, correct normals, held weapon transforms and upright dead frames. Keep the existing viewer as a near-camera reference and a working WebGL fallback; record a lower visual tier if its GPU budget differs.

For each tier **1, 8, 25, 50, 100, 200**, capture the same seed/camera/resolution, a quiet-hardware baseline and at least three runs after warmup: CPU p50/p95, GPU p50/p95, sim tick p95, draws/triangles, live projectiles, allocations/heap, memory after disposal and hitches. Include mixed variants, close-up movement/IK, full Hammer/Cinder fire, overlapping shields and casualties. A 200-frame gate means 200 actual simulated actors, including the expensive combat peak, not 200 static decorations.

Proposed gates, using `scripts/perf.mjs`'s existing budgets:

- On a recorded real-GPU configuration at 1080p, CPU p95 ≤4 ms and GPU p95 ≤8 ms for the representative scene; report overall frame p95 ≤16.7 ms. Count >33.3 ms warmed hitches and investigate repeatable ones. State backend, GPU, driver, power mode and quality settings.
- Headless total simulation p95 <8 ms/tick for 200 frames plus the target capital, escort screen and peak bounded ordnance. This adopts the roadmap's prospective 200-ship shard budget as a target, not a benchmark already passed by walkers.
- Three load/fight/dispose cycles show no growing live GPU resource counts or retained actor references; memory returns to a stable post-warmup band. Instancing must show a substantial measured draw reduction against the same visible actors.
- Ten-minute repeated-seed hashes match at every checkpoint at each tier, across render cadences and save/replay resynchronisation. No `Math.random` or render-derived surface decisions in sim.
- Do not waive a failed tier by reducing AI updates according to render FPS or by counting a SwiftShader result as a hardware pass. If 200 fails, publish the measured cap and bottleneck and continue optimisation behind that cap.

### Verification inventory

New focused suites: `kessen-sim`, `kessen-couplings`, `kessen-consists`, `kessen-world`, `kessen-arc`, and faction/save compatibility fixtures. Existing suites to extend include `kessen`, `combat`, `subsystems`, `destruction`, `campaign-runner`, `campaign-data`, `guilds`, `contracts`, `world-state`, `world-sim`, `world-diff`, `schedule`, `replay-codec` and `determinism`.

Required cases include stationary/rotating hosts, origin shift, destroyed attachment host, out-of-range boarding, restored shield after valid entry, friendly-fire attribution, command loss mid-volley, zero ammunition, duplicate kill events, same-tick decisive/withdrawal results, late/paid engagements, Episode 18 suspension, log truncation, old guild pending choices and all custody endings. Add assertions that named Kessen radio lines remain ≤140 characters and subtitles satisfy the existing pacing checks.

Run `npm run typecheck` and `npm test` for each coherent code phase, then relevant `ai-sim`, `balance`, `determinism` and `econ-sim` gates when those systems change. Final integration also runs `flow-check`, `career-check` and `node scripts/replay-check.mjs --dock`. Use `npm run perf` for supported scenario tiers and live inspection for hull contact, scale/readability, UI, shields and death/recovery. Test additions should cover these behavioral risks rather than mirror implementation internals.

## 10. Deferred dependencies and essential decisions

**Audio:** the ninth Hammer-song score remains with the soundtrack owner: steel/anvil percussion and work-song response, catalogue/palette registration, score precedence and audible/performance checks. Preserve episode score priority, particularly Episode 19, and the existing title/prologue/trailer Original Score behavior. The Loom's volley tick never depends on musical beat scheduling or audio playback. Until that work lands, use an explicit existing-score fallback.

New named voices and barks follow final line approval and stable gameplay events (“Standing”, Lid deployed, Hammer committed, coupling complete, spike fired, frame stood down/recovered). Scope event payloads and rate limits with the voice owner; subtitles/synth can support development. Generate recordings using the repository's voices workflow once text is stable and verify the manifest/fallback. Do not mark them recorded merely because a line was added. Stencil decals, extra clips, permanent Corin recruitment, playable Kessendra and expanded frame progression remain later work.

The remaining engineering risks are shared combat interfaces still centred on ships, local storage writes spanning several keys, replay hash compatibility, coarse hull geometry, unmeasured real-GPU costs, and proposal stats that do not yet account for the current shield/kill rules. Each has an explicit gate above. Station batteries are still not simulated; do not make the first arc depend on their fire as a hidden balance assumption.

Only these design decisions need David now; numeric tuning, module names and implementation detail can follow the stated gates:

| Decision | Recommendation to approve or amend | Meaning of the alternative |
|---|---|---|
| **D1 — first release and the door** | NPC faction + independent four-step side arc; autonomous protection versus intact-but-controlled Continuity custody; no irreversible Seam destruction, playable frames, new economy or sixth guild. Approve restrained conditional cameos within the unchanged campaign outcomes. | Adding permanent destruction, player ownership or a new homeworld/economy requires a larger story, save and interaction design before implementation. |
| **D2 — decisiveness and agency** | A requested, successful material intervention breaks one active engagement through existing consequences; appearances and failed interventions do not; Episode 18 still ends the Schedule. | “Any Kessen participation always breaks it” requires a different cameo policy, stronger scripting and reduced player/counterplay agency. |
| **D3 — shield entry** | Validated slow relative-motion Couplings can cross a live capital shield; projectiles cannot; internal damage requires a real breach route. | Require a dead facing first, simplifying the first combat slice but revising the Kessen proposal's stated reason walkers bypass ship shields. |

Approval of this plan should record the chosen D1–D3 values and authorised phases. Until then, all recommendations remain unimplemented. The existing name and five Statures do not need to be approved again.
