# Dependable mission loop

David authorised all five priorities on 26 September 2026. Chief owns integration
and acceptance. The baseline was `a38865a`; V4.1 remains a frozen delivery and
is not relabelled as footage of these later changes.

| Priority | Owner / source | Acceptance |
| --- | --- | --- |
| Safe mission routes | Collisions & Breakup, `b9e7df8`; merged `43b92a3` | Actual EP02 carrier approach and EP10 lifeboat contact reproduced and corrected. CPU flight, mission predicate, hold/resume and restore cases pass; native confirmation pending. |
| Clear objective navigation | Integration & QA, `4135eea` | EP04 live convoy targets and EP05 sequential survey markers integrated. Pure resolver and runner/authoring tests pass; ordinary-input native route proof pending. |
| Durable dock transactions | Chief, `a397133` / `3133487` | Atomic money/hangar record, visible rejection and successful-only replay commands integrated. Fifteen transaction/legacy checks pass; independent review closed guild repair and stale-default overwrite defects. Native dock fault injection pending. |
| Combat instructions and damage readability | Voice, `d10650a`; Combat & Spatial Audio | Eight plain-language cues and six recorded clips integrated. HUD/event readability and matched encounter evidence in progress. |
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
- [Career transactions](CAREER-TRANSACTIONS.md)
- [Mission cue script and recordings](MISSION-CUES-REVIEW.md)

The scope is these concrete mission-loop changes, not certification of all
twenty campaign episodes or every future expansion. Physical surround speakers
and subjective intelligibility still require suitable hardware/listening evidence.
