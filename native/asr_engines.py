"""The recognisers the helper can run on this computer, and how it installs them.

Everything it installs goes into a private folder (`tools/` next to the helper): one Python virtual environment for the
download and audio tools, and one per recogniser, because two recognisers can need different versions of the same
library (installing faster-whisper next to mlx-whisper downgraded a shared dependency in a trial). Nothing global is
touched and no package manager such as Homebrew is needed. Only the packages listed here can be installed; a page can
name an engine, never a package.
"""
import os, platform, re, shutil, sys
from pathlib import Path

def tools_home():
    return Path(os.environ.get('QIAOMU_TOOLS_HOME') or Path.home() / '.local/share/qiaomu-clipper/tools')
def hf_home():
    return Path(os.environ.get('HF_HOME') or Path.home() / '.cache/huggingface')
def apple_silicon(): return sys.platform == 'darwin' and platform.machine() == 'arm64'

# Fetching the video and cutting the audio. imageio-ffmpeg ships a static ffmpeg, so ffmpeg needs no system install.
BASE = {'id': 'base', 'name': '下载与音频工具（yt-dlp、ffmpeg）', 'packages': ['yt-dlp', 'imageio-ffmpeg'], 'sizeMb': 60}
ENGINES = {
    'mlx': {'name': 'Whisper large-v3-turbo（MLX）', 'packages': ['mlx-whisper'], 'model': 'mlx-community/whisper-large-v3-turbo', 'sizeMb': 1700, 'kind': 'cli', 'binary': 'mlx_whisper', 'module': 'mlx_whisper', 'apple': True, 'note': 'Apple 芯片上最快（41 分钟约 1 分钟）'},
    'mlx-qwen3': {'name': 'Qwen3-ASR 0.6B（MLX）', 'packages': ['mlx-qwen3-asr'], 'model': 'Qwen/Qwen3-ASR-0.6B', 'sizeMb': 1300, 'kind': 'runner', 'module': 'mlx_qwen3_asr', 'apple': True, 'note': '中文术语识别准确，体积较小'},
    'faster-whisper': {'name': 'Whisper large-v3-turbo（faster-whisper）', 'packages': ['faster-whisper'], 'model': 'mobiuslabsgmbh/faster-whisper-large-v3-turbo', 'sizeMb': 1700, 'kind': 'runner', 'module': 'faster_whisper', 'apple': False, 'note': '任何电脑都能用，没有 GPU 也行；纯 CPU 约为音频时长的 1/4（41 分钟视频约 10 分钟）'},
}
ORDER = ['mlx', 'mlx-qwen3', 'faster-whisper']

def venv_dir(name): return tools_home() / name
def venv_python(name): return venv_dir(name) / 'bin' / 'python'
def venv_bin(name): return venv_dir(name) / 'bin'
def private_bin_dirs():
    return [str(venv_bin(name)) for name in ['base'] + ORDER if venv_bin(name).is_dir()]
def private_ffmpeg():
    """ffmpeg inside the base environment's imageio-ffmpeg package."""
    for path in sorted(venv_dir('base').glob('lib/python*/site-packages/imageio_ffmpeg/binaries/ffmpeg-*')):
        if path.is_file() and os.access(path, os.X_OK): return str(path)
    return None
def has_module(name, module):
    return any(p.is_dir() for p in venv_dir(name).glob(f'lib/python*/site-packages/{module}'))
def model_ready(model):
    snapshots = hf_home() / 'hub' / ('models--' + model.replace('/', '--')) / 'snapshots'
    return snapshots.is_dir() and any(snapshots.iterdir())
def model_bytes(model):
    folder = hf_home() / 'hub' / ('models--' + model.replace('/', '--'))
    total = 0
    for path in folder.rglob('*') if folder.is_dir() else []:
        try:
            if path.is_file() and not path.is_symlink(): total += path.stat().st_size
        except OSError: pass
    return total

def supported(engine_id):
    return not ENGINES[engine_id]['apple'] or apple_silicon()
def installed(engine_id):
    spec = ENGINES[engine_id]
    if not venv_python(engine_id).exists(): return False
    return (venv_bin(engine_id) / spec['binary']).exists() if spec['kind'] == 'cli' else has_module(engine_id, spec['module'])
def describe(engine_id):
    spec = ENGINES[engine_id]
    return {'id': engine_id, 'name': spec['name'], 'sizeMb': spec['sizeMb'], 'note': spec['note'], 'supported': supported(engine_id), 'installed': installed(engine_id), 'modelReady': model_ready(spec['model']), 'managed': True}
def base_installed():
    return venv_bin('base').joinpath('yt-dlp').exists() and private_ffmpeg() is not None

# ---- installing ---------------------------------------------------------------------------------------------------
def plan(engine_id, python=None):
    """The steps to get one engine (or the base tools) ready: [(stage text, share of the progress, command)] and the model to fetch."""
    python = python or sys.executable
    spec = BASE if engine_id == 'base' else ENGINES[engine_id]
    steps = []
    if not venv_python(spec['id'] if engine_id == 'base' else engine_id).exists(): steps.append(('正在创建独立的 Python 环境', 5, [python, '-m', 'venv', str(venv_dir(engine_id))]))
    steps.append(('正在安装 ' + ', '.join(spec['packages']), 55 if engine_id != 'base' else 90, [str(venv_python(engine_id)), '-m', 'pip', 'install', '--progress-bar', 'off', '--disable-pip-version-check', '-U', *spec['packages']]))
    model = None if engine_id == 'base' else spec['model']
    return steps, model
def required_free_mb(engine_id):
    return (BASE['sizeMb'] if engine_id == 'base' else ENGINES[engine_id]['sizeMb'] + 400) * 1.3
def free_mb():
    home = tools_home()
    while not home.exists() and home != home.parent: home = home.parent
    return shutil.disk_usage(home).free / 1048576
