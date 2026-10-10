#!/usr/bin/env python3
"""Runs inside an engine's own virtual environment and prints '[start --> end] text' lines as it recognises, the same shape
the other engines print, so the job reads every engine the same way.

    asr_runner.py <engine> <wav> <language> --model ID --ffmpeg PATH
"""
import argparse, gc, os, re, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def stamp(seconds):
    seconds = max(0.0, float(seconds)); h, rest = divmod(seconds, 3600); m, s = divmod(rest, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'
def emit(start, end, text):
    text = ' '.join(str(text).split())
    if text: print(f'[{stamp(start)} --> {stamp(max(end, start))}] {text}', flush=True)

NAMES = {'zh': 'Chinese', 'en': 'English', 'ja': 'Japanese', 'ko': 'Korean', 'de': 'German', 'fr': 'French', 'es': 'Spanish', 'ru': 'Russian', 'pt': 'Portuguese', 'it': 'Italian'}

def diagnostic(message):
    print('[asr] ' + message, file=sys.stderr, flush=True)

def compute_candidates(ctranslate2):
    """Probe actual backend support, not just the presence of a CUDA device."""
    candidates = []
    try:
        if ctranslate2.get_cuda_device_count() > 0:
            supported = ctranslate2.get_supported_compute_types('cuda')
            diagnostic('CUDA supports: ' + ', '.join(sorted(supported)))
            precision = next((p for p in ('float16', 'int8_float16', 'int8_float32', 'int8', 'float32') if p in supported), None)
            if precision: candidates.append(('cuda', precision))
    except (RuntimeError, ValueError):
        diagnostic('CUDA capability probe failed; using CPU fallback')
    # CPU float32 remains a safe last attempt when the capability probe itself fails.
    try:
        supported = ctranslate2.get_supported_compute_types('cpu')
        diagnostic('CPU supports: ' + ', '.join(sorted(supported)))
    except (RuntimeError, ValueError):
        diagnostic('CPU capability probe failed; trying float32')
        supported = {'float32'}
    candidates.extend(('cpu', p) for p in ('int8', 'float32') if p in supported)
    if not candidates: raise RuntimeError('No supported CUDA/CPU compute type for faster-whisper')
    return candidates

BACKEND_ERROR = re.compile(r'cuda|cudnn|cublas|compute type|out of memory', re.I)

def transcribe_faster(args, samples, model_factory, candidates):
    for index, (device, precision) in enumerate(candidates):
        emitted = False; model = None
        diagnostic(f'Using {device} compute_type={precision}')
        try:
            model = model_factory(args.model, device=device, compute_type=precision)
            segments, _ = model.transcribe(samples, language=None if args.language == 'auto' else args.language, vad_filter=True, condition_on_previous_text=False, beam_size=5,
                                          initial_prompt=' '.join(x for x in (args.context, '以下是普通话的句子。' if args.language == 'zh' else '') if x) or None)
            for segment in segments:
                emit(segment.start, segment.end, segment.text)
                emitted = True
            return
        except (RuntimeError, ValueError) as error:
            # A lazy CUDA failure may appear on the first segment. Never restart after emitting subtitles:
            # that would duplicate a partial transcript. Model/file/download errors are not backend failures.
            if emitted or index + 1 == len(candidates) or not BACKEND_ERROR.search(str(error)): raise
            diagnostic(f'{device}/{precision} backend failed ({type(error).__name__}: {str(error)[:200]}); falling back to CPU')
            model = None; gc.collect()

def faster_whisper(args):
    # Windows 环境下 NO_PROXY 中的 ::1 或 ::1/128 会导致 httpx 报错 Invalid port: ':1'，在此做清理保护
    for k in ('NO_PROXY', 'no_proxy'):
        if k in os.environ:
            cleaned = ','.join(p for p in os.environ[k].split(',') if not p.strip().startswith('::1'))
            os.environ[k] = cleaned

    from faster_whisper import WhisperModel
    import ctranslate2
    candidates = compute_candidates(ctranslate2)
    # The job's audio is already 16 kHz mono PCM: read it directly instead of letting the library decode it with PyAV
    # (faster-whisper 1.2 and PyAV 19 disagree about an argument, and the decoder is not needed here).
    import numpy, wave
    with wave.open(args.wav, 'rb') as audio: samples = numpy.frombuffer(audio.readframes(audio.getnframes()), dtype=numpy.int16).astype(numpy.float32) / 32768.0
    transcribe_faster(args, samples, WhisperModel, candidates)

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
