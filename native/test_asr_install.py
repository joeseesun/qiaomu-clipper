import json, os, stat, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr, asr_engines as eng

FAKE_FFMPEG_INFO = '#!/bin/bash\necho "  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s" >&2\nexit 1\n'

class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); root = Path(self.temp.name)
        self.base = root / 'state'; self.base.mkdir()
        self.patches = [patch.object(asr, 'find_tool', lambda name: None), patch.dict(os.environ, {'QIAOMU_TOOLS_HOME': str(root / 'tools'), 'HF_HOME': str(root / 'hf'), 'QIAOMU_TOOL_DIRS': ''}), patch.object(asr, 'apple_silicon', lambda: True), patch.object(eng, 'apple_silicon', lambda: True)]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in self.patches: p.stop()
        self.temp.cleanup()

    def test_duration_comes_from_ffmpeg_when_there_is_no_ffprobe(self):
        ffmpeg = Path(self.temp.name) / 'ffmpeg'; ffmpeg.write_text(FAKE_FFMPEG_INFO); ffmpeg.chmod(0o700)
        self.assertAlmostEqual(asr.duration_of('x.m4a', {'ffmpeg': str(ffmpeg), 'ffprobe': None}, dict(os.environ)), 3723.5)

    def test_catalogue_lists_missing_engines_as_installable(self):
        status = asr.status(); local = {x['id']: x for x in status['local']}
        self.assertEqual(set(local), {'mlx', 'mlx-qwen3', 'faster-whisper'})
        self.assertFalse(local['mlx']['installed']); self.assertTrue(local['mlx']['managed'])
        self.assertTrue(status['installable']['base']); self.assertIn('mlx-qwen3', status['installable']['engines'])

    def test_intel_mac_is_not_offered_the_mlx_engines(self):
        with patch.object(eng, 'apple_silicon', lambda: False):
            ids = [x['id'] for x in asr.status()['local']]
        self.assertEqual(ids, ['faster-whisper'])

    def test_installed_private_engine_is_found_and_selected(self):
        venv = eng.venv_dir('faster-whisper'); (venv / 'bin').mkdir(parents=True); (venv / 'bin' / 'python').write_text(''); (venv / 'lib/python3.14/site-packages/faster_whisper').mkdir(parents=True)
        status = asr.status(engine='faster-whisper')
        self.assertEqual(status['engine'], 'faster-whisper'); self.assertNotIn('whisper', status['missing'])
        self.assertTrue(next(x for x in status['local'] if x['id'] == 'faster-whisper')['installed'])
        self.assertIn('whisper', asr.status(engine='mlx-qwen3')['missing'])

    def test_start_reports_what_can_be_installed(self):
        reply = asr.handle({'action': 'asrStart', 'videoKey': 'bilibili:BV1hM4m1U7rA:1', 'engine': 'mlx-qwen3'}, self.base)
        self.assertEqual(reply['error'], 'missing'); self.assertIn('mlx-qwen3', reply['installable']['engines'])
        with self.assertRaises(ValueError): asr.handle({'action': 'asrStart', 'videoKey': 'bilibili:BV1hM4m1U7rA:1', 'engine': 'rm -rf'}, self.base)

    def test_only_listed_engines_can_be_installed_or_removed(self):
        with self.assertRaises(ValueError): asr.handle({'action': 'asrInstall', 'engine': 'evil-package'}, self.base)
        with self.assertRaises(ValueError): asr.handle({'action': 'asrUninstall', 'engine': 'base'}, self.base)

    def test_install_needs_disk_space(self):
        with patch.object(eng, 'free_mb', lambda: 10):
            self.assertEqual(asr.handle({'action': 'asrInstall', 'engine': 'mlx'}, self.base)['error'], 'no-space')

    def test_install_job_runs_the_plan_and_reports_completion(self):
        marker = Path(self.temp.name) / 'ran'
        fake_plan = lambda target, python=None: ([('正在安装', 60, ['/bin/sh', '-c', f'echo {target} >> {marker}'])], None)
        # drive the worker directly: starting a detached process is covered by the real-install check
        directory = asr.installs_dir(self.base) / ('a' * 32); directory.mkdir(parents=True)
        asr.atomic_json(directory / 'spec.json', {'engine': 'mlx'}); asr.write_state(directory, engine='mlx', state='queued')
        with patch.object(eng, 'plan', fake_plan), patch.object(eng, 'base_installed', lambda: False), patch.object(asr, 'link_ffmpeg', lambda: None):
            asr.run_install(str(directory))
        state = asr.read_state(directory)
        self.assertEqual(state['state'], 'completed'); self.assertEqual(marker.read_text().split(), ['base', 'mlx'])

    def test_failed_install_leaves_no_half_made_environment(self):
        fake_plan = lambda target, python=None: ([('x', 60, ['/bin/sh', '-c', 'echo "ERROR: no network" >&2; exit 1'])], None)
        directory = asr.installs_dir(self.base) / ('b' * 32); directory.mkdir(parents=True)
        asr.atomic_json(directory / 'spec.json', {'engine': 'faster-whisper'}); eng.venv_dir('faster-whisper').mkdir(parents=True)
        with patch.object(eng, 'plan', fake_plan), patch.object(eng, 'base_installed', lambda: True):
            asr.run_install(str(directory))
        state = asr.read_state(directory)
        self.assertEqual(state['state'], 'failed'); self.assertEqual(state['errorCode'], 'install-failed'); self.assertIn('no network', state['error'])
        self.assertFalse(eng.venv_dir('faster-whisper').exists())

    def test_uninstall_removes_the_environment_and_optionally_the_model(self):
        eng.venv_dir('mlx-qwen3').mkdir(parents=True)
        snap = eng.hf_home() / 'hub' / 'models--Qwen--Qwen3-ASR-0.6B' / 'snapshots' / 'x'; snap.mkdir(parents=True); (snap / 'w.bin').write_bytes(b'0' * 2048)
        reply = asr.handle({'action': 'asrUninstall', 'engine': 'mlx-qwen3', 'model': True}, self.base)
        self.assertTrue(reply['ok']); self.assertFalse(eng.venv_dir('mlx-qwen3').exists()); self.assertFalse(snap.exists())

    def test_runner_engine_command_uses_the_runner_script(self):
        captured = {}
        def fake_stream(command, env, on_line, tail=20): captured['c'] = command; on_line('[00:00.000 --> 00:02.000] hello'); return 0, []
        directory = Path(self.temp.name) / 'job'; directory.mkdir()
        found = {'id': 'faster-whisper', 'path': '/venv/bin/python', 'model': 'm/x', 'modelReady': True, 'runner': True}
        with patch.object(asr, 'stream', fake_stream):
            segments, _ = asr.recognise(directory, {'language': 'en'}, directory / 'a.wav', 10, {}, found, {'ffmpeg': '/ff'})
        self.assertEqual(captured['c'][0], '/venv/bin/python'); self.assertTrue(captured['c'][1].endswith('asr_runner.py')); self.assertEqual(captured['c'][2:5], ['faster-whisper', str(directory / 'a.wav'), 'en'])
        self.assertEqual(segments[0]['text'], 'hello')

if __name__ == '__main__': unittest.main()
