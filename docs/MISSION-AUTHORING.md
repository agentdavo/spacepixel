# Authoring and debugging Vanguard missions

Each story episode now lives in `src/game/campaign/episodes/`. For example,
Episode 4 is `ep04-black-light.ts`, and Episode 5 is
`ep05-whispers-in-the-static.ts`. Change the relevant episode rather than adding
another branch to FlightScene. `missions.ts` collects the episodes in save order;
existing callers can keep importing from the same entry point.

## Where changes belong

| Change | Owner |
| --- | --- |
| Briefing, dialogue, spawns, objectives, pacing | The episode definition |
| Reusable authoring helpers | `campaign/authoring.ts` |
| Campaign types / supported content vocabulary | `campaign/types.ts` |
| Plot-armour and fallback-system tables | `campaign/runtimePolicy.ts` |
| Objective evaluation, scheduling, runner snapshot mechanics | `game/CampaignRunner.ts` |
| Current objective's copied HUD destination | `campaign/ObjectiveNavigation.ts` and `ui/FlightNavigation.ts` |
| Story-specific interaction with fleet, AI, effects and comms | `game/CampaignSession.ts` |
| Generated operation policy and persistence | `game/contracts/ContractDesk.ts` |
| New physical/visual set-piece behaviour | Its set-piece implementation and session adapter |

The runtime conventions are documented beside the shared authoring helpers.
Predicates read `CampaignContext`; they must not import renderer, DOM or audio
services. Put one-off mission predicates in their episode. Add a shared helper
only when it represents genuinely shared mission behaviour.

## Safe edit loop

1. Keep mission, objective, chatter and tag IDs stable. Current saves also depend
   on mission, spawn and objective array order: reordering an existing array
   requires a migration, even if the visible text is unchanged.
2. Declare ship/set-piece tags before relying on them. Group-prefix references
   are allowed where the runner allows them; `navTag` requires an exact set-piece
   tag. New `navigation` metadata supports exact `ship`, declared `group`, or
   `setpiece` targets and an optional label. A group marker follows its first
   surviving authored member. Deferred references are statically valid but must
   also be available at the time they are used in play.
3. Use world-space offsets in metres. The historical `ahead(x,y,z)` helper adds
   the player's initial position; it does **not** rotate by the ship's heading.
4. Run `npm run check:campaign` for catalog and reference errors, then
   `npm run typecheck`. A diagnostic includes the mission ID, field path and
   error code. `npm run build` includes the campaign check automatically.
5. For changed game rules, add a focused runner/adapter regression and run
   `npm test`. Check both success and failure/departure/restore when affected.
6. Play or replay the changed route with a recorded seed, source revision and
   input trace. Inspect objective visibility, navigation, radio timing, actual
   shield/hull outcomes and completion. Record the actual renderer used.

## Navigation and escort clearance

Use `navigation: { kind: 'group', tag: 'tankers' }` for a moving convoy, or
`navigation: { kind: 'setpiece', tag: 'buoyN' }` for a survey point. Only the
active visible required objective drives the marker; hidden and optional cues
do not redirect it. In a mission with authored navigation, an objective without
a destination clears the mission marker instead of pointing at an unrelated
jump gate. See [objective navigation](OBJECTIVE-NAVIGATION.md) for examples.

For a transfer to a large ship, author `routeArrival` with a world-axis offset
and radius outside the host hull. Guidance and arrival use the same endpoint.
Do not use the host centre as a rendezvous merely because its tag is convenient.
Use `memberOffsets` when the default formation cannot accommodate the group's
hulls; check actual contact after launch grace as well as conservative bounds.
`stationary: true` is available for a neutral static anchor that must hold its
position. It does not freeze hostile or provoked combat actors. Existing saved
positions are preserved, so a content fix does not automatically repair an old
overlapping save. See [clearance evidence](MISSION-CLEARANCE-REVIEW.md).

## What validation does and does not establish

`validateMission(definition, catalogs)` is pure and can also check generated
operations. Catalogs are injected, so it does not need a renderer or global
faction registry. `validateCampaign` adds story ID/order checks and derives cast
and codex catalogs. The command uses the complete runtime blueprint registry,
not only purchasable ships.

Checks cover explicit blueprint, cast, codex, tag and objective references,
duplicate IDs, placements, counts and timing values. Predicates are not executed
or parsed, host-produced flags are not guessed, and validation is not a proof of
reachability or mission completion. A typed `params` bag can still contain a key
the corresponding set piece ignores; a future schema should close that gap.

`validateRunnerSnapshot` handles untrusted loaded snapshot data separately from
authoring checks. Malformed data must fail before restore mutates state or calls
the host. A thrown host callback after valid data begins restoring is a different
failure and is not transactionally rolled back.

## Debugging a mission defect

Identify whether the fault is content, runner scheduling, story/contract policy,
simulation or presentation. Inspect the flag/objective transition and the event
that should cause it. Reproduce with an input replay rather than making the
desired flag true in a capture. Keep an old-save fixture when changing persistence.
Use `tests/campaign-validation.test.ts` and `tests/campaign-snapshot.test.ts` as
examples of checks that isolate the responsible boundary.

An added story episode is not automatically an expansion loader: preserve the
current campaign contract until explicit pack IDs and migrations are implemented.
See [engine architecture](ENGINE-ARCHITECTURE.md) for that direction.
