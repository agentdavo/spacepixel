# Parallel sessions: who owns what

Several Claude sessions work on this repo at once and can't message each
other, so this file is the noticeboard. Add a row when you start on an area.
Leave requests for another owner under **Requests**, then pull before
touching their files.

| Area | Owner (session / branch) | Files |
|---|---|---|
| Engine, world, campaign, merges | Vanguard lead · `claude/vanguard-space-combat-0l3bfi` | everything not listed below |
| Turrets, shields, weapon impacts (batch 6) | turrets session · `claude/ship-turrets-shields-weapons-8lz4su` (the user returned it there on 24 Sep) | `src/sim/TurretRig.ts`, `Subsystems.ts`, `Weapons.ts`, `Damage.ts`, `Combat.ts`, `Capitals.ts`, `ai/Turret.ts`, `src/fx/impacts.ts`, `src/world/{WeaponVisuals,CombatFx,ImpactDecals,ShieldGeometry}.ts`, impact SFX. **Handed over 24 Sep** (see below); free for the project thread |
| **Character voices, chat, soundtrack** | voices/score session · `claude/ova-soundtrack-voices` | `src/audio/Music.ts`, `instruments.ts`, `src/audio/score/**`, `src/audio/voice/**`, `src/dialog/**`, `src/ui/Comms.ts`, `AudioTestScene`, `scripts/audio-render.mjs`, `src/audio/offline.ts`, the `soundtrack` field in `src/game/Settings.ts` |

## Batch 6 handover (turrets session, 24 Sep): done / left

Everything below is merged on `claude/ship-turrets-shields-weapons-8lz4su`,
which also carries `claude/vanguard-space-combat-0l3bfi` up to b917a5d.
Typecheck clean, 258 tests, `npm run determinism`, `balance`, `ai-sim` all
pass (4v4 sweep 51 % Concord). Milestone status is in ROADMAP *Batch 6*.

**Done**
- Turret rigs (`src/sim/TurretRig.ts`, `ShipBuilder` auto-rig, `Part.rig`):
  every turret socket gets a traverse joint (`<socket>`) and elevation joint
  (`<socket>/el`); slew, arcs, fire gate, barrel-tip muzzles, recoil, wreck
  pose. `turretWorldPosition(ship, socket, out)`; subsystem id = socket id.
  Missiles launch from launcher sockets; `Weapons.muzzleFlash()` queues
  turret 'fire' events.
- Shields v2 (`Damage.ts`): FACING FORE/AFT/PORT/STBD/DORSAL/VENTRAL,
  `ShipStats.facings` 1 | 2 | 4 | 6, `facingOf` / `facingUp` /
  `facingStrength`, trim + transfer (keys `.` `,` `/`), shield emitters
  (`kind: 'shieldEmitter'`, `facing`), bleed, collapse cooldown, splash.
- Subsystems (`src/sim/Subsystems.ts`): exposure, aimed hit spheres,
  `Fleet.blast` splash, hangar cook-off, damage control, AI stripping,
  B / Shift+B / I picking, HUD brackets + kill feed.
- Impact FX (`src/fx/impacts.ts`, `src/world/ShieldGeometry.ts`,
  `ImpactDecals.ts`, `WeaponVisuals.ts`, `CombatFx.ts`). Test stage:
  `?scene=combat&stage=impacts&side=hull|shield|collapse|regen|subsystem&cam=0|1|2`.

**Left (next owner)**
- Impact **audio** in `src/audio/index.ts` / `Sfx.ts`: shield vs hull per
  `ev.type`, `ev.shielded` beams, 'shield-down', 'shield-up', 'subsystem' by
  `sub.kind`; player-owned turret shots still play the player gun sound.
- Screenshot-verify and tune: hull marks (`ImpactDecals`, TSL instanced
  shader rewritten, final look unconfirmed), capital facing outline / low-cell
  density, collapse, regen, fire columns, beam cut lines. Faction shell
  styles (crystal Choir, scrap Rustwake). Run `npm run perf` on a GPU.
- Trailer / prologue scripted volleys still fire from turret bases.
- Subsystems not yet modelled: sensors, reactor, missile launchers; station
  batteries (bastion turrets are visual-only `scanPose`).
- Kill paths (milestone 6) not started: mine the lead's paused
  `worktree-agent-a936121b44b53858f`.
- Balance watch: stock Valiant vs Vesper now loses ~1–2 / 10 seeds (INFO);
  Cantor shield 110 + 1.5× transfer offsets fore/aft halves.
- Turret drive state is not in `StateHash` (it reaches the world via bolts).

**Events for the voices session** (`WeaponEvent`, `src/sim/Weapons.ts`)
- `shield` (facing held; `facing`, `strength` 0..1, `bleed`),
  `shield-bleed` (leak to hull), `shield-down` (facing collapsed),
  `shield-up` (facing coming back). Fighters report facing 0 fore / 1 aft.
- `subsystem` with `sub.kind` turret | lance | hangar | engine | shieldGen |
  shieldEmitter | bridge (+ `sub.facing` on emitters); also fired for splash
  and cook-off kills. `hit` / `beam-hit` carry the struck `sub` and optional
  `subHp`, `type`, `amount`, `shielded`.
- Existing barks: `mount-player`, `mount-wing` (`src/dialog/barks.ts`).
  Suggested: `shield-down` on the player → wingman "your shields are down",
  shieldGen destroyed on a capital → "their shields are gone", hangar
  cook-off → Cantor / station control alarm.

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
