#!/usr/bin/env node
/**
 * Encode frames from scripts/record.mjs (+ an optional soundtrack WAV from
 * scripts/audio-render.mjs) into an H.264/AAC MP4, loudness-normalised.
 *
 *   node scripts/make-video.mjs --frames <dir> [--audio prologue.wav] [--fps 24]
 *        [--crf 23] --out prologue-720p.mp4
 *
 * Needs ffmpeg: $FFMPEG, or on PATH (`pip install imageio-ffmpeg` ships one).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const frames = opt('frames', 'recording');
const audio = opt('audio', '');
const out = opt('out', 'video.mp4');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const fps = Number(opt('fps', '24'));
const numbers = readdirSync(frames).filter(n => /^f_\d{5}\.jpg$/.test(n)).map(n => Number(n.slice(2, 7))).sort((a, b) => a - b);
if (!numbers.length || numbers.some((n, i) => n !== numbers[0] + i)) throw new Error('Missing or noncontiguous captured frames');
const duration = numbers.length / fps;
mkdirSync(dirname(out), { recursive: true });
const fade = `atrim=0:${duration},afade=t=out:st=${Math.max(0, duration - 1.25)}:d=1.25`;
let normalise = 'loudnorm=I=-16:TP=-1.5:LRA=11';
if (audio) {
  const measure = spawnSync(ffmpeg, ['-hide_banner', '-i', audio, '-af', `${fade},${normalise}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (measure.status !== 0) throw new Error(measure.stderr || 'Loudness analysis failed');
  const stats = JSON.parse(measure.stderr.slice(measure.stderr.lastIndexOf('{'), measure.stderr.lastIndexOf('}') + 1));
  normalise += `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
}
const cmd = [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-framerate', String(fps), '-start_number', String(numbers[0]), '-i', `${frames}/f_%05d.jpg`,
  ...(audio ? ['-i', audio] : []),
  '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '23'), '-tune', 'animation', '-pix_fmt', 'yuv420p',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart',
  ...(audio ? ['-af', `${fade},${normalise}`, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k'] : []),
  '-t', String(duration),
  out,
];
const r = spawnSync(ffmpeg, cmd, { stdio: 'inherit' });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
