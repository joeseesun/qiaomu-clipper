"""Keep the full install report outside NSIS's limited output stack."""
import contextlib
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import traceback


def rebase_environments(previous, native, base):
    """Retain installed packages when retiring their old bundled Python runtime."""
    if not previous or previous.parent == native.parent.resolve(): return
    old_runtime = (previous.parent / 'runtime').resolve()
    python = native.parent / 'runtime/python.exe'
    for config in (base / 'tools').glob('*/pyvenv.cfg'):
        values = {key.strip(): value.strip() for line in config.read_text(encoding='utf8').splitlines() if '=' in line for key,value in [line.split('=', 1)]}
        if not values.get('home') or Path(values['home']).resolve() != old_runtime: continue
        # --without-pip keeps existing packages and needs no network.
        subprocess.run([str(python), '-X', 'utf8', '-m', 'venv', '--upgrade', '--without-pip', str(config.parent)], check=True, timeout=120)
        subprocess.run([str(config.parent / 'Scripts/python.exe'), '-X', 'utf8', '-c', 'import ssl,sys; print(sys.version)'], check=True, timeout=20)


def main():
    operation = sys.argv[1] if len(sys.argv) == 2 else 'install'
    if operation not in {'install', 'uninstall'}:
        raise SystemExit(2)
    native = Path(__file__).resolve().parent
    import uninstall
    previous = uninstall.windows_package() if operation == 'install' else None
    script = native / (operation + '.py')
    sys.argv = [str(script)] + (['--from-package'] if operation == 'uninstall' else [])
    # ExecToStack truncates at NSIS_MAX_STRLEN. Write UTF-8 directly so a long
    # report or Chinese user path cannot truncate or corrupt diagnostics.
    with (native.parent / (operation + '.log')).open('w', encoding='utf8') as report:
        with contextlib.redirect_stdout(report), contextlib.redirect_stderr(report):
            try:
                if operation == 'install':
                    if uninstall.busy(): raise RuntimeError('请先完成或取消正在进行的任务，再升级助手。')
                    rebase_environments(previous, native, uninstall.BASE)
                runpy.run_path(str(script), run_name='__main__')
                # A version upgrade switches registration only after a successful
                # self-test. Retire the prior package so its uninstaller cannot
                # later remove the newly registered host.
                if previous and previous.parent != native.parent.resolve():
                    shutil.rmtree(previous.parent)
            except Exception:
                traceback.print_exc()
                raise SystemExit(1)


if __name__ == '__main__':
    main()
