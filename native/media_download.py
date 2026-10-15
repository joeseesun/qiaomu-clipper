"""Full media export, independent of recognition models. Reuses the helper's detached jobs.
Only extension pages can start/reveal these jobs. Files go to one fixed Downloads subfolder;
requests never contain a destination path, an executable, a shell command or a cloud key.
"""
import os, re, shutil, subprocess, sys, time, uuid
from pathlib import Path
from urllib.parse import urlparse
import asr

YOUTUBE = ('youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'youtube.googleapis.com')
def allowed(url):
    if not isinstance(url, str) or len(url) > 1500 or not asr.public_https(url): return False
    host = (urlparse(url).hostname or '').lower().rstrip('.')
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet')) or '.' not in host: return False
    return not any(host == h or host.endswith('.' + h) for h in YOUTUBE)

def destination():
    downloads = (Path.home() / 'Downloads').resolve()
    downloads.mkdir(parents=True, exist_ok=True)
    folder = downloads / 'Qiaomu Clipper'
    if folder.is_symlink(): raise ValueError('Download folder must not be a symbolic link')
    folder.mkdir(exist_ok=True, mode=0o700)
    return folder

def start(base, message):
    url = message.get('url')
    if not allowed(url) or not isinstance(message.get('name'), str) or len(message['name']) > 300 or not isinstance(message.get('video'), bool): raise ValueError('bad-request')
    for field in ('mediaUrl', 'audioUrl'):
        media = message.get(field)
        if media is not None and not (asr.page_media(url, media) or asr.xiaoe_media(url, media)): raise ValueError('bad-request')
    if message.get('audioUrl') and not message.get('mediaUrl'): raise ValueError('bad-request')
    if not asr.find_tool('yt-dlp') or not asr.find_tool('ffmpeg'): return {'ok': False, 'error': 'missing'}
    cookies = message.get('cookies')
    if cookies and cookies not in asr.COOKIE_BROWSERS: raise ValueError('bad-request')
    cookie_text = asr.clean_cookie_text(message.get('cookiesTxt')) if cookies else None
    # An export cannot change or replace an in-progress subtitle job.
    running_id, running = asr.active_job(base)
    if running: return {'ok': False, 'error': 'busy', 'jobId': running_id}
    asr.prune(base)
    job_id = uuid.uuid4().hex; directory = asr.job_dir(base, job_id); directory.mkdir(parents=True, mode=0o700)
    spec = {k: message[k] for k in ('url', 'name', 'video', 'mediaUrl', 'audioUrl') if k in message}
    spec.update(purpose='download', id=job_id, videoKey='web:' + asr.sha(url, 12), cookies=cookies)
    if cookie_text: asr.write_private(directory / 'cookies.txt', cookie_text); spec['cookiesFile'] = True
    asr.atomic_json(directory / 'spec.json', spec)
    asr.write_state(directory, id=job_id, purpose='download', videoKey=spec['videoKey'], state='queued', progress=0, createdAt=time.time())
    asr.write_state(directory, pid=asr.spawn_worker(directory))
    return view(directory, asr.read_state(directory))

def view(directory, state):
    return {'ok': True, **{k: state.get(k) for k in ('id', 'state', 'progress', 'error')}}

def handle(base, message):
    action = message['action']
    if action == 'mediaDownloadStart': return start(base, message)
    directory, state = asr.job_state(base, message.get('jobId'))
    if not state or state.get('purpose') != 'download': return {'ok': False, 'error': 'unknown-job'}
    if action == 'mediaDownloadCancel':
        if state.get('state') in asr.RUNNING:
            if asr.pid_alive(state.get('pid')): asr.stop_worker(state['pid'])
            state = asr.write_state(directory, state='cancelled', error=None)
            for entry in directory.glob('audio.*'): entry.unlink(missing_ok=True)
            (directory / 'cookies.txt').unlink(missing_ok=True)
            (destination() / ('.qiaomu-' + directory.name + '.part')).unlink(missing_ok=True)
    if action == 'mediaDownloadReveal':
        path = Path(state.get('path') or '')
        if state.get('state') != 'completed' or path.parent != destination() or not path.is_file() or path.is_symlink(): return {'ok': False, 'error': 'unknown-job'}
        if sys.platform == 'darwin': subprocess.Popen(['open', '-R', str(path)])
        elif os.name == 'nt': subprocess.Popen(['explorer.exe', '/select,' + str(path)])
        else: subprocess.Popen(['xdg-open', str(path.parent)])
    return view(directory, state)

def export_file(directory, source, name):
    folder = destination(); ext = source.suffix.lower()
    if source.is_symlink() or not source.is_file() or not source.stat().st_size or not re.fullmatch(r'\.[a-z0-9]{1,8}', ext): raise asr.Failed('下载中断')
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')[:100] or 'media'
    name = name.encode('utf8')[:180].decode('utf8', 'ignore')
    target = folder / (name + '-' + directory.name[:8] + ext)
    partial = folder / ('.qiaomu-' + directory.name + '.part')
    try:
        with partial.open('xb') as out, source.open('rb') as inp:
            os.chmod(partial, 0o600); shutil.copyfileobj(inp, out); out.flush(); os.fsync(out.fileno())
        os.link(partial, target)  # atomic publication; never replace an existing file
    finally: partial.unlink(missing_ok=True)
    return target

def fetch_full(directory, spec, env, tools):
    # Signed sources use the existing host-specific redirect guards. HLS retains its picture.
    if spec.get('mediaUrl'):
        video = asr.download_hls(directory, spec, env, tools) if asr.xiaoe_media(spec['url'], spec['mediaUrl']) else asr.download_page_media(directory, spec)
        if not spec.get('audioUrl'): return video
        other = directory / 'sound'; other.mkdir()
        try:
            audio = asr.download_page_media(other, {**spec, 'mediaUrl': spec['audioUrl']})
            target = directory / 'audio.mkv'
            code, tail = asr.stream([tools['ffmpeg'], '-nostdin', '-v', 'error', '-i', str(video), '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', str(target)], env, lambda _: None)
            if code or not target.is_file(): raise asr.Failed('下载中断')
            return target
        finally: shutil.rmtree(other, ignore_errors=True)
    # Never use an ASR bestaudio selector for video exports. Ignore user configs and reject
    # YouTube extractors (including embeds/redirects), DRM formats and live streams.
    command = [tools['yt-dlp'], '--ignore-config', '--no-playlist', '--no-warnings', '--newline', '--no-continue', '--abort-on-unavailable-fragments', '--socket-timeout', '30', '--retries', '3', '--fragment-retries', '3',
               '--match-filter', 'extractor_key !~= (?i)youtube & !is_live & !has_drm', '--ffmpeg-location', tools['ffmpeg'],
               '-f', 'bv*+ba/b' if spec['video'] else 'ba/b', '--merge-output-format', 'mkv', '-o', str(directory / 'audio.%(ext)s')]
    if spec.get('cookiesFile'): command += ['--cookies', str(directory / 'cookies.txt')]
    elif spec.get('cookies'): command += ['--cookies-from-browser', spec['cookies']]
    command += ['--', spec['url']]
    def progress(line):
        match = re.search(r'\[download\]\s+([0-9.]+)%', line)
        if match: asr.write_state(directory, state='downloading', progress=min(95, float(match.group(1)) * .95))
    code, tail = asr.stream(command, env, progress)
    candidates = [p for p in directory.glob('audio.*') if p.suffix in ('.mp4', '.m4v', '.mkv', '.webm', '.mov', '.m4a', '.mp3', '.ogg', '.opus', '.aac', '.flac', '.wav', '.ts')]
    # yt-dlp can leave separate streams after a failed merger. Only exit 0 and one file is success.
    if code or len(candidates) != 1:
        detail = ' '.join(tail)
        if asr.NEEDS_LOGIN.search(detail): raise asr.Failed('这个平台要求登录状态才能下载这条视频的音频', code='needs-cookies')
        raise asr.Failed('下载中断')
    return candidates[0]

def run_worker(directory, spec):
    try:
        if not allowed(spec.get('url')): raise asr.Failed('bad-request')
        tools = {tool: asr.find_tool(tool) for tool in ('yt-dlp', 'ffmpeg')}
        if not all(tools.values()): raise asr.Failed('缺少工具')
        asr.write_state(directory, state='downloading', progress=0)
        source = fetch_full(directory, spec, asr.tool_env(), tools)
        path = export_file(directory, source, spec['name'])
        asr.write_state(directory, state='completed', progress=100, path=str(path), error=None)
    except Exception as error: asr.write_state(directory, state='failed', error=str(error)[:400])
    finally:
        for entry in directory.glob('audio.*'): entry.unlink(missing_ok=True)
        (directory / 'cookies.txt').unlink(missing_ok=True)
        asr.atomic_json(directory / 'spec.json', {k: v for k, v in spec.items() if k not in ('mediaUrl', 'audioUrl', 'url')}, durable=False)
