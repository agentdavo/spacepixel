# Native dock transaction proof

`scripts/dock-transaction-proof.mjs` exercises the actual market, repair,
rearm, shipyard, outfitting and guild wardens' repair controls in disposable browser contexts.
This is a **dock UI fixture**, not a flown mission or evidence that a new
career can afford the purchases. It seeds two million shares, sufficient
standing, three missiles and a damaged stock Kestrel in a disposable save.
The documented `?dock=docked` flag opens a berth at a generated Directorate
bastion; wardens use the Keeping guild seat and `guild=keeping.3` fixture.
No user browser profile or existing player save is opened.

## Native result — 26 September 2026

Prepared in the isolated `codex/dock-transaction-proof` branch and reconciled
with canonical `43b92a3`, including CareerStore commits `a397133` and `3133487`.
All **26 native WebGPU cases passed** on capture HEAD
`82dc94711a56919fec992c87c0f8a43a7fd571e6`, with zero browser errors and process
exit 0. Syntax and diff checks also passed. The accepted durable key is
`vanguard.career.v1`. The owned Edge browser and Vite server closed, and the
exclusive GPU slot was released to Integration & QA after the run.

| Actual UI operation | Legacy write/read denial | Career write/read denial | Successful retry |
| --- | --- | --- | --- |
| Market buy | Pass / pass | Pass / pass | One Ebon-gas unit, 1,358 shares |
| Rearm | Pass / pass | Pass / pass | 3 to 8 salvos, 454 shares |
| Repair | Pass / pass | Pass / pass | 62% to 100% hull, 464 shares |
| Shipyard buy and keep | Pass / pass | Pass / pass | Super Kestrel, 22,000 shares; original retained |
| Buy and fit | Pass / pass | Pass / pass | `g-laser-mk1`, 310 shares |
| Guild wardens' repair | Pass / pass | Pass / pass | 62% to 100% hull, 404 shares |
| Startup read lock | Pass | Pass | Saved Mk II engine restored, then one durable repair |

Every operation preserved the complete live ledger, hangar, hull, loadout and
primary saved values during failure, showed a storage error, and emitted no
confirm cue or new success text. One retry matched the pure transaction result
exactly. A plain reload retained the ledger, fitted ship, loadout and hull
condition. Both startup cases preserved the original save despite restored
access and actual pagehide; the UI required reload before trading.

## Evidence

Evidence is retained at
`C:/Users/David(J)Smith/.codex/worktrees/dock-transaction-proof/spacepixel/scratchpad/dock-proof/run-1`.
The original run contains 52 screenshots, `evidence.json`, and the exact
`harness.mjs`: 54 files, 64,777,075 bytes. A delivery copy of this report and
a SHA-256 manifest are added after acceptance; they do not alter run evidence.

- Evidence JSON SHA-256: `d55e729a18a89daa68ee2485091bbbe01277ae654cc34e52d952374f6f65f1a6`.
- Harness SHA-256: `1bd2a40b96cae98b508931ef5adaf831c315b21254453e92260d1d91498ac9f8`.
- Visually inspected: market failure, shipyard retry, wardens failure, startup
  write-lock warning, and full-hull repair after recovered startup.
- Chief independently inspected the career refit failure screenshot and
  intermediate evidence during execution.

Selected files: `legacy-buy-write-failed.png`,
`career-shipyard-read-retry.png`, `career-wardens-write-failed.png`,
`career-startup-read-lock-locked.png`, and
`career-startup-read-lock-repaired.png`.

## Reproduction

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

This is fixture-based native dock verification, not a flown mission, campaign
economy balance check, physical audio listening test, or exhaustive item/hull
catalogue test. No gameplay code changed in this proof branch. The accepted
store uses a single atomic `setItem` and has no post-write readback stage.

QA additionally identified read-back ambiguity, optional legacy-backup quota
pressure and any multi-step durable boundaries as review targets. The initial
native matrix injects persistent read/write denial. Add a specific additional
seam only if the accepted store has that boundary; do not infer that this
matrix covers every storage instruction or crash/recovery ordering.
