#!/usr/bin/env python3
"""Runs inside an engine's own virtual environment and prints '[start --> end] text' lines as it recognises, the same shape
the other engines print, so the job reads every engine the same way.

    asr_runner.py <engine> <wav> <language> --model ID --ffmpeg PATH
"""
import argparse, os, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

def stamp(seconds):
    seconds = max(0.0, float(seconds)); h, rest = divmod(seconds, 3600); m, s = divmod(rest, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'
def emit(start, end, text):
    text = ' '.join(str(text).split())
    if text: print(f'[{stamp(start)} --> {stamp(max(end, start))}] {text}', flush=True)

NAMES = {'zh': 'Chinese', 'en': 'English', 'ja': 'Japanese', 'ko': 'Korean', 'de': 'German', 'fr': 'French', 'es': 'Spanish', 'ru': 'Russian', 'pt': 'Portuguese', 'it': 'Italian'}

def faster_whisper(args):
    from faster_whisper import WhisperModel
    try:
        import ctranslate2
        cuda = ctranslate2.get_cuda_device_count() > 0
    except Exception: cuda = False
    model = WhisperModel(args.model, device='cuda' if cuda else 'cpu', compute_type='float16' if cuda else 'int8')
    # The job's audio is already 16 kHz mono PCM: read it directly instead of letting the library decode it with PyAV
    # (faster-whisper 1.2 and PyAV 19 disagree about an argument, and the decoder is not needed here).
    import numpy, wave
    with wave.open(args.wav, 'rb') as audio: samples = numpy.frombuffer(audio.readframes(audio.getnframes()), dtype=numpy.int16).astype(numpy.float32) / 32768.0
    segments, _ = model.transcribe(samples, language=None if args.language == 'auto' else args.language, vad_filter=True, condition_on_previous_text=False, beam_size=5,
                                   initial_prompt=' '.join(x for x in (args.context, '以下是普通话的句子。' if args.language == 'zh' else '') if x) or None)
    for segment in segments: emit(segment.start, segment.end, segment.text)

def qwen3(args):
    # Qwen3-ASR returns text for a piece of audio, not timing: cut at pauses like a cloud service and put the pieces back.
    import asr_cloud
    from mlx_qwen3_asr import Session
    env = dict(os.environ)
    total = float(args.total)
    chunks = asr_cloud.plan_chunks(asr_cloud.silences(args.wav, args.ffmpeg, env), total)
    session = Session(model=args.model)
    scratch = Path(tempfile.mkdtemp(prefix='qwen3-'))
    try:
        for index, (start, end) in enumerate(chunks):
            path = scratch / f'c{index}.wav'
            subprocess.run([args.ffmpeg, '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', args.wav, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(path)], check=True, env=env, timeout=300)
            try: result = session.transcribe(str(path), language=None if args.language == 'auto' else NAMES.get(args.language), context=args.context)
            finally: path.unlink(missing_ok=True)
            for cue in asr_cloud.cues_from(asr_cloud.tidy(getattr(result, 'text', '') or ''), None, start, end): emit(cue['start'], cue['end'], cue['text'])
    finally:
        for leftover in scratch.glob('*'): leftover.unlink(missing_ok=True)
        scratch.rmdir()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('engine'); parser.add_argument('wav'); parser.add_argument('language')
    parser.add_argument('--model', required=True); parser.add_argument('--ffmpeg', required=True); parser.add_argument('--total', default='0'); parser.add_argument('--context', default='')
    args = parser.parse_args()
    {'faster-whisper': faster_whisper, 'mlx-qwen3': qwen3}[args.engine](args)

if __name__ == '__main__': main()
