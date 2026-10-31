import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, Mock

import x_setup as setup
import x_articles

ID = '01234567-1234-1234-1234-0123456789ab'
BINARY = 'grok.exe' if os.name == 'nt' else 'grok'

class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.folder = setup.folder_for(self.base, ID)
        self.folder.mkdir(parents=True)
        self.manifest = {'platforms': {'macos-aarch64': {'url': 'https://x.ai/cli/fixture', 'size': 4,
            'sha256': hashlib.sha256(b'GOOD').hexdigest()}}}

    def tearDown(self):
        self.temp.cleanup()

    def install(self, content, check=lambda: None):
        with patch.object(setup, 'runtime_manifest', return_value=self.manifest), patch.object(setup, 'target', return_value='macos-aarch64'):
            setup.install_grok(self.base, self.folder, Mock(), check, opener=lambda *a, **k: io.BytesIO(content))

    def test_checked_download_replaces_only_private_binary(self):
        self.install(b'GOOD')
        self.assertEqual((self.base / 'tools/grok' / BINARY).read_bytes(), b'GOOD')
        self.assertEqual(x_articles.find_grok(self.base), str((self.base / 'tools/grok' / BINARY).resolve()))

    def test_bad_digest_oversize_and_cancel_preserve_working_binary(self):
        self.install(b'GOOD')
        for value in [b'BAD!', b'GOOD-extra', b'G']:
            with self.assertRaisesRegex(ValueError, 'integrity'):
                self.install(value)
            self.assertEqual((self.base / 'tools/grok' / BINARY).read_bytes(), b'GOOD')
            self.assertFalse((self.folder / 'download.part').exists())
        def cancel(): raise InterruptedError()
        with self.assertRaises(InterruptedError): self.install(b'GOOD', cancel)
        self.assertEqual((self.base / 'tools/grok' / BINARY).read_bytes(), b'GOOD')

    def test_invalid_operations_paths_and_changed_operation_are_rejected(self):
        for bad in ['../../escape', None, 'a' * 36]:
            with self.assertRaises(ValueError): setup.folder_for(self.base, bad)
        with self.assertRaises(ValueError): setup.handle({'action': 'xSetupStart', 'id': ID, 'operation': 'run-shell'}, self.base)
        setup.atomic_json(self.folder / 'job.json', {'operation': 'install', 'state': 'ready', 'created': time.time()})
        with self.assertRaises(ValueError): setup.handle({'action': 'xSetupStart', 'id': ID, 'operation': 'login'}, self.base)

    def test_cancel_before_start_is_retained(self):
        setup.handle({'action': 'xSetupCancel', 'id': ID}, self.base)
        with patch.object(setup.subprocess, 'Popen'):
            setup.handle({'action': 'xSetupStart', 'id': ID, 'operation': 'login'}, self.base)
        with patch.object(setup, 'find_grok') as find:
            setup.run(self.folder)
            find.assert_not_called()
        self.assertEqual(setup.read_job(self.folder)['state'], 'cancelled')

    def test_login_uses_fixed_oauth_command_and_never_captures_credentials(self):
        setup.atomic_json(self.folder / 'job.json', {'operation': 'login', 'created': time.time(), 'state': 'queued'})
        child = Mock(returncode=0); child.poll.return_value = 0
        with patch.object(setup, 'find_grok', return_value='/private/grok'), patch.object(setup.subprocess, 'Popen', return_value=child) as run, patch.dict(os.environ, {'XAI_API_KEY': 'DO-NOT-SEND'}):
            setup.run(self.folder)
        self.assertEqual(run.call_args.args[0], ['/private/grok', '--no-auto-update', 'login', '--oauth'])
        opts = run.call_args.kwargs
        self.assertNotIn('XAI_API_KEY', opts['env'])
        self.assertEqual(opts['stdout'], subprocess.DEVNULL)
        self.assertEqual(opts['stderr'], subprocess.DEVNULL)
        self.assertEqual(setup.read_job(self.folder)['state'], 'ready')
        self.assertEqual([p.name for p in self.folder.iterdir()], ['job.json'])

    def test_stale_job_does_not_block_new_install_and_status_does_not_leak_output(self):
        setup.atomic_json(self.folder / 'job.json', {'operation': 'login', 'created': 0, 'state': 'signing-in', 'token': 'secret'})
        self.assertIsNone(setup.active_job(self.base))
        status = setup.handle({'action': 'xSetupPoll', 'id': ID}, self.base)
        self.assertEqual(status['error'], 'setup-timeout')
        self.assertNotIn('token', status)

    @unittest.skipIf(os.name == 'nt', 'Mac/Linux isolated home fixture')
    def test_real_install_without_vault_preserves_previous_settings_and_browser_pairings(self):
        root = self.base / '.local/share/qiaomu-clipper'; root.mkdir(parents=True)
        origin = 'chrome-extension://' + 'a' * 32 + '/'
        (root / 'config.json').write_text(json.dumps({'origins': [origin], 'custom': 'keep'}))
        env = {**os.environ, 'HOME': str(self.base), 'PATH': '/usr/bin:/bin'}
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('install.py'))], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertTrue(json.loads(result.stdout)['ok'])
        config = json.loads((root / 'config.json').read_text())
        self.assertIn(origin, config['origins']); self.assertEqual(config['custom'], 'keep')
        self.assertTrue((root / 'x_setup.py').is_file())
        self.assertTrue((root / 'grok-runtime.json').is_file())

if __name__ == '__main__': unittest.main()
