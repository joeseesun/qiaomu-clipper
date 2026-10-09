#!/usr/bin/env python3
"""Generate subtitles for a video that has none, entirely on this machine: yt-dlp -> ffmpeg -> Whisper.

The native host starts a job as a detached worker (`asr.py worker <job dir>`) and answers short status requests from
the job's files, so nothing listens on a port and the browser only ever talks to the host. Audio never leaves the
machine and is deleted when the job ends; only the text of the result is kept (a cache keyed by the video).
"""
import base64, hashlib, json, os, platform, re, shutil, signal, subprocess, sys, tempfile, time, uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr_engines as eng
import asr_context

MAX_DURATION = 4 * 3600
JOB_KEEP_SECONDS = 3 * 86400
RESULT_KEEP_SECONDS = 60 * 86400
MAX_POLL_SEGMENTS = 2000
# Bump when a change in how audio is recognised makes older cached results wrong (v2: the Chinese prompt no longer biases automatic detection).
RESULT_VERSION = 2
MLX_MODEL = 'mlx-community/whisper-large-v3-turbo'
MLX_MODEL_DIR = 'models--mlx-community--whisper-large-v3-turbo'
# A native host starts with a bare PATH (no Homebrew), so look where these tools are normally installed.
TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', str(Path.home() / '.local/bin'), str(Path.home() / '.cargo/bin'), '/usr/bin', '/bin']
LANGUAGES = {'auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'ru', 'pt', 'it'}
# Browsers yt-dlp can borrow a login from. Only ever used when the viewer explicitly asked for it for this video.
COOKIE_BROWSERS = {'chrome', 'edge', 'brave', 'chromium', 'firefox', 'safari'}
COOKIES_UNREADABLE = re.compile(r'cookies? database|could not (find|decrypt).{0,40}cookie|keyring', re.I)  # the helper started by the browser is not always allowed to open the browser's own cookie file
NEEDS_LOGIN = re.compile(r'sign in to confirm|not a bot|use --cookies|fresh cookies|login required|412|ip address is blocked|blocked from accessing', re.I)  # TikTok answers an anonymous download with "IP address is blocked"; a signed-in browser is let through
# What a downloader that has fallen behind the site looks like (YouTube changes its player every few weeks). Worth one update and one retry.
STALE_TOOL = re.compile(r'needs to be reloaded|unable to extract|nsig|signature|player response|precondition check failed|requested format is not available|http error 403|sabr|po token|js runtime|challenge', re.I)
YOUTUBE_CLIENT_ERROR = re.compile(r'needs to be reloaded|player response|precondition check failed|unable to extract.{0,40}(?:player|initial)', re.I)
UPDATE_EVERY = 12 * 3600
# Lines Whisper tends to invent over silence or music. Only dropped when they stand alone in a short segment.
HALLUCINATIONS = ('谢谢观看', '感谢观看', '请不吝点赞', '字幕由', '字幕 by', '字幕by', '订阅', 'thanks for watching', 'thank you for watching', 'subtitles by', 'amara.org')

# ---- files --------------------------------------------------------------------------------------------------------
def atomic_json(path, data, durable=True):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as f:
            json.dump(data, f, ensure_ascii=False); f.flush()
            if durable: os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)
def asr_root(base): return base / 'asr'
def job_dir(base, job_id): return asr_root(base) / 'jobs' / job_id
def result_path(base, video_key): return asr_root(base) / 'results' / (hashlib.sha256(video_key.encode()).hexdigest()[:32] + '.json')
def read_json(path, default=None):
    try: return json.loads(path.read_text(encoding='utf8'))
    except (OSError, ValueError): return default
def read_state(directory): return read_json(directory / 'state.json', {})
_last_write = {}
def write_state(directory, **changes):
    # Progress ticks come many times a second; a state change is always written, a tick at most every 0.4 s.
    state = read_state(directory); now = time.time()
    quiet = set(changes) <= {'progress', 'processedSec', 'segmentCount', 'stage', 'updatedAt'} and all(state.get(k) == changes.get(k) for k in ('stage',) if k in changes)
    if quiet and now - _last_write.get(str(directory), 0) < 0.4: return {**state, **changes}
    state.update(changes); state['updatedAt'] = now; _last_write[str(directory)] = now; atomic_json(directory / 'state.json', state, durable=False); return state

# ---- tools --------------------------------------------------------------------------------------------------------
def tool_dirs():
    extra = [x for x in os.environ.get('QIAOMU_TOOL_DIRS', '').split(os.pathsep) if x]
    return extra + eng.private_bin_dirs() + TOOL_DIRS
COOKIE_FILE_MAX = 1_000_000
def clean_cookie_text(value):
    """Cookies the extension read from its own browser, in the Netscape file format yt-dlp reads: only that, and not too much of it."""
    if value is None: return None
    if not isinstance(value, str) or len(value) > COOKIE_FILE_MAX or '\x00' in value: raise ValueError('cookies 无效')
    lines = [line for line in value.splitlines() if line.strip()]
    for line in lines:
        if line.startswith('#') and not line.startswith('#HttpOnly_'): continue
        if len(line.split('\t')) != 7: raise ValueError('cookies 无效')
    return '\n'.join(lines) + '\n'
def write_private(path, text):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf8') as handle: handle.write(text)
def find_tool(name):
    found = shutil.which(name, path=os.pathsep.join(tool_dirs() + [os.environ.get('PATH', '')]))
    return found or (eng.private_ffmpeg() if name == 'ffmpeg' else None)
def tool_env():
    env = dict(os.environ); env['PATH'] = os.pathsep.join(tool_dirs() + [env.get('PATH', '')]); env['PYTHONUNBUFFERED'] = '1'; env['PYTHONIOENCODING'] = 'utf-8'
    return env
