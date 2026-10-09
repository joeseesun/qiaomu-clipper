import importlib.util, json, os, struct, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('clipper_install', Path(__file__).with_name('install.py'))
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)

class InstallCheckTests(unittest.TestCase):
    def probe(self, platform, cloud=False):
        answer = json.dumps({'ok': True, 'ready': cloud, 'missing': [] if cloud else ['whisper'], 'hints': [], 'engine': 'cloud' if cloud else None, 'modelDownloadNeeded': False}).encode()
        with patch.object(install.sys, 'platform', platform), patch.dict(os.environ, {'USERPROFILE': 'C:/Users/fixture', 'HOME': '/home/fixture', 'SystemRoot': 'C:/Windows', 'PATH': 'user-tools'}, clear=True), patch.object(install.subprocess, 'run', return_value=SimpleNamespace(stdout=struct.pack('=I', len(answer)) + answer)) as run:
            result = install.self_asr(Path('host.bat'), 'chrome-extension://fixture/', cloud=cloud)
            kwargs = run.call_args.kwargs
            message = json.loads(kwargs['input'][4:])
            self.assertEqual(message, {'action': 'asrStatus', 'cloud': cloud})
            self.assertEqual(kwargs['env']['USERPROFILE'], 'C:/Users/fixture')
            self.assertEqual(kwargs['env']['HOME'], '/home/fixture')
            self.assertEqual({k.upper(): v for k, v in kwargs['env'].items()}['SYSTEMROOT'], 'C:/Windows')
            self.assertEqual(kwargs['env']['PATH'], 'user-tools' if platform == 'win32' else '/usr/bin:/bin')
            return result

    def test_platform_environment_preserves_home_and_windows_path(self):
        for platform in ('win32', 'darwin', 'linux'):
            with self.subTest(platform=platform): self.probe(platform)

    def test_cloud_ready_without_local_engine_or_model(self):
        self.assertFalse(self.probe('win32')['ready'])
        result = self.probe('win32', cloud=True)
        self.assertTrue(result['ready'])
        self.assertEqual(result['missing'], [])
        self.assertFalse(result['modelDownloadNeeded'])

    def test_bad_reply_is_an_optional_capability_failure(self):
        with patch.object(install.subprocess, 'run', return_value=SimpleNamespace(stdout=b'')):
            self.assertEqual(install.self_asr(Path('host'), 'origin'), {'ready': False, 'error': 'host produced no reply'})

if __name__ == '__main__': unittest.main()
