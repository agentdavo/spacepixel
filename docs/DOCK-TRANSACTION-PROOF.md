# Native dock transaction proof

`scripts/dock-transaction-proof.mjs` exercises the actual market, repair,
rearm, shipyard, outfitting and guild wardens' repair controls in disposable browser contexts.
This is a **dock UI fixture**, not a flown mission or evidence that a new
career can afford the purchases. It seeds two million shares, sufficient
standing, three missiles and a damaged stock Kestrel in a disposable save.
The documented `?dock=docked` flag opens a berth at a generated Directorate
bastion; wardens use the Keeping guild seat and `guild=keeping.3` fixture.
No user browser profile or existing player save is opened.

## Preparation status

Prepared in the isolated `codex/dock-transaction-proof` branch and reconciled
with canonical `43b92a3`, including CareerStore commits `a397133` and `3133487`.
Syntax and diff checks only have run. Native acceptance is **pending** the
assigned GPU slot. The accepted durable key is `vanguard.career.v1`.

```powershell
node --check scripts/dock-transaction-proof.mjs
node scripts/dock-transaction-proof.mjs --run --accepted-source FULL_HEAD_SHA --out scratchpad/dock-proof/run-1
```

The script refuses a dirty tracked source tree, a mismatched source SHA or
an existing output directory. It records the exact source/harness hashes.
`--operations buy,rearm,repair,shipyard,refit,wardens` is the default; a narrower list
is useful only for diagnosing a specific failure, not full acceptance.
`--formats legacy,career` covers both unmigrated and authoritative pair saves.
Use `--port` to select an unused local port. All owned resources close in
`finally`; each case gets a new nonpersistent browser context.

## Sequence

For each operation and each save format, exercise both a thrown `setItem` quota error and a thrown
`getItem` permission error at the career/ledger/hangar keys after boot.
Choose an affordable purchase using read-only domain calculations, select
the actual DOM controls, then click the transaction button.

The failed attempt must produce a storage failure message, no new success
text and no confirm sound. Complete ledger, hangar/fit, live hull/loadout
and saved primary values must remain unchanged. Diagnostic snapshots read
through the retained native storage getter so the injected exception cannot
conceal a changed stored value. Fault counters prove that the fault fired.

Restore storage, click retry exactly once, and compare the result against
one pure domain transaction. Reload without `dock` or `cargo` flags and
verify exact ledger/hangar, fitted loadout, active ship and hull condition.
Read reload state before advancing any simulation tick (which changes the clock).
The fixture flags are deliberately absent on reload because they would
reset hull/cargo and invalidate persistence verification.

Two additional startup cases seed a distinctive Mk II engine, deny reads before
scene construction, then restore storage access. A real repair button must
still report `RELOAD BEFORE TRADING` and preserve all saved state. Actual page
navigation exercises pagehide while stale defaults remain locked. A fresh page
must restore the saved money and fitted engine; a subsequent repair must save
once and restore full hull condition on the next plain reload. The full matrix
contains 26 cases: 24 operation/fault/format combinations and two startup locks.

Evidence includes failure and retry screenshots, exact before/after/reload
states, observed messages/sound cues, intercepted fault calls, page errors,
renderer identity and source hashes in `evidence.json`. Native WebGPU is
required. Audio checks observe dispatched UI cues, not physical playback.

## Limits and implementation coordination

Market and rearm retain the legacy ledger until the first paired operation;
repair, shipyard, refit and wardens migrate to the atomic career envelope.
A failure is retained as evidence; it is not silently
relabeled as passed. No gameplay changes belong in this branch.

QA additionally identified read-back ambiguity, optional legacy-backup quota
pressure and any multi-step durable boundaries as review targets. The initial
native matrix injects persistent read/write denial. Add a specific additional
seam only if the accepted store has that boundary; do not infer that this
matrix covers every storage instruction or crash/recovery ordering.
