# Expansion integration fixes

These bounded corrections apply after `0485121` in the isolated expansion branch. No integration merge or GPU capture is included.

## Contract issuers

Generic boards and direct/guild offer generation now require an authored client from the posting polity. Missing issuers produce no offers; the picker no longer borrows `CLIENTS[0]`. Frontier CONTRACTS explains this and directs pilots to FIRST CONTACT. Accepted jobs remain visible.

Validation: 30 targeted contract/expansion tests passed; 81 legacy boards (399 offers) match a SHA-256 snapshot captured before the fix. All seven new polities reject unsupported generic offers. Production build passed. GPU-disabled browser check passed: the real frontier dock shows the empty-board explanation, no Halloran or repost promise, and still completes a First Contact delivery.

## Ledger quota and delivery persistence

Ledger loading no longer writes a backup. `saveLedger` returns success/failure, prioritizes the primary career, creates a legacy backup only after successful persistence, and can reclaim an earlier optional backup if quota blocks the primary. Failed retries leave the old primary intact and attempt to restore the optional backup. No primary key is deleted to make space.

First Contact uses a durable commit callback: session cargo, reward, standing, receipt and replay ledger event change only after storage succeeds. Failure is visible inside the active tab and leaves the delivery retryable. Existing market/session behavior outside this bounded adapter is unchanged.

Validation: four focused real Profile load/save tests passed (read-only load, quota recovery, failed retry, failure without backup); TypeScript passed. GPU-disabled browser check injected a real Storage write failure, verified the visible error and unchanged session/persisted cargo and reward, restored storage, retried using Enter, and verified one payment across reload.
