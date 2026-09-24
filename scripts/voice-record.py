#!/usr/bin/env python3
"""
Record every written line with Piper neural voices (see src/audio/voice/neural.ts).

  node --experimental-transform-types --no-warnings scripts/voice-lines.ts > /tmp/lines.json
  python3 scripts/voice-record.py /tmp/lines.json --models <dir with Piper .onnx voices> [--jobs 4]

Writes dry mono clips to public/voice/<key>.mp3 (the game adds the radio or room
per channel) and public/voice/manifest.json ({key: seconds}). Existing clips are
kept; clips no line uses any more are deleted. Needs: piper-tts, numpy, lameenc.
Models: https://huggingface.co/rhasspy/piper-voices (the names in neural.ts).
"""
import argparse, json, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'voice')
SR = 22050
_voices = {}


def render(job):
    line, models = job
    from piper import PiperVoice, SynthesisConfig
    import lameenc
    v = line['voice']
    m = v['model']
    if m not in _voices:
        _voices[m] = PiperVoice.load(os.path.join(models, m + '.onnx'))
    pv = _voices[m]
    cfg = SynthesisConfig(speaker_id=v.get('speaker'), length_scale=v['length'], noise_scale=0.6, noise_w_scale=0.7)
    chunks = [c.audio_float_array for c in pv.synthesize(line['text'], cfg)]
    if not chunks or not sum(len(c) for c in chunks):
        return line['key'], 0  # nothing speakable ("—"): the synth covers it
    a = np.concatenate(chunks).astype(np.float64)
    src = pv.config.sample_rate / v['pitch']  # play faster → higher and quicker
    n = int(len(a) * SR / src)
    a = np.interp(np.arange(n) * src / SR, np.arange(len(a)), a)
    # Trim the model's lead-in and tail silence (keep 30 ms), then peak-normalise.
    env = np.abs(a) > 0.02 * (np.max(np.abs(a)) + 1e-9)
    idx = np.flatnonzero(env)
    if len(idx):
        pad = int(0.03 * SR)
        a = a[max(0, idx[0] - pad): idx[-1] + pad]
    a = a / (np.max(np.abs(a)) + 1e-9) * 0.9
    fade = min(len(a), int(0.005 * SR))
    a[:fade] *= np.linspace(0, 1, fade)
    a[len(a) - fade:] *= np.linspace(1, 0, fade)
    pcm = (a * 32767).astype('<i2').tobytes()
    e = lameenc.Encoder()
    e.set_bit_rate(32)
    e.set_in_sample_rate(SR)
    e.set_channels(1)
    e.set_quality(2)
    with open(os.path.join(OUT, line['key'] + '.mp3'), 'wb') as f:
        f.write(e.encode(pcm) + e.flush())
    return line['key'], round(len(a) / SR, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lines')
    ap.add_argument('--models', required=True)
    ap.add_argument('--jobs', type=int, default=4)
    args = ap.parse_args()
    lines = json.load(open(args.lines))
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    keys = {l['key'] for l in lines}
    todo = [l for l in lines if l['key'] not in manifest or not os.path.exists(os.path.join(OUT, l['key'] + '.mp3'))]
    # Group by model so each worker loads few models.
    todo.sort(key=lambda l: l['voice']['model'])
    print(f'{len(lines)} lines, {len(todo)} to record', file=sys.stderr)
    with ProcessPoolExecutor(args.jobs) as ex:
        for i, (k, d) in enumerate(ex.map(render, [(l, args.models) for l in todo], chunksize=8)):
            if d:
                manifest[k] = d
            if i % 50 == 0:
                print(f'  {i}/{len(todo)}', file=sys.stderr)
                with open(mpath, 'w') as f:
                    json.dump(manifest, f)
    for k in list(manifest):
        if k not in keys:
            del manifest[k]
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f[:-4] not in keys:
            os.remove(os.path.join(OUT, f))
    with open(mpath, 'w') as f:
        json.dump(dict(sorted(manifest.items())), f, separators=(',', ':'))
    print(f'{len(manifest)} clips, {sum(manifest.values()) / 60:.1f} min', file=sys.stderr)


if __name__ == '__main__':
    main()
