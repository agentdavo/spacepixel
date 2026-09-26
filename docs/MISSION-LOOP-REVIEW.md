# Dependable mission loop

David authorised all five priorities on 26 September 2026. Chief owns integration
and acceptance. The baseline was `a38865a`; V4.1 remains a frozen delivery and
is not relabelled as footage of these later changes.

| Priority | Owner / source | Acceptance |
| --- | --- | --- |
| Safe mission routes | Collisions & Breakup, `b9e7df8`; merged `43b92a3` | Actual EP02 carrier approach and EP10 lifeboat contact reproduced and corrected. CPU flight, mission predicate, hold/resume and restore cases pass. Native 35 s EP02 approach/arrival/hold and 25 s EP10 initial hold show zero contacts involving either protected pair; independent raw-data review passes. |
| Clear objective navigation | Integration & QA, `4135eea`; native source `1de3652` | EP04 switches from Magpie to the live convoy at 39.233 s. EP05 advances through all four survey destinations, completes the 20 s listening dwell and clears navigation for combat at 87.1 s. Four fresh native tapes replay all 188 checkpoints without desynchronization. |
| Durable dock transactions | Chief, `a397133` / `3133487`; native proof `1d751d2` | Atomic money/hangar record, visible rejection and successful-only replay commands integrated. Fifteen transaction/legacy checks and all 26 native failure/retry/reload cases pass. Independent review closed guild repair and stale-default overwrite defects. |
| Combat instructions and damage readability | Voice, `d10650a`; Combat & Spatial Audio, integrated `1de3652` | Eight plain-language cues, six recorded clips and shield/hull impact labels integrated. Matched native EP04 takes pass all 60 replay checks each with identical combat events and no browser errors. Eight follow-up tests pass. |
| Measured presentation | Rendering & Ship Art | Current-hardware measurements and one bounded improvement in progress; no performance or visual acceptance claimed yet. |

## Integration policy

One source owner per subsystem and isolated branches from the accepted baseline.
GPU captures are serial: combat/audio, measured presentation, dock transaction
proof, then joint navigation/clearance. New mission authoring uses fresh input
tapes rather than old tapes with changed rules. Native fixtures identify their
source, setup and any injected state; ordinary-flight evidence uses controls
without forcing mission flags, kills or positions.

All **393 tests passed** on `43b92a3`; the production build and both content
validators passed. Logs are recorded in `reviews/mission-loop/combined-tests.txt`
and `combined-build.txt`. This run includes the transaction,
navigation, clearance and cue changes; later presentation additions require
their own targeted validation before final combined acceptance.

## Supporting reviews

- [Mission clearance](MISSION-CLEARANCE-REVIEW.md)
- [Objective navigation](OBJECTIVE-NAVIGATION.md)
- [Native routes, replay and independent clearance audit](OBJECTIVE-NAVIGATION-NATIVE.md)
- [Career transactions](CAREER-TRANSACTIONS.md)
- [Native dock failure/retry/reload proof](DOCK-TRANSACTION-PROOF.md)
- [Mission cue script and recordings](MISSION-CUES-REVIEW.md)
- [Combat readability and matched encounter](COMBAT-READABILITY-2026-09-26.md)

The complete dock evidence archive is also copied to the canonical workspace at
`scratchpad/dock-proof/dock-transaction-proof-26-pass.zip`; chief independently
verified SHA-256 `9d042a48376e60794bf11fcaef550f5fb848864591b7330a9486f05028397e9f`.
Combat review video/audio pairs and their verified manifest are retained in
`scratchpad/combat-readability/`. These ignored media files are local deliverables;
the source, review reports and compact evidence are committed.
All 147 raw navigation/clearance artifacts were also copied and independently
hash-verified against their recorded manifest in
`scratchpad/objective-navigation-native/` (55,273,163 bytes, excluding the manifest).

The scope is these concrete mission-loop changes, not certification of all
twenty campaign episodes or every future expansion. Physical surround speakers
and subjective intelligibility still require suitable hardware/listening evidence.
