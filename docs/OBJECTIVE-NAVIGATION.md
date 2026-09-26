# Episode 4/5 objective navigation

Source base: `a38865a`, isolated branch `codex/objective-navigation`.

## Behavior

Episode 4 marks the live **Magpie's Due** during form-up. The raid, second
torpedo run and convoy arrival objectives mark a surviving **Marsh Tanker**.
The group marker follows the first surviving member in authored spawn/member
order, using its actual current position and display name. It does not jump
between whichever member happens to be closest. A destroyed member is replaced
immediately; no surviving member means no marker.

Episode 5 marks **Null Picket Station 2**, **Survey Buoy North**, **Survey Buoy
Void**, then **Ring throat**. The marker clears during Psalm's Measure and
returns to the station for the final objective. Success and failure clear it.

The active, visible required objective owns the marker. Hidden cues and optional
objectives cannot redirect it. Unreleased or unresolved targets produce no fix.
Legacy Episode 1 `navTag` entries retain their set-piece behavior.

For missions with authored navigation, the flight HUD no longer substitutes a
generic system gate when the mission marker is absent. Free flight and missions
without navigation metadata retain their existing gate guidance. The tactical
map still displays gates as explicitly labelled `LANTERN` landmarks, alongside
the current mission marker when available.

## Implementation boundary

- `CampaignObjective.navigation` declares `setpiece`, exact `ship`, or declared
  `group` targets, with an optional HUD label. Static validation checks kind,
  declared references, member indices and conflicts with legacy `navTag`.
- `ObjectiveNavigation.ts` resolves read-only runner facts. Returned positions
  are copies; callers cannot move ships or set pieces through the HUD adapter.
- `CampaignRunner.navigation()` delegates to this pure resolver. `FlightNavigation.ts`
  selects the mission/gate HUD destination, used by `FlightScene`.
- Objective predicates, arrival/dwell thresholds, chatter, player controls,
  spawn placement, escort steering and snapshot schema are unchanged. Marker
  state is derived, so retry and JSON restore need no new saved fields.

The collision owner owns separate Episode 2/10 placement and escort changes.
The voice owner owns dialogue. This branch does not include either workstream.

## Validation

26 September 2026:

```text
node --experimental-transform-types --no-warnings --test tests/objective-navigation.test.ts tests/campaign-data.test.ts tests/campaign-runner.test.ts tests/campaign-snapshot.test.ts tests/campaign-validation.test.ts
24 tests passed

npm run build
TypeScript, campaign validation, expansion validation and Vite production build passed

git diff --check
Passed
```

The six new navigation tests cover current moving positions; stable group
selection; dead, deferred and unresolved targets; exact group membership;
failure/success cleanup; fresh retry; JSON restore; strict existing proximity
boundaries; full authored survey/dwell/return transitions; optional/hidden
objective isolation; and gate fallback policy. The authoring validation test
checks valid and invalid target kinds and conflicting metadata. Existing
Episode 1, runner and snapshot regressions also pass.

These are CPU fixtures that supply positions and kills to the real runner.
They are not ordinary-input playthrough evidence or collision acceptance.

## Pending native acceptance

After Chief integrates mission clearance and allocates the GPU, use an isolated
browser profile on the merged source. Start Episodes 4 and 5 through the normal
mission entry (or the existing `?scene=flight&episode=4` / `episode=5` test entry).
Use ordinary flight controls, preserving a replay and source revision:

1. In Episode 4, approach the moving Magpie and verify the marker changes to the
   live convoy only when the form-up predicate passes. Inspect both on-screen
   and off-screen labels and the tactical view. Check cleanup on an observed
   failure/retry without injecting flags, damage, poses or objective state.
2. In Episode 5, fly station → North → Void → throat. Verify marker transitions
   at the authored proximity boundaries, the full listening dwell, and marker
   removal for combat. Record return/completion only if actually achieved.
3. Report any unobserved dead-member/completion cases as CPU-only coverage;
   do not describe these unit fixtures as an ordinary flight demonstration.

No browser, GPU capture or native acceptance was run for this handoff.
