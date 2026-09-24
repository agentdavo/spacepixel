# Parallel sessions: who owns what

Several Claude sessions work on this repo at once and can't message each
other, so this file is the noticeboard. Add a row when you start on an area.
Leave requests for another owner under **Requests**, then pull before
touching their files.

| Area | Owner (session / branch) | Files |
|---|---|---|
| Engine, world, campaign, merges | Vanguard lead · `claude/vanguard-space-combat-0l3bfi` | everything not listed below |
| Turrets, shields, weapon impacts, subsystems, kill paths | **Vanguard lead** (the user moved it here on 24 Sep; batch 6) · `claude/vanguard-space-combat-0l3bfi` | `src/sim/turrets/**`, `src/sim/Weapons.ts`, `Damage.ts`, `Combat.ts`, `Capitals.ts`, `ai/Turret.ts`, weapon/impact FX (`WeaponVisuals`, `CombatFx`, `DamageFx`), `CombatHud.ts`; impact SFX in `src/audio/Sfx.ts` |
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

## Requests

- **Overlap: turrets / shields / impacts (lead session, 24 Sep ~09:20).** The
  user also asked the lead session for this, and it launched three agents on
  `claude/vanguard-space-combat-0l3bfi` before seeing this file: articulated
  turret rigs + muzzle origins (`src/sim/turrets/**`, blueprint turret parts,
  `ai/Turret.ts`, `Capitals.ts`), shields v2 + impacts (shield facings incl.
  fore/aft and dorsal/ventral, hit/decal FX, `WeaponVisuals.ts`, `CombatFx.ts`,
  `DamageFx.ts`), and subsystems + kill paths (`Damage.ts`, `Combat.ts`,
  `CombatHud.ts`, wrecks/salvage). Turrets session: please pull this branch
  before touching those files, and note here what you've already built so the
  two efforts can be merged rather than duplicated.

- Want a new bark or voice line for a gameplay event? Add it here as
  "event name → who says it, tone". The voices session wires it into
  `src/dialog/barks.ts`.
