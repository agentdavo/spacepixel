#!/usr/bin/env python3
"""
Record every written line with Piper neural voices (see src/audio/voice/neural.ts).

  npm run voices -- --models <Piper model directory> [--python <python executable>]

Writes dry mono clips to public/voice/<key>.mp3 (the game adds the radio or room
per channel) and public/voice/manifest.json ({key: seconds}). Existing clips are
kept, including legacy clips no current line uses. No pruning is performed. Needs: piper-tts, numpy, lameenc.
Models: https://huggingface.co/rhasspy/piper-voices (the names in neural.ts).
"""
import argparse, json, os, sys, math
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'voice')
SR = 22050
_voices = {}


def render(job):
    line, model_path = job
    import numpy as np
    from piper import PiperVoice, SynthesisConfig
    from piper.config import PiperConfig
    import onnxruntime
    import lameenc
    v = line['voice']
    m = v['model']
    if m not in _voices:
        options = onnxruntime.SessionOptions()
        # One inference thread per worker keeps recording from monopolising
        # the machine (and avoids thread oversubscription across models).
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        with open(model_path + '.json', encoding='utf-8') as f:
            config = PiperConfig.from_dict(json.load(f))
        _voices[m] = PiperVoice(config=config, session=onnxruntime.InferenceSession(
            model_path, sess_options=options, providers=['CPUExecutionProvider']))
    pv = _voices[m]
    cfg = SynthesisConfig(speaker_id=v.get('speaker'), length_scale=v['length'], noise_scale=0.6, noise_w_scale=0.7)
    chunks = [c.audio_float_array for c in pv.synthesize(line['text'], cfg)]
    if not chunks or not sum(len(c) for c in chunks):
        raise RuntimeError(f"No audio produced for {line['key']}: {line['text']}")
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
    path = os.path.join(OUT, line['key'] + '.mp3')
    with open(path + '.tmp', 'wb') as f:
        f.write(e.encode(pcm) + e.flush())
    os.replace(path + '.tmp', path)
    return line['key'], round(len(a) / SR, 3)


def save_manifest(path, manifest):
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(manifest.items())), f, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def valid_clip(line, manifest):
    duration = manifest.get(line['key'])
    path = Path(OUT) / (line['key'] + '.mp3')
    return (isinstance(duration, (int, float)) and math.isfinite(duration)
            and duration > 0 and path.is_file() and path.stat().st_size > 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('lines')
    ap.add_argument('--models', required=True)
    ap.add_argument('--jobs', type=int, default=2)
    args = ap.parse_args()
    if args.jobs < 1:
        ap.error('--jobs must be positive')
    with open(args.lines, encoding='utf-8-sig') as f:
        lines = json.load(f)
    if any(not any(c.isalnum() for c in l['text']) or '{' in l['text'] for l in lines):
        ap.error('Input contains unspoken punctuation or unresolved placeholders; re-enumerate voice-lines.ts')
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = {}
    if os.path.exists(mpath):
        with open(mpath, encoding='utf-8') as f:
            manifest = json.load(f)
    todo = [l for l in lines if not valid_clip(l, manifest)]
    todo.sort(key=lambda l: l['voice']['model'])
    print(f'{len(lines)} lines, {len(todo)} to record; existing clips retained', file=sys.stderr)
    if not todo:
        return
    # Preflight every required model before writing any audio; accept both flat
    # model directories and hf download's original repository hierarchy.
    models = {}
    missing = []
    for model in sorted({l['voice']['model'] for l in todo}):
        paths = list(Path(args.models).rglob(model + '.onnx'))
        paths = [p for p in paths if p.stat().st_size > 0 and Path(str(p) + '.json').is_file()]
        if len(paths) != 1:
            missing.append(f'{model}.onnx + {model}.onnx.json (found {len(paths)} complete pairs)')
        else:
            models[model] = str(paths[0])
    if missing:
        ap.error('Missing or ambiguous Piper models in ' + args.models + ':\n  ' + '\n  '.join(missing))
    try:
        from piper import PiperVoice, SynthesisConfig
        import numpy, lameenc
    except ImportError as error:
        ap.error(f'{error}; install piper-tts numpy lameenc in this Python environment')
    os.makedirs(OUT, exist_ok=True)
    try:
        with ProcessPoolExecutor(args.jobs) as ex:
            for i, (key, duration) in enumerate(ex.map(render, [(l, models[l['voice']['model']]) for l in todo], chunksize=8), 1):
                manifest[key] = duration
                # Checkpoint every completed clip; failures never discard earlier work.
                save_manifest(mpath, manifest)
                if i % 25 == 0 or i == len(todo):
                    print(f'  {i}/{len(todo)}', file=sys.stderr)
    finally:
        save_manifest(mpath, manifest)
    remaining = [l['key'] for l in lines if not valid_clip(l, manifest)]
    if remaining:
        raise RuntimeError(f'{len(remaining)} authored clips remain missing')
    print(f'{len(manifest)} clips, {sum(manifest.values()) / 60:.1f} min; no legacy clips removed', file=sys.stderr)


if __name__ == '__main__':
    main()
