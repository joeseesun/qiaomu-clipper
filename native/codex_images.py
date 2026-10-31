"""Codex image jobs, using the same app-server events as Qiaomu Agent/Design.

The CLI owns login credentials. Native messages carry job ids and bounded image
chunks, never arbitrary command lines, file paths or OAuth tokens.
"""
import base64
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import unquote, urlparse

MAX_IMAGE = 20 * 1024 * 1024
CHUNK = 384 * 1024  # base64 plus JSON must stay under native messaging's 1 MB limit
RELAY = ("You are an image generation relay. Call the built-in image generation tool exactly once "
         "for the user's request. Do not run commands, read unrelated files, browse, use MCP tools, "
         "or ask questions. Save only the generated image in the current working directory.")


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf8')
    os.replace(temporary, path)


def find_codex():
    home = Path.home()
    candidates = [shutil.which('codex'), str(home / '.local/bin/codex'),
                  '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
                  str(home / '.npm-global/bin/codex'), str(home / '.bun/bin/codex')]
    candidates.extend(str(p) for p in sorted((home / '.nvm/versions/node').glob('*/bin/codex'), reverse=True))
    for value in candidates:
        if value and Path(value).is_file() and os.access(value, os.X_OK):
            return value
    raise ValueError('codex-missing')


class Rpc:
    def __init__(self, cwd):
        binary = find_codex()
        env = dict(os.environ)
        env['PATH'] = str(Path(binary).parent) + os.pathsep + env.get('PATH', '')
        self.child = subprocess.Popen([binary, 'app-server', '--listen', 'stdio://'], cwd=cwd,
                                      env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, encoding='utf8')
        self.events = queue.Queue()
        self.next_id = 0
        self.notes = []
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.child.stdout:
                try:
                    self.events.put(json.loads(line))
                except (ValueError, TypeError):
                    pass
        finally:
            self.events.put(None)

    def send(self, message):
        self.child.stdin.write(json.dumps(message) + '\n')
        self.child.stdin.flush()

    def receive(self, timeout):
        try:
            value = self.events.get(timeout=max(.01, timeout))
        except queue.Empty:
            raise TimeoutError('codex-image-timeout')
        if value is None:
            raise ValueError('codex-process-closed')
        # Never approve a tool, command, file request or interactive question.
        if 'id' in value and 'method' in value:
            self.send({'id': value['id'], 'error': {'code': -32601, 'message': 'Not supported'}})
            return {}
        return value

    def request(self, method, params, timeout=25):
        self.next_id += 1
        request_id = self.next_id
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            event = self.receive(deadline - time.monotonic())
            if event.get('id') == request_id:
                if event.get('error'):
                    raise ValueError(str(event['error'].get('message', 'codex-request-failed'))[:250])
                return event.get('result', {})
            if event.get('method'):
                self.notes.append(event)
        raise TimeoutError('codex-image-timeout')

    def initialize(self):
        self.request('initialize', {'clientInfo': {'name': 'qiaomu_clipper_images', 'title': 'Qiaomu Clipper', 'version': '1.0'}})
        self.send({'method': 'initialized', 'params': {}})

    def close(self):
        self.child.terminate()
        try:
            self.child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait(timeout=3)
        for stream in (self.child.stdin, self.child.stdout):
            stream.close()


def status():
    with tempfile.TemporaryDirectory(prefix='qiaomu-codex-status-') as cwd:
        rpc = Rpc(cwd)
        try:
            rpc.initialize()
            account = rpc.request('account/read', {'refreshToken': False}).get('account')
            result = rpc.request('model/list', {'limit': 100})
            models = [{'id': m['model'], 'name': m.get('displayName', m['model'])}
                      for m in result.get('data', []) if isinstance(m.get('model'), str) and not m.get('hidden')]
            return {'ok': True, 'signedIn': bool(account and account.get('type') == 'chatgpt'), 'models': models}
        finally:
            rpc.close()


