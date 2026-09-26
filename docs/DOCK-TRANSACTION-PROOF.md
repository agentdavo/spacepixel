# Native dock transaction proof

`scripts/dock-transaction-proof.mjs` exercises the actual market, repair,
rearm, shipyard and outfitting controls in disposable browser contexts.
This is a **dock UI fixture**, not a flown mission or evidence that a new
career can afford the purchases. It seeds two million shares, sufficient
standing, three missiles and a damaged stock Kestrel in a disposable save.
The documented `?dock=docked` flag opens a berth at a generated Directorate
bastion. No user browser profile or existing player save is opened.

## Preparation status

Prepared from `a38865a` in the isolated `codex/dock-transaction-proof` branch.
Syntax and diff checks only have run. Native acceptance is **pending** the
chief's committed CareerStore/UI implementation and assigned GPU slot.
The default expected durable key is `vanguard.career.v1`; confirm it against
the accepted store before running, or pass `--store-key`.

```powershell
node --check scripts/dock-transaction-proof.mjs
node scripts/dock-transaction-proof.mjs --run --accepted-source FULL_HEAD_SHA --out scratchpad/dock-proof/run-1
```

The script refuses a dirty tracked source tree, a mismatched source SHA or
an existing output directory. It records the exact source/harness hashes.
`--operations buy,rearm,repair,shipyard,refit` is the default; a narrower list
is useful only for diagnosing a specific failure, not full acceptance.
Use `--port` to select an unused local port. All owned resources close in
`finally`; each case gets a new nonpersistent browser context.

## Sequence

For each operation, exercise both a thrown `setItem` quota error and a thrown
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
The fixture flags are deliberately absent on reload because they would
reset hull/cargo and invalidate persistence verification.

Evidence includes failure and retry screenshots, exact before/after/reload
states, observed messages/sound cues, intercepted fault calls, page errors,
renderer identity and source hashes in `evidence.json`. Native WebGPU is
required. Audio checks observe dispatched UI cues, not physical playback.

## Limits and implementation coordination

The harness must be reconciled with the final store API/error contract before
native execution. A failure is retained as evidence; it is not silently
relabeled as passed. No gameplay changes belong in this branch.

QA additionally identified read-back ambiguity, optional legacy-backup quota
pressure and any multi-step durable boundaries as review targets. The initial
native matrix injects persistent read/write denial. Add a specific additional
seam only if the accepted store has that boundary; do not infer that this
matrix covers every storage instruction or crash/recovery ordering.
