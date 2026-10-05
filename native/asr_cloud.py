"""Cloud speech recognition for the subtitle job (see asr.py).

Most hosted recognisers return one block of text per request and no timing, so the audio is cut at natural pauses,
each piece is sent on its own, and the pieces are put back on the video's timeline: a piece's text gets the piece's start
as its offset, and is split into sentences spread over the piece's duration. Providers that do return segments
(OpenAI-style `verbose_json`, Doubao's utterances) keep their own times. Three request styles cover the services tried:
an OpenAI-style `/audio/transcriptions` upload, an audio-capable `/chat/completions` model, and Doubao's recorded-file "flash" call.
"""
import base64, json, os, random, re, subprocess, tempfile, time, urllib.error, urllib.parse, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROTOCOLS = {'openai-transcriptions', 'chat-audio', 'doubao-flash'}
TIMESTAMPS = {'none', 'segments'}
TARGET_CHUNK, MAX_CHUNK, MIN_CHUNK = 20.0, 40.0, 4.0  # defaults; a service sets its own (GLM accepts 30 s at most, Doubao takes minutes)
SILENCE_SECONDS = 0.15
CONCURRENCY = 3  # a few at once hides a slow request; more only queues behind the service (SenseVoice on SiliconFlow got slower with more)
RETRIES = 3
REQUEST_TIMEOUT = 60
LANGUAGES = {'auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'ru', 'pt', 'it'}

class CloudError(Exception):
    def __init__(self, message, code=None): super().__init__(message); self.code = code

def clean_config(config):
    """Check what the page sent about the service. The key is never part of it."""
    if not isinstance(config, dict): raise ValueError('云端识别设置无效')
    protocol = config.get('protocol'); timestamps = config.get('timestamps') or 'none'
    if protocol not in PROTOCOLS or timestamps not in TIMESTAMPS: raise ValueError('云端识别设置无效')
    base = str(config.get('baseUrl') or '').strip().rstrip('/')
    parsed = urllib.parse.urlparse(base)
    local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
    if parsed.scheme not in ('https', 'http') or (parsed.scheme == 'http' and not local) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError('云端识别地址必须是 https 地址')
    model = str(config.get('model') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_./:\-]{1,100}', model): raise ValueError('云端识别模型名无效')
    label = re.sub(r'[\x00-\x1f]', '', str(config.get('label') or parsed.hostname))[:40]
    def seconds(name, default, low, high):
        value = config.get(name, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high: raise ValueError('云端识别的切块长度无效')
        return float(value)
    maximum = seconds('maxChunkSeconds', MAX_CHUNK, 10, 900); target = min(seconds('chunkSeconds', TARGET_CHUNK, 5, 900), maximum - MIN_CHUNK)
    mode = config.get('contextMode'); mode = mode if mode in ('doubao', 'prompt') else None
    return {'protocol': protocol, 'contextMode': mode, 'baseUrl': base, 'model': model, 'timestamps': timestamps, 'languageParam': bool(config.get('languageParam')), 'label': label, 'chunkSeconds': target, 'maxChunkSeconds': maximum, 'local': bool(local)}

# ---- cutting the audio ---------------------------------------------------------------------------------------------
def silence_threshold(wav, ffmpeg, env):
    """"Quiet" relative to this recording: a loud lecture has no pause at a fixed -35 dB. Mean level minus 13 dB, kept in a sane range."""
    result = subprocess.run([ffmpeg, '-hide_banner', '-nostats', '-i', str(wav), '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True, env=env, timeout=600)
    mean = re.search(r'mean_volume:\s*(-?[0-9.]+) dB', result.stderr)
    return max(-45.0, min(-22.0, float(mean.group(1)) - 13.0)) if mean else -30.0
def silences(wav, ffmpeg, env):
    """Midpoints of the pauses in the audio, from ffmpeg's silence detector."""
    result = subprocess.run([ffmpeg, '-hide_banner', '-nostats', '-i', str(wav), '-af', f'silencedetect=noise={silence_threshold(wav, ffmpeg, env):.1f}dB:d={SILENCE_SECONDS}', '-f', 'null', '-'], capture_output=True, text=True, env=env, timeout=600)
    starts = [float(x) for x in re.findall(r'silence_start:\s*(-?[0-9.]+)', result.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end:\s*(-?[0-9.]+)', result.stderr)]
    return [(max(a, 0) + b) / 2 for a, b in zip(starts, ends)]
def plan_chunks(mids, total, target=TARGET_CHUNK, maximum=MAX_CHUNK):
    """Pieces of about `target` seconds cut in the middle of a pause, never longer than `maximum`."""
    chunks, start = [], 0.0
    while total - start > maximum:
        candidates = [m for m in mids if start + MIN_CHUNK <= m <= start + maximum]
        cut = min(candidates, key=lambda m: abs(m - (start + target))) if candidates else start + maximum
        chunks.append((round(start, 3), round(cut, 3))); start = cut
    if total - start >= 0.3 or not chunks: chunks.append((round(start, 3), round(total, 3)))
    return chunks
def encode_chunk(wav, start, end, out, ffmpeg, env):
    base = [ffmpeg, '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(wav), '-vn', '-ac', '1', '-ar', '16000']
    for suffix, codec in (('.mp3', ['-c:a', 'libmp3lame', '-b:a', '48k']), ('.wav', ['-c:a', 'pcm_s16le'])):
        path = out.with_suffix(suffix)
        if subprocess.run(base + codec + [str(path)], capture_output=True, env=env, timeout=120).returncode == 0 and path.is_file() and path.stat().st_size > 0: return path
    raise CloudError('无法切分音频')

# ---- one request ---------------------------------------------------------------------------------------------------
def multipart(fields, filename, content, content_type):
    boundary = '----qiaomu' + uuid.uuid4().hex; parts = []
    for name, value in fields:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode() + content + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'
import asr_context
def context_for(cfg, meta, language):
    """The background to send with each piece, in the form this service reads, or '' when it reads none (or the page said nothing).
    Only services where it was seen to help take it: Doubao (`corpus.context`) and Whisper-style `prompt` (OpenAI, Groq)."""
    mode = cfg.get('contextMode')
    text = asr_context.doubao(meta) if mode == 'doubao' else asr_context.prompt(meta) if mode == 'prompt' else ''
    if mode == 'prompt' and language == 'en' and re.search(r'[\u4e00-\u9fff]', text): return ''
    return text
def build_request(cfg, key, path, language, context=''):
    audio = path.read_bytes(); mime = 'audio/mpeg' if path.suffix == '.mp3' else 'audio/wav'
    if cfg['protocol'] == 'doubao-flash':
        # The recorded-file "flash" call: the whole file in one request, answered at once with utterances and their times.
        payload = {'user': {'uid': 'qiaomu-clipper'}, 'audio': {'data': base64.b64encode(audio).decode()}, 'request': {'model_name': cfg['model']}}
        if context: payload['request']['corpus'] = {'context': context}
        return urllib.request.Request(cfg['baseUrl'] + '/auc/bigmodel/recognize/flash', data=json.dumps(payload).encode(), method='POST', headers={'X-Api-Key': key, 'X-Api-Resource-Id': 'volc.bigasr.auc_turbo', 'X-Api-Request-Id': str(uuid.uuid4()), 'X-Api-Sequence': '-1', 'Content-Type': 'application/json'})
    if cfg['protocol'] == 'openai-transcriptions':
        fields = [('model', cfg['model']), ('response_format', 'verbose_json' if cfg['timestamps'] == 'segments' else 'json')]  # some services (StepFun) require the format
        if cfg['languageParam'] and language != 'auto': fields.append(('language', language))
        if context and cfg.get('contextMode') == 'prompt': fields.append(('prompt', context))
        if cfg['timestamps'] == 'segments': fields.append(('timestamp_granularities[]', 'segment'))
        body, content_type = multipart(fields, 'chunk' + path.suffix, audio, mime); url = cfg['baseUrl'] + '/audio/transcriptions'
    else:
        # `asr_options` sits at the top of the body: that is where the service reads it (SDK "extra_body" is merged there).
        payload = {'model': cfg['model'], 'messages': [{'role': 'user', 'content': [{'type': 'input_audio', 'input_audio': {'data': f'data:{mime};base64,' + base64.b64encode(audio).decode()}}]}], 'asr_options': {'language': language if language in ('zh', 'en') else 'auto'}, 'stream': False}
        body, content_type = json.dumps(payload).encode(), 'application/json'; url = cfg['baseUrl'] + '/chat/completions'
    return urllib.request.Request(url, data=body, method='POST', headers={'Authorization': 'Bearer ' + key, 'Content-Type': content_type, 'Accept': 'application/json'})
def message_of(raw):
    try:
        data = json.loads(raw); error = data.get('error') if isinstance(data, dict) else None
        found = (error.get('message') if isinstance(error, dict) else error) or (data.get('message') if isinstance(data, dict) else None)
        return str(found or raw)[:160]
    except (ValueError, AttributeError): return raw.decode('utf8', 'replace')[:160] if isinstance(raw, bytes) else str(raw)[:160]
# Some recognisers (SenseVoice) mark emotion and sound events with emoji or <|tags|>; a subtitle has no use for them.
NOISE = re.compile(r'<\|[^|>]*\|>|[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F]')
LANGUAGE_NAMES = {'chinese': 'zh', 'mandarin': 'zh', 'english': 'en', 'japanese': 'ja', 'korean': 'ko', 'german': 'de', 'french': 'fr', 'spanish': 'es', 'russian': 'ru', 'portuguese': 'pt', 'italian': 'it'}
def tidy(text): return re.sub(r'\s+', ' ', NOISE.sub('', str(text))).strip()
def language_code(value):
    if not isinstance(value, str) or not value.strip(): return None
    low = value.strip().lower().replace('_', '-'); return LANGUAGE_NAMES.get(low) or (low.split('-')[0] if re.fullmatch(r'[a-z]{2,3}(-[a-z0-9]+)?', low) else None)
DOUBAO_OK, DOUBAO_SILENT = '20000000', '20000003'
def parse_response(cfg, raw, headers=None):
    data = json.loads(raw)
    if cfg['protocol'] == 'doubao-flash':
        result = data.get('result') if isinstance(data, dict) else None
        if not isinstance(result, dict): return '', None, None
        segments = [{'start': u['start_time'] / 1000.0, 'end': u['end_time'] / 1000.0, 'text': u.get('text')} for u in (result.get('utterances') or []) if isinstance(u, dict) and isinstance(u.get('start_time'), (int, float)) and isinstance(u.get('end_time'), (int, float))]
        return tidy(result.get('text') or ''), segments or None, None
    if cfg['protocol'] == 'openai-transcriptions':
        text = tidy(data.get('text') or ''); segments = data.get('segments') if isinstance(data.get('segments'), list) else None
        return text, segments, language_code(data.get('language'))
    content = (((data.get('choices') or [{}])[0]).get('message') or {}).get('content')
    return tidy(content if isinstance(content, str) else ''), None, None
def transcribe(cfg, key, path, language, sleep=time.sleep, context=''):
    """Send one piece. Retries what is worth retrying (rate limits, server errors, a dropped connection) a few times."""
    last = None
    for attempt in range(RETRIES + 1):
        try:
            with urllib.request.urlopen(build_request(cfg, key, path, language, context), timeout=REQUEST_TIMEOUT) as response:
                if cfg['protocol'] == 'doubao-flash':
                    # Doubao answers HTTP 200 and reports the outcome in a header.
                    code = response.headers.get('X-Api-Status-Code', ''); detail = response.headers.get('X-Api-Message', '')
                    if code == DOUBAO_SILENT: return '', None, None
                    if code and code != DOUBAO_OK:  # no header at all (a proxy stripped it) is judged by the body
                        if re.search(r'quota|balance|insufficient|额度|余额|欠费', detail, re.I): raise CloudError('云端识别额度不足或账户欠费：' + detail, code='cloud-quota')
                        if code.startswith('4500001') and re.search(r'auth|key|token|permission|resource|unauthor', detail, re.I): raise CloudError('云端识别鉴权失败，请检查 API Key 和是否已开通极速版识别', code='cloud-auth')
                        if code.startswith('55') and attempt < RETRIES: sleep(min(30.0, (2 ** attempt) + random.random())); last = f'{code} {detail}'; continue
                        raise CloudError(f'云端识别失败（{code}）：{detail[:120]}')
                return parse_response(cfg, response.read(), response.headers)
        except urllib.error.HTTPError as error:
            raw = error.read(); detail = message_of(raw)
            if error.code in (401, 403): raise CloudError('云端识别鉴权失败，请检查 API Key', code='cloud-auth')
            if error.code == 402 or re.search(r'balance|quota|insufficient|余额|额度|欠费', detail, re.I): raise CloudError('云端识别额度不足或账户欠费：' + detail, code='cloud-quota')
            if error.code in (429, 500, 502, 503, 504) and attempt < RETRIES:
                try: wait = float(error.headers.get('Retry-After') or 0)
                except ValueError: wait = 0
                sleep(min(30.0, wait if wait > 0 else (2 ** attempt) + random.random())); last = detail; continue
            raise CloudError(f'云端识别失败（HTTP {error.code}）：{detail}')
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            last = str(getattr(error, 'reason', error))[:120]
            if attempt < RETRIES: sleep(min(30.0, (2 ** attempt) + random.random())); continue
        except (ValueError, KeyError, AttributeError): raise CloudError('云端识别返回了无法理解的内容')
    raise CloudError('云端识别连接失败：' + (last or '未知错误'))

# ---- text back onto the timeline --------------------------------------------------------------------------------------
SENTENCE = re.compile(r'[^。！？!?；;…]+[。！？!?；;…]*|[。！？!?；;…]+')
LONG_CUE = 46
def split_long(piece):
    """A sentence with only commas in it would become one very long cue: break it at commas into pieces of about LONG_CUE characters."""
    if len(piece) <= LONG_CUE: return [piece]
    out, current = [], ''
    for part in re.findall(r'[^，,、]+[，,、]?', piece):
        if current and len(current) + len(part) > LONG_CUE: out.append(current.strip()); current = part
        else: current += part
    if current.strip(): out.append(current.strip())
    return out
def sentences(text):
    pieces = [x for p in SENTENCE.findall(text) if p.strip() for x in split_long(p.strip())]
    # English full stops: split after ". " only (not decimals or abbreviations like "3.5").
    out = []
    for piece in pieces: out += [x.strip() for x in re.split(r'(?<=[a-z0-9\)][.])\s+(?=[A-Z"“])', piece) if x.strip()]
    merged = []
    for piece in out:
        if merged and len(piece) < 6: merged[-1] += (' ' if re.search(r'[A-Za-z0-9.!?"”)]$', merged[-1]) and re.match(r'[A-Za-z0-9"“(]', piece) else '') + piece
        else: merged.append(piece)
    return merged
def cues_from(text, segments, start, end):
    """Cues for one piece: the provider's own segments when it gave any, else sentences spread over the piece by length."""
    if segments:
        cues = []
        for segment in segments:
            try: a, b, t = float(segment['start']), float(segment['end']), tidy(segment.get('text') or '')
            except (KeyError, TypeError, ValueError): continue
            if t: cues.append({'start': round(start + a, 2), 'end': round(start + max(a, b), 2), 'text': t})
        if cues: return cues
    parts = sentences(text) if text else []
    if not parts: return []
    weights = [max(len(p), 1) for p in parts]; total = float(sum(weights)); cues, at = [], start
    for part, weight in zip(parts, weights):
        span = (end - start) * weight / total; cues.append({'start': round(at, 2), 'end': round(at + span, 2), 'text': part}); at += span
    return cues

# ---- the job -------------------------------------------------------------------------------------------------------
def recognise(wav, total, directory, cfg, key, language, tools, env, on_cues, progress, workers=CONCURRENCY, sleep=time.sleep, context=''):
    """Cut, send and reassemble. `on_cues(list)` receives each piece's cues in order as soon as that piece and all before it are done."""
    chunks = plan_chunks(silences(wav, tools['ffmpeg'], env), total, cfg['chunkSeconds'], cfg['maxChunkSeconds']); made = []; detected = None
    scratch = Path(tempfile.mkdtemp(dir=directory, prefix='chunks-'))
    def work(index):
        start, end = chunks[index]; path = encode_chunk(wav, start, end, scratch / f'c{index}', tools['ffmpeg'], env)
        try: return transcribe(cfg, key, path, language, sleep, context)
        finally: path.unlink(missing_ok=True)
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(work, i) for i in range(len(chunks))]
            for index, future in enumerate(futures):
                try: text, segments, lang = future.result()
                except BaseException:
                    for pending in futures: pending.cancel()
                    raise
                detected = detected or lang; start, end = chunks[index]
                cues = cues_from(text, segments, start, end); made += cues
                if cues: on_cues(cues)
                progress(index + 1, len(chunks), end)
    finally:
        for leftover in scratch.glob('*'): leftover.unlink(missing_ok=True)
        try: scratch.rmdir()
        except OSError: pass
    return made, detected

def test(cfg, key, ffmpeg, env, sleep=time.sleep):
    """Check the key and model with a short tone: any answer from the service (even empty text) means the setup works."""
    folder = Path(tempfile.mkdtemp()); path = folder / 'probe.mp3'
    try:
        if subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', str(path)], capture_output=True, env=env, timeout=30).returncode != 0: raise CloudError('无法生成测试音频')
        started = time.time(); text, _, _ = transcribe({**cfg, 'timestamps': 'none'}, key, path, 'auto', sleep)
        return {'ok': True, 'ms': int((time.time() - started) * 1000), 'sample': text[:40]}
    finally:
        for leftover in folder.glob('*'): leftover.unlink(missing_ok=True)
        folder.rmdir()