def tool_version(path, flag='--version'):
    try: return subprocess.run([path, flag], capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[0][:60]
    except Exception: return ''
apple_silicon = eng.apple_silicon
def mlx_model_ready():
    hub = Path(os.environ.get('HF_HOME') or Path.home() / '.cache/huggingface') / 'hub' / MLX_MODEL_DIR / 'snapshots'
    return hub.is_dir() and any(hub.iterdir())
def whisper_cpp_model():
    configured = os.environ.get('WHISPER_CPP_MODEL')
    candidates = [Path(configured)] if configured else []
    for folder in (Path.home() / '.cache/whisper.cpp', Path.home() / '.local/share/whisper.cpp', Path.home() / '.local/share/whisper.cpp/models', Path('/opt/homebrew/share/whisper-cpp/models')):
        for name in ('ggml-large-v3-turbo.bin', 'ggml-large-v3-turbo-q5_0.bin', 'ggml-large-v3.bin', 'ggml-medium.bin', 'ggml-small.bin', 'ggml-base.bin'):
            candidates.append(folder / name)
    return next((str(x) for x in candidates if x.is_file()), None)
def engines():
    """Available recognisers, best first. Each one is a command that prints '[start --> end] text' lines as it goes."""
    found = []
    mlx = find_tool('mlx_whisper')
    if mlx and apple_silicon(): found.append({'id': 'mlx', 'name': 'MLX Whisper (large-v3-turbo)', 'path': mlx, 'modelReady': mlx_model_ready(), 'model': MLX_MODEL, 'fast': True})
    # Engines this helper installs itself (private environments), after the Homebrew-style one above.
    for engine_id in ('mlx-qwen3', 'faster-whisper'):
        if eng.supported(engine_id) and eng.installed(engine_id):
            spec = eng.ENGINES[engine_id]
            found.append({'id': engine_id, 'name': spec['name'], 'path': str(eng.venv_python(engine_id)), 'modelReady': eng.model_ready(spec['model']), 'model': spec['model'], 'fast': engine_id == 'mlx-qwen3', 'runner': True})
    cpp, model = find_tool('whisper-cli'), whisper_cpp_model()
    if cpp and model: found.append({'id': 'whispercpp', 'name': 'whisper.cpp (' + Path(model).stem.replace('ggml-', '') + ')', 'path': cpp, 'modelReady': True, 'model': model, 'fast': False})
    return found
def pick_engine(found, wanted=None):
    """The engine to use: the one asked for if it is installed, else the first available (managed ones only when asked for or alone)."""
    if wanted:
        return next((e for e in found if e['id'] == wanted), None)
    return found[0] if found else None
def local_catalogue(found):
    """Every local engine this computer could use, installed or not, so a page can offer to install the missing ones."""
    listing = [eng.describe(engine_id) for engine_id in eng.ORDER if eng.supported(engine_id)]
    for item in listing:
        # An engine found outside the private folder (Homebrew, uv tool) counts as installed too.
        if not item['installed'] and any(e['id'] == item['id'] for e in found): item['installed'] = True; item['managed'] = False
    # What to suggest installing first: the fastest one this machine can run.
    if listing: listing[0]['recommended'] = True
    cpp = next((e for e in found if e['id'] == 'whispercpp'), None)
    if cpp: listing.append({'id': 'whispercpp', 'name': cpp['name'], 'sizeMb': 0, 'note': '已在本机检测到', 'supported': True, 'installed': True, 'modelReady': True, 'managed': False})
    return listing
def status(cloud=False, engine=None):
    """What is installed. With `cloud` the recognition happens at a service, so no local Whisper is needed."""
    ytdlp, ffmpeg = find_tool('yt-dlp'), find_tool('ffmpeg')
    found = engines(); chosen = pick_engine(found, engine); missing = [name for name, path in (('yt-dlp', ytdlp), ('ffmpeg', ffmpeg)) if not path]
    if not chosen and not cloud: missing.append('whisper')
    hints = []
    if sys.platform == 'darwin':
        if any(x in missing for x in ('yt-dlp', 'ffmpeg')): hints.append('brew install yt-dlp ffmpeg')
        if 'whisper' in missing: hints.append('uv tool install mlx-whisper' + ('' if apple_silicon() else '  # 需要 Apple 芯片；Intel Mac 请改用 brew install whisper-cpp 并下载 ggml 模型'))
    else:
        if any(x in missing for x in ('yt-dlp', 'ffmpeg')): hints.append('安装 yt-dlp 和 ffmpeg')
        if 'whisper' in missing: hints.append('安装 whisper.cpp 并下载 ggml 模型（可用 WHISPER_CPP_MODEL 指定）')
    # What the helper itself can set up when something is missing (no package manager needed).
    installable = {'base': bool({'yt-dlp', 'ffmpeg'} & set(missing)), 'engines': [x['id'] for x in local_catalogue(found) if x['managed'] and x['supported'] and not x['installed']]}
    return {'ok': True, 'ready': not missing, 'missing': missing, 'hints': hints, 'tools': {'yt-dlp': {'path': ytdlp, 'version': (version := tool_version(ytdlp) if ytdlp else ''), 'ageDays': ytdlp_age_days(version), 'updatable': is_private(ytdlp)}, 'ffmpeg': {'path': ffmpeg}}, 'engines': [{k: v for k, v in e.items() if k != 'path'} for e in found], 'local': local_catalogue(found), 'installable': installable, 'engine': 'cloud' if cloud else (chosen['id'] if chosen else None), 'modelDownloadNeeded': not cloud and bool(chosen) and not chosen['modelReady']}

# ---- keeping yt-dlp current ---------------------------------------------------------------------------------------
def ytdlp_age_days(version):
    """Days since this yt-dlp was released (its version is its release date, e.g. 2026.08.19)."""
    match = re.match(r'(\d{4})\.(\d{2})\.(\d{2})', version or '')
    try: return max(0, (time.time() - time.mktime((int(match.group(1)), int(match.group(2)), int(match.group(3)), 0, 0, 0, 0, 0, -1))) // 86400) if match else None
    except (ValueError, OverflowError): return None
def is_private(path):
    """Only the copy the helper installed is the helper's to update; a Homebrew one belongs to the person."""
    return bool(path) and str(Path(path).parent) == str(eng.venv_bin('base'))
def is_standalone(path):
    """pip uses a script on Unix and an executable with an embedded script ZIP on Windows."""
    try:
        with open(path, 'rb') as f:
            if f.read(2) == b'#!': return False
        if eng.windows():
            import zipfile
            try:
                with zipfile.ZipFile(path) as launcher: return '__main__.py' not in launcher.namelist()
            except zipfile.BadZipFile: pass
        return True
    except OSError: return False
def update_stamp(): return eng.tools_home() / 'ytdlp-update.json'
def run_steps(steps, env):
    for label, weight, command in steps:
        code, tail = stream(command, env, lambda line: None)
        if code != 0: raise Failed((tail[-1] if tail else '未知错误')[:200])
def rebuild_base(env):
    """The download environment was made with a Python too old for today's yt-dlp (pip then installs a year-old one and never says so).
    Make a new one beside it and swap; if that fails the old one is put back."""
    folder, old = eng.venv_dir('base'), eng.tools_home() / 'base.old'
    shutil.rmtree(old, ignore_errors=True); folder.rename(old)
    try:
        run_steps(eng.plan('base')[0], env); unquarantine(folder); link_ffmpeg()
        if not eng.base_installed(): raise Failed('下载环境没有装好')
    except Exception:
        shutil.rmtree(folder, ignore_errors=True); old.rename(folder); raise
    shutil.rmtree(old, ignore_errors=True)
def update_ytdlp(env, force=False, on_stage=None):
    """Bring the helper's own yt-dlp up to date. Quiet when it cannot (offline, someone else's copy): the download goes on with
    what there is. Checked at most twice a day unless `force`. Returns True when the version changed."""
    path = find_tool('yt-dlp')
    if not is_private(path): return False
    stamp = read_json(update_stamp(), {})
    if not force and time.time() - stamp.get('checkedAt', 0) < UPDATE_EVERY: return False
    before = tool_version(path)
    if on_stage: on_stage('正在更新下载工具')
    try:
        old_python = (eng.venv_python_version('base') or (3, 99)) < eng.MIN_YTDLP_PYTHON
        if is_standalone(path): run_steps([('', 0, [path, '-U'])], env)  # the standalone program updates itself
        elif old_python and eng.has_module('base', 'yt_dlp'):
            # pip cannot go past what this Python supports: a modern Python rebuilds the environment, else the standalone program replaces it.
            if eng.modern_python(): rebuild_base(env)
            else: run_steps([step for step in eng.plan('base')[0] if step[0] == '正在下载 yt-dlp'], env)
        elif eng.has_module('base', 'yt_dlp'):
            run_steps([('', 0, [str(eng.venv_python('base')), '-m', 'pip', 'install', '--progress-bar', 'off', '--disable-pip-version-check', '--quiet', '-U', 'yt-dlp'])], env)
        else: run_steps([('', 0, [path, '-U'])], env)
    except Exception: pass
    try: atomic_json(update_stamp(), {'checkedAt': time.time(), 'before': before}, durable=False)
    except OSError: pass
    return tool_version(find_tool('yt-dlp')) != before

# ---- the video ----------------------------------------------------------------------------------------------------
def video_url(video_key):
    """The page's video key is all the host accepts; it builds the address itself, so no page can pass an arbitrary one."""
    if not isinstance(video_key, str): raise ValueError('视频标识无效')
    youtube = re.fullmatch(r'youtube:([A-Za-z0-9_-]{11})', video_key)
    if youtube: return 'https://www.youtube.com/watch?v=' + youtube.group(1)
    bilibili = re.fullmatch(r'bilibili:(BV[0-9A-Za-z]{10}):(\d{1,4})', video_key)
    if bilibili: return f'https://www.bilibili.com/video/{bilibili.group(1)}/?p={bilibili.group(2)}'
    podcast = re.fullmatch(r'xiaoyuzhou:([0-9a-f]{24})', video_key)
    if podcast: return 'https://www.xiaoyuzhoufm.com/episode/' + podcast.group(1)
    # An audio or video file the person chose: it was uploaded earlier (see uploads below) and is named by its content.
    if re.fullmatch(r'file:[0-9a-f]{32}', video_key): return video_key
    # A podcast episode from an RSS feed: the key names the feed and the episode by hash; the address itself comes with the request.
    if re.fullmatch(r'rss:[0-9a-f]{12}:[0-9a-f]{16}', video_key): return video_key
    # Any other site yt-dlp can read: the key is the address's hash and the address comes with the request (from the extension's own pages only).
    if re.fullmatch(r'web:[0-9a-f]{12}', video_key): return video_key
    raise ValueError('只支持 YouTube、B 站、小宇宙和本地音频')

# ---- audio that is not a video page: a podcast episode, or a file the person chose ---------------------------------
AUDIO_EXTENSIONS = {'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'webm', 'mp4', 'mkv', 'mov', 'm4v', 'aiff', 'amr'}
MAX_UPLOAD = 4 * 1024 ** 3
MEDIA_HOST = re.compile(r'(?:^|\.)xyzcdn\.net$')
def uploads_dir(base): return asr_root(base) / 'uploads'
def staged_file(base, video_key):
    folder = uploads_dir(base) / video_key.split(':', 1)[1]
    return next((p for p in sorted(folder.glob('source.*')) if p.is_file()), None) if folder.is_dir() else None
def upload_start(base, message):
    name = str(message.get('name') or ''); ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    size = message.get('size')
    if ext not in AUDIO_EXTENSIONS: raise ValueError('不支持的文件类型')
    if not isinstance(size, int) or size <= 0 or size > MAX_UPLOAD: raise ValueError('文件大小无效或超过 4 GB')
    (uploads_dir(base)).mkdir(parents=True, exist_ok=True); prune_uploads(base)
    if eng.free_mb() < size / 1048576 * 3 + 300: return {'ok': False, 'error': 'no-space', 'needMb': int(size / 1048576 * 3 + 300), 'freeMb': int(eng.free_mb())}
    upload_id = uuid.uuid4().hex; folder = uploads_dir(base) / ('tmp-' + upload_id); folder.mkdir(mode=0o700)
    atomic_json(folder / 'meta.json', {'ext': ext, 'size': size, 'received': 0, 'next': 0})
    return {'ok': True, 'uploadId': upload_id}
def upload_folder(base, upload_id):
    if not re.fullmatch(r'[0-9a-f]{32}', str(upload_id)): raise ValueError('上传标识无效')
    folder = uploads_dir(base) / ('tmp-' + upload_id)
    if not folder.is_dir(): raise ValueError('上传已过期，请重新选择文件')
    return folder
def upload_chunk(base, message):
    folder = upload_folder(base, message.get('uploadId')); meta = read_json(folder / 'meta.json', {})
    if message.get('index') != meta.get('next'): raise ValueError('分块顺序不对')
    try: data = base64.b64decode(str(message.get('data') or ''), validate=True)
    except ValueError: raise ValueError('分块数据无效')
    if not data or meta['received'] + len(data) > meta['size']: raise ValueError('分块大小不对')
    with (folder / 'part').open('ab') as f: f.write(data)
    meta['received'] += len(data); meta['next'] += 1; atomic_json(folder / 'meta.json', meta, durable=False)
    return {'ok': True, 'received': meta['received']}
def upload_finish(base, message):
    folder = upload_folder(base, message.get('uploadId')); meta = read_json(folder / 'meta.json', {}); part = folder / 'part'
    if not part.is_file() or part.stat().st_size != meta.get('size'): raise ValueError('文件没有传完整')
    digest = hashlib.sha256()
    with part.open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''): digest.update(block)
    key = digest.hexdigest()[:32]; final = uploads_dir(base) / key; final.mkdir(exist_ok=True, mode=0o700)
    for old in final.glob('source.*'): old.unlink(missing_ok=True)
    os.replace(part, final / ('source.' + meta['ext'])); shutil.rmtree(folder, ignore_errors=True)
    return {'ok': True, 'key': 'file:' + key}
def prune_uploads(base):
    now = time.time()
    for entry in (uploads_dir(base).iterdir() if uploads_dir(base).is_dir() else []):
        try:
            if now - entry.stat().st_mtime > JOB_KEEP_SECONDS: shutil.rmtree(entry, ignore_errors=True)
        except OSError: pass
def fetch_bytes(url, limit=5 * 1024 * 1024, timeout=30):
    import urllib.request
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (qiaomu-clipper)'})
    with urllib.request.urlopen(request, timeout=timeout) as response: return response.read(limit)
# ---- podcasts from an RSS feed -----------------------------------------------------------------------------------
def sha(text, size): return hashlib.sha1(str(text).encode()).hexdigest()[:size]
def public_https(url):
    """https to a real host name: not an address (private or not), not localhost, not a name that is local by convention. The name is not
    resolved here: people who run a proxy with its own DNS (every name answers with a private address) must still be able to download."""
    import ipaddress
    from urllib.parse import urlparse
    parsed = urlparse(str(url)); host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or not host or parsed.username or parsed.password: return False
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet')) or '.' not in host: return False
    try: ipaddress.ip_address(host.strip('[]')); return False  # a numeric address of any kind
    except ValueError: return True
def open_public(url, timeout=30, headers=None, allowed=None):
    import urllib.request
    class Guard(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not public_https(newurl) or (allowed and not allowed(newurl)): raise OSError('跳转到了不允许的地址')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    if not public_https(url) or (allowed and not allowed(url)): raise OSError('地址不是公开的 https 地址')
    opener = urllib.request.build_opener(Guard)
    return opener.open(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (qiaomu-clipper)', 'Accept': '*/*', **(headers or {})}), timeout=timeout)
BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
def douyin_media(page, media):
    from urllib.parse import urlparse, parse_qs
    if not isinstance(media, str) or len(media) > 8000 or not re.fullmatch(r'https://www\.douyin\.com/video/\d+', str(page)): return False
    try:
        parsed = urlparse(media); host = (parsed.hostname or '').lower()
        params = parse_qs(parsed.query, keep_blank_values=True)
        return public_https(media) and parsed.port in (None, 443) and (host == 'douyinvod.com' or host.endswith('.douyinvod.com')) and ('__vid' not in params or params['__vid'] == [page.rsplit('/', 1)[-1]])
    except ValueError: return False
def channels_share(page):
    from urllib.parse import urlparse, parse_qs
    try:
        p = urlparse(str(page))
        if not public_https(page) or p.port not in (None, 443) or p.fragment: return False
        if p.hostname == 'weixin.qq.com': return bool(re.fullmatch(r'/sph/[A-Za-z0-9]{3,64}/?', p.path)) and not p.query
        q = parse_qs(p.query)
        return p.hostname == 'channels.weixin.qq.com' and p.path == '/finder-preview/pages/sph' and set(q) == {'id'} and len(q['id']) == 1 and bool(re.fullmatch(r'[A-Za-z0-9]{3,64}', q['id'][0]))
    except (TypeError, ValueError): return False

def channels_media(page, media):
    from urllib.parse import urlparse
    if not channels_share(page) or not isinstance(media, str) or len(media) > 8000: return False
    try:
        p = urlparse(media)
        return public_https(media) and p.port in (None, 443) and not p.fragment and p.hostname == 'finder.video.qq.com' and bool(re.fullmatch(r'/(?:[0-9]+/){2}stodownload', p.path))
    except ValueError: return False

def page_media(page, media): return douyin_media(page, media) or channels_media(page, media)

XIAOE_SHOP = re.compile(r'https://(app[0-9a-z]{6,24})\.(?:h5\.(?:xiaoeknow|xiaoe-tech)\.com|(?:h5\.)?xet\.(?:citv\.cn|pomoho\.com))/v4/course/alive/(l_[0-9a-z_]{8,64})\?app_id=(app[0-9a-z]{6,24})', re.I)
XIAOE_MEDIA_HOSTS = ('xiaoeknow.com', 'xet.tech', 'xiaoe-tech.com', 'xiaoecloud.com')
def xiaoe_media(page, media):
    """A 小鹅通 live replay: the page is the live's own address, the media one of the shop's HLS playlists."""
    from urllib.parse import urlparse
    shop = XIAOE_SHOP.fullmatch(str(page))
    if not isinstance(media, str) or len(media) > 4000 or not shop or shop.group(1).lower() != shop.group(3).lower(): return False
    try:
        parsed = urlparse(media); host = (parsed.hostname or '').lower()
        return public_https(media) and parsed.port in (None, 443) and any(host == h or host.endswith('.' + h) for h in XIAOE_MEDIA_HOSTS) and parsed.path.lower().endswith('.m3u8')
    except ValueError: return False
def download_hls(directory, spec, env, tools):
    """A replay playlist: yt-dlp reads the segments (several at a time) into one file; the picture is dropped when converting."""
    page = spec['url']; media = spec['mediaUrl']
    if not xiaoe_media(page, media): raise Failed('回放地址无效，请重新打开学习页')
    pattern = re.compile(r'\[download\]\s+([0-9.]+)%')
    command = [tools['yt-dlp'], '--no-playlist', '--no-warnings', '--newline', '--no-continue', '--retries', '4', '--fragment-retries', '6',
               '--concurrent-fragments', '6', '--abort-on-unavailable-fragments', '--fixup', 'never', '-f', 'best', '--add-header', 'Referer:' + page.split('/v4/')[0] + '/',
               '--user-agent', BROWSER_AGENT, '-o', str(directory / 'audio.%(ext)s'), media]
    def progress(line):
        match = pattern.search(line)
        if match: write_state(directory, state='downloading', stage='正在下载小鹅通回放', progress=round(min(float(match.group(1)), 100) * 0.15, 1))
    for attempt in range(3):
        for leftover in directory.glob('audio.*'): leftover.unlink(missing_ok=True)
        write_state(directory, state='downloading', stage='正在下载小鹅通回放', progress=0)
        code, tail = stream(command, env, progress)
        audio = next((p for p in directory.glob('audio.*') if p.suffix not in ('.part', '.ytdl', '.wav', '.json') and not p.name.endswith('.part')), None)
        if code == 0 and audio: return audio
        text = ' '.join(tail).lower()
        if '403' in text or '410' in text or 'expired' in text: raise Failed('回放地址已过期，请重新打开学习页再生成字幕', code='media-expired')
        time.sleep(attempt + 1)
    raise Failed('回放下载失败，请重新读取原链接后重试')
def download_page_media(directory, spec):
    import urllib.error
    page = spec['url']; media = spec['mediaUrl']
    if not page_media(page, media): raise Failed('视频地址无效，请刷新原页面后重试')
    target = directory / 'audio.src.mp4'
    write_state(directory, state='downloading', stage='正在读取原页面视频', progress=0)
    try:
        with open_public(media, timeout=60, headers={'Referer': page, 'User-Agent': BROWSER_AGENT}, allowed=lambda url: page_media(page, url)) as response, target.open('wb') as out:
            total = int(response.headers.get('Content-Length') or 0); got = 0
            if total > MAX_UPLOAD: raise Failed('视频文件太大')
            for block in iter(lambda: response.read(1 << 20), b''):
                got += len(block)
                if got > MAX_UPLOAD: raise Failed('视频文件太大')
                out.write(block)
                if total: write_state(directory, state='downloading', stage='正在读取原页面视频', progress=round(min(got / total, 1) * 15, 1))
            if not got or (total and got < total): raise Failed('视频下载中断，请刷新原页面后重试')
    except urllib.error.HTTPError as error: raise Failed(f'视频地址已过期或被拒绝（{error.code}），请刷新原页面后重新进入学习模式')
    except OSError: raise Failed('视频地址已过期或暂时无法读取，请刷新原页面后重新进入学习模式')
    return target
def cdata(text): return html_unescape(re.sub(r'^\s*<!\[CDATA\[(.*?)\]\]>\s*$', r'\1', str(text or ''), flags=re.S)).strip()
def html_unescape(text):
    import html
    return html.unescape(text)
def rss_item(feed, guid_hash, limit=6 * 1024 * 1024):
    """The episode of a feed whose guid hashes to `guid_hash`: its audio address and what the feed says about it. Only the top of the feed is read (newest first)."""
    with open_public(feed) as response: xml = response.read(limit).decode('utf8', 'replace')
    first = xml.find('<item')
    show = cdata(re.search(r'<title[^>]*>(.*?)</title>', xml[:first if first > 0 else len(xml)], re.S).group(1)) if re.search(r'<title[^>]*>(.*?)</title>', xml[:first if first > 0 else len(xml)], re.S) else ''
    for block in re.findall(r'<item[ >].*?</item>', xml, re.S):
        enclosure = re.search(r'<enclosure[^>]*\burl="([^"]+)"', block)
        guid = re.search(r'<guid[^>]*>(.*?)</guid>', block, re.S)
        ident = cdata(guid.group(1)) if guid else (html_unescape(enclosure.group(1)) if enclosure else '')
        if not ident or sha(ident, 16) != guid_hash: continue
        if not enclosure: raise Failed('这一集没有音频')
        title = re.search(r'<title[^>]*>(.*?)</title>', block, re.S); body = re.search(r'<content:encoded[^>]*>(.*?)</content:encoded>', block, re.S) or re.search(r'<description[^>]*>(.*?)</description>', block, re.S)
        text = re.sub(r'</(?:p|li|h\d|blockquote|div)>|<br\s*/?>', '\n', cdata(body.group(1))) if body else ''
        return {'audio': html_unescape(enclosure.group(1)), 'meta': {'title': cdata(title.group(1)) if title else '', 'show': show, 'description': html_unescape(re.sub(r'<[^>]+>', ' ', text))}}
    raise Failed('在订阅源里没有找到这一集（可能已经太旧）')
def download_rss(directory, spec):
    ref = spec.get('rss') or {}
    item = rss_item(ref['feed'], spec['videoKey'].split(':')[2])
    save_meta(directory, item['meta'])
    audio = item['audio']; ext = audio.split('?')[0].rsplit('.', 1)[-1].lower(); ext = ext if ext in AUDIO_EXTENSIONS else 'mp3'
    target = directory / ('audio.src.' + ext); write_state(directory, state='downloading', stage='正在下载音频', progress=0)
    try:
        with open_public(audio, timeout=60) as response, target.open('wb') as out:
            total = int(response.headers.get('Content-Length') or 0); got = 0
            if total > MAX_UPLOAD: raise Failed('音频文件太大')
            for block in iter(lambda: response.read(1 << 20), b''):
                out.write(block); got += len(block)
                if got > MAX_UPLOAD: raise Failed('音频文件太大')
                if total: write_state(directory, state='downloading', stage='正在下载音频', progress=round(min(got / total, 1) * 15, 1))
            if total and got < total: raise Failed('音频下载中断，请重试')
    except OSError as error: raise Failed('音频下载失败：' + str(error)[:160])
    return target
def podcast_audio_url(page_url, page=None):
    """A podcast page names its audio file in og:audio; only the platform's own media host is accepted."""
    html = page if page is not None else fetch_bytes(page_url, limit=3 * 1024 * 1024).decode('utf8', 'replace')
    match = re.search(r'<meta[^>]+property="og:audio"[^>]+content="([^"]+)"', html) or re.search(r'"enclosure":\{"url":"([^"]+)"', html)
    if not match: raise Failed('没有在这集节目页面里找到音频地址')
    audio = match.group(1).replace('&amp;', '&')
    from urllib.parse import urlparse
    parsed = urlparse(audio)
    if parsed.scheme != 'https' or not MEDIA_HOST.search(parsed.hostname or ''): raise Failed('音频地址不在小宇宙的媒体域名下，已拒绝')
    return audio
def download_podcast(directory, spec):
    import urllib.request
    page = fetch_bytes(spec['url'], limit=3 * 1024 * 1024).decode('utf8', 'replace')
    audio = podcast_audio_url(spec['url'], page)
    save_meta(directory, asr_context.from_podcast_page(page))
    ext = audio.split('?')[0].rsplit('.', 1)[-1].lower(); ext = ext if ext in AUDIO_EXTENSIONS else 'm4a'
    target = directory / ('audio.src.' + ext); request = urllib.request.Request(audio, headers={'User-Agent': 'Mozilla/5.0 (qiaomu-clipper)'})
    write_state(directory, state='downloading', stage='正在下载音频', progress=0)
    try:
        with urllib.request.urlopen(request, timeout=60) as response, target.open('wb') as out:
            total = int(response.headers.get('Content-Length') or 0); got = 0
            for block in iter(lambda: response.read(1 << 20), b''):
                out.write(block); got += len(block)
                if total: write_state(directory, state='downloading', stage='正在下载音频', progress=round(min(got / total, 1) * 15, 1))
            if total and got < total: raise Failed('音频下载中断，请重试')
    except OSError as error: raise Failed('音频下载失败：' + str(error)[:160])
    return target
def copy_staged(directory, spec, base):
    source = staged_file(base, spec['videoKey'])
    if not source: raise Failed('找不到之前选择的文件，请重新选择', code='file-missing')
    write_state(directory, state='downloading', stage='正在读取文件', progress=2)
    target = directory / ('audio.src' + source.suffix)  # never audio.wav: that is where the converted copy goes
    shutil.copyfile(source, target); return target

# ---- results ------------------------------------------------------------------------------------------------------
def to_seconds(stamp):
    parts = [float(x) for x in stamp.split(':')]; total = 0.0
    for part in parts: total = total * 60 + part
    return total
LINE = re.compile(r'^\[((?:\d+:)?\d{1,2}:\d{2}\.\d{3}) --> ((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\]\s*(.*)$')
def parse_line(line):
    match = LINE.match(line.strip())
    if not match or not match.group(3).strip(): return None
    return {'start': round(to_seconds(match.group(1)), 2), 'end': round(to_seconds(match.group(2)), 2), 'text': match.group(3).strip()}
def clean_segments(segments):
    """Drop the lines Whisper makes up over silence and collapse a line it got stuck repeating."""
    out = []
    for segment in segments:
        text = re.sub(r'\s+', ' ', str(segment.get('text', ''))).strip()
        if not text: continue
        low = text.lower()
        if segment['end'] - segment['start'] <= 6 and len(text) <= 40 and any(low.startswith(x) or low == x for x in HALLUCINATIONS): continue
        if len(out) >= 2 and out[-1]['text'] == text and out[-2]['text'] == text: continue
        out.append({'start': segment['start'], 'end': max(segment['end'], segment['start']), 'text': text})
    return out

# ---- job control --------------------------------------------------------------------------------------------------
RUNNING = ('queued', 'downloading', 'converting', 'downloadingModel', 'transcribing')
def pid_alive(pid):
    """Alive and still our worker: a recycled process id must neither keep a dead job running nor be killed by a cancel."""
    if not isinstance(pid, int) or pid <= 0: return False
    if eng.windows():
        # os.kill(pid, 0) terminates a process on Windows instead of probing it.
        query = f"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); (Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine"
        try:
            command = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', query], capture_output=True, text=True, encoding='utf8', errors='replace', timeout=10, creationflags=0x08000000).stdout
        except (OSError, subprocess.SubprocessError): return False
        return 'asr.py' in command and ('worker' in command or 'install' in command)
    try: os.kill(pid, 0)
    except (OSError, TypeError): return False
    try: command = subprocess.run(['ps', '-o', 'command=', '-p', str(pid)], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError): return True
    return 'asr.py' in command and ('worker' in command or ' install ' in command)

def stop_worker(pid):
    if eng.windows():
        if not pid_alive(pid): return
        try: subprocess.run(['taskkill.exe', '/PID', str(pid), '/T', '/F'], capture_output=True, timeout=10, creationflags=0x08000000)
        except (OSError, subprocess.SubprocessError): pass
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try: os.killpg(pid, sig)
        except (OSError, TypeError): break
        time.sleep(0.3)
        if not pid_alive(pid): break
def job_state(base, job_id):
    if not re.fullmatch(r'[0-9a-f]{32}', str(job_id)): return None, None
    directory = job_dir(base, job_id)
    if not directory.is_dir(): return None, None
    state = read_state(directory)
    # A worker that died (crash, killed, machine slept through a reboot) must not stay "running" forever.
    if state.get('state') in RUNNING and not pid_alive(state.get('pid')):
        # Process inspection can take seconds on Windows. The worker may have written its real
        # terminal result and exited while we inspected the PID; do not overwrite that fresh result
        # with an error derived from the stale state read before the inspection.
        state = read_state(directory)
        if state.get('state') in RUNNING:
            state = write_state(directory, state='failed', stage='失败', error=state.get('error') or '字幕生成进程意外退出，请重试')
    return directory, state
def active_job(base):
    jobs = asr_root(base) / 'jobs'
    for entry in (jobs.iterdir() if jobs.is_dir() else []):
        directory, state = job_state(base, entry.name)
        if state and state.get('state') in RUNNING: return entry.name, state
    return None, None
def prune(base):
    now = time.time()
    for folder, keep in ((asr_root(base) / 'jobs', JOB_KEEP_SECONDS), (asr_root(base) / 'results', RESULT_KEEP_SECONDS)):
        for entry in (folder.iterdir() if folder.is_dir() else []):
            try:
                if now - entry.stat().st_mtime > keep and not (entry.is_dir() and read_state(entry).get('state') in RUNNING): shutil.rmtree(entry, ignore_errors=True) if entry.is_dir() else entry.unlink()
            except OSError: pass
def view(directory, state, since=0):
    segments = []; next_index = since
    try:
        with (directory / 'segments.jsonl').open(encoding='utf8') as f:
            for index, line in enumerate(f):
                if index < since: continue
                if len(segments) >= MAX_POLL_SEGMENTS: break
                try: item = json.loads(line)
                except ValueError: break  # a line still being written
                segments.append(item); next_index = index + 1
    except OSError: pass
    keys = ('id', 'videoKey', 'state', 'stage', 'progress', 'processedSec', 'totalSec', 'engine', 'language', 'error', 'errorCode', 'cached', 'segmentCount')
    return {'ok': True, **{k: state.get(k) for k in keys}, 'segments': segments, 'next': next_index}
def spawn_worker(directory, key=None):
    """Detached, in its own session: the host exits after answering, and a cancel can stop the whole group.
    A cloud service's API key reaches the worker only through its environment, never a file."""
    env = tool_env()
    if key: env['QIAOMU_ASR_KEY'] = key
    with (directory / 'worker.log').open('ab') as log:
        worker = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker', str(directory)], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=env)
    return worker.pid
def clean_key(key):
    if not isinstance(key, str) or not key.strip() or len(key) > 300 or re.search(r'[\s\x00-\x1f]', key): raise ValueError('缺少云端识别的 API Key')
    return key
def start(base, message):
    video_key = message.get('videoKey'); url = video_url(video_key)
    rss = None; media_url = None
    if video_key.startswith('rss:'):
        ref = message.get('rss') or {}
        if not isinstance(ref, dict) or not isinstance(ref.get('feed'), str) or not isinstance(ref.get('guid'), str) or len(ref['feed']) > 600 or len(ref['guid']) > 800: raise ValueError('订阅源信息无效')
        if video_key != f"rss:{sha(ref['feed'], 12)}:{sha(ref['guid'], 16)}": raise ValueError('订阅源信息与视频标识不符')
        if not public_https(ref['feed']): raise ValueError('订阅源地址必须是公开的 https 地址')
        rss = {'feed': ref['feed']}
    if video_key.startswith('web:'):
        ref = message.get('web') or {}
        if not isinstance(ref, dict) or not isinstance(ref.get('url'), str) or len(ref['url']) > 1500: raise ValueError('网页地址无效')
        if video_key != 'web:' + sha(ref['url'], 12): raise ValueError('网页地址与视频标识不符')
        if not public_https(ref['url']): raise ValueError('网页地址必须是公开的 https 地址')
        url = ref['url']
        if ref.get('mediaUrl') is not None:
            if not page_media(url, ref['mediaUrl']) and not xiaoe_media(url, ref['mediaUrl']): raise ValueError('原页面视频地址无效')
            media_url = ref['mediaUrl']
    if video_key.startswith('file:') and not staged_file(base, video_key) and not read_json(result_path(base, video_key)): return {'ok': False, 'error': 'file-missing'}
    language = message.get('language') or 'auto'
    if language not in LANGUAGES: raise ValueError('不支持的语言')
    cookies = message.get('cookies') or None
    if cookies is not None and cookies not in COOKIE_BROWSERS: raise ValueError('不支持的浏览器')
    cookie_text = clean_cookie_text(message.get('cookiesTxt')) if cookies else None
    cloud = None; key = None
    if message.get('cloud'):
        import asr_cloud
        cloud = asr_cloud.clean_config(message['cloud']); key = clean_key(message.get('cloudKey'))
    wanted = message.get('engine') or None
    if wanted is not None and wanted not in eng.ENGINES and wanted != 'whispercpp': raise ValueError('不支持的识别引擎')
    info = status(cloud=bool(cloud), engine=None if cloud else wanted)
    if not info['ready']: return {'ok': False, 'error': 'missing', 'missing': info['missing'], 'hints': info['hints'], 'installable': info['installable'], 'engine': wanted}
    (asr_root(base) / 'jobs').mkdir(parents=True, exist_ok=True); (asr_root(base) / 'results').mkdir(parents=True, exist_ok=True); prune(base)
    running_id, running = active_job(base)
    if running:
        if running.get('videoKey') == video_key: return view(job_dir(base, running_id), running)
        return {'ok': False, 'error': 'busy', 'jobId': running_id, 'videoKey': running.get('videoKey')}
    job_id = uuid.uuid4().hex; directory = job_dir(base, job_id); directory.mkdir(parents=True, mode=0o700)
    cached = read_json(result_path(base, video_key))
    engine = 'cloud' if cloud else info['engine']
    # A previous cloud result is valid, but must not masquerade as a new local-engine result (or vice versa).
    cached_language = (cached or {}).get('requestedLanguage', (cached or {}).get('language') or 'auto')
    if cached and cached.get('segments') and cached.get('version') == RESULT_VERSION and cached.get('engine') == engine and cached_language == language and not message.get('force'):
        with (directory / 'segments.jsonl').open('w', encoding='utf8') as f:
            for segment in cached['segments']: f.write(json.dumps(segment, ensure_ascii=False) + '\n')
        state = write_state(directory, id=job_id, videoKey=video_key, state='completed', stage='已从本机缓存读取', progress=100, engine=cached.get('engine'), language=cached.get('language'), cached=True, segmentCount=len(cached['segments']), totalSec=cached.get('duration'), processedSec=cached.get('duration'))
        return view(directory, state)
    spec = {'id': job_id, 'videoKey': video_key, 'url': url, 'language': language, 'engine': engine, 'cookies': cookies, 'cloud': cloud, 'context': message.get('context') is not False, **({'rss': rss} if rss else {}), **({'mediaUrl': media_url} if media_url else {})}
    if cookie_text: write_private(directory / 'cookies.txt', cookie_text); spec['cookiesFile'] = True
    atomic_json(directory / 'spec.json', spec)
    write_state(directory, id=job_id, videoKey=video_key, state='queued', stage='正在准备', progress=0, engine=engine, language=language, segmentCount=0, createdAt=time.time())
    write_state(directory, pid=spawn_worker(directory, key))
    return view(directory, read_state(directory))
def poll(base, message):
    directory, state = job_state(base, message.get('jobId'))
    if not state: return {'ok': False, 'error': 'unknown-job'}
    since = message.get('since'); since = since if isinstance(since, int) and since >= 0 else 0
    return view(directory, state, since)
def cancel(base, message):
    directory, state = job_state(base, message.get('jobId'))
    if not state: return {'ok': False, 'error': 'unknown-job'}
    if state.get('state') in RUNNING:
        stop_worker(state.get('pid'))
        state = write_state(directory, state='cancelled', stage='已取消', error=None)
    for leftover in directory.glob('audio.*'): leftover.unlink(missing_ok=True)
    return view(directory, state)
def probe(message):
    """What yt-dlp can tell about an address without downloading it: whether it can read it, and what it is (title, who, length, picture, and a
    direct media address when the site gives a plain file the page can play)."""
    url = message.get('url')
    if not isinstance(url, str) or len(url) > 1500 or not public_https(url): raise ValueError('网页地址必须是公开的 https 地址')
    cookies = message.get('cookies') or None
    if cookies is not None and cookies not in COOKIE_BROWSERS: raise ValueError('不支持的浏览器')
    cookie_text = clean_cookie_text(message.get('cookiesTxt')) if cookies else None
    ytdlp = find_tool('yt-dlp')
    if not ytdlp: return {'ok': False, 'error': 'missing', 'missing': ['yt-dlp']}
    command = [ytdlp, '--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', '--socket-timeout', '20', '-f', 'bestaudio/best']
    cookie_path = None
    if cookie_text:
        import tempfile
        handle, cookie_path = tempfile.mkstemp(prefix='qm-cookies-', suffix='.txt'); os.close(handle); write_private(cookie_path, cookie_text)
        command += ['--cookies', cookie_path]
    elif cookies: command += ['--cookies-from-browser', cookies]
    command.append(url)
    try: result = subprocess.run(command, capture_output=True, text=True, timeout=60, env=tool_env())
    except subprocess.TimeoutExpired: return {'ok': False, 'error': 'timeout'}
    finally:
        if cookie_path: Path(cookie_path).unlink(missing_ok=True)
    if result.returncode != 0:
        text = (result.stderr or '').strip(); low = text.lower()
        return {'ok': False, 'error': 'unsupported' if 'unsupported url' in low else 'cookies-unreadable' if COOKIES_UNREADABLE.search(low) else 'needs-cookies' if NEEDS_LOGIN.search(low) else 'failed', 'message': (text.splitlines() or [''])[-1][:200]}
    try: info = json.loads(result.stdout)
    except ValueError: return {'ok': False, 'error': 'failed'}
    # Something the page can play as it is: a plain file (not a stream), with the picture if the site has one that is not too large.
    playable = []
    for item in ([info] if not info.get('formats') else []) + list(info.get('formats') or []):
        link = item.get('url')
        if not isinstance(link, str) or item.get('protocol') not in ('https', 'http') or str(item.get('ext') or '').lower() not in ('m4a', 'mp3', 'mp4', 'aac', 'ogg', 'opus', 'webm', 'wav') or not public_https(link) or (item.get('http_headers') or {}).get('Cookie'): continue
        picture = str(item.get('ext') or '').lower() in ('mp4', 'webm') and (item.get('vcodec') not in (None, 'none') or isinstance(item.get('height'), (int, float)))
        if picture and item.get('acodec') == 'none': continue
        playable.append((picture, item.get('height') or 0, item.get('abr') or 0, link))
    pictured = sorted((x for x in playable if x[0] and x[1] <= 720), key=lambda x: -x[1]); sound = sorted((x for x in playable if not x[0]), key=lambda x: -x[2])
    larger = sorted((x for x in playable if x[0]), key=lambda x: x[1])
    chosen = pictured[0] if pictured else larger[0] if larger else sound[0] if sound else None
    direct = chosen[3] if chosen else None
    date = str(info.get('upload_date') or ''); date = f'{date[:4]}-{date[4:6]}-{date[6:8]}' if re.fullmatch(r'\d{8}', date) else None
    return {'ok': True, 'title': str(info.get('title') or '')[:300], 'author': str(info.get('uploader') or info.get('channel') or '')[:120], 'seconds': info.get('duration') if isinstance(info.get('duration'), (int, float)) else None, 'thumbnail': info.get('thumbnail') if isinstance(info.get('thumbnail'), str) and info['thumbnail'].startswith('https://') else None, 'site': str(info.get('extractor_key') or '')[:60], 'mediaUrl': direct, 'video': bool(chosen and chosen[0]), 'description': str(info.get('description') or '')[:6000], 'date': date}
def cloud_test(message):
    """Try a cloud service with a short tone, so a wrong key or model name shows up before a long job does."""
    import asr_cloud
    cfg = asr_cloud.clean_config(message.get('cloud')); key = clean_key(message.get('cloudKey')); ffmpeg = find_tool('ffmpeg')
    if not ffmpeg: return {'ok': False, 'error': '需要先安装 ffmpeg（brew install ffmpeg）', 'code': 'missing'}
    try: return asr_cloud.test(cfg, key, ffmpeg, tool_env())
    except asr_cloud.CloudError as error: return {'ok': False, 'error': str(error), 'code': error.code}
def handle(message, base):
    action = message.get('action')
    if action == 'asrStatus': return status(cloud=bool(message.get('cloud')), engine=message.get('engine') or None)
    if action == 'asrCloudTest': return cloud_test(message)
    if action == 'asrStart': return start(base, message)
    if action == 'asrPoll': return poll(base, message)
    if action == 'asrCancel': return cancel(base, message)
    if action == 'asrProbe': return probe(message)
    if action == 'asrUploadStart': return upload_start(base, message)
    if action == 'asrUploadChunk': return upload_chunk(base, message)
    if action == 'asrUploadFinish': return upload_finish(base, message)
    if action == 'asrInstall': return install_start(base, message)
    if action == 'asrInstallPoll': return install_poll(base, message)
    if action == 'asrInstallCancel': return install_cancel(base, message)
    if action == 'asrUninstall': return uninstall(base, message)
    raise ValueError('不支持的本地操作')

# ---- installing local engines -------------------------------------------------------------------------------------
INSTALLING = ('queued', 'installing', 'downloadingModel')
def installs_dir(base): return asr_root(base) / 'installs'
def install_state(base, job_id):
    if not re.fullmatch(r'[0-9a-f]{32}', str(job_id)): return None, None
    directory = installs_dir(base) / job_id
    if not directory.is_dir(): return None, None
    state = read_state(directory)
    if state.get('state') in INSTALLING and not pid_alive(state.get('pid')):
        # PID inspection may finish after the installer writes its terminal result.
        state = read_state(directory)
        if state.get('state') in INSTALLING:
            state = write_state(directory, state='failed', stage='失败', error=state.get('error') or '安装进程意外退出，请重试')
    return directory, state
def active_install(base):
    for entry in (installs_dir(base).iterdir() if installs_dir(base).is_dir() else []):
        directory, state = install_state(base, entry.name)
        if state and state.get('state') in INSTALLING: return entry.name, state
    return None, None
def install_view(job_id, state):
    return {'ok': True, 'jobId': job_id, **{k: state.get(k) for k in ('engine', 'state', 'stage', 'progress', 'error', 'errorCode')}}
def install_start(base, message):
    engine = message.get('engine')
    if engine != 'base' and engine not in eng.ENGINES: raise ValueError('不支持的识别引擎')
    if engine != 'base' and not eng.supported(engine): return {'ok': False, 'error': 'unsupported', 'message': '这个引擎需要 Apple 芯片的 Mac'}
    running_id, running = active_install(base)
    if running: return install_view(running_id, running) if running.get('engine') == engine else {'ok': False, 'error': 'busy', 'engine': running.get('engine')}
    if active_job(base)[0]: return {'ok': False, 'error': 'busy-job'}
    need = eng.required_free_mb(engine) + (0 if engine == 'base' or eng.base_installed() else eng.required_free_mb('base'))
    if eng.free_mb() < need: return {'ok': False, 'error': 'no-space', 'needMb': int(need), 'freeMb': int(eng.free_mb())}
    installs_dir(base).mkdir(parents=True, exist_ok=True)
    for entry in installs_dir(base).iterdir():  # old finished installs
        if time.time() - entry.stat().st_mtime > 86400: shutil.rmtree(entry, ignore_errors=True)
    job_id = uuid.uuid4().hex; directory = installs_dir(base) / job_id; directory.mkdir(mode=0o700)
    atomic_json(directory / 'spec.json', {'engine': engine})
    write_state(directory, engine=engine, state='queued', stage='正在准备', progress=0)
    with (directory / 'worker.log').open('ab') as log:
        worker = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'install', str(directory)], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=tool_env())
    state = write_state(directory, pid=worker.pid)
    return install_view(job_id, state)
def install_poll(base, message):
    directory, state = install_state(base, message.get('jobId'))
    return install_view(message['jobId'], state) if state else {'ok': False, 'error': 'unknown-job'}
def install_cancel(base, message):
    directory, state = install_state(base, message.get('jobId'))
    if not state: return {'ok': False, 'error': 'unknown-job'}
    if state.get('state') in INSTALLING:
        stop_worker(state.get('pid'))
        state = write_state(directory, state='cancelled', stage='已取消', error=None)
        # A half-made environment is worse than none: the next attempt starts clean.
        if state.get('engine') and not (eng.base_installed() if state['engine'] == 'base' else eng.installed(state['engine'])): shutil.rmtree(eng.venv_dir(state['engine']), ignore_errors=True)
    return install_view(message['jobId'], state)
def uninstall(base, message):
    engine = message.get('engine')
    if engine not in eng.ENGINES: raise ValueError('只能卸载由插件安装的识别引擎')
    if active_job(base)[0] or active_install(base)[0]: return {'ok': False, 'error': 'busy'}
    shutil.rmtree(eng.venv_dir(engine), ignore_errors=True)
    freed = 0
    if message.get('model'):
        folder = eng.hf_home() / 'hub' / ('models--' + eng.ENGINES[engine]['model'].replace('/', '--')); freed = eng.model_bytes(eng.ENGINES[engine]['model'])
        shutil.rmtree(folder, ignore_errors=True)
    return {'ok': True, 'freedMb': round(freed / 1048576)}

def run_install(base_dir):
    directory = Path(base_dir); spec = read_json(directory / 'spec.json') or {}; engine = spec.get('engine'); env = tool_env()
    steps = []
    if engine != 'base' and not eng.base_installed(): steps.append('base')
    steps.append(engine)
    try:
        for index, target in enumerate(steps):
            low, high = index * 100 / len(steps), (index + 1) * 100 / len(steps)
            plan, model = eng.plan(target)
            weights = sum(w for _, w, _ in plan) + (40 if model else 0); done = 0
            for label, weight, command in plan:
                write_state(directory, state='installing', stage=label, progress=round(low + (high - low) * done / weights, 1))
                code, tail = stream(command, env, lambda line: None)
                if code != 0: raise Failed('安装失败：' + (tail[-1] if tail else '未知错误')[:200], code='install-failed')
                unquarantine(eng.venv_dir(target))
                done += weight
            if target == 'base': link_ffmpeg()
            if model: fetch_model(directory, target, model, low + (high - low) * done / weights, high, env)
        write_state(directory, state='completed', stage='安装完成', progress=100, error=None)
    except Failed as error:
        shutil.rmtree(eng.venv_dir(engine), ignore_errors=True) if not (eng.base_installed() if engine == 'base' else eng.installed(engine)) else None
        write_state(directory, state='failed', stage='失败', error=str(error), errorCode=error.code)
    except Exception as error: write_state(directory, state='failed', stage='失败', error='安装时出错：' + str(error)[:200])
def unquarantine(path):
    """Files written by a process Chrome started carry macOS's download flag, and Gatekeeper then refuses to load the unsigned
    compiled libraries pip puts in them ("Apple cannot verify _yaml.cpython-314-darwin.so"). They came from the helper's own
    installer, not a download the person opened, so clear the flag on the private tools folder."""
    if sys.platform != 'darwin' or not Path(path).exists(): return
    try: subprocess.run(['/usr/bin/xattr', '-dr', 'com.apple.quarantine', str(path)], capture_output=True, timeout=300)
    except (OSError, subprocess.SubprocessError): pass
def link_ffmpeg():
    """pip puts the bundled ffmpeg under an odd name; give it the plain one so every tool finds it."""
    binary = eng.private_ffmpeg(); link = eng.venv_executable('base', 'ffmpeg')
    if binary and not link.exists():
        try: link.symlink_to(binary)
        except OSError: shutil.copy2(binary, link)
def fetch_model(directory, engine, model, low, high, env):
    """Download the model with huggingface_hub from the engine's own environment; progress from the size on disk."""
    code_text = 'import sys\nfrom huggingface_hub import snapshot_download\nsnapshot_download(sys.argv[1])'
    expected = max(eng.ENGINES[engine]['sizeMb'], 1) * 1048576
    write_state(directory, state='downloadingModel', stage='正在下载识别模型', progress=round(low, 1))
    process = subprocess.Popen([str(eng.venv_python(engine)), '-c', code_text, model], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True, errors='replace')
    try:
        while process.poll() is None:
            share = min(0.99, eng.model_bytes(model) / expected)
            write_state(directory, state='downloadingModel', stage='正在下载识别模型（%d / %d MB）' % (eng.model_bytes(model) / 1048576, expected / 1048576), progress=round(low + (high - low) * share, 1))
            time.sleep(1)
    finally:
        if process.poll() is None: process.kill()
    if process.returncode != 0: raise Failed('模型下载失败：' + ((process.stdout.read() or '').strip().splitlines() or ['未知错误'])[-1][:200], code='model-failed')

# ---- the worker ---------------------------------------------------------------------------------------------------
class Failed(Exception):
    def __init__(self, message, code=None): super().__init__(message); self.code = code
def stream(command, env, on_line, tail=20):
    """Run a command, hand every output line to on_line, and return its last lines for an error message."""
    lines = []
    with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True, encoding='utf8', errors='replace', bufsize=1) as process:
        for raw in process.stdout:
            for line in raw.replace('\r', '\n').split('\n'):
                if not line.strip(): continue
                lines.append(line); lines = lines[-tail:]; on_line(line)
        return process.wait(), lines
def download(directory, spec, env, tools):
    pattern = re.compile(r'\[download\]\s+([0-9.]+)%')
    if spec['videoKey'].startswith('xiaoyuzhou:'): return download_podcast(directory, spec)
    if spec['videoKey'].startswith('rss:'): return download_rss(directory, spec)
    if spec['videoKey'].startswith('file:'): return copy_staged(directory, spec, directory.parent.parent.parent)
    if spec['videoKey'].startswith('web:') and spec.get('mediaUrl') and xiaoe_media(spec['url'], spec['mediaUrl']): return download_hls(directory, spec, env, tools)
    if spec['videoKey'].startswith('web:') and spec.get('mediaUrl'): return download_page_media(directory, spec)
    command = [tools['yt-dlp'], '--no-playlist', '--no-warnings', '--newline', '--no-continue', '--retries', '4', '--fragment-retries', '4', '-f', 'bestaudio/best', '--write-info-json', '-o', str(directory / 'audio.%(ext)s')]
    cookie_args = []
    if spec.get('cookiesFile') and (directory / 'cookies.txt').is_file(): cookie_args = ['--cookies', str(directory / 'cookies.txt')]
    elif spec.get('cookies') in COOKIE_BROWSERS: cookie_args = ['--cookies-from-browser', spec['cookies']]
    command += cookie_args
    command.append(spec['url'])
    def progress(line):
        match = pattern.search(line)
        if match: write_state(directory, state='downloading', stage='正在下载音频', progress=round(min(float(match.group(1)), 100) * 0.15, 1))
    refreshed = False; client_retry = False; anonymous_retry = False; network_retries = 0
    # Only YouTube needs room for the extra client retry; preserve other sites' three-attempt limit.
    for attempt in range((6 if cookie_args else 5) if spec['videoKey'].startswith('youtube:') else 3):
        for leftover in directory.glob('audio.*'): leftover.unlink(missing_ok=True)  # never resume a truncated CDN stream as if it were whole
        write_state(directory, state='downloading', stage='正在不使用登录状态重试视频下载' if anonymous_retry else '正在下载音频', progress=0)
        code, tail = stream(command, env, progress)
        using_login = bool(cookie_args) and not anonymous_retry
        print(f'[asr] Download attempt {attempt + 1}: client={"default,web_embedded" if client_retry and not anonymous_retry else "default"}, login={using_login}, exit={code}', flush=True)
        audio = next((p for p in directory.glob('audio.*') if p.suffix not in ('.part', '.ytdl', '.wav', '.json')), None)
        if code == 0 and audio:
            info = read_json(directory / 'audio.info.json')
            if info: save_meta(directory, asr_context.from_ytdlp(info))
            return audio
        text = ' '.join(tail).lower()
        if network_retries < 2 and (any(x in text for x in ('timed out', 'connection reset', 'winerror 10054', 'incomplete read', 'unexpected end', 'http error 5')) or re.search(r'downloaded.{0,20}expected', text)):
            network_retries += 1; time.sleep(network_retries); continue
        if NEEDS_LOGIN.search(text) and not using_login:
            if anonymous_retry: raise Failed('YouTube 拒绝了当前登录状态，匿名下载也需要验证身份；请更新 YouTube 登录状态后重试', code='cookies-rejected')
            raise Failed('这个平台要求登录状态才能下载这条视频的音频', code='needs-cookies')
        if COOKIES_UNREADABLE.search(text): raise Failed('没能读取浏览器的登录状态：系统不允许本地助手访问浏览器的数据', code='cookies-unreadable')
        if STALE_TOOL.search(text) and not refreshed:
            # The site changed under the downloader: update it once, then try again with the new one.
            refreshed = True
            if update_ytdlp(env, force=True, on_stage=lambda stage: write_state(directory, state='downloading', stage=stage)):
                command[0] = tools['yt-dlp'] = find_tool('yt-dlp'); continue
        if spec['videoKey'].startswith('youtube:') and YOUTUBE_CLIENT_ERROR.search(text) and not client_retry:
            # Keep the user's explicit login choice and all other download arguments. This is only a
            # bounded retry for YouTube player extraction failures, never a change for other sites.
            client_retry = True
            command[-1:-1] = ['--extractor-args', 'youtube:player_client=default,web_embedded']
            write_state(directory, stage='正在重试 YouTube 音频下载')
            continue
        if spec['videoKey'].startswith('youtube:') and YOUTUBE_CLIENT_ERROR.search(text) and using_login and not anonymous_retry:
            # Current authenticated defaults already contain web_embedded. A rejected cookie session
            # can fail every signed-in client while the public video works anonymously. Try without
            # credentials once, at lower privilege; never change the saved login choice or cookie file.
            anonymous_retry = True
            for flag in ('--cookies', '--cookies-from-browser'):
                if flag in command:
                    index = command.index(flag); del command[index:index + 2]
            # Recompute defaults for an anonymous session; do not carry the authenticated client's
            # embedded override into it (that client can fail fetching its config on Windows).
            if '--extractor-args' in command:
                index = command.index('--extractor-args'); del command[index:index + 2]
            command[-1:-1] = ['--no-cookies', '--no-cookies-from-browser']
            continue
        if STALE_TOOL.search(text): raise Failed('这个视频暂时下载不了：下载工具已是最新，但站点最近有变化，过几天更新后再试。（' + (tail[-1] if tail else '')[:160] + '）', code='tool-outdated')
        raise Failed('音频下载失败：' + (tail[-1] if tail else '未知错误')[:200])
    raise Failed('音频下载失败')
def save_meta(directory, meta):
    """What the page says about this video, kept for the recogniser (only the few fields that matter, length-capped)."""
    keep = {k: (str(v)[:6000] if isinstance(v, str) else [str(x)[:200] for x in v[:60]]) for k, v in (meta or {}).items() if v and k in ('title', 'author', 'show', 'description', 'chapters')}
    if keep: atomic_json(directory / 'meta.json', keep, durable=False)
def duration_of(audio, tools, env):
    """Length in seconds. ffprobe when there is one; otherwise the 'Duration:' line ffmpeg prints (the bundled ffmpeg has no ffprobe)."""
    try:
        if tools.get('ffprobe'): return float(subprocess.run([tools['ffprobe'], '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(audio)], capture_output=True, text=True, timeout=60, env=env).stdout.strip())
        match = re.search(r'Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)', subprocess.run([tools['ffmpeg'], '-hide_banner', '-i', str(audio)], capture_output=True, text=True, timeout=60, env=env).stderr)
        return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))
    except (ValueError, AttributeError, subprocess.SubprocessError): raise Failed('无法读取音频长度')
def convert(directory, audio, env, tools):
    write_state(directory, state='converting', stage='正在转换音频', progress=15)
    total = duration_of(audio, tools, env)
    if total > MAX_DURATION: raise Failed(f'视频超过 {MAX_DURATION // 3600} 小时，暂不支持')
    wav = directory / 'audio.wav'
    code, tail = stream([tools['ffmpeg'], '-y', '-loglevel', 'error', '-i', str(audio), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], env, lambda line: None)
    if code != 0 or not wav.is_file(): raise Failed('音频转换失败：' + (tail[-1] if tail else '')[:200])
    if audio != wav: audio.unlink(missing_ok=True)
    write_state(directory, totalSec=round(total, 1), progress=18)
    return wav, total
def resplit(segments, longest=10.0):
    """A recogniser that was given background text sometimes returns the first stretch as one long line (24 s was seen). Break such a
    line at its sentences, the time shared by length, so a subtitle is never a paragraph."""
    import asr_cloud
    out = []
    for segment in segments:
        if segment['end'] - segment['start'] > longest and len(segment['text']) > 30:
            parts = asr_cloud.cues_from(segment['text'], None, segment['start'], segment['end'])
            if len(parts) > 1: out.extend({'start': p['start'], 'end': p['end'], 'text': p['text']} for p in parts); continue
        out.append(segment)
    return out
def page_meta(directory, spec):
    """What the page said about this video, if the person allows it to be used (the setting is on by default)."""
    return (read_json(directory / 'meta.json') or {}) if spec.get('context', True) else {}
def fits_language(text, language):
    """Background in another script than the speech would pull it the wrong way (a Chinese prompt on English audio)."""
    cjk = len(re.findall(r'[\u4e00-\u9fff]', text)) > len(text) * 0.15
    return not text or (language == 'en' and not cjk) or (language in ('zh', 'ja', 'ko') and cjk) or language not in ('en', 'zh', 'ja', 'ko')
def recognise(directory, spec, wav, total, env, found, tools):
    language = spec.get('language') or 'auto'
    meta = page_meta(directory, spec); short = asr_context.prompt(meta); long = asr_context.background(meta, asr_context.BUDGET_QWEN)
    short = short if fits_language(short, language) else ''; long = long if fits_language(long, language) else ''
    model_missing = not found['modelReady']
    write_state(directory, state='downloadingModel' if model_missing else 'transcribing', stage='首次使用，正在下载识别模型（约 %.1f GB），请稍候' % (eng.ENGINES.get(found['id'], {}).get('sizeMb', 1600) / 1000) if model_missing else '正在识别语音', progress=18)
    if found['id'] == 'mlx':
        command = [found['path'], str(wav), '--model', found['model'], '--condition-on-previous-text', 'False', '--output-dir', str(directory), '--output-name', 'whisper', '--output-format', 'json', '--verbose', 'True']
        if language != 'auto': command += ['--language', language]
        # Only when Chinese was asked for: a Chinese prompt on automatic detection pulls other languages toward Chinese.
        # What the page says about the video goes in the same prompt, at the end, where Whisper weighs it most.
        prompt = ' '.join(x for x in (short, '以下是普通话的句子。' if language == 'zh' else '') if x)
        if prompt: command += ['--initial-prompt', prompt]
    elif found.get('runner'):
        command = [found['path'], str(Path(__file__).resolve().parent / 'asr_runner.py'), found['id'], str(wav), language, '--model', found['model'], '--ffmpeg', tools['ffmpeg'], '--total', str(round(total, 1))]
        context = long if found['id'] == 'mlx-qwen3' else short
        if context: command += ['--context', context]
    else:
        command = [found['path'], '-m', found['model'], '-f', str(wav), '-l', language, '-sns']
    segments = []
    def on_line(line):
        if line.startswith('[asr] '): print(line, flush=True)
        item = parse_line(line)
        if not item: return
        window = segments[-2:]; kept = clean_segments(window + [item])
        if len(kept) > len(window):
            segments.append(kept[-1])
            with (directory / 'segments.jsonl').open('a', encoding='utf8') as f: f.write(json.dumps({'start': kept[-1]['start'], 'end': kept[-1]['end'], 'text': kept[-1]['text']}, ensure_ascii=False) + '\n')
            write_state(directory, state='transcribing', stage='正在识别语音', progress=round(18 + 80 * min(1, item['end'] / max(total, 1)), 1), processedSec=round(item['end'], 1), segmentCount=len(segments))
    code, tail = stream(command, env, on_line)
    if code != 0: raise Failed('语音识别失败：' + (tail[-1] if tail else '未知错误')[:200])
    detected = None
    final = read_json(directory / 'whisper.json') if found['id'] == 'mlx' else None
    if final and isinstance(final.get('segments'), list):
        detected = final.get('language')
        segments = clean_segments([{'start': round(float(s['start']), 2), 'end': round(float(s['end']), 2), 'text': s['text']} for s in final['segments']])
    if not segments: raise Failed('没有识别到语音内容')
    return resplit(segments), detected or (language if language != 'auto' else None)
def recognise_cloud(directory, spec, wav, total, env, tools):
    """Recognition at a service: the audio is cut at pauses and each piece is sent on its own (see asr_cloud.py)."""
    import asr_cloud
    cfg = spec['cloud']; language = spec.get('language') or 'auto'; key = os.environ.get('QIAOMU_ASR_KEY', '')
    meta = page_meta(directory, spec)
    if not key: raise Failed('缺少云端识别的 API Key', code='cloud-auth')
    write_state(directory, state='transcribing', stage='正在用「' + cfg['label'] + '」云端识别', progress=18)
    segments = []
    def on_cues(cues):
        for cue in cues:
            window = segments[-2:]; kept = clean_segments(window + [cue])
            if len(kept) > len(window):
                segments.append(kept[-1])
                with (directory / 'segments.jsonl').open('a', encoding='utf8') as f: f.write(json.dumps(kept[-1], ensure_ascii=False) + '\n')
        write_state(directory, segmentCount=len(segments))
    def progress(done, count, end): write_state(directory, state='transcribing', progress=round(18 + 80 * done / max(count, 1), 1), processedSec=round(end, 1), segmentCount=len(segments))
    try: _, detected = asr_cloud.recognise(wav, total, directory, cfg, key, language, tools, env, on_cues, progress, context=asr_cloud.context_for(cfg, meta, language))
    except asr_cloud.CloudError as error: raise Failed(str(error), code=error.code)
    if not segments: raise Failed('没有识别到语音内容')
    return segments, detected or (language if language != 'auto' else None)
def run_worker(base_dir):
    directory = Path(base_dir); spec = read_json(directory / 'spec.json') or {}; env = tool_env()
    unquarantine(eng.tools_home())  # environments installed before the flag was cleared at install time
    base = directory.parent.parent.parent
    try:
        info = status(cloud=bool(spec.get('cloud')), engine=None if spec.get('cloud') else spec.get('engine'))
        if not info['ready']: raise Failed('缺少工具：' + '、'.join(info['missing']))
        tools = {'yt-dlp': find_tool('yt-dlp'), 'ffmpeg': find_tool('ffmpeg'), 'ffprobe': find_tool('ffprobe')}
        found = None if spec.get('cloud') else pick_engine(engines(), spec.get('engine'))
        update_ytdlp(env, on_stage=lambda stage: write_state(directory, state='downloading', stage=stage, progress=0))
        tools['yt-dlp'] = find_tool('yt-dlp')
        audio = download(directory, spec, env, tools)
        wav, total = convert(directory, audio, env, tools)
        segments, language = recognise_cloud(directory, spec, wav, total, env, tools) if spec.get('cloud') else recognise(directory, spec, wav, total, env, found, tools)
        (asr_root(base) / 'results').mkdir(parents=True, exist_ok=True)
        atomic_json(result_path(base, spec['videoKey']), {'version': RESULT_VERSION, 'videoKey': spec['videoKey'], 'engine': 'cloud' if spec.get('cloud') else found['id'], 'language': language, 'requestedLanguage': spec.get('language') or 'auto', 'duration': round(total, 1), 'createdAt': time.time(), 'segments': segments})
        with (directory / 'segments.jsonl').open('w', encoding='utf8') as f:
            for segment in segments: f.write(json.dumps(segment, ensure_ascii=False) + '\n')
        write_state(directory, state='completed', stage='字幕已生成', progress=100, language=language, segmentCount=len(segments), processedSec=round(total, 1), error=None)
    except Failed as error: write_state(directory, state='failed', stage='失败', error=str(error), errorCode=error.code)
    except Exception as error: write_state(directory, state='failed', stage='失败', error='生成字幕时出错：' + str(error)[:200])
    finally:
        for leftover in directory.glob('audio.*'): leftover.unlink(missing_ok=True)
        (directory / 'cookies.txt').unlink(missing_ok=True)  # the site's cookies live only as long as the job
        # Signed media addresses are needed only by this worker, not by retries or the result cache.
        if spec.get('mediaUrl') and (directory / 'spec.json').is_file():
            try: atomic_json(directory / 'spec.json', {k: v for k, v in spec.items() if k != 'mediaUrl'}, durable=False)
            except OSError: pass

if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'worker': run_worker(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == 'install': run_install(sys.argv[2])
    else: print(json.dumps(status(), ensure_ascii=False, indent=2))
