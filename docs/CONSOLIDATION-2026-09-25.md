# Vanguard consolidation — 25 September 2026

Canonical branch: `codex/integrate-audit-trailer-combat-voices` in
`C:/projects/spacepixel`. This consolidates completed work locally; no remote
branch deletion or publication is included.

## Source accounting

- Baseline `c9429e0` already contains modular campaign authoring and snapshot
  validation, combat fixes `9b1e769`, spatial/combat audio `3cb0945`, trailer
  source integration, voice repair, Kessen cameos, and the bounded expansion
  foundation with its persistence and berth fixes.
- Kessen standalone assault commits `0d15ec1` and `706960f` were integrated as
  `1adb5fe` and `c465a65`. Both videos, source, capture harness and original
  evidence are retained. Fresh native WebGPU checks on that combined source
  passed both camera cuts, eight original-scale actors, repeat-seek equality,
  gun alignment and zero browser errors. This remains authored demonstration
  footage, not campaign combat or boarding mechanics.
- Voice repair `d11c78b` is represented by `ed847a6`. Of its 664 changed files,
  662 are blob-identical to the baseline. The package retains the same voice
  command with newer build checks. All 1,639 original manifest entries retain
  identical values; the baseline has nine additional entries. No voice source
  or recording from that change is missing.
- `2378e5d`, the trailer branch tip, is an ancestor of the baseline. Its owner
  rechecked all 151 manifest entries in the portable V4 package with zero hash
  or size mismatches. Final movie SHA256:
  `c5c709830ab871a50616aac4c14d462d734d3ab0e3010c39da026577d9f21c6d`.
- Point-defence and Kessen-foundation branches were checked for patch parity;
  their non-ancestor changes are already represented in the canonical source.
- Rendering reconciliation `b0212de` was merged into staging as `e111a09`.
  It adds portable shield shaders, actual-device GPU timing, restart controls,
  refit resource cleanup, fitted subsystem armour scaling, optional reduced
  effects and independent ship-review tooling. Extra PD cadence tuning and
  unaccepted default bloom / ink changes are excluded. Historical Package A
  and expansion tips remain recoverable through the archive refs below.

## Preservation and branch retirement

Archive tags under `archive/2026-09-25/` retain the exact old branch tips:

| Former task branch suffix | Tip | Status |
| --- | --- | --- |
| `lantern-pd-investigation` | `7fcc10b` | Retired after patch-parity verification. |
| `kessen-faction-foundation` | `e75d68b` | Retired after patch-parity verification. |
| `voice-recording-repair` | `d11c78b` | Retired after file/manifest parity verification. |
| `vanguard-trailer-delivery` | `2378e5d` | Retired after ancestry verification. |
| `kessen-assault-demo` | `706960f` | Archived; integrated as `1adb5fe` / `c465a65`. |
| `render-ships-m01-m04` | `b9b043a` | Archived; completed fixes reconciled in `b0212de`; excluded proposals preserved by tag. |
| `universe-expansion` | `8b084f2` | Archived; expansion selectively integrated and unique rendering fixes reconciled. |

Branch retirement does not delete worktrees. Detached checkouts retain their
files and media. In particular, `f0d2/scratchpad` holds native source frames,
rejected takes and earlier film work; `bef8/scratchpad` holds auditions,
recording helpers, models and environments. These are not all present in the
portable trailer package. No worktree or dependency junction was removed.

Five previously untracked root rendering-review artifacts were copied and
SHA256-verified under
`scratchpad/branch-archive/2026-09-25/root-review-originals/` before replacing
them with the rendering owner's corrected historical record. A manifest
preserves the original hashes. The older Markdown differs by subsequent
authorization/status notes and a correction distinguishing missed shield-shell
contact from an unproven shield-damage bypass.

The original tracking baseline is retained. New active physics and escort
branches are not stale; they have separate source ownership and will return
through chief review. See [team ownership](TEAM-OWNERSHIP.md).

## Combined validation

On combined source `e111a09`, all **350 tests passed** with zero failures in a
serial run. TypeScript, both content validators and the production build also
passed. Logs are retained in [the consolidation evidence](reviews/consolidation).
All existing balance bands passed. Dogfight, capital and traffic each passed
ten simulated minutes of same-seed repeat and JSON-round-trip replay, matching
all 600 checkpoints per scenario; changing the seed changed each world.
The source combines Kessen delivery with rendering/refit reconciliation; it
does not include the subsequent collision or escort fixes still under review.

Renderer reconciliation separately recorded stable resources through twenty
refits and ten scene cycles, restart paths preserving a saved sentinel, and live
shield rendering on WebGPU and WebGL2. Two intentionally injected device-loss
messages are expected in that harness. Those checks do not certify real driver
failure recovery, frame-rate targets or final art quality.

## Reported trailer defect and next work

David flagged 00:42–00:48. Source review found shared escort destinations,
crowding and direction reversal; the 46-second edit also skips 1.5 source
seconds and changes orbit distance. A late shield flash obscures the view.
The new collision task independently found no large-ship pair response above
the fighter-contact cutoff. These are distinct problems with separate owners.

Integration & QA owns escort arrival/spacing. Collision Physics & Capital
Breakup owns contact response and damage. Trailer & Cinematic Capture will
replace only 42.5–48.5 using fresh ordinary-input capture after accepted fixes,
continuous source time and restrained framing. V4 remains preserved. The new
V4.1 cut will keep its 114-second duration and existing narration/music timing.
