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

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const frames = opt('frames', 'recording');
const audio = opt('audio', '');
const out = opt('out', 'video.mp4');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const cmd = [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-framerate', opt('fps', '24'), '-start_number', '0', '-i', `${frames}/f_%05d.jpg`,
  ...(audio ? ['-i', audio] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '23'), '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ...(audio ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', '-shortest'] : []),
  out,
];
const r = spawnSync(ffmpeg, cmd, { stdio: 'inherit' });
process.exit(r.status ?? 1);
