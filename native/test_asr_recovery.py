"""Backend, downloader and failed-result regressions; no GPU, shell fixtures or network required."""
import contextlib, io, json, sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
import asr, asr_runner as runner

class ComputeTests(unittest.TestCase):
    def capabilities(self, cuda, cpu=None, count=1):
        return SimpleNamespace(get_cuda_device_count=Mock(return_value=count),
                               get_supported_compute_types=Mock(side_effect=lambda device: cuda if device == 'cuda' else (cpu if cpu is not None else {'int8', 'float32'})))

    def test_gpu_priorities_use_only_supported_types(self):
        for supported, expected in [({'float16', 'int8', 'float32'}, 'float16'), ({'int8_float16'}, 'int8_float16'),
                                    ({'int8', 'int8_float32', 'float32'}, 'int8_float32'), ({'int8'}, 'int8'), ({'float32'}, 'float32')]:
            with self.subTest(supported=supported):
                self.assertEqual(runner.compute_candidates(self.capabilities(supported))[0], ('cuda', expected))

    def test_no_cuda_or_no_suitable_precision_falls_back_to_cpu(self):
        for count, cuda in [(0, {'float16'}), (1, set()), (1, {'bfloat16'})]:
            self.assertEqual(runner.compute_candidates(self.capabilities(cuda, count=count)), [('cpu', 'int8'), ('cpu', 'float32')])
        self.assertEqual(runner.compute_candidates(self.capabilities(set(), {'float32'})), [('cpu', 'float32')])

    def test_probe_failures_are_logged_and_cpu_float32_remains_available(self):
        ct = self.capabilities(set())
        ct.get_supported_compute_types.side_effect = RuntimeError('driver unavailable')
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertEqual(runner.compute_candidates(ct), [('cpu', 'float32')])
        self.assertIn('CUDA capability probe failed', log.getvalue())
        self.assertIn('CPU capability probe failed', log.getvalue())
        ct.get_cuda_device_count.side_effect = RuntimeError('driver missing')
        ct.get_supported_compute_types.side_effect = None
        ct.get_supported_compute_types.return_value = {'int8'}
        self.assertEqual(runner.compute_candidates(ct), [('cpu', 'int8')])

    def test_no_supported_backend_is_an_explicit_failure(self):
        with self.assertRaisesRegex(RuntimeError, 'No supported'):
            runner.compute_candidates(self.capabilities(set(), set()))

    def run_transcription(self, factory):
        args = SimpleNamespace(model='installed-model', language='zh', context='')
        runner.transcribe_faster(args, 'samples', factory, [('cuda', 'int8_float32'), ('cpu', 'int8'), ('cpu', 'float32')])

    def test_cuda_loader_failure_and_cpu_int8_failure_use_cpu_float32(self):
        good = Mock(); good.transcribe.return_value = ([SimpleNamespace(start=0, end=1, text='hello')], None)
        factory = Mock(side_effect=[RuntimeError('Library cublas64_12.dll is not found'), ValueError('Requested int8 compute type unsupported'), good])
        with patch.object(runner, 'emit') as emit:
            self.run_transcription(factory)
        self.assertEqual([call.kwargs for call in factory.call_args_list], [dict(device='cuda', compute_type='int8_float32'), dict(device='cpu', compute_type='int8'), dict(device='cpu', compute_type='float32')])
        emit.assert_called_once_with(0, 1, 'hello')

    def test_lazy_gpu_failure_before_first_segment_can_fall_back(self):
        def broken():
            raise RuntimeError('cudnn DLL missing')
            yield
        bad = Mock(); bad.transcribe.return_value = (broken(), None)
        good = Mock(); good.transcribe.return_value = ([], None)
        factory = Mock(side_effect=[bad, good])
        self.run_transcription(factory)
        self.assertEqual(factory.call_count, 2)

    def test_partial_output_and_unrelated_model_errors_are_never_restarted(self):
        def partial():
            yield SimpleNamespace(start=0, end=1, text='partial')
            raise RuntimeError('CUDA out of memory')
        bad = Mock(); bad.transcribe.return_value = (partial(), None)
        factory = Mock(return_value=bad)
        with patch.object(runner, 'emit') as emit, self.assertRaisesRegex(RuntimeError, 'out of memory'):
            self.run_transcription(factory)
        self.assertEqual(factory.call_count, 1); emit.assert_called_once()
        factory = Mock(side_effect=ValueError('model file missing'))
        with self.assertRaisesRegex(ValueError, 'model file missing'): self.run_transcription(factory)
        self.assertEqual(factory.call_count, 1)

