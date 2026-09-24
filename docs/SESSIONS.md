# Parallel sessions: who owns what

Several Claude sessions work on this repo at once and can't message each
other, so this file is the noticeboard. Add a row when you start on an area.
Leave requests for another owner under **Requests**, then pull before
touching their files.

| Area | Owner (session / branch) | Files |
|---|---|---|
| Engine, world, campaign, merges | Vanguard lead · `claude/vanguard-space-combat-0l3bfi` | everything not listed below |
| Turrets, shields, weapon impacts (batch 6) | turrets session · `claude/ship-turrets-shields-weapons-8lz4su` (the user returned it there on 24 Sep) | `src/sim/turrets/**`, `src/sim/Weapons.ts`, `Damage.ts`, `Combat.ts`, `Capitals.ts`, `ai/Turret.ts`, weapon/impact FX + SFX |
| **Character voices, chat, soundtrack** | voices/score session · `claude/ova-soundtrack-voices` | `src/audio/Music.ts`, `instruments.ts`, `src/audio/score/**`, `src/audio/voice/**`, `src/dialog/**`, `src/ui/Comms.ts`, `AudioTestScene`, `scripts/audio-render.mjs`, `src/audio/offline.ts`, the `soundtrack` field in `src/game/Settings.ts` |

## Soundtrack backend (landed)

Eight scores re-orchestrate the mood sequencer (see README, *Soundtrack*).
Hooks for other owners:

- `getAudio().setPlace(systemId, faction, episode)`: cheap per frame. It
  re-orchestrates only on change. FlightScene calls it next to
  `audio.update()`, and main.ts calls it before a briefing and on the title.
- `getAudio().setScore(id, variant)` pins a score (audio test scene, captures).
- Title, prologue and trailer stay on the **Original Score** unless the player
  pinned one, so `make-video` / trailer renders are unchanged.

## Voices / chat / soundtrack handoff (24 Sep, `claude/ova-soundtrack-voices`)

The voices/score session is stopping here. A project thread continues from
this file. Everything is merged into `claude/vanguard-space-combat-0l3bfi`.

**Done** (`tsc` clean, `npm test` 227/227 incl. `tests/score.test.ts`, every
score scenario in `scripts/audio-render.mjs` renders with 0 clipped samples,
live-checked in Chromium: faction pick, `?score=`, Shift+F7, `?scene=audio`):

- `src/audio/score/`: `rack.ts` (strings / FM / analog / drum-kit patches),
  `palette.ts` (routes the mood scripts' instrument calls to each score's
  patches), `scores.ts` (8 scores: palettes, per-mood rewrites, score parts),
  `catalog.ts` (pure resolver: pinned > episode > special system > faction >
  original, plus a stable per-system/episode variant).
- `Music.setScore` crossfade, ensemble chorus (its LFOs are stopped in
  `Strip.dispose`), swing, per-score reverb rooms, score-aware stings.
  `GameAudio.setPlace` is called per frame in FlightScene and in `main.ts`
  (briefing, title).
- Settings: `soundtrack` field, Shift+F7, `?score=`. The hotkeys now install
  from the audio layer, so they work in every scene.
- Original Score (title, prologue, trailer) renders identically to before.
- Samples: `docs/audio/score-reel.mp3`, `score-reel-cruise.mp3`. README
  *Soundtrack* section.

**Left / known issues:**

- The mix is tuned from level and spectrum analysis only; nobody has listened
  to it. Orchestral scores (Cathedral, Long Dark, Anchor) are darker in
  battle than the synth ones, so the string/timpani levels may want a pass.
