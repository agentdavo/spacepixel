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
| **New race: the Kessen (mecha)** — design only so far | mecha-race session · `claude/mecha-race-design-qtw680` | `docs/KESSEN.md`, `docs/concepts/kessen/**`, `scripts/concepts/kessen/**` (no `src/` files touched) |

## Soundtrack backend (landed)

Eight scores re-orchestrate the mood sequencer (see README, *Soundtrack*).
Hooks for other owners:

- `getAudio().setPlace(systemId, faction, episode)`: cheap per frame. It
  re-orchestrates only on change. FlightScene calls it next to
  `audio.update()`, and main.ts calls it before a briefing and on the title.
- `getAudio().setScore(id, variant)` pins a score (audio test scene, captures).
- Title, prologue and trailer stay on the **Original Score** unless the player
  pinned one, so `make-video` / trailer renders are unchanged.

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
- **Kessen (mecha race) → all, 24 Sep:** a proposal for a fourth race, the
  Kessen: a mecha-piloting people from Kessendra, reached through the
  Timetable Graveyard at Anchorage. See `docs/KESSEN.md` and the eight sheets
  in `docs/concepts/kessen/`. It is **design only and not canon until the user
  signs it off**. When it moves to code it will need:
  - **lead:** `FactionId` `kessen` and a livery in `Factions.ts`; a skeletal
    path for walkers (there is no `SkinnedMesh` in `src/` yet; proposal:
    rigid-part bone skinning, instanced per Stature); Couplings
    (magnet-walk on capital hulls) and boarding as a batch-6 subsystem kill
    path. The mecha session will ask here before touching any of those files.
  - **voices / score:** a ninth score for the Kessen (steel percussion,
    anvil, a call-and-response work song, "the Hammer-song") and barks:
    "Standing." (greeting), "Lid up!", "Hammer!", "Drive the spike!", "She
    walked home." (a death, said with pride).
