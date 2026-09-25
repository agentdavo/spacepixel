# Expansion integration fixes

These bounded corrections apply after `0485121` in the isolated expansion branch. No integration merge or GPU capture is included.

## Contract issuers

Generic boards and direct/guild offer generation now require an authored client from the posting polity. Missing issuers produce no offers; the picker no longer borrows `CLIENTS[0]`. Frontier CONTRACTS explains this and directs pilots to FIRST CONTACT. Accepted jobs remain visible.

Validation: 30 targeted contract/expansion tests passed; 81 legacy boards (399 offers) match a SHA-256 snapshot captured before the fix. All seven new polities reject unsupported generic offers. Production build passed. GPU-disabled browser check passed: the real frontier dock shows the empty-board explanation, no Halloran or repost promise, and still completes a First Contact delivery.
