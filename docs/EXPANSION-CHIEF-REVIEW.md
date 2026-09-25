# Open Horizon foundation: chief integration review

25 September 2026. Reviewed expansion commit `0485121` on
`codex/universe-expansion`, based on rendering Package A `02b2817` and planning
commit `b9b043a`. This is a bounded package review, not U08 release acceptance.

## Decision

The bounded foundation is accepted for prototype integration after all four
findings below were corrected and the combined checks passed. Package A ancestry
is excluded: current combat/audio fixes are the baseline, and the existing
hangar supplies hull inspection. The findings below document the original review
of `0485121`, not unresolved defects in the corrected integration.

The new content registries, language data, survey graph and contact rules follow
the intended pure-content/adapter boundaries. Legacy faction and team indices
are retained and new entries appended. The atlas is separate from flight;
192 survey records do not represent 192 completed playable systems. The flight
prototype adds six systems to the original 22; eight new hulls remain blockouts.

The owner reports 326 passing tests, build/content checks and GPU-disabled browser
checks on the isolated branch. Those results do not validate the combined tree,
native expansion rendering, an ordinary-input playthrough or physical audio.

## Findings assigned to the expansion owner

### P2 — new-port contracts silently use a Directorate client

`src/game/contracts/contracts.ts:584–587` selects clients only from the old cast
and falls back to `CLIENTS[0]`. A direct generator reproduction at a Pelagic
Threshold freeport returned six offers, all with `faction: pelagic` and client
`cl-halloran` (Directorate Quartermaster Halloran). The new voice table does not
fix the issuer identity or portrait.

Use explicitly authored issuers, or suppress unsupported generic offers while
retaining the First Contact supply agreements. Preserve deterministic legacy
boards. A focused regression must prevent cross-faction fallback at new ports.

### P2 — optional backup can prevent a durable career save

`src/game/Profile.ts:74–76` writes a pre-expansion ledger backup while loading.
The independent persistence review reproduced a quota case through real
`loadLedger`, `saveLedger` and `deliverContact`: old primary plus backup fits,
updated primary alone fits, but updated primary plus backup does not. The save
then silently leaves the old primary unchanged. Removing only the optional
backup allows the same write to succeed.

Durable primary persistence must take precedence over optional backup capacity.
Preserve the old career when no safe write succeeds and surface failed delivery
persistence. Add quota-pressure coverage, not only successful round trips.

### P2 — leaving the Marches breaks prototype berth resume

`src/world/scenes/FlightScene.ts:452` attempts resume only for `marches:*` IDs.
The prototype includes the Reach and its Rustwake border. After docking at a
Reach port, `lastDock` is valid but the same prototype URL starts at Threshold
and skips restoring that berth. A separate prototype location or explicit
first-entry/continuation state must distinguish this from starting the pilot.

The browser check at `scripts/check-frontier-ui.mjs:75–77` only asserts the ledger
field, so it passes even if actual berth restoration is removed. Assert the
current system, docking phase/target and visible dock screen, including a
non-Threshold destination. This finding is based on control flow, not a claimed
human-flown reproduction.

### P2 — future contact versions are silently downgraded

`src/game/expansion/contact.ts:18–24` does not check the stored version before
normalizing receipts. A read-only reproduction through `normaliseLedger` changed
`{version:2, completed:['pelagic-1','pelagic-4'], receipts:{'pelagic-4':{reward:3300,revision:2}}}`
into `{version:1, completed:['pelagic-1']}`. Ordinary save round trips therefore
discard unknown receipt metadata. This demonstrates forward-version data loss,
not an immediate duplicate-payment exploit with the current schema.

Preserve unsupported contact subdocuments and disable their mutation, or protect
the ledger with a surfaced incompatibility diagnostic. Do not throw into the
existing broad `loadLedger` catch and accidentally substitute a new career.
Known v1 orphan/unknown-ID cleanup is a distinct policy. Add future-contact
preservation coverage; the separate atlas-save version guard does not cover it.