class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.directory = Path(self.temp.name)
        self.spec = dict(videoKey='youtube:azFsmVcFsSw', url=asr.video_url('youtube:azFsmVcFsSw'))
        self.tools = {'yt-dlp': 'private-ytdlp'}; self.commands = []
    def tearDown(self): self.temp.cleanup()

    def attempt(self, errors):
        replies = iter(errors)
        def stream(command, env, callback):
            self.commands.append(list(command)); error = next(replies)
            if error:
                (self.directory / 'audio.m4a').write_bytes(b'truncated')
                return 1, [error]
            self.assertFalse((self.directory / 'audio.m4a').exists())
            (self.directory / 'audio.m4a').write_bytes(b'whole')
            return 0, []
        return patch.object(asr, 'stream', side_effect=stream)

    def test_default_success_does_not_change_client(self):
        with self.attempt([None]), patch.object(asr, 'update_ytdlp') as update:
            self.assertEqual(asr.download(self.directory, self.spec, {}, self.tools).read_bytes(), b'whole')
        self.assertNotIn('--extractor-args', self.commands[0]); update.assert_not_called()

    def test_reload_retry_preserves_explicit_cookie_file_and_never_logs_its_contents(self):
        secret = 'COOKIE-SECRET'
        (self.directory / 'cookies.txt').write_text(secret)
        self.spec.update(cookies='edge', cookiesFile=True)
        with self.attempt(['ERROR: The page needs to be reloaded.', None]), patch.object(asr, 'update_ytdlp', return_value=False) as update, contextlib.redirect_stdout(io.StringIO()) as log:
            asr.download(self.directory, self.spec, {}, self.tools)
        update.assert_called_once(); self.assertEqual(len(self.commands), 2)
        self.assertIn('youtube:player_client=default,web_embedded', self.commands[1])
        for command in self.commands:
            self.assertIn('--cookies', command); self.assertNotIn('--cookies-from-browser', command)
        self.assertNotIn(secret, log.getvalue())

    def test_updated_tool_is_used_before_client_retry_and_retries_are_bounded(self):
        with self.attempt(['The page needs to be reloaded.'] * 3), patch.object(asr, 'update_ytdlp', return_value=True) as update, patch.object(asr, 'find_tool', return_value='updated-ytdlp'), self.assertRaises(asr.Failed) as error:
            asr.download(self.directory, self.spec, {}, self.tools)
        self.assertEqual(error.exception.code, 'tool-outdated'); self.assertEqual(len(self.commands), 3)
        self.assertNotIn('--extractor-args', self.commands[1]); self.assertEqual(self.commands[1][0], 'updated-ytdlp')
        self.assertIn('--extractor-args', self.commands[2]); update.assert_called_once()

    def test_transport_retries_do_not_exhaust_update_and_client_retry(self):
        with self.attempt(['connection reset', 'timed out', 'player response invalid', 'player response invalid', None]), patch.object(asr.time, 'sleep'), patch.object(asr, 'update_ytdlp', return_value=True), patch.object(asr, 'find_tool', return_value='new'):
            asr.download(self.directory, self.spec, {}, self.tools)
        self.assertEqual(len(self.commands), 5)

    def test_other_sites_login_walls_cookie_errors_and_generic_403_do_not_get_client_retry(self):
        cases = [('bilibili:BV1hM4m1U7rA:20', 'The page needs to be reloaded.', 'tool-outdated'),
                 (self.spec['videoKey'], 'Sign in to confirm you are not a bot', 'needs-cookies'),
                 (self.spec['videoKey'], 'Could not copy Chrome cookie database', 'cookies-unreadable'),
                 (self.spec['videoKey'], 'HTTP Error 403', 'tool-outdated')]
        for key, message, expected in cases:
            with self.subTest(message=message):
                self.commands = []; self.spec['videoKey'] = key; self.spec['url'] = asr.video_url(key)
                with self.attempt([message]), patch.object(asr, 'update_ytdlp', return_value=False), self.assertRaises(asr.Failed) as error:
                    asr.download(self.directory, self.spec, {}, self.tools)
                self.assertEqual(error.exception.code, expected); self.assertEqual(len(self.commands), 1)

class ResultTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.base = Path(self.temp.name)
        self.key = 'youtube:azFsmVcFsSw'; self.job = 'a' * 32
        self.directory = asr.job_dir(self.base, self.job); self.directory.mkdir(parents=True)
        self.result = asr.result_path(self.base, self.key); self.result.parent.mkdir(parents=True)
        self.cached = dict(version=asr.RESULT_VERSION, engine='cloud', videoKey=self.key, language=None, duration=100, segments=[dict(start=0, end=2, text='complete cloud result')])
        self.info = dict(ready=True, engine='faster-whisper')
    def tearDown(self): self.temp.cleanup()

    def test_cloud_cache_is_not_returned_as_local_and_language_changes_require_new_job(self):
        for cached, language, reused in [(self.cached, 'auto', False), ({**self.cached, 'engine':'faster-whisper'}, 'auto', True),
                                         ({**self.cached, 'engine':'faster-whisper', 'requestedLanguage':'zh'}, 'auto', False),
                                         ({**self.cached, 'engine':'faster-whisper', 'requestedLanguage':'zh'}, 'zh', True)]:
            with self.subTest(language=language, cached=cached):
                asr.atomic_json(self.result, cached)
                with patch.object(asr, 'status', return_value=self.info), patch.object(asr, 'active_job', return_value=(None,None)), patch.object(asr, 'spawn_worker', return_value=424242):
                    reply = asr.start(self.base, dict(videoKey=self.key, language=language, engine='faster-whisper'))
                self.assertEqual(bool(reply.get('cached')), reused)
                self.assertEqual(reply['state'], 'completed' if reused else 'queued')

    def test_worker_failure_after_streaming_never_creates_or_overwrites_completed_cache(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                if existing: asr.atomic_json(self.result, self.cached)
                asr.atomic_json(self.directory/'spec.json', dict(videoKey=self.key, engine='faster-whisper', language='auto', context=False))
                found = dict(id='faster-whisper', path='runner-python', model='installed', modelReady=True, runner=True)
                def stream(command, env, callback):
                    callback('[00:00.000 --> 00:02.000] partial')
                    return 1, ['CUDA out of memory']
                with patch.object(asr, 'status', return_value=self.info), patch.object(asr, 'unquarantine'), patch.object(asr, 'find_tool', return_value='tool'), patch.object(asr, 'engines', return_value=[found]), patch.object(asr, 'update_ytdlp'), patch.object(asr, 'download', return_value=self.directory/'audio.m4a'), patch.object(asr, 'convert', return_value=(self.directory/'audio.wav',100)), patch.object(asr, 'stream', side_effect=stream):
                    asr.run_worker(self.directory)
                state = asr.read_state(self.directory)
                self.assertEqual(state['state'], 'failed'); self.assertEqual(state['segmentCount'], 1)
                self.assertEqual(self.result.exists(), existing)
                if existing: self.assertEqual(asr.read_json(self.result), self.cached)
                (self.directory/'segments.jsonl').unlink(missing_ok=True)

if __name__ == '__main__': unittest.main()
