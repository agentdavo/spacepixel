# Next trailer: cinematic revision proposal

Review of the delivered V3 clarity cut, 25 September 2026. This is a shot plan,
not an approved new edit. V3 is preserved. No narration or full render has been
started. The chief owns the full script rewrite and final duration.

Revision 2 incorporates the chief's replacement twelve-line script: gates let
ships travel; failure cuts worlds off; scarce fuel makes reopened routes worth
fighting over; the player joins Vanguard; after the battle, the ship's computer
answers an unknown signal. The old countdown premise is removed. The gate can
return at the end because it now carries a specific new event, not a vague slogan.

The current weakness is visual cause and effect: we spend 45 seconds looking
at similar rings before identifying the player's role, then hold a rotating
combat view for 29 seconds. More spectacle alone will not explain the story.
The next script should determine these beats, with each image supplying one
concrete fact rather than decorating a proper noun.

## Five changes tied to the current cut

| Current time | Change and proposed treatment | Available material / bounded pickup |
| --- | --- | --- |
| **00:00–00:45** | **Show what a gate does before showing its loss.** Lead with 6–8 seconds of the working route and ships using it; then 5–6 seconds of the dark ring and 5–7 seconds of wreckage. The contrast becomes transport → lost connection → physical aftermath. Avoid the present 18-second opening hold followed by two more long, similar ring views. Leave dates/names to the rewritten script after the function is clear. | Reorder `lore-living-take-1`, `lore-gate-take-1`, and `lore-wreckage-take-1`. The existing living view is dominated by the player's engines; use the actual EP04 convoy pickup described below for close cargo coverage, paired with the already recorded working gate. A separate freighter beauty pickup is not required. Do not fabricate a gate transit or present the staged wreckage as an actual historical event being simulated. |
| **00:45–01:21** | **Introduce the player once, then keep their action legible.** Bring the fighter's approach/lock/fire forward to the script's player introduction. Use roughly source **0–6 seconds**, including the missile command near 3 seconds and target destruction at 4.217 seconds; remove most of the empty post-kill coast now at 01:04–01:10. Use one clear 6–8-second bridge/bow passage for capital command, instead of repeatedly switching between fighter and capital with no explanation. Drop the obstructed LOCK material around 01:18. | `fighter-take-1`, source 0–6, and `capital-controls-take-1`, source 0–7 or 7–14. These are separate encounters: do not cut a fighter missile launch against capital damage as if one caused the other. Preserve one uninterrupted 6–10-second native HUD segment elsewhere for actual playability. |
| **01:21–01:50** | **Give the battle geography and escalation.** Replace the uninterrupted 29-second orbit with a short wide establishing view, a readable firing beat, a 2–3-second shield/subsystem change, and an exterior damage beat. Keep the same battle in increasing source time. Suggested anchors: source 30–34 wide; 35–40 broadside; 44–47 HUD damage; 54–59 exterior damage. Cut on a real discharge or impact, not on each sentence. Aim for roughly 16–20 seconds rather than a complete repeated camera revolution. | Existing `capital-exterior-hud-take-1` covers source 30–59. One **3–4-second native tactical wide pickup** can show the player's capital, escorts and target together, so the audience understands who is shooting at whom. Native tactical/orbit are implemented in `CameraDirector`; only presentation framing changes, with the original tape and checkpoint checks retained. |
| **01:50–02:10** | **Let destruction be the consequence, then hold the aftermath.** Keep a continuous **16-second source 64–80** passage from the same recorded battle. That puts failure about 1.48 seconds into the shot and still reaches the separated wrecks visible near source 79. The current early lead-in plus long rotating smoke cloud dilutes the payoff. Withdraw the score shortly before the actual failure, retain the game's rupture/impact sound, and let the two pieces drift without narration. Do not add a second explosion or manufacture a clearer split. | `capital-hero-take-1` already covers 60.5–80.5. This is an edit and sound-timing change, with no new outcome or capture required. Preserve the real smoke and the time needed for the two hull sections to become visible. |
| **02:10–02:33** | **Make the mystery happen to the player's ship.** After the unvoiced wreck aftermath, return to the broken gate for the new signal line, then move into the player's native HUD/computer response for the final line. This is a new event with a personal consequence, not the discarded countdown. Allow roughly 12–16 seconds for the three spoken hook lines, then 8–9 seconds for the complete title/slate fade. | Existing dark-gate footage establishes the location. An optional **3–4-second actual EP05 computer-response HUD pickup** can show `RESPONSE TRANSMITTED.` as implemented in `missions.ts` (burst beat, around line 562). Reach the event through normal mission play; do not fabricate a terminal or force the mission flag during capture. If this cannot be captured, let the narrator supply the fact over the gate/player image instead of inventing a UI response. The previously proposed closing flyby is no longer needed. |

