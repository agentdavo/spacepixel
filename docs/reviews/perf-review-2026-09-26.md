# Performance review — 26 September 2026

Scope: a read-only review of Rendering's ink-shader candidate on
`codex/measured-presentation` (tip `e37b1aa`, candidate commit `4d72fa3`) and
its timing harness. The review ends with a ranked list of other render wins
and the commands to measure them. It is based on reading code only: no GPU or
browser timings were taken, because the native GPU was reserved by another
team. Nothing on `codex/measured-presentation` was changed.

The planet-LOD prewarm (ROADMAP known issue) landed separately in this branch
(`src/render/ShaderPrewarm.ts`, `planetPrewarmPlan` in
`src/world/planets/lod.ts`). Its measurement is in section 5.

---

## 1. Is the uninked-interior skip image-identical?

The candidate (`src/render/post/shaders/inkEdge.wgsl.ts`, `inkAxis`) adds this
after the silhouette term is computed:

```wgsl
if (CI.x == 0.0) { return vec3<f32>(sil, 0.0, 0.0); }
```

Without the skip, the same axis returns `(sil, crease, region)` with

```
wIn    = min(CI.x, min(IA2.x, IB2.x))
crease = smoothstep(params.z, params.z * 1.8, bend) * wIn
region = step(params.w, idDelta) * wIn
```

**Silhouette path.** `sil` (all four silhouette loads, `wSil`, `nearSide`)
is computed before the branch and is returned unchanged. Pixels with no ink,
such as the sky dome (`inkMRT(0, 0, 0)`, positive depth) and glows
(`noInkMRT`), still get a full silhouette. The earlier zero-depth idea would
have missed the sky; this version does not.

**The min argument.** The branch runs only when the centre weight, as loaded
from the texture, compares equal to zero (+0 or −0). Every other value runs
the original code, including NaN (`NaN == 0` is false) and negative weights.
Both versions read the same stored texel, so half-float underflow of a tiny
positive weight to 0 affects them equally.

- If the neighbour weights are finite and ≥ 0, which the MRT contract gives
  (see below), then `wIn = min(0, a, b) = 0`. The original `crease` and
  `region` are then a finite value times zero, so ±0. The candidate returns
  +0.
- **A stronger result for the final image:** the composite uses only
  `edge = clamp(max(e.x, e.y, e.z), 0, 1)`, and `e` is a component-wise max
  over the four axes. The branch depends only on `CI.x`, so all four axes
  skip together. With `CI.x == 0` and any finite neighbours, `wIn ≤ 0`, so
  the original crease and region are ≤ 0 on every axis, because
  `smoothstep ∈ [0, 1]` and `step ∈ {0, 1}`. That gives
  `clamp(max(S, y≤0, z≤0), 0, 1) = clamp(max(S, 0), 0, 1)`, which is the
  candidate's value whether `S` is positive or negative. So the final edge
  matches **even if a neighbour weight were negative**. Signed zero cannot
  leak through: `mix(lit, lineColor, ±0)` returns `lit`.
- Only the debug `edges` view can differ, because it shows the raw crease and
  region channels. It differs only where a neighbour weight is negative or
  NaN.

**Why the weights are finite and ≥ 0.** `sceneMRT()` defaults the ink
attachment to weight 1. `inkMRT` writes the given weights, which are all
positive constants today. `noInkMRT` writes 0. Blending on the ink attachment
uses `MaterialBlending`, so each result is a convex or additive mix of
non-negative values. The clear value is 0.

**NaN and degenerate thresholds.** The original can produce NaN where the
candidate produces 0:

- when a neighbour weight is NaN, because `min(0, NaN)` is
  implementation-defined;
- when `creaseThreshold` is set to 0, because `smoothstep(0, 0, 0)` is 0/0.

The WGSL specification also lets implementations assume that NaN and
infinity never occur, so NaN behaviour is not portable on either side. The
candidate's behaviour here is, if anything, more defined.