The v1 delivery transform itself couples cargo, payment, standing and receipt in
one value and leaves the input unchanged. Its UI reads the current ledger on
each click, correctly preventing ordinary repeated-click/reload payment. The
independent review used static analysis and two in-memory Node/SSR probes; it
made no source changes or native gameplay claims.

## Integration sequence

1. Review the bounded fixes and their regressions; preserve both campaign and
   expansion validation commands in the combined build.
2. Reconcile Package A combat changes against the reviewed combat/audio baseline.
   Both packages add compact-capital shield redistribution. Package A also changes
   fitted point-defence burst pauses; the audio/combat task instead fixes relative
   bolt-versus-moving-missile sweep. Do not stack tuning changes unintentionally.
3. Apply the bounded expansion changes and explicitly required presentation pieces.
   The atlas's hull-inspection links depend on Package A's ship-review scene;
   either include that reviewed dependency or adjust the links.
4. Run combined content, save, faction-consumer, replay and gameplay checks.
   Then inspect the new hulls/ports in native rendering and fly a contact route.

Package A's measured integrated-GPU runs miss its proposed 720p and 1080p budgets;
they do not establish 1080p/60 readiness. Rendering lifecycle improvements and
visual changes must be reviewed separately from expansion content. No U08,
complete localization, production fleet or language-voice acceptance is granted
by this review.

## Corrected integration and independent checks

| Original finding | Owner fix | Integrated commit |
| --- | --- | --- |
| Incorrect issuer fallback | `e7b027a` | `d7de2c6` |
| Backup quota / durable contact delivery | `3728de8` | `1965919` |
| Future contact document preservation | `0f976f2` | `199c224` |
| Actual Reach and Marches berth restoration | `8b084f2` | `425d67c` |

Foundation `0485121` was applied as `96de95f` to engine/combat/audio baseline
`3bff2bb`; only the expansion-plan document was taken from `b9b043a`. No Package A
combat, point-defence cadence, renderer, resource or recovery changes were added.
The build retains both `check:campaign` and `check:expansion`. Atlas inspection
links use the existing `?scene=hangar&ship=<id>` four-view model sheet.

The persistence reviewer independently reran the original quota and future-version
probes against the fixes and found no new blocking defect. The primary ledger is
written before optional backup; only the optional backup is evicted for retry;
unrecoverable failure preserves the old primary. First Contact changes in-memory
state only after durable persistence. Unsupported contact records round-trip
unchanged and cannot be mutated by delivery. Known v1 corruption recovery remains.

`frontierDock` records prototype berths separately from normal visits. Existing
Marches-only saves migrate. An earlier-build save containing only a Reach
`lastDock` cannot reveal whether it came from prototype or normal play; this
ambiguous case uses first-entry behaviour. Generic market saves retain their
existing session-only failure policy; the new durable transaction boundary is
currently specific to First Contact.

Chief reran the following on the combined tree, including its integration edits:

- **343 tests passed**, including the dynamic contact/damage matrix for all 36
  registered hulls and legacy contract-board snapshot parity.
- Production build passed TypeScript, twenty-episode campaign validation and
  expansion content validation.
- All unchanged combat balance checks passed. These are the existing encounter
  bands, not new-civilization encounter tuning acceptance.
- Dogfight, capital and traffic each passed ten simulated minutes: repeat and
  JSON replay matched all 600 one-second checkpoints; a different seed differed.
- GPU-disabled browser checks passed atlas navigation, expanded-text layouts,
  independent language preferences, failed delivery save/retry, future-contact
  diagnostic, and actual system/phase/target/visible-screen restoration at
  Threshold, Stillwater and Rustwake. First entry, old Marches migration, a normal
  Meridian visit and invalid-berth fallback are covered.

Raw combined logs are in `docs/reviews/expansion-integration/`. Browser testing
uses fixture cargo and forced berths; it is not an ordinary-input playthrough.
Native hull/station rendering, fleet performance, physical surround, full language
review and U08 release acceptance remain open. Frozen V4 footage is unchanged.