## Provisional sequence against the new script

| Approximate new time | Script beat and picture job |
| --- | --- |
| 00:00–00:13 | Line 1: working gate and moving ships establish travel between worlds. |
| 00:13–00:25 | Lines 2–3: dark ring, then wreckage; connection lost and ships missing. |
| 00:25–00:36 | Lines 4–5: reopened gate and useful cargo ships; explain the fuel without pretending to show a harvest. |
| 00:36–00:48 | Lines 6–7: distinguish opposing ships, then the supply convoy at risk. |
| 00:48–01:05 | Lines 8–9: player fighter, readable HUD action, then a capital threat. A real EP04 convoy-defense pickup can specifically support the protection task. |
| 01:05–01:33 | No narration: chronological battle escalation followed by the 16-second genuine breakup/aftermath. |
| 01:33–01:49 | Lines 10–12: broken gate, signal, player's computer response; keep the mystery personal and concrete. |
| 01:49–01:58 | Title and complete end slate. |

These are planning windows, not final speech cues. About 110–120 seconds is a
reasonable first assembly target; the natural reading sets exact cuts. No voice
has been commissioned for this proposal. The earlier 153-second duration and
92-second HUD total are explicitly not targets for this rewrite.

## Editorial guardrails

- Fit the runtime to the new plain-English script and its natural read. These
  changes can remove about 25–35 seconds of repetition; do not pad back to
  153 seconds merely to preserve V3's length.
- Retain at least 70 seconds of recognisable gameplay under the existing brief,
  with readable continuous HUD passages. Do not treat V3's 92 HUD seconds as a
  creative target. Clean native views can establish scale and relationships.
- Do not show the same ship damage moving backwards in time. Civilian, fighter
  and capital footage may form a thematic montage but must not imply an escort
  mission or missile-to-capital hit that the recordings did not contain.
- There is no existing footage proving fuel harvesting or a specific civilian
  rescue. The script should not depend on either image without a separately
  supported scene. Explain any required lore in concrete language over an
  appropriate route/cargo image, not an invented visual demonstration.
- No new Kessen exposition or reveal. These changes neither require nor expand
  a Kessen appearance; any later approved image remains cameo-only.
- Keep the runtime LOCK/own-hull intersection documented. Avoid those frames;
  the held-orbit trailer workaround did not repair that game-camera issue.

Suggested additional capture scope after the script/plan is accepted: roughly
14–18 seconds of selected footage, comprising an 8–10-second actual EP04 convoy
attack/defense passage, a 3–4-second tactical battle wide, and a 3–4-second actual
EP05 computer-response HUD passage. Mission pickups require normal gameplay to
reach those events; this footage length is not an estimate of production time.
EP04 already implements tankers, delayed raiders and protection objectives
(`missions.ts`, episode `ep04-black-light`, around lines 423–452). EP05 already
implements the computer's response; no new campaign reveal or Kessen scene is
needed. The remaining pictures can be recut from preserved JPEGs and event logs.
