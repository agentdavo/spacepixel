# Trailer V2 script and voice review

Reviewed 25 September 2026 by the chief game architect. Film source: `e06d5d8`.
Delivered film: `scratchpad/delivery/v2/vanguard-trailer-v2-720p.mp4`.
Evidence: adjacent `TRAILER_SCRIPT.md`, `voice-audit.json`, mix analysis and
contact sheet; source dialogue, cast, recording and playback code; series bible.

This is a script, casting and production review. No direct audio audition was
available in this review session. Pronunciation, emotional performance and
intelligibility of the actual mix are therefore not certified. No film, script
or recordings were changed for this review.

## Editorial verdict

The story is understandable and broadly faithful: mystery, Lantern collapse,
two powers, Ebon-gas dependence, inherited ships and Vanguard's role. Keep the
opening mystery, fossil-ship idea and final squadron line. It correctly avoids
the campaign's later revelations and unimplemented Kessen gameplay.

The middle sells commerce and upgrades more strongly than squadron attachment
and the literary campaign. FIGHT / TRADE / RISE gives the film a clear structure,
but the spoken copy should carry character and stakes while the images explain
the menus. One crew exchange that demonstrates trust is worth more than another
generic combat shout. Keep the career footage; refine its dramatic purpose.

## Findings and decisions for the next revision

| Priority | Evidence | Direction |
|---|---|---|
| High | Narrator at 02.33, 38.40 and 55.40 plays at 1.20x. `Recorded.ts` applies raw playbackRate, raising pitch about 3.16 semitones as well as speed. Other narrator lines stay at 1.00x. | Cut or retime prose and record to the intended cadence. Keep narrator pitch consistent. Do not call the voice final just because it fits. Prefer natural speech; if time stretching is needed, preserve pitch and audition the result. |
| High | The 38.40 faction line uses almost the entire caption: predicted end leaves 1.7 ms; opening mystery leaves 9.2 ms. The audit accepts 25 ms tolerance and offline scheduling is quantised. | These are numerical passes with negligible headroom, not evidence of comfortable pacing. Allow a deliberate pause and reading time; verify actual audio onset/end against rendered captions after mixing. No audible truncation has been established here. |
| Medium | `trailer.ts` labels Jackpot Vanguard 2, Candle Vanguard 3 and Sparrow Vanguard 4. Both LORE and campaign cast specify 3, 4 and 5 respectively. | Correct the three caption kickers. Kade's 'Vanguard lead' label is appropriate even though her number is 2. |
| Medium | At 34.55, Candle orders 'All batteries — fire!' over Indomitable's broadside. Canon makes Candle a strike pilot/engine-warden and Rook the dreadnought captain. | Give that capital command to Rook, or replace it with a credible Candle observation. 'Forward shield gone!' is also more precise than 'SHIELDS DOWN!' when one facing collapses. |
| Medium | At 55.40, 'Trade. Take contracts. Build your future.' sounds like a feature list; at 58.54 Lucan's 'I am not flying today' has little standalone dramatic payoff and repeats Psalm's 'Be witnessed'. | Shorten the sales narration, let the market image do its job, and use the concourse beat for a purposeful relationship moment or breathing room. Do not alter Lucan's game-wide greeting simply to improve a trailer. |
| Medium | Kade and Psalm share `en_GB-cori-high`; narrator and Lucan share `en_GB-alan-medium`. The film has eight speaker identities but six base models. | Audition those pairs back-to-back. Their shared base is a distinctiveness risk, not proof they sound identical. Preserve the established cast unless an audition supports a change; do not bulk-recast the game for one film. |
| Production defect, confirmed | `voice-record.py` computes source step as sample_rate / pitch. The voice owner's known-tone test executed the actual assignments extracted from the script: all 12 cases across two source sample rates confirmed frequency = input / pitch and duration = input * pitch, opposite to the documented setting. | A fix changes established voice identity; preserve existing clips and version/regenerate only an explicitly reviewed set. Clip keys currently omit the processing algorithm version, so silently changing the formula risks inconsistent treatments under identical keys. This test does not establish how the delivered historical clips were generated. |

