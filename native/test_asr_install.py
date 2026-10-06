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

class KeepYtdlpCurrentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); root = Path(self.temp.name)
        self.patches = [patch.dict(os.environ, {'QIAOMU_TOOLS_HOME': str(root / 'tools'), 'QIAOMU_TOOL_DIRS': ''})]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in self.patches: p.stop()
        self.temp.cleanup()
    def private_ytdlp(self, py='3.14.0', module=True):
        venv = eng.venv_dir('base'); (venv / 'bin').mkdir(parents=True); (venv / 'pyvenv.cfg').write_text(f'version = {py}\n')
        (venv / 'bin' / 'yt-dlp').write_text('#!/bin/sh\necho 2025.10.14\n'); (venv / 'bin' / 'yt-dlp').chmod(0o755)
        if module: (venv / f'lib/python{py[:4]}/site-packages/yt_dlp').mkdir(parents=True)

    def test_old_python_gets_the_standalone_ytdlp_not_a_year_old_pip_one(self):
        with patch.object(eng, 'python_version', lambda path: (3, 9)), patch.object(eng, 'modern_python', lambda: None):
            steps, _ = eng.plan('base')
        pip = next(command for _, _, command in steps if 'pip' in command)
        self.assertNotIn('yt-dlp', pip); self.assertIn('imageio-ffmpeg', pip)
        self.assertTrue(any('yt-dlp_' in ' '.join(command) for _, _, command in steps))

    def test_modern_python_installs_ytdlp_with_pip(self):
        with patch.object(eng, 'python_version', lambda path: (3, 12)), patch.object(eng, 'modern_python', lambda: '/x/python3.12'):
            steps, _ = eng.plan('base')
        self.assertEqual(steps[0][2][0], '/x/python3.12'); self.assertIn('yt-dlp', next(c for _, _, c in steps if 'pip' in c))
        self.assertFalse(any('curl' in ' '.join(c) for _, _, c in steps))

    def test_age_is_read_from_the_version(self):
        self.assertIsNone(asr.ytdlp_age_days('')); self.assertGreater(asr.ytdlp_age_days('2020.01.01'), 365)

    def test_only_the_helpers_own_copy_is_updated_and_at_most_twice_a_day(self):
        self.private_ytdlp(); ran = []
        with patch.object(asr, 'run_steps', lambda steps, env: ran.append(steps)):
            self.assertFalse(asr.update_ytdlp({}))  # find_tool finds nothing private here
            with patch.object(asr, 'find_tool', lambda name: str(eng.venv_bin('base') / 'yt-dlp')):
                asr.update_ytdlp({}); self.assertEqual(len(ran), 1); self.assertIn('pip', ran[0][0][2])
                asr.update_ytdlp({}); self.assertEqual(len(ran), 1)  # throttled
                asr.update_ytdlp({}, force=True); self.assertEqual(len(ran), 2)
            with patch.object(asr, 'find_tool', lambda name: '/opt/homebrew/bin/yt-dlp'):
                asr.update_ytdlp({}, force=True); self.assertEqual(len(ran), 2)  # Homebrew's copy is not ours

    def test_standalone_program_updates_itself(self):
        self.private_ytdlp(py='3.9.6'); program = eng.venv_bin('base') / 'yt-dlp'; program.write_bytes(b'\xcf\xfa\xed\xfe'); ran = []
        with patch.object(asr, 'find_tool', lambda name: str(program)), patch.object(asr, 'run_steps', lambda steps, env: ran.append(steps[0][2])):
            asr.update_ytdlp({}, force=True)
        self.assertEqual(ran, [[str(program), '-U']])

    def test_old_python_environment_is_rebuilt_when_a_modern_python_exists(self):
        self.private_ytdlp(py='3.9.6'); rebuilt = []
        with patch.object(asr, 'find_tool', lambda name: str(eng.venv_bin('base') / 'yt-dlp')), patch.object(eng, 'modern_python', lambda: '/x/python3.12'), patch.object(asr, 'rebuild_base', lambda env: rebuilt.append(1)):
            asr.update_ytdlp({}, force=True)
        self.assertEqual(rebuilt, [1])

    def test_failed_rebuild_puts_the_old_environment_back(self):
        self.private_ytdlp(py='3.9.6')
        with patch.object(asr, 'run_steps', lambda steps, env: (_ for _ in ()).throw(asr.Failed('boom'))):
            with self.assertRaises(asr.Failed): asr.rebuild_base({})
        self.assertTrue((eng.venv_bin('base') / 'yt-dlp').is_file())

    def test_download_updates_the_tool_once_when_the_site_has_moved_on(self):
        directory = Path(self.temp.name) / 'job'; directory.mkdir()
        spec = {'videoKey': 'youtube:t4_Uquzbg-U', 'url': 'https://www.youtube.com/watch?v=t4_Uquzbg-U'}
        calls = []
        def fake_stream(command, env, on_line, tail=20):
            calls.append(command[0])
            if command[0] == 'old': return 1, ['ERROR: [youtube] t4_Uquzbg-U: The page needs to be reloaded.']
            (directory / 'audio.m4a').write_text('x'); return 0, []
        with patch.object(asr, 'stream', fake_stream), patch.object(asr, 'update_ytdlp', lambda env, force=False, on_stage=None: True), patch.object(asr, 'find_tool', lambda name: 'new'):
            audio = asr.download(directory, spec, {}, {'yt-dlp': 'old'})
        self.assertEqual(calls, ['old', 'new']); self.assertEqual(audio.name, 'audio.m4a')

    def test_download_says_so_when_even_the_newest_tool_fails(self):
        directory = Path(self.temp.name) / 'job'; directory.mkdir()
        spec = {'videoKey': 'youtube:t4_Uquzbg-U', 'url': 'https://www.youtube.com/watch?v=t4_Uquzbg-U'}
        with patch.object(asr, 'stream', lambda *a, **k: (1, ['ERROR: The page needs to be reloaded.'])), patch.object(asr, 'update_ytdlp', lambda env, force=False, on_stage=None: False):
            with self.assertRaises(asr.Failed) as caught: asr.download(directory, spec, {}, {'yt-dlp': 'x'})
        self.assertEqual(caught.exception.code, 'tool-outdated')

if __name__ == '__main__': unittest.main()
