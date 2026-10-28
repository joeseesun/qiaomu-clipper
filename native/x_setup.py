"""GUI setup for the existing X reader. Only fixed download/login operations.

Credentials belong to Grok and never enter native messages or setup logs. A
located executable is not evidence of a valid subscription or a complete source.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
from urllib.request import Request, urlopen

from x_articles import atomic_json, find_grok, terminate

TIMEOUT = 600
LIMIT = 250 * 1024 * 1024
ACTIVE = {'queued', 'downloading', 'signing-in'}


def runtime_manifest():
    return json.loads(Path(__file__).with_name('grok-runtime.json').read_text())


def target():
    system = {'darwin': 'macos', 'win32': 'windows'}.get(sys.platform)
    arch = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'amd64': 'x86_64', 'x86_64': 'x86_64'}.get(platform.machine().lower())
    if not system or not arch:
        raise ValueError('setup-platform-unsupported')
    return system + '-' + arch


def folder_for(base, job_id):
    if not isinstance(job_id, str) or not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', job_id):
        raise ValueError('invalid-x-request')
    folder = Path(base) / 'x-setup' / job_id
    if folder.parent.is_symlink() or folder.is_symlink():
        raise ValueError('invalid-x-request')
    return folder


def read_job(folder):
    meta = json.loads((folder / 'job.json').read_text(encoding='utf8'))
    if meta.get('state') in ACTIVE and time.time() - meta['created'] > TIMEOUT + 30:
        meta.update(state='failed', error='setup-timeout')
    # No process output, executable paths, credentials or arbitrary properties.
    return {k: meta[k] for k in ('id', 'operation', 'state', 'created', 'progress', 'error') if k in meta}


def active_job(base):
    for path in (Path(base) / 'x-setup').glob('*/job.json'):
        if path.parent.is_symlink():
            continue
        try:
            job = read_job(path.parent)
            if job['state'] in ACTIVE:
                return job
        except (OSError, ValueError, KeyError):
            continue
    return None


def status(base):
    try:
        find_grok(base); available = True
    except ValueError:
        available = False
    try:
        key = target()
        supported = key in runtime_manifest()['platforms']
    except (ValueError, OSError):
        supported = False
    return {'ok': True, 'xSetup': 1, 'xArticles': 1, 'grokAvailable': available,
            'setupSupported': supported, 'version': Path(__file__).with_name('VERSION').read_text().strip(),
            'job': active_job(base)}


def install_grok(base, folder, update, check, opener=urlopen):
    # Version and digests are reviewed with the helper; never execute a mutable
    # install script or accept a URL/digest/command from a browser message.
    lock = runtime_manifest()
    artifact = lock['platforms'].get(target())
    if not artifact:
        raise ValueError('setup-platform-unsupported')
    destination = Path(base) / 'tools' / 'grok'
    if destination.is_symlink() or destination.parent.is_symlink():
        raise ValueError('setup-install-failed')
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    binary = destination / ('grok.exe' if os.name == 'nt' else 'grok')
    temporary = folder / 'download.part'
    try:
        update(state='downloading', progress=0)
        digest, count = hashlib.sha256(), 0
        with opener(Request(artifact['url'], headers={'User-Agent': 'QiaomuClipper-X-Setup/1'}), timeout=30) as response, temporary.open('wb') as output:
            while True:
                check()
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > LIMIT or count > artifact['size']:
                    raise ValueError('setup-integrity-failed')
                digest.update(chunk); output.write(chunk)
                update(progress=int(count * 100 / artifact['size']))
        check()
        if count != artifact['size'] or digest.hexdigest() != artifact['sha256']:
            raise ValueError('setup-integrity-failed')
        temporary.chmod(0o700)
        # Atomic replacement preserves any previously working managed binary on
        # download/checksum failure. It never overwrites a user's Grok install.
        os.replace(temporary, binary)
    finally:
        temporary.unlink(missing_ok=True)


def run(folder):
    base = folder.parent.parent
    meta = json.loads((folder / 'job.json').read_text(encoding='utf8'))
    child = None
    def update(**fields):
        meta.update(fields); atomic_json(folder / 'job.json', meta)
    def check():
        if (folder / 'cancel').exists():
            raise InterruptedError()
        if time.time() - meta['created'] > TIMEOUT:
            raise TimeoutError()
    try:
        check()
        if meta['operation'] == 'install':
            install_grok(base, folder, update, check)
        else:
            binary = find_grok(base)
            update(state='signing-in')
            env = dict(os.environ)
            env.pop('XAI_API_KEY', None)
            env['PATH'] = str(Path(binary).parent) + os.pathsep + env.get('PATH', '')
            options = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
            # The official client opens the user's browser and stores its own
            # login. Discard output, including OAuth callback URLs and tokens.
            child = subprocess.Popen([binary, '--no-auto-update', 'login', '--oauth'], cwd=folder, env=env,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
            while child.poll() is None:
                check(); time.sleep(.2)
            check()
            if child.returncode:
                raise ValueError('setup-login-failed')
        check(); update(state='ready', progress=100)
    except InterruptedError:
        update(state='cancelled')
    except TimeoutError:
        update(state='failed', error='setup-timeout')
    except Exception as error:
        code = str(error)
        allowed = {'setup-integrity-failed', 'setup-platform-unsupported', 'grok-missing', 'setup-login-failed', 'setup-install-failed'}
        update(state='failed', error=code if code in allowed else 'setup-download-failed' if meta['operation'] == 'install' else 'setup-login-failed')
    finally:
        if child:
            terminate(child)


def handle(message, base):
    action = message.get('action')
    if action == 'xSetupStatus':
        return status(base)
    folder = folder_for(base, message.get('id'))
    if action == 'xSetupStart':
        operation = message.get('operation')
        if operation not in {'install', 'login'}:
            raise ValueError('invalid-x-request')
        folder.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        from host import lock_exclusive
        with (folder.parent / 'lock').open('a+b') as lock:
            if not lock.tell():
                lock.write(b'0'); lock.flush()
            lock_exclusive(lock)
            if (folder / 'job.json').exists():
                if read_job(folder).get('operation') != operation:
                    raise ValueError('invalid-x-request')
                return {'ok': True, 'id': message['id']}
            if active_job(base):
                raise ValueError('setup-busy')
            from x_articles import active_job as reading
            if reading(base):
                raise ValueError('setup-busy')
            folder.mkdir(mode=0o700, exist_ok=True)
            atomic_json(folder / 'job.json', {'id': message['id'], 'operation': operation, 'state': 'queued', 'created': time.time()})
            options = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS}
            try:
                subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--run', str(folder)],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
            except Exception:
                atomic_json(folder / 'job.json', {'state': 'failed', 'created': time.time(), 'error': 'setup-install-failed'})
                raise ValueError('setup-install-failed')
        return {'ok': True, 'id': message['id']}
    if action == 'xSetupCancel':
        # A cancellation arriving before start is retained for the worker.
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        (folder / 'cancel').touch()
        return {'ok': True}
    if action == 'xSetupPoll' and (folder / 'job.json').is_file():
        return {'ok': True, **read_job(folder)}
    raise ValueError('setup-job-missing')


if __name__ == '__main__' and len(sys.argv) == 3 and sys.argv[1] == '--run':
    run(Path(sys.argv[2]))
