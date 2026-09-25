# Expansion integration fixes

These bounded corrections apply after `0485121` in the isolated expansion branch. No integration merge or GPU capture is included.

## Contract issuers

Generic boards and direct/guild offer generation now require an authored client from the posting polity. Missing issuers produce no offers; the picker no longer borrows `CLIENTS[0]`. Frontier CONTRACTS explains this and directs pilots to FIRST CONTACT. Accepted jobs remain visible.

Validation: 30 targeted contract/expansion tests passed; 81 legacy boards (399 offers) match a SHA-256 snapshot captured before the fix. All seven new polities reject unsupported generic offers. Production build passed. GPU-disabled browser check passed: the real frontier dock shows the empty-board explanation, no Halloran or repost promise, and still completes a First Contact delivery.

## Ledger quota and delivery persistence

Ledger loading no longer writes a backup. `saveLedger` returns success/failure, prioritizes the primary career, creates a legacy backup only after successful persistence, and can reclaim an earlier optional backup if quota blocks the primary. Failed retries leave the old primary intact and attempt to restore the optional backup. No primary key is deleted to make space.

First Contact uses a durable commit callback: session cargo, reward, standing, receipt and replay ledger event change only after storage succeeds. Failure is visible inside the active tab and leaves the delivery retryable. Existing market/session behavior outside this bounded adapter is unchanged.

Validation: four focused real Profile load/save tests passed (read-only load, quota recovery, failed retry, failure without backup); TypeScript passed. GPU-disabled browser check injected a real Storage write failure, verified the visible error and unchanged session/persisted cargo and reward, restored storage, retried using Enter, and verified one payment across reload.

## Future contact documents

Trade-ledger normalization preserves contact documents with unsupported explicit versions opaquely, including unknown receipt IDs and metadata. Contact eligibility and delivery refuse mutations while normal trade remains available. FIRST CONTACT displays an update-required message and no delivery actions. Supported v1 documents still remove corrupt, duplicate and orphaned completion entries.

Validation: 18 expansion/persistence tests passed, including the reviewer's exact version-2 example through real Profile load, a commodity purchase, save and reload. TypeScript passed. GPU-disabled browser check verified the visible unsupported-version message, absence of delivery buttons and unchanged future receipt document after a real berth/save.

## Prototype berth restoration

The trade ledger now carries `frontierDock` separately from the shared career `lastDock`. Prototype docking records it for either Marches or Reach ports; normal campaign docking preserves it. First entry ignores an existing campaign Reach berth and starts at Threshold. Earlier prototype saves with only a Marches `lastDock` migrate on resume. Invalid station IDs leave the pilot at the initial Threshold flight state without resetting the career. Replay playback does not restore or update the dedicated prototype berth.

Validation: seven persistence tests passed and TypeScript passed. The GPU-disabled browser check verifies actual `currentSystemId`, docking phase, docking target and visible dock screen after Threshold, Stillwater and Rustwake reloads. It also checks first entry with a pre-existing Reach career, legacy Marches migration, a normal Meridian visit between prototype sessions, and invalid-station fallback. These are forced-berth wiring checks, not ordinary-input flight acceptance.

## Combined validation after all four fixes

- Full isolated-branch regression suite: **335 passed, 0 failed**. Output: [integration-tests.txt](integration-tests.txt).
- Content validation, TypeScript and production build passed. Output: [integration-build.txt](integration-build.txt).
- GPU-disabled browser integration check passed with no page/console errors. Output: [integration-browser.txt](integration-browser.txt).
- `git diff --check` passed. U08's native performance, visual, language and ordinary-input playthrough gates remain open. These results do not certify a later integrated tree.
