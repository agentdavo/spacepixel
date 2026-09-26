/** Bounded EP01 opening / EP04 escort voice and subtitle audit; no browser/GPU. */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { EP01 } from '../src/game/campaign/episodes/ep01-the-long-dark.ts';
import { EP04 } from '../src/game/campaign/episodes/ep04-black-light.ts';
import { clipKey, neuralVoiceFor, profileSex } from '../src/audio/voice/neural.ts';
import { voiceFor } from '../src/audio/voice/voices.ts';
import { planUtterance } from '../src/audio/voice/plan.ts';
import { lineHold, typeDuration, cps, MAX_CPS } from '../src/ui/subtitleTiming.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest: Record<string, number> = JSON.parse(readFileSync(resolve(root, 'public/voice/manifest.json'), 'utf8'));
const selection = [[EP01, ['open']], [EP04, ['open', 'black-light', 'raid', 'second-run']]] as const;
const beats = selection.flatMap(([mission, names]) => mission.chatter.filter(b => names.some(name => name === b.id)).map(beat => {
  let nextStart = beat.lines[0].delay ?? 0.1;
  const lines = beat.lines.map((line, index) => {
    const profile = voiceFor(line.who);
    const voice = neuralVoiceFor(line.who, profileSex(profile));
    const key = voice ? clipKey(voice, line.text) : null;
    const file = key ? `public/voice/${key}.mp3` : null;
    const covered = key && file ? Number.isFinite(manifest[key]) && manifest[key] > 0 && existsSync(resolve(root, file)) && statSync(resolve(root, file)).size > 0 : null;
    let seed = 0;
    for (let i = 0; i < line.who.length; i++) seed = (seed * 31 + line.who.charCodeAt(i)) >>> 0;
    const plan = planUtterance(line.text, profile, { seed });
    // Campaign Comms passes no maxDur/maxSqueeze; cast rate is therefore 1.
    const kind = line.who === 'system' ? 'clean' : 'radio';
    const duration = covered && key ? manifest[key] + (kind === 'radio' ? 0.06 : 0) : plan.dur;
    const read = lineHold(line.text, duration);
    const typed = typeDuration(line.text, duration);
    const next = beat.lines[index + 1];
    const delay = next?.delay;
    const hold = next ? Math.max(typed + 0.7, delay === undefined ? read : Math.min(delay, read)) : read;
    const start = nextStart;
    nextStart += hold + (next && delay !== undefined && delay > read ? delay - read : 0.12);
    return { index, who: line.who, text: line.text, voice, key, file, covered,
      route: voice ? (covered ? 'recorded-cast' : 'missing-cast/synth-fallback') : 'intentional-procedural-synth',
      recordedSeconds: covered && key ? manifest[key] : null,
      voiceSeconds: duration, holdSeconds: hold, captionCps: cps(line.text, hold),
      startOffset: start, endOffset: start + hold, playbackRate: covered ? 1 : null };
  });
  return { mission: mission.id, beat: beat.id, trigger: beat.trigger, priority: beat.priority ?? 0, lines };
}));
const missing = beats.flatMap(b => b.lines.filter(l => l.covered === false).map(l => ({ mission: b.mission, beat: b.beat, index: l.index, key: l.key })));
const timingFailures = beats.flatMap(b => b.lines.filter(l => l.captionCps > MAX_CPS || l.holdSeconds < l.voiceSeconds).map(l => ({ mission: b.mission, beat: b.beat, index: l.index })));
console.log(JSON.stringify({ mode: 'cast after manifest/clip load', scope: 'EP01 open; EP04 open, black-light, raid, second-run',
  limitations: 'Computed from authored data, recorded manifest and shared timing functions; not a listening or runtime capture test. Start offsets assume uninterrupted beat playback. Higher-priority interruption and separate Comms panels can change delivery.',
  missing, timingFailures, beats }, null, 2));
if (missing.length || timingFailures.length) process.exitCode = 1;
