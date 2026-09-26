# Opening and EP04 objective speech

26 September 2026. Base: `a38865a`; branch: `codex/mission-cues`.
The chief locked these exact eight replacements before recording. This slice
changes chatter text and six human recordings. Mission objectives, navigation
metadata, triggers, priorities, spawn timing, briefing prose and other dialogue
remain as authored. QA owns the separate navigation changes.

## Cue sheet

Indices below are zero-based within each chatter beat. Full source paths are
`src/game/campaign/episodes/ep01-the-long-dark.ts` and
`src/game/campaign/episodes/ep04-black-light.ts`.

| Cue / actual trigger | Visible goal and reason | Locked spoken replacement |
| --- | --- | --- |
| EP01 `open[1]`, Candle; mission start, priority 2 | `Survey buoy 1`, tag `buoy1`, starts 2,500 m ahead. First objective completes within 300 m. Ferry airframe 0413 to Anchorage Yards. | I'm Brother Oduya. Fly to Survey buoy one. We're taking your fighter to Anchorage Yards. |
| EP01 `open[2]`, Candle; follows previous line | Oduya's escort fighter and the Timetable Graveyard wreckage. Establish companion and immediate hazard before the Keepings. | I'll follow you through the wrecks. Keep clear of the old hulls. |
| EP04 `open[0]`, Magpie; mission start, default priority | `Magpie's Due`, tag `magpie`; form-up completes within 800 m. Three `Marsh Tanker` escorts route to `rwbuoy`. | Kestrel, join my ship, the Magpie's Due. We're escorting three fuel tankers to the gate. |
| EP04 `open[1]`, Magpie; follows previous line | At least two tankers must survive; keeping all three is optional. Fuel powers gate travel. | They carry fuel for the gates. Keep at least two tankers alive. Bring all three home if you can. |
| EP04 `raid[0]`, SYSTEM; elapsed 38 s, priority 3 | Three `Choir Raider` fighters spawn at 38 s; two `Psalter` bombers at 42 s. The old line prematurely announced five contacts. | ENEMY FIGHTERS APPROACHING. TORPEDO BOMBERS WILL FOLLOW. |
| EP04 `raid[1]`, Magpie; follows SYSTEM warning | Destroy the five raiders while keeping the tankers alive. Describe bombers by their role before relying on the class name. | Kestrel, destroy the raiders. Hit the torpedo bombers before they reach our tankers! |
| EP04 `second-run[0]`, SYSTEM; `onDone('raid')`, priority 3 | Five Choir kills complete `raid` and set `raid-broken`; two further bombers spawn six seconds after that flag. | TWO MORE TORPEDO BOMBERS INBOUND. |
| EP04 `second-run[1]`, Magpie; follows SYSTEM warning | Intercept the additional bombers; seven Choir kills complete `torpedoes`. Protect the convoy without claiming an unverified fixed attack on tanker three. | Kestrel, intercept those bombers. Keep them away from the tankers! |

The EP01 opening previously spoke no first destination. It now gives the action
before the remaining ritual lines. The player is still a ferry/picket pilot in
Chapter I; these cues do not call them a member of Vanguard. Gate fuel and the
escort premise follow `docs/LORE.md`'s Ebon-gas section and `docs/CAMPAIGN.md`'s
Episode 4. Later arrival still requires `tankers-arrived`; this patch does not
replace that condition with reaching the buoy in the player's own ship.

## Recordings and subtitle fit

Existing cast and production recorder are retained: Candle uses
`en_GB-northern_english_male-medium` (length 1.08, pitch setting 0.97); Magpie uses
`en_GB-alba-medium` (length 0.93, pitch setting 1.02). No cast or recorder changes
are part of this slice. SYSTEM remains intentionally procedural; there is no
SYSTEM MP3 and no claim that the procedural voice is intelligible English.
Magpie's recorded lines carry the actionable combat instructions themselves.

| Cue | File under `public/voice/` | Recorded seconds | Caption hold seconds |
| --- | --- | ---: | ---: |
| EP01 `open[1]` | `16i60751jv9i4m.mp3` | 4.599 | 6.667 |
| EP01 `open[2]` | `s303hr1qjl8bo.mp3` | 2.744 | 5.067 |
| EP04 `open[0]` | `e2701j16wypbw.mp3` | 5.147 | 6.667 |
| EP04 `open[1]` | `26qffja59y44.mp3` | 5.929 | 7.200 |
| EP04 `raid[1]` | `saevobxenazs.mp3` | 4.995 | 6.400 |
| EP04 `second-run[1]` | `d04rlgq3banp.mp3` | 4.414 | 5.200 |

`Comms.showLine()` passes no `maxDur` or `maxSqueeze` to `VoiceBox.speak()`, so
recorded campaign lines play at 1x. VoiceBox reports the dry clip duration plus
0.06 seconds for radio. The audit uses the actual shared subtitle functions and
Comms line-end formula; all selected lines fit, and the six changed human lines
read at 12.63–13.33 characters per second. These are calculated timings after
manifest/clip loading, not a runtime listening or GPU-capture result.

For the shared EP04 fixture, the raid interrupts lower-priority chatter at
38 seconds. With Comms' 0.08-second interrupt lead-in and the new SYSTEM line,
Magpie is expected to begin around **43.344 s**, with her caption clearing around
**49.744 s**, subject to update ticks. The old line began around 44.932 s and its
caption cleared around 51.332 s. Include the encounter through at least 50 s to
capture the whole new instruction; a 42–48 s excerpt cuts its end. Original
baseline clip `14msp8htrqcau.mp3` (5.806 s) remains available for comparison.

## Validation and remaining limits

- `node --experimental-transform-types --no-warnings scripts/audit-mission-cues.ts`
  checks the bounded beat set's file coverage and calculated caption/voice fit.
  It emits keys, exact text, triggers, cast settings and uninterrupted beat offsets.
- `npm run voices -- --check`: **1,631 / 1,631 required clips covered**, zero
  missing or unindexed files; 23 legacy entries retained. Required clips and total
  manifest entries differ because legacy recordings are deliberately retained.
- All 1,648 baseline manifest entries and values are unchanged; six new entries
  bring the manifest to 1,654. FFmpeg decoded each new MP3 without errors;
  decoded peaks were 0.852–0.876, with zero samples at or above full scale.
- Typecheck and 25 targeted campaign-data, campaign-runner, dialogue and
  voice-pipeline tests passed. No GPU capture was run by this task.

The existing `black-light` beat at 22 s queues behind EP04's opening and is
interrupted by the priority-3 raid; optional flavour may therefore be cut short.
Higher-priority beats can interrupt speech, and separate Comms instances can
sound together. Cross-panel overlap has **not** been reproduced in this slice.
The combat/audio owner has the exact new and baseline cue timing for the shared
encounter and owns any reproduced combat masking issue. Playback before asset
loading or failed fetches can still use the existing synthetic fallback.

No subjective intelligibility, pronunciation, physical-speaker or first-play
acceptance is claimed by these source, timing and decode checks.
