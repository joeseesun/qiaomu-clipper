"""Before packaging, test the signed interpreter with real, separately signed wheels.

Uses an isolated venv and imports the recognizer; never downloads weights or touches
the user's installed tools/models. The other architecture requires its own machine.
"""
import argparse, subprocess, tempfile
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', required=True)
    args = parser.parse_args()
    arch = subprocess.run([args.python, '-c', 'import platform; print(platform.machine())'], check=True, capture_output=True, text=True).stdout.strip()
    engine = 'mlx-qwen3' if arch == 'arm64' else 'faster-whisper'
    package = 'mlx-qwen3-asr' if engine == 'mlx-qwen3' else 'faster-whisper'
    with tempfile.TemporaryDirectory(prefix='qiaomu-signed-runtime-') as temp:
        subprocess.run([args.python, '-m', 'venv', temp], check=True)
        python = str(Path(temp)/'bin/python')
        subprocess.run([python, '-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', package], check=True)
        # Use the same probe as the install worker. No source-only mock can detect
        # macOS library validation rejecting wheels with a different Team ID.
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'native'))
        import asr_engines
        subprocess.run([python, '-c', asr_engines.runtime_probe_code(engine)], check=True, timeout=60)
        print('Signed Python native-library smoke test passed:', engine)

if __name__ == '__main__': main()
