#!/usr/bin/env node
/** Verify the delivered MP4 and matching frame/event capture; make a contact sheet. */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { TRAILER } from '../src/cinema/trailer.ts';

const [video, eventFile] = process.argv.slice(2);
if (!video || !eventFile) throw new Error('Usage: node scripts/trailer-qa.mjs video.mp4 events-0.jsonl');
const out = dirname(video);
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || `${cmd} failed`);
  return r;
};
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', video]).stdout);
writeFileSync(join(out, 'ffprobe.json'), JSON.stringify(probe, null, 2));
const [header, ...frames] = readFileSync(eventFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const counts = {};
const shotEvents = {};
for (const [i, frame] of frames.entries()) {
  if (frame.frame !== i || Math.abs(frame.at - i / header.fps) > 1e-6) throw new Error(`Discontinuous capture at ${i}`);
  if (Math.abs(frame.timeline - (i + 1) / header.fps) > 1e-5) throw new Error(`Timeline drift at ${i}`);
  for (const e of [...frame.weaponEvents, ...frame.missileEvents]) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    const k = `${frame.shot}/${e.kind}`;
    shotEvents[k] = (shotEvents[k] ?? 0) + 1;
  }
}
const v = probe.streams.find(s => s.codec_type === 'video');
const a = probe.streams.find(s => s.codec_type === 'audio');
if (v.width !== 1280 || v.height !== 720 || v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || v.avg_frame_rate !== '24/1') throw new Error('Unexpected video format');
if (a.codec_name !== 'aac' || a.channels !== 2 || a.sample_rate !== '48000') throw new Error('Unexpected audio format');
if (Number(v.nb_frames) !== frames.length) throw new Error('Encoded frame count differs from capture');
const bytes = readFileSync(video);
const faststart = bytes.indexOf(Buffer.from('moov')) < bytes.indexOf(Buffer.from('mdat'));
if (!faststart) throw new Error('MP4 moov is not ahead of mdat');
let at = 0;
const samples = TRAILER.map(shot => { const t = at + shot.dur * 0.65; at += shot.dur; return t; });
const select = samples.map(t => `eq(n,${Math.floor(t * header.fps)})`).join('+');
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `select='${select}',scale=320:180,drawtext=font=Arial:text='%{pts\\:hms}':fontsize=13:fontcolor=white:box=1:boxcolor=black@0.7:x=8:y=8,tile=5x5:padding=4:margin=4:color=black`, '-frames:v', '1', join(out, 'contact-sheet.jpg')]);
const checks = run('ffmpeg', ['-hide_banner', '-i', video, '-vf', 'blackdetect=d=0.12:pix_th=0.025:pic_th=0.98', '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr;
writeFileSync(join(out, 'av-analysis.txt'), checks);
const report = { backend: header.backend, frames: frames.length, fps: header.fps, duration: Number(v.duration), resolution: [v.width, v.height], codecs: [v.codec_name, a.codec_name], faststart, sha256: createHash('sha256').update(bytes).digest('hex'), eventCounts: counts, shotEvents, timing: 'Events keyed to the matching output frame; offline scheduling resolution 1024/48000 s (21.33 ms).', samples };
writeFileSync(join(out, 'qa.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