- Only cruise and combat are rendered per score. Title, briefing, dread,
  sublime, victory and defeat under non-original scores are untested by ear
  (they run and don't clip in the audio test scene).
- No per-frame CPU measurement of the heavier scores (Symphony of Gates
  combat) on a real device. Offline renders run faster than real time on
  SwiftShader.
- The batch 6 barks (Requests below) are waiting on event names from the
  turrets session.
- Voices and dialog: no changes in this session beyond ownership. The
  procedural voice, barks and concourse dialog are as the lead left them.

## Lead session handoff (24 Sep, `claude/vanguard-space-combat-0l3bfi`)

The lead session is stopping here; a project thread continues from this file.

**Done and merged on this branch** (all checks green at `b02c1e6`: `tsc`,
`npm test` 221/221, `ai-sim`, `balance`, `econ-sim`, `determinism`,
`flow-check`, `career-check`, `attract-check` 3 cycles):

- Batches 1–2: engine, ink/cel pipeline, flight, AI, campaign (20 episodes).
- Batch 3: prologue + cinema sequencer, 90 s trailer, attract mode, photo
  mode, `record` → `make-video` clip pipeline; stations, docking for every
  hull size (bays, clamp arms, moorings), planetary ports (descent to surface
  cities), trade, repair/rearm, contracts, free-roam career loop; MP-0
  (fixed 60 Hz step, seeded RNG, bit-exact replays, kill-cam).
- Batch 4: combat depth, 28 hulls T1–T6, shipyard + outfitting (398 items),
  living Reach (planets, moons, traffic, ambushes), people/dialog/voices,
  collisions, economy balance, integration polish, rough-edges pass.
- Batch 5: WorldState memory, guilds (5) + 20 arc missions + outposts, world
  sim (story → economy, player actions, news), the Schedule, the Signal
  countdown, NPC arcs (7) + rivals (6).
- Last fixes: attract-loop leaks (planet LOD caches; renderer RenderObjects
  retaining old scenes).

**Left / known issues** (details in `docs/ROADMAP.md` → Known issues):

- Batch 6 (turrets, shields v2, impacts, subsystems, kill paths): turrets
  session. The lead's paused batch 6 WIP is listed under Requests.
- Never flown live, only exercised headless: breaking the Schedule, rival
  fights end to end (retreat/eject, rival-led ambushes), desert/ice/volcanic
  surface descents, the traffic/rival encounter mix over a long session.
- Replay tapes: guild/outpost actions record a full WorldState snapshot
  (`world` command); migrate to small commands like the world sim's.
- Balance: story-rule economy effects are hand-tuned; stock T5 loses to a
  Lantern Guard (by design, may surprise).
- Perf: everything measured on SwiftShader only; planet LOD savings, first
  LOD-switch hitch, and all budgets need a real-GPU pass (`npm run perf`).
- Multiplayer roadmap items 15–20 (headless shard, two-browser flight,
  Lantern-jump handoff, persistent economy, co-op, playtest):
  `docs/MULTIPLAYER.md`.
- Batch 3 items still open: attract/trailer "10 min unattended" is verified
  (3 cycles); photo mode exists; planetary ports have no contract kinds.

## Wing chat (voices session)

- Wing orders (keys 1–4) get a spoken answer from the lead wingman, in
  character (`order-*` barks in `src/dialog/barks.ts`); "attack my target"
  with no lock gets a "which one?". The only touch outside this area is one
  line in `FlightScene.onKey`: `this.radio.order(this.wingOrder, !!this.lock.target)`.
- On a long quiet leg (30 s clear of hostiles, 90 s between exchanges, never
  during an episode) the wing chats among itself: `BANTER` in `barks.ts`.

## Requests

- **Batch 6 overlap, resolved (user, 24 Sep ~10:20).** Batch 6 (turrets,
  shields, impacts, subsystems, kill paths) stays with the turrets session.
  The lead session's three batch 6 agents are **paused** and it will start no
  new batch 6 work. Their unfinished, unverified work is committed on local
  branches in the lead session's container (not pushed):
  `worktree-agent-a9181dba8d1e07ff0` (turret rigs + muzzles, 6 commits),
  `worktree-agent-ad2e6ed36bfec934d` (shields v2 + impact decals, 2 commits),
  `worktree-agent-a936121b44b53858f` (subsystems v2 + kill paths: structural
  break-up, reactor, bridge kill, wrecks/salvage, 14 commits). Ask the lead
  session (via the user) to push any of them if you want to mine them.

- **Voices → batch 6 owner (turrets session):** once shields v2, subsystems and kill paths emit
  events, list their `WeaponEvent.kind` names here (e.g. `facing-down`,
  `reactor-critical`, `bridge-kill`, `turret-destroyed`). The voices session
  will add wingman / Cantor / station-control barks for them (voiced,
  subtitled, rate-limited) and a music stinger for reactor detonations.
  Impact SFX in `Sfx.ts` stay yours.
- Want a new bark or voice line for a gameplay event? Add it here as
  "event name → who says it, tone". The voices session wires it into
  `src/dialog/barks.ts`.