## Casting and performance direction

| Speaker | Current base model | Direction |
|---|---|---|
| Narrator | en_GB-alan-medium | Calm witness to history; leave room for uncertainty. Avoid a sales-announcer cadence. |
| Kade | en_GB-cori-high | Short, controlled orders; authority through restraint. |
| Jackpot | en_US-ryan-high | Fast confidence covering fear; give one line a personal purpose. |
| Sparrow | en_US-amy-medium | Urgent and young, with consonants clear through the radio. |
| Candle | en_GB-northern_english_male-medium | Grounded technical observation and ritual; preserve his deliberate manner. |
| Psalm | en_GB-cori-high | Measured certainty, distinct from Kade's practical command. |
| Control | en_GB-jenny_dioco-medium | Crisp clearance; current line serves the docking shot. |
| Lucan | en_GB-alan-medium, selected by stable NPC mapping | Quiet social encounter; include only if the line rewards its screen time. |

All 19 cues are recorded Piper neural speech, not human performances. The
procedural fallback's personality settings do not all translate into the
recorded path: its performance largely comes from the base model, text,
synthesis pace, resampling and subsequent channel processing. More elaborate
profile comments are not evidence of directed acting in an existing clip.

The delivered mix report gives -16 LUFS integrated, -6.1 dBTP and no clipped
source samples. Trailer code ducks music by 9 dB and effects to 0.45 gain during
speech. Those are useful safeguards, but do not establish word intelligibility.
Dry clips are 22.05 kHz mono MP3 encoded at 32 kbps; higher-quality source audio
is worth comparing for exposed narration before any broad rerecording.

## Suggested copy changes to audition

These are proposed text, not new recordings or timing-approved replacements.

- Keep: 'Something beyond this gate is counting down.' Start it earlier or
  give it more screen time, rather than accelerating the mystery.
- Tighten history: 'Four centuries ago, the Lanterns went dark. Humanity was
  stranded.'
- Simplify the faction beat: 'The Directorate. The Hegemony. Two powers
  fighting over six surviving gates.' Keep full faction names in clear labels
  or expand this shot after recording if their spoken names are required.
- Keep: 'Ebon-gas, harvested from dying stars.'
- Keep: 'Without it, the colonies fall silent.'
- Replace sales copy with: 'Earn your passage. Keep flying.' Let the visible
  contracts, trade and outfitting screens establish how.
- Keep: 'Every ship is a relic of a lost age.'
- Keep: 'Keep it flying. Make it yours.' Consider removing the earlier
  'Keep flying' if these sound repetitive in sequence.
- Keep the final identity: 'You are Vanguard. The squadron that goes through
  first.'

For a crew beat, an example is Sparrow's existing 'Two on my six!' answered by
Jackpot with 'I see them. Stay with me.' This needs a matching rescue shot and
new recording; it must not be pasted over unrelated action. Choose it in place
of existing chatter so the film gets more character without more voice density.

## Acceptance for any new edit

Recorder investigation evidence (voice owner, no production changes):
`C:/Users/David(J)Smith/.codex/worktrees/bef8/spacepixel/scratchpad/pitch-review/check_pitch.py`
and adjacent `results.json`. A 440 Hz, two-second input at setting 1.2 becomes
366.667 Hz and 2.4 seconds under the current recorder. The separately tested
multiplication candidate gives 528 Hz and 1.666667 seconds, matching the
documented meaning. Production adoption remains a distinct, versioned change.

First review a timed voice-and-picture draft before a full capture. Listen to
dry and mixed versions at normal playback speed, including ordinary speakers.
Check Lantern, Ebon-gas, Directorate, Hegemony and Vanguard pronunciation;
compare repeated narrator identity and the shared-model character pairs.
Confirm crew labels, capital-command ownership, caption readability and pauses.
Then regenerate changed clips, run coverage and actual timing checks, inspect
the final encoded film, and identify its source revision. Keep V2 intact.
