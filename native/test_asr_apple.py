"""Apple catalog recovery through the actual probe/download entry points."""
import json, sys, tempfile, unittest
from pathlib import Path
from subprocess import CompletedProcess, TimeoutExpired
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr

CN = 'https://podcasts.apple.com/cn/podcast/example/id123?i=1000797277485&l=zh-Hans'
US = CN.replace('/cn/', '/us/')
ERROR = 'ERROR: [apple:podcasts] 1000797277485: Unable to download JSON metadata: HTTP Error 404: Not Found'
INFO = {'id': '1000797277485', 'title': 'Episode', 'url': 'https://cdn.example.com/episode.mp3', 'ext': 'mp3', 'protocol': 'https', 'duration': 60}

class AppleRecoveryTests(unittest.TestCase):
    def probe(self, url, errors):
        commands = []
        def run(command, **kwargs):
            commands.append(list(command)); error = errors[len(commands)-1]
            return CompletedProcess(command, bool(error), '' if error else json.dumps(INFO), error or '')
        with patch.object(asr, 'find_tool', return_value='yt-dlp'), patch.object(asr.subprocess, 'run', side_effect=run):
            result = asr.probe({'url': url})
        return result, commands

    def test_probe_recovers_same_episode_and_query_once(self):
        result, calls = self.probe(CN, [ERROR, None])
        self.assertTrue(result['ok']); self.assertEqual([c[-1] for c in calls], [CN, US])
        self.assertEqual(result['mediaUrl'], INFO['url'])
        self.assertTrue(all('--no-color' in c for c in calls))

    def test_missing_regional_webpage_also_recovers(self):
        result, calls = self.probe(CN, [ERROR.replace('JSON metadata', 'webpage'), None])
        self.assertTrue(result['ok']); self.assertEqual([c[-1] for c in calls], [CN, US])

    def test_both_catalogs_missing_stop_and_strip_terminal_codes(self):
        result, calls = self.probe(CN, [ERROR, '\x1b[31m' + ERROR + '\x1b[0m'])
        self.assertFalse(result['ok']); self.assertEqual(len(calls), 2)
        self.assertNotIn('\x1b', result['message'])

    def test_no_fallback_for_other_failures_hosts_or_episodes(self):
        for url, error in [(US, ERROR), (CN.replace('/cn/', '/'), ERROR),
                           (CN.replace('podcasts.apple.com', 'podcasts.apple.com.evil.example'), ERROR),
                           (CN.replace('i=1000797277485', 'i=42'), ERROR),
                           (CN + '&i=42', ERROR),
                           (CN, ERROR.replace('404', '403')), (CN, ERROR.replace('404', '500')),
                           (CN, 'ERROR: unable to download audio: HTTP Error 404: Not Found'),
                           (CN, 'ERROR: login required')]:
            with self.subTest(url=url, error=error):
                result, calls = self.probe(url, [error]); self.assertFalse(result['ok']); self.assertEqual(len(calls), 1)

    def test_working_original_does_not_change_region(self):
        result, calls = self.probe(CN, [None]); self.assertTrue(result['ok']); self.assertEqual(len(calls), 1)

    def test_retry_timeout_cleans_cookie_file(self):
        calls = []; cookie_paths = []
        def run(command, **kwargs):
            calls.append(list(command)); cookie_paths.append(Path(command[command.index('--cookies') + 1]))
            self.assertTrue(cookie_paths[-1].is_file())
            if len(calls) == 2: raise TimeoutExpired(command, kwargs['timeout'])
            return CompletedProcess(command, 1, '', ERROR)
        with patch.object(asr, 'find_tool', return_value='yt-dlp'), patch.object(asr.subprocess, 'run', side_effect=run):
            result = asr.probe({'url': CN, 'cookies': 'chrome', 'cookiesTxt': '# Netscape HTTP Cookie File\n'})
        self.assertEqual(result['error'], 'timeout'); self.assertEqual(len(calls), 2)
        self.assertTrue(all(not p.exists() for p in cookie_paths))

    def test_probe_retry_shares_original_deadline(self):
        failure = CompletedProcess([], 1, '', ERROR)
        success = CompletedProcess([], 0, json.dumps(INFO), '')
        with patch.object(asr, 'find_tool', return_value='yt-dlp'), patch.object(asr.subprocess, 'run', side_effect=[failure, success]) as run, patch.object(asr.time, 'monotonic', side_effect=[100, 125]):
            self.assertTrue(asr.probe({'url': CN})['ok'])
        self.assertEqual([c.kwargs['timeout'] for c in run.call_args_list], [60, 35])

    def test_audio_server_404_does_not_switch_catalog(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(asr, 'stream', return_value=(1, ['ERROR: unable to download audio: HTTP Error 404: Not Found'])) as run:
            with self.assertRaises(asr.Failed):
                asr.download(Path(tmp), {'videoKey': 'web:0123456789ab', 'url': CN}, {}, {'yt-dlp': 'yt-dlp'})
            self.assertEqual(run.call_count, 1)

    def test_download_recovers_without_mutating_source_or_resuming_partial_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); calls = []; spec = {'videoKey': 'web:0123456789ab', 'url': CN}
            def stream(command, env, callback):
                calls.append(list(command))
                if len(calls) == 1:
                    (directory / 'audio.mp3').write_bytes(b'partial'); return 1, [ERROR]
                self.assertFalse((directory / 'audio.mp3').exists())
                (directory / 'audio.mp3').write_bytes(b'complete'); return 0, []
            with patch.object(asr, 'stream', side_effect=stream), patch.object(asr, 'update_ytdlp') as update:
                audio = asr.download(directory, spec, {}, {'yt-dlp': 'yt-dlp'})
            self.assertEqual(audio.read_bytes(), b'complete'); self.assertEqual(spec['url'], CN)
            self.assertEqual([c[-1] for c in calls], [CN, US]); update.assert_not_called()

    def test_download_both_missing_stops_after_one_fallback(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(asr, 'stream', return_value=(1, [ERROR])) as run:
            with self.assertRaises(asr.Failed):
                asr.download(Path(tmp), {'videoKey': 'web:0123456789ab', 'url': CN}, {}, {'yt-dlp': 'yt-dlp'})
            self.assertEqual(run.call_count, 2)

if __name__ == '__main__': unittest.main()
