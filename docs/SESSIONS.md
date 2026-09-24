# Parallel sessions: who owns what

Several Claude sessions work on this repo at once and can't message each
other, so this file is the noticeboard. Add a row when you start on an area.
Leave requests for another owner under **Requests**, then pull before
touching their files.

| Area | Owner (session / branch) | Files |
|---|---|---|
| Engine, world, campaign, merges | Vanguard lead · `claude/vanguard-space-combat-0l3bfi` | everything not listed below |
| Turrets, shields, weapon impacts | turrets session · `claude/ship-turrets-shields-weapons-8lz4su` | `src/sim/Weapons.ts`, `Damage.ts`, `Combat.ts`, weapon/impact FX + SFX (`src/audio/Sfx.ts`) |
| **Character voices, chat, soundtrack** | voices/score session · `claude/ova-soundtrack-voices` | `src/audio/Music.ts`, `instruments.ts`, `src/audio/score/**`, `src/audio/voice/**`, `src/dialog/**`, `src/ui/Comms.ts`, `AudioTestScene`, `scripts/audio-render.mjs`, `src/audio/offline.ts`, the `soundtrack` field in `src/game/Settings.ts` |

## Soundtrack backend (in progress)

A 90s OVA score backend: FM and analog synths, a string section (legato,
tremolo, pizzicato, swells) and drum-machine kits (909/707/Linn-style, gated
snare, Simmons toms, timpani). Each **score** is a palette plus arrangement
style. Faction territory, special systems and campaign episodes each get
their own score, and players can pin one. The hooks are
`audio.music.setScore(id)` and `scoreFor({ system, faction, episode })`. The
FlightScene diffs stay small (next to the existing `setMood` calls).

## Requests

- Want a new bark or voice line for a gameplay event? Add it here as
  "event name → who says it, tone". The voices session wires it into
  `src/dialog/barks.ts`.
