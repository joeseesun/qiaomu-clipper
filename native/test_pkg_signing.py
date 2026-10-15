"""Exercise signing itself, not an earlier missing-file failure."""
import os, plistlib, shutil, subprocess, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

@unittest.skipIf(os.name == 'nt', 'POSIX macOS packaging fixture')
class PackageSigningTest(unittest.TestCase):
    def build(self, root, failure=None):
        pkg = root / 'scripts/pkg'; pkg.mkdir(parents=True)
        shutil.copy(ROOT / 'scripts/pkg/build-pkg.sh', pkg / 'build-pkg.sh')
        for path in (ROOT / 'scripts/pkg').glob('*.plist'): shutil.copy(path, pkg / path.name)
        native = root / 'native'; native.mkdir()
        (native / 'VERSION').write_text('1.16.4')
        for name in ['install.py', 'host.py', 'asr.py', 'asr_cloud.py', 'asr_engines.py', 'asr_runner.py', 'asr_context.py', 'media_download.py']: (native / name).write_text('# fixture')
        for name in ['qiaomu-helper', 'postinstall', 'welcome.html', 'conclusion.html', 'distribution.xml']: (pkg / name).write_text('fixture')
        runtime = root / 'runtime/bin'; runtime.mkdir(parents=True)
        (runtime / 'python3').write_text('fixture'); (runtime / 'python3').chmod(0o755)
        (runtime / 'native.so').write_text('fixture')
        mock = root / 'mock'; mock.mkdir()
        commands = {
            'node': ':',
            'python3': 'case "$1" in *check-runtime.py) echo smoke >> "$MOCK_LOG";; *) exec "$REAL_PYTHON" "$@";; esac',
            'ditto': 'cp -R "$1" "$2"',
            'file': 'case "$2" in *.so) echo "Mach-O 64-bit bundle arm64";; *) echo "Mach-O 64-bit executable arm64";; esac',
            'codesign': 'echo "$*" >> "$MOCK_LOG"\n' + ('exit 17' if failure == 'sign' else 'case "$1" in --verify) exit 18;; esac' if failure == 'verify' else ':'),
            'pkgbuild': 'touch "$MOCK_PACKAGED"',
            'productbuild': 'for last; do :; done; touch "$last"',
        }
        for name, body in commands.items():
            target = mock / name; target.write_text('#!/bin/sh\n' + body + '\n'); target.chmod(0o755)
        import sys
        env = {**os.environ, 'PATH': str(mock) + os.pathsep + os.environ['PATH'], 'APP_SIGN_ID': 'fixture', 'INSTALLER_SIGN_ID': '', 'NOTARY_PROFILE': '', 'MOCK_LOG':str(root/'calls'), 'MOCK_PACKAGED':str(root/'packaged'), 'REAL_PYTHON':sys.executable}
        result = subprocess.run(['bash', str(pkg/'build-pkg.sh'), '--python-arm64', str(runtime.parent), '--python-x86_64', str(runtime.parent)], cwd=root, env=env, capture_output=True, text=True)
        return result, (root/'calls').read_text() if (root/'calls').exists() else ''

    def test_sign_or_verification_failure_stops_packaging(self):
        for failure in ['sign','verify']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); result, calls=self.build(root,failure)
                self.assertIn('--force',calls, result.stdout+result.stderr)
                self.assertNotEqual(result.returncode,0)
                self.assertFalse((root/'packaged').exists())

    def test_python_can_load_third_party_native_extensions_and_is_smoke_tested(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); result,calls=self.build(root)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            signs=[line for line in calls.splitlines() if line.startswith('--force')]
            self.assertTrue(signs)
            for line in signs:
                self.assertEqual('--entitlements' in line, not line.endswith('.so'),line)
            entitlement=ROOT/'scripts/pkg/python-entitlements.plist'
            self.assertEqual(plistlib.loads(entitlement.read_bytes()),{'com.apple.security.cs.disable-library-validation':True})
            self.assertIn('smoke',calls)