**Verdict.** Under WGSL real-number semantics, with the ink-weight contract
above and `params.z > 0`, the skip is **provably identical for the composited
image**, at every resolution and with line boil on. That proof does not cover
the driver's floating-point freedom: DXC, FXC or Metal may contract or
reorder the `sil` arithmetic differently once the control flow changes. So
the claim must still be confirmed by exact-pixel parity, which the harness
supports through `--mode=parity` and `compare-presentation.py`, and not by
reasoning alone. `textureLoad` has no implicit derivatives, so the divergent
return is legal. The WebGL TSL twin correctly keeps the unbranched form,
because it uses filtered samples.

**Expected gain, which is small.** The shader does 34 loads per pixel: 2 at
the centre plus 4 axes × (4 silhouette + 4 interior). The skip removes 16 of
them, 47 %, but only saves time when a whole SIMD wave (8–64 pixels) is
uninked. Mixed waves along every hull edge run both paths. In the one
exploratory 1080p sweep, the entire ink pass was worth about 1.3 ms at p50
(`full` 15.04 ms against `noink` 13.72 ms, single runs, Intel Xe-LPG). A
realistic ceiling for this candidate is well under half of that, times the
fraction of uniformly uninked waves. That is at or below the noise of the
current harness (section 2). Rendering's decision not to ship on mixed data
is right. The change is safe but unproven. If it is revisited, hoist the test
into `inkEdge` (one branch, silhouette-only loop) and judge it only against
the criteria in section 3.

---

## 2. Bias risks in the timing harness

Files: `scripts/measured-presentation.mjs` and `scripts/presentation-report.mjs`
on `codex/measured-presentation`, plus `src/core/Perf.ts`.