def job_dir(base, job_id):
    if not isinstance(job_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{8,80}', job_id):
        raise ValueError('invalid-image-request')
    return Path(base) / 'image-jobs' / job_id


def image_bytes(item, cwd):
    if item.get('failure') or item.get('status') in ('failed', 'cancelled'):
        raise ValueError('codex-image-failed')
    raw = None
    # The app-server can save its own artifact outside the job workspace while
    # also returning the full image inline. Prefer those bytes: no file access
    # is needed, and the scoped-file fallback can remain strict.
    if isinstance(item.get('result'), str) and item['result']:
        value = re.sub(r'^data:[^;]+;base64,', '', item['result'])
        if len(value) > MAX_IMAGE * 4 // 3 + 4:
            raise ValueError('invalid-image')
        raw = base64.b64decode(value, validate=True)
    saved = item.get('savedPath')
    if raw is None and isinstance(saved, str) and saved:
        path = Path(unquote(urlparse(saved).path) if saved.startswith('file://') else saved)
        if not path.is_absolute():
            path = cwd / path
        path = path.resolve()
        if not path.is_relative_to(cwd.resolve()):
            raise ValueError('codex-image-path-invalid')
        if path.is_file() and 0 < path.stat().st_size <= MAX_IMAGE:
            raw = path.read_bytes()
    if not raw or len(raw) > MAX_IMAGE:
        raise ValueError('empty-image')
    kind = ('image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else
            'image/jpeg' if raw.startswith(b'\xff\xd8\xff') else
            'image/webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None)
    if not kind:
        raise ValueError('invalid-image')
    return raw, kind


def run(folder):
    meta = json.loads((folder / 'job.json').read_text())
    rpc = None
    try:
        if (folder / 'cancel').exists():
            raise InterruptedError()
        meta.update(state='running', pid=os.getpid())
        write_json(folder / 'job.json', meta)
        cwd = folder / 'work'
        cwd.mkdir(mode=0o700, exist_ok=True)
        rpc = Rpc(str(cwd))
        rpc.initialize()
        account = rpc.request('account/read', {'refreshToken': False}).get('account')
        if not account or account.get('type') != 'chatgpt':
            raise ValueError('codex-login-required')
        common = {'cwd': str(cwd), 'approvalPolicy': 'never'}
        if meta['model']:
            common['model'] = meta['model']
        thread = rpc.request('thread/start', {**common, 'sandbox': 'workspace-write', 'ephemeral': True,
                                             'serviceName': 'qiaomu_clipper_images', 'developerInstructions': RELAY})
        thread_id = thread.get('thread', {}).get('id')
        if not thread_id:
            raise ValueError('codex-thread-failed')
        turn = rpc.request('turn/start', {**common, 'threadId': thread_id,
                                         'sandboxPolicy': {'type': 'workspaceWrite', 'writableRoots': [str(cwd)], 'networkAccess': False},
                                         'input': [{'type': 'text', 'text': meta['prompt'], 'text_elements': []}]})
        turn_id = turn.get('turn', {}).get('id')
        deadline = time.monotonic() + 600
        picture = None
        completed = False
        while time.monotonic() < deadline:
            if (folder / 'cancel').exists():
                if turn_id:
                    rpc.send({'id': 999999, 'method': 'turn/interrupt', 'params': {'threadId': thread_id, 'turnId': turn_id}})
                raise InterruptedError()
            try:
                event = rpc.notes.pop(0) if rpc.notes else rpc.receive(1)
            except TimeoutError:
                continue
            params = event.get('params') or {}
            if params.get('threadId') != thread_id:
                continue
            if event.get('method') == 'item/completed' and params.get('item', {}).get('type') == 'imageGeneration':
                picture = image_bytes(params['item'], cwd)
            if event.get('method') == 'turn/completed':
                if params.get('turn', {}).get('status') in ('failed', 'interrupted'):
                    raise ValueError('codex-image-failed')
                completed = True
                break
        if not completed:
            raise TimeoutError('codex-image-timeout')
        if not picture:
            raise ValueError('empty-image')
        raw, kind = picture
        (folder / 'image').write_bytes(raw)
        meta.update(state='ready', type=kind, size=len(raw))
    except InterruptedError:
        meta.update(state='cancelled')
    except Exception as error:
        meta.update(state='failed', error=str(error)[:300])
    finally:
        if rpc:
            rpc.close()
        meta.pop('prompt', None)
        write_json(folder / 'job.json', meta)
        shutil.rmtree(folder / 'work', ignore_errors=True)


def active_job(base):
    for file in (Path(base) / 'image-jobs').glob('*/job.json'):
        try:
            job = json.loads(file.read_text())
            if job.get('state') in ('queued', 'running') and time.time() - job.get('created', 0) <= 720:
                return True
        except (OSError, ValueError, TypeError):
            continue
    return False


def handle(message, base):
    action = message.get('action')
    if action == 'codexImageStatus':
        return status()
    folder = job_dir(base, message.get('id'))
    if action == 'codexImageStart':
        prompt, model = message.get('prompt'), message.get('model', '')
        if not isinstance(prompt, str) or not 1 <= len(prompt) <= 16500 or not isinstance(model, str) or not re.fullmatch(r'[a-zA-Z0-9._/-]{0,120}', model):
            raise ValueError('invalid-image-request')
        find_codex()
        folder.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            folder.mkdir(mode=0o700)
        except FileExistsError:
            return {'ok': True, 'id': message['id']}  # never restart an existing job
        write_json(folder / 'job.json', {'state': 'queued', 'prompt': prompt, 'model': model, 'created': time.time()})
        args = [sys.executable, str(Path(__file__).resolve()), '--run', str(folder)]
        options = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS}
        try:
            subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
        except Exception:
            write_json(folder / 'job.json', {'state': 'failed', 'error': 'codex-process-closed'})
            raise
        return {'ok': True, 'id': message['id']}
    if not (folder / 'job.json').is_file():
        raise ValueError('codex-image-missing')
    meta = json.loads((folder / 'job.json').read_text())
    if action == 'codexImageCancel':
        (folder / 'cancel').touch()
        return {'ok': True}
    if action == 'codexImagePoll':
        if meta['state'] in ('queued', 'running') and time.time() - meta.get('created', 0) > 720:
            meta.update(state='interrupted')
        return {'ok': True, **{k: meta[k] for k in ('state', 'type', 'size', 'error') if k in meta}}
    if action == 'codexImageRead':
        offset = message.get('offset')
        if meta['state'] != 'ready' or type(offset) is not int or not 0 <= offset < meta.get('size', 0):
            raise ValueError('invalid-image-request')
        with (folder / 'image').open('rb') as stream:
            stream.seek(offset)
            raw = stream.read(CHUNK)
        return {'ok': True, 'data': base64.b64encode(raw).decode(), 'next': offset + len(raw)}
    raise ValueError('invalid-image-request')


if __name__ == '__main__' and len(sys.argv) == 3 and sys.argv[1] == '--run':
    run(Path(sys.argv[2]))
