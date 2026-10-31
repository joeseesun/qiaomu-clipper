"""Developer build for Windows installers. Users do not need Python or NSIS.

Sign the .exe with the release owner's Authenticode certificate before public
distribution. This builder intentionally labels its output as unsigned tests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MODULES = 'install.py host.py asr.py asr_cloud.py asr_engines.py asr_runner.py asr_context.py media_download.py uninstall.py codex_images.py x_articles.py x_article_source.py x_setup.py grok-runtime.json VERSION'.split()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', type=Path, required=True)
    parser.add_argument('--arch', choices=['x64', 'arm64'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not (args.python / 'python.exe').is_file():
        parser.error('--python must contain python.exe')
    pe = (args.python / 'python.exe').read_bytes()
    header = struct.unpack_from('<I', pe, 0x3c)[0]
    if pe[header:header + 4] != b'PE\0\0' or struct.unpack_from('<H', pe, header + 4)[0] != {'x64': 0x8664, 'arm64': 0xaa64}[args.arch]:
        parser.error('Python executable architecture does not match --arch')
    version = (ROOT / 'native/VERSION').read_text().strip()
    identity = ['node', '-e', 'console.log(JSON.stringify(require("./scripts/build-info.cjs").sourceState()))']
    source = subprocess.check_output(identity, cwd=ROOT)
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    installer = output / ('qiaomu-clipper-helper-windows-' + args.arch + '.exe')
    (ROOT / 'build/tmp').mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nsis-', dir=ROOT / 'build/tmp') as temporary:
        native = Path(temporary)
        for name in MODULES:
            shutil.copyfile(ROOT / 'native' / name, native / name)
        shutil.copyfile(ROOT / 'scripts/windows/installer.py', native / 'installer.py')
        subprocess.run(['makensis', '-WX', '-V2', '-DVERSION=' + version, '-DOUTPUT=' + str(installer),
                        '-DPYTHON=' + str(args.python.resolve()), '-DNATIVE=' + str(native),
                        str(ROOT / 'scripts/windows/helper.nsi')], check=True)
    if source != subprocess.check_output(identity, cwd=ROOT):
        raise RuntimeError('Source changed during installer build')
    sha = hashlib.sha256(installer.read_bytes()).hexdigest()
    (output / (installer.stem + '.json')).write_text(json.dumps({**json.loads(source), 'version': version, 'file': installer.name,
        'sha256': sha, 'arch': args.arch, 'signed': False, 'published': False, 'status': 'testing-only'}, indent=2) + '\n')
    print(installer)

if __name__ == '__main__':
    main()
