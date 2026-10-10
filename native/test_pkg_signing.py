"""A signing failure must abort packaging before an apparently releasable installer exists."""
import os, shutil, subprocess, tempfile, unittest
from pathlib import Path

@unittest.skipIf(os.name == 'nt', 'POSIX macOS packaging fixture; Windows native compatibility is tested separately')
class PackageSigningTest(unittest.TestCase):
    def test_sign_or_verification_failure_stops_packaging(self):
        script = Path(__file__).resolve().parents[1] / 'scripts/pkg/build-pkg.sh'
        for failing in ['sign', 'verify']:
            with self.subTest(failing=failing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); pkg = root / 'scripts/pkg'; pkg.mkdir(parents=True)
                shutil.copy(script, pkg / 'build-pkg.sh')
                (root / 'package.json').write_text('{"version":"1.16.0"}')
                native = root / 'native'; native.mkdir()
                for name in ['install.py', 'host.py', 'asr.py', 'asr_cloud.py', 'asr_engines.py', 'asr_runner.py', 'asr_context.py']: (native / name).write_text('# fixture')
                for name in ['qiaomu-helper', 'postinstall', 'welcome.html', 'conclusion.html', 'distribution.xml']: (pkg / name).write_text('fixture')
                runtime = root / 'runtime/bin'; runtime.mkdir(parents=True)
                (runtime / 'python3').write_text('fixture'); (runtime / 'python3').chmod(0o755)
                mock = root / 'mock'; mock.mkdir()
                commands = {
                    'node': 'echo 1.16.0',
                    'ditto': 'cp -R "$1" "$2"',
                    'file': 'echo Mach-O',
                    'codesign': ('exit 17' if failing == 'sign' else 'case "$1" in --verify) exit 18;; *) exit 0;; esac'),
                    'pkgbuild': 'touch "$PWD/packaging-reached"',
                    'productbuild': 'for last; do :; done; touch "$last"',
                }
                for name, body in commands.items():
                    target = mock / name; target.write_text('#!/bin/sh\n' + body + '\n'); target.chmod(0o755)
                env = {**os.environ, 'PATH': str(mock) + os.pathsep + os.environ['PATH'], 'APP_SIGN_ID': 'fixture', 'INSTALLER_SIGN_ID': '', 'NOTARY_PROFILE': ''}
                result = subprocess.run(['bash', str(pkg / 'build-pkg.sh'), '--python-arm64', str(runtime.parent), '--python-x86_64', str(runtime.parent)], cwd=root, env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertFalse((root / 'packaging-reached').exists())
                self.assertFalse((root / 'builds/qiaomu-clipper-helper.pkg').exists())
