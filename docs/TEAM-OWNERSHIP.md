# Vanguard task ownership and next delivery

Chief coordination record, 25 September 2026. David requested a single integrated
codebase, retirement of stale branches, clear task names and coordinated game
improvements. Existing task history and raw production media remain available.

## Working agreement

- The canonical development branch is `codex/integrate-audit-trailer-combat-voices`
  in `C:/projects/spacepixel`. Begin new implementation branches from its latest
  accepted commit, not the older project default.
- One owner changes a subsystem at a time. Other tasks supply evidence and
  review; they do not make competing fixes in the shared checkout.
- Each handoff states source commit, actual changes, tests, reproduction steps,
  artifacts and limitations. The chief reviews and integrates bounded commits.
- Native GPU capture is serialized. Historical captures describe their source
  revision; merging code does not make old performance evidence current.
- Completed task branches may retire after ancestry or content-parity review.
  Archived refs preserve excluded experiments. Worktree media is not deleted as
  part of branch cleanup.

## Owners

| Task | Responsibility | Next delivery / acceptance |
| --- | --- | --- |
| Vanguard — Chief Architect & Integration | Engine boundaries, editorial direction, scope and final integration | Consolidate completed work; maintain this ownership record and the acceptance gates. |
| Vanguard — Integration & QA | Cross-system regressions, first-session route and persistence | Verify objective navigation through escort/survey transitions; then durable acknowledgement for purchase/refit saves. Demonstrate ordinary-input play and storage-fault/reload cases. Coordinate source ownership before implementation. |
| Vanguard — Combat & Spatial Audio | Weapon contact semantics, shields, combat cues and output routing | Make absorbed, bleeding, collapsed and hull-hit states understandable; calibrate objective dialogue during sustained combat. Use seeded native clips, event-to-cue checks, bounded voices and stereo/headphone evaluation. |
| Vanguard — Rendering & Ship Art | Cel rendering, GPU lifecycle, performance and ship presentation | Reconcile completed Package A fixes without extra PD tuning or unaccepted default style changes. Next: measured hardware profiling and clearer finished ship/station silhouettes. |
| Vanguard — Kessen & Campaign Integration | Restrained campaign cameos, Kessen continuity and dedicated demonstrations | Keep Episode 10/19 outcomes intact. Standalone assault footage is staged, not evidence of implemented campaign collision or boarding. Subsequent work must improve cameo clarity before broadening mechanics. |
| Vanguard — Trailer & Cinematic Capture | Capture provenance, shot continuity, film assembly and delivery | Diagnose V4 00:42–00:48 with collision owner; identify actual source shot/tape and distinguish camera, replay and simulation faults. Preserve V4; reshoot only after the underlying issue is understood. |
| Vanguard — Dialogue & Voice Production | Plain-language lore, recorded dialogue and voice assets | Write objective lines as action, visible object and reason; introduce gate function before lore names. Preserve Chapter I ferry/picket identity: the player joins Vanguard in Chapter II. Coordinate final text/timing with mission and audio owners before recording. |
| Vanguard — Point Defence & Combat Verification | Independent weapon/interception verification | Supply reproducible contact and interception cases to the combat owner. Do not maintain a competing combat implementation or duplicate collision ownership. |
| Vanguard — Collisions & Breakup | Ship-to-ship contact, collision response/damage, structural breakup and avoidance interfaces | Bounded solver and feedback fixes accepted. Support the fresh convoy proof, then address authored spawn/route clearance with QA; defer larger physics scope until ordinary missions are safe. |

## Priority order

1. Establish the combined source baseline and close the reported trailer motion /
   collision diagnosis. Heavy ships must have weight and consequential impacts;
   breakup must follow actual structural damage.
2. Prove the opening loop: understand the objective, fly, fight, dock, trade/refit,
   save, close and resume. Clear navigation and durable transactions outrank new
   content volume.
3. Make shield state and personal danger readable while objective speech remains
   intelligible. Rendering, combat audio and dialogue owners share one encounter
   fixture and retain separate source responsibilities.
4. Improve measured frame time and silhouette/readability on declared hardware
   before increasing fleet density or claiming expansion production readiness.

## Acceptance limits

The collision task's initial source audit found that ships above the existing
fighter contact cutoff act as obstacles for smaller craft but had no large-ship
pair response. The bounded contact/damage fix is accepted through `dee8042`;
combined validation and limitations are in [the contact review](CONTACT-INTEGRATION.md). The
trailer also changes source time and camera scale at 46 seconds; that edit must
be diagnosed separately from simulation defects.

The shared-destination escort bug is corrected in `5cd644c` / `61c97f6` and
integrated into the canonical branch, with 27 campaign/cameo regression checks
and the production build passing. Native collision before/after proof and
exactly-once event, damage-layer and surface-normal reviews are complete.
The next gate is fresh ordinary-input Episode 4 capture/replay and the V4.1
replacement shot; neither old tapes nor controlled collision fixtures prove it.

The V4 film is a completed review artifact, not blanket acceptance of gameplay.
The Kessen assault is a standalone authored demonstration. Expansion registries,
six additional flyable systems and eight hull blockouts are a bounded prototype.
Physical 5.1 speakers remain unverified on the available two-channel device.
Package A's historical hardware frame-time targets and visual signoff remain
open even when individual correctness fixes are integrated.