| # | Risk | Where | Effect | Fix |
|---|---|---|---|---|
| 1 | **Unbalanced order.** Odd runs use the list order `[720 ref, 720 cand, 1080 ref, 1080 cand]` and even runs reverse it. With the default `--runs=3`, the reference goes first in its pair two times out of three. Each 720 block also follows a 1080 block in reversed runs. | `for (let run…) run % 2 ? reverse : selected` | Order, thermal and GC drift land unevenly on one arm. | Use an even number of runs with ABBA pairs inside each resolution, and randomise the resolution block order per run. |
| 2 | **Clock and power state (DVFS).** Timing uses real rAF: headless Edge (Playwright's default), `shot=1`, and a 60 Hz sim. The GPU idles between frames and the integrated Xe-LPG shares a power budget with the CPU. The data show the effect: `capital-scene-720` p50 was 12.29 ms in run 1 and 4.92 ms in run 2. Many cases report interval p95 ≈ 33 ms, meaning they fell to 30 Hz pacing. | `open()` query, `Perf.ts` | A faster shader leaves more idle time and lower clocks, which can erase or invert a small gain. The lighter 720p case is hit hardest. This alone explains "mixed 720p / 1080p". | Keep the GPU saturated during a sample window (stepped back-to-back frames, or no frame cap: `--disable-gpu-vsync --disable-frame-rate-limit`). Log the clock or power state. Plug in and use a high-performance power plan. |
| 3 | **Short warm-up.** 180 frames (about 3 s) from a cold page, with no discarded first case in the session. | `perfwarmup: '180'` | Early boost clocks and cold browser caches favour whichever case runs first. | Discard one full warm-up case per session. Warm up for time (≥ 20 s) rather than frames. |
| 4 | **Sparse, rate-dependent samples.** There is one GPU sample per timestamp resolve (`Perf.end` keeps a single resolve in flight). three returns only the **last frame** of each resolved batch (`WebGPUTimestampQueryPool._resolveQueries`). The gate `gpuSamples >= 120` counts `Ring.count`, which is capped at 240. | `waitForFunction(... gpuSamples >= 120)` | The sampling rate depends on readback latency, which differs by variant and resolution. A p95 over 120 samples is the 6th-worst sample, a very noisy tail. | Gate on ≥ 600 samples with a larger ring, or keep every frame's timestamp. Decide on p50 or a trimmed mean, with p95 only as a guard. |
| 5 | **Median of per-run p95 values.** The report takes the median over 3 runs of a tail statistic. `e37b1aa` fixed even counts, which had returned the upper-middle value and biased high; now it averages the central pair. It is still n = 3 and unpaired, with no interval. | `presentation-report.mjs` `median` | "Mixed" is the expected outcome of this estimator whenever the effect is small. | Analyse paired differences (ref − cand per ABBA pair) with the median difference, a sign test, and a bootstrap CI. Record raw per-frame samples, not only summaries. |
| 6 | **Two dev servers.** `--mode=focused` serves the candidate from port 5240 and the reference from 5241. That means separate origins with their own localStorage and IndexedDB (profile and settings written during a case persist per origin within the context), separate HTTP caches, and separate dependency pre-bundle caches (`node_modules/.vite-measured-524x`). Both serve unbundled development ESM with `import.meta.env.DEV` set, not a production build. | `makeServer()` | CPU and interval numbers do not represent the shipping build, and origin state can diverge between arms. GPU timestamps are mostly unaffected. | Serve both variants from one origin: build two production bundles (`vite build`, reference blob swapped in) and choose between them with a query parameter, or clear storage before each case. |
| 7 | **Polling cost.** `waitForFunction(..., polling: 25)` calls `hooks.perf()` every 25 ms, and that sorts 8 rings of up to 240 floats each time. | harness wait loop | Main-thread noise in CPU p95 and interval. It hits both arms equally, but it widens the spread. | Poll a cheap counter and read `perf()` once at the end. |
| 8 | **Diluted metric.** GPU time is the sum of every pass (scene MRT, bloom mips, FXAA RTT, output). The ink shader runs inside one full-screen pass. | `Perf.gpu` | A 20 % change in ink cost is only about 2 % of the total. | Report per-pass durations. three already keys them by pass (`timestampQueryPool.render.timestamps`). Judge the pass the change touches, and use the total only as a no-regression guard. |
| 9 | **One content point.** The focused mode uses only the frozen capital close-up. The candidate's gain scales with the sky fraction. | `cases` for `focused` | A result is valid for that framing only. | Add a sky-heavy framing (small hull in frame) and a hull-filled framing. Require no regression on either. |

Things the harness does well and should keep: one browser session with both
variants interleaved, a seeded `Math.random`, a frozen fixture, recorded
adapter, source, diff hash and sample counts, backend and adapter asserts,
a STOP file, and exact-pixel parity with a fixed shader clock.

---

## 3. Pre-registered acceptance criteria for any future shader optimisation

Fix these before the first timing run. Report every run, including failures.
Do not add runs after seeing results.

1. **Image identity.** Zero differing pixels (`exact: true` for every pair in
   `compare-presentation.py`) on the full parity set at both 1280×720 and
   1920×1080, with the fixed shader clock. If the change touches the ink
   channels, also capture `view=edges`. Any non-zero pixel is a reject unless
   the change is explicitly an art change with art sign-off, which is outside
   this process.
2. **Minimum gain.** The median paired improvement in the affected pass's GPU
   time must be ≥ 5 % of that pass **and** ≥ 0.15 ms of total frame GPU time
   at 1920×1080 on the reference adapter. At 1280×720 the change must not
   regress: median paired difference ≥ 0, with no single pair worse than
   +2 %.
3. **Runs and agreement.** At least 8 ABBA pairs per resolution in one browser
   session, after one discarded warm-up case, each with ≥ 600 GPU samples
   collected under saturated-GPU conditions (section 2, item 2). The candidate
   must win at least 7 of 8 pairs at 1080p (one-sided sign test, p ≈ 0.035),
   and the 95 % bootstrap CI of the median paired difference must exclude 0.
4. **Noise floor.** In the same session, run an A/A control (reference against
   reference, same pairing). Its median |difference| must be below half the
   gain threshold in item 2. Otherwise the session is void, not a failure of
   the candidate.
5. **Both resolutions and two framings.** Criteria 2–3 apply at both
   resolutions, on the capital close-up and on one sky-heavy framing.
6. **Provenance.** Record the adapter, driver, browser version, power plan,
   source SHA, diff hash, and the per-frame raw samples.

A candidate that meets item 1 but not item 2 is "safe, unproven". Park it with
this record. Do not keep re-measuring it until it passes.

---

## 4. Cheaper, likelier wins (from reading the code)

Ranked by expected gain against risk. None of these were measured.

1. **The sky dome is shaded under every pixel.** In `src/world/Backdrop.ts:108-160`
   the dome is opaque with `renderOrder = -1000` and `depthWrite = false`, so
   it draws first and early-Z never rejects it. Hull pixels pay for the sky
   and then overwrite it. Per pixel it evaluates 12 octaves of MaterialX
   Perlin fBm (3 + 5 + 4) and 15 cell-noise calls (three star layers). This
   is likely the most expensive full-screen ALU work in the scene pass.
   - **Option A (image-identical in principle):** draw the dome after the
     opaques, depth-tested, with depth forced to the far plane in the vertex
     stage. The 400 km dome would otherwise occlude farther planets. Parity
     is required: the sky's gbuf writes then happen only where it is visible,
     which is exactly where they survive today.
   - **Option B:** bake the static nebula and wisps into a per-system cubemap
     at load, and keep the stars live. This is a visual change and needs art
     sign-off.
   - **Upper bound:** `?skydome=0`, the ablation flag added in this branch.
2. **Hyperspace zoom blur is always sampled.** In `src/render/post/InkPipeline.ts:166-173`,
   4 full-resolution `color` samples feed `blur` and are then mixed with
   `jump * 0.7`, which is 0 outside a jump. Wrap them in a uniform-condition
   `If(jump > 0)`. `select`/`mix` still evaluate both sides, so a real branch
   is needed. The output is exactly identical when `jump = 0`, the loads fall
   in uniform control flow, and derivatives stay safe. The chromatic-
   aberration pair (`caAmt`, lines 162-164) is live whenever `speed > 0`, so
   leave it.
3. **Transparent effects write three MRT attachments.** `noInkMRT` materials
   (HazeClouds, MultiplaneSky, sparkles, atmosphere shells, dust) blend zeros
   into `gbuf` and `ink` (`InkChannels.ts:37-38`). That is two wasted
   read-modify-write attachment operations per overdraw fragment on large
   overlapping quads. A per-attachment write mask would remove them, but it
   needs three.js support. Measure overdraw-heavy framings (the asteroid
   field with haze) before investing.
4. **Planet LOD savings are still unmeasured.** Run the existing A/B
   (`planetlod=0` against default) now that first-use hitches are gone.
5. **The ink skip, made coherent.** Only worth revisiting after items 1–2, as
   a single branch in `inkEdge` under section 3.

Not recommended: packing the ink target as 8-bit. The region-id threshold
(0.004) is just above 1/255, so adjacent ids would stop producing lines.

---

## 5. Measurement commands for when the GPU is free

All commands run from the repository root in PowerShell on the reserved
machine. They use one Vite origin per invocation (port 5198), the default
headless Edge, and `--stepped` (record = 60, shot = 1, deterministic demo
autopilot). Run every pair as ABBA, 4 or more repeats per resolution. Output
goes to `docs/reviews/perf-2026-09-26/`.

### A. Planet LOD prewarm (this branch)

`?planetlodcycle=3` walks every body far → mid → full, switching at t = 3 s
and t = 6 s of planet clock, inside the measured window. `?prewarm=0` is the
control arm.

```powershell
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --query "planetlodcycle=3" --out docs/reviews/perf-2026-09-26/prewarm-on-1080-1.json
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --query "planetlodcycle=3&prewarm=0" --out docs/reviews/perf-2026-09-26/prewarm-off-1080-1.json
npm run perf -- --stepped --scene flight --frames 480 --size 1280x720 --query "planetlodcycle=3" --out docs/reviews/perf-2026-09-26/prewarm-on-720-1.json
npm run perf -- --stepped --scene flight --frames 480 --size 1280x720 --query "planetlodcycle=3&prewarm=0" --out docs/reviews/perf-2026-09-26/prewarm-off-720-1.json
```

Read these fields in each report:

- `perf.planetLod.switches`: must be > 0, otherwise no body was on screen and
  the run tells you nothing. In that case try the same with
  `--query "dock=approach&planetlodcycle=3"`.
- `perf.planetLod.cold`: expected lower with prewarm on. Level 0 → far at
  load is cold in both arms and happens during warm-up.
- `perf.prewarm.compiled`, `errors` (must be 0), and `ms`.
- `perf.cpu.max`, `perf.hitches`, `steppedMsPerFrame.max`.

Pass condition: with prewarm on, the mid switch at t = 3 s adds no hitch
(`hitches` on ≤ off, `cpu.max` on < off in ≥ 3 of 4 pairs). Steady state
(`gpu.p50`, `cpu.p50`) stays within the A/A spread.

### B. Top candidates (upper bounds and baselines)

```powershell
# Sky dome cost (upper bound for item 1): baseline vs dome hidden
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --out docs/reviews/perf-2026-09-26/base-1080-1.json
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --query "skydome=0" --out docs/reviews/perf-2026-09-26/skydome0-1080-1.json
npm run perf -- --stepped --scene flight --frames 480 --size 1280x720 --out docs/reviews/perf-2026-09-26/base-720-1.json
npm run perf -- --stepped --scene flight --frames 480 --size 1280x720 --query "skydome=0" --out docs/reviews/perf-2026-09-26/skydome0-720-1.json

# Whole post chain (ink + bloom + grade + FXAA) upper bound: scene pass only
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --query "view=color" --out docs/reviews/perf-2026-09-26/postoff-1080-1.json

# Planet surface LOD savings (ROADMAP): full detail pinned vs LOD
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --query "planetlod=0" --out docs/reviews/perf-2026-09-26/lod-pinned-full-1080-1.json

# Fill-rate sensitivity reference: 0.75 render scale
npm run perf -- --stepped --scene flight --frames 480 --size 1920x1080 --query "quality=low" --out docs/reviews/perf-2026-09-26/scale075-1080-1.json
```

Compare `perf.gpu.p50` (the primary metric) and `perf.gpuRender.p95` (the
guard) against the matching baseline pair. `?ink=0` is **not** an ablation:
it only zeroes a uniform, and the edge shader still runs. Ink-pass cost can
only be separated with the `postprobe` probes on `codex/measured-presentation`.

ABBA loop, the same pattern for every pair:

```powershell
$arms = @(@{ n = 'on'; q = 'planetlodcycle=3' }, @{ n = 'off'; q = 'planetlodcycle=3&prewarm=0' })
foreach ($size in '1920x1080', '1280x720') {
  foreach ($i in 1..4) {
    foreach ($k in $(if ($i % 2) { 0, 1 } else { 1, 0 })) {
      $a = $arms[$k]
      npm run perf -- --stepped --scene flight --frames 480 --size $size --query $a.q --out "docs/reviews/perf-2026-09-26/prewarm-$($a.n)-$size-$i.json"
    }
  }
}
```

Caveats:

- Stepped mode waits for `onSubmittedWorkDone` every frame, so the GPU idles
  between frames. That is fine for counting hitches (A), but for GPU-time
  A/B cross-check each result once with a non-stepped run:
  `npm run perf -- --scene flight --frames 720 --size 1920x1080 --query "skydome=0"`.
  Apply the saturation advice from section 2, item 2.
- `skydome=0` also changes what the ink pass sees behind hulls: the cleared
  G-buffer (1/z = 0) replaces the dome's small positive 1/z. The per-pixel
  ink work is unchanged, so the delta still isolates the dome.
