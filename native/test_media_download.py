import json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from test_support import directory_link
sys.path.insert(0, str(Path(__file__).parent))
import asr, media_download as media

class DownloadTests(unittest.TestCase):
    def test_source_policy_blocks_youtube_and_private_or_non_https(self):
        for url in ('https://youtube.com/watch?v=x', 'https://r1.googlevideo.com/x', 'https://www.youtu.be/x', 'file:///tmp/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://name.local/x', 'https://u:p@bilibili.com/x'):
            self.assertFalse(media.allowed(url), url)
        for url in ('https://www.bilibili.com/video/BV1xx411c7mD/', 'https://www.douyin.com/video/1234567890', 'https://www.xiaoyuzhoufm.com/episode/65abcdef0123456789abcdef'):
            self.assertTrue(media.allowed(url), url)

    def test_start_does_not_query_recognition_models_or_cloud_settings(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(asr, 'find_tool', return_value='/tools/bin'), patch.object(asr, 'status', side_effect=AssertionError('must not query ASR')), patch.object(asr, 'spawn_worker', return_value=123), patch.object(asr, 'pid_alive', return_value=True):
            base=Path(temp); reply=media.start(base, {'url':'https://www.bilibili.com/video/BV1xx411c7mD/','name':'../title','video':True,'destination':'/etc','cloudKey':'secret'})
            self.assertEqual(reply['state'], 'queued'); spec=asr.read_json(asr.job_dir(base,reply['id'])/'spec.json')
            self.assertEqual(spec['purpose'],'download'); self.assertNotIn('destination',spec); self.assertNotIn('cloudKey',spec)
            self.assertEqual(media.handle(base,{'action':'mediaDownloadPoll','jobId':reply['id']})['id'],reply['id'])

    def test_forged_media_and_unknown_jobs_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            for url in ('https://youtu.be/abcdefghijk','https://localhost/file'):
                with self.assertRaises(ValueError): media.start(Path(temp),{'url':url,'name':'Test','video':True})
            with self.assertRaises(ValueError): media.start(Path(temp),{'url':'https://www.douyin.com/video/1234567890','name':'Test','video':True,'mediaUrl':'https://evil.org/video.mp4'})
            for action in ('mediaDownloadPoll','mediaDownloadCancel','mediaDownloadReveal'):
                self.assertFalse(media.handle(Path(temp),{'action':action,'jobId':'../foo'})['ok'])

    def test_export_is_atomic_sanitized_non_overwriting_and_handles_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp); directory=home/'job';directory.mkdir();source=directory/'audio.mkv';source.write_bytes(b'media')
            with patch.object(media.Path,'home',return_value=home):
                target=media.export_file(directory,source,'../../a:b');self.assertEqual(target.parent,(home/'Downloads'/'Qiaomu Clipper').resolve());self.assertEqual(target.read_bytes(),b'media');self.assertNotIn('/',target.name)
                with self.assertRaises(FileExistsError):media.export_file(directory,source,'../../a:b')
                self.assertFalse(list(target.parent.glob('*.part')))
                target.unlink();target.parent.rmdir();directory_link(target.parent,directory)
                with self.assertRaises(ValueError):media.export_file(directory,source,'Test')

    def test_youtube_is_accepted_only_as_an_explicit_watch_page(self):
        page = 'https://www.youtube.com/watch?v=jNQXAC9IJRw'
        for url in (page, 'https://youtu.be/jNQXAC9IJRw', 'https://m.youtube.com/shorts/abc'):
            self.assertFalse(media.allowed(url), url); self.assertTrue(media.allowed(url, True), url)
        for url in ('https://r1.googlevideo.com/videoplayback', 'https://www.youtube-nocookie.com/embed/x', 'https://youtube.googleapis.com/v/x'):
            self.assertFalse(media.allowed(url, True), url)
        for url in ('https://youtube.com.evil.org/x', 'https://notyoutube.com/x'):
            self.assertTrue(media.allowed(url), url)  # ordinary sites that only look like YouTube
        with tempfile.TemporaryDirectory() as temp, patch.object(asr, 'find_tool', return_value='/tools/bin'), patch.object(asr, 'spawn_worker', return_value=1):
            with self.assertRaises(ValueError): media.start(Path(temp), {'url': page, 'name': 'T', 'video': True})
            with self.assertRaises(ValueError): media.start(Path(temp), {'url': page, 'name': 'T', 'video': True, 'allowYoutube': 'true'})
            with self.assertRaises(ValueError): media.start(Path(temp), {'url': page, 'name': 'T', 'video': True, 'allowYoutube': True, 'mediaUrl': 'https://r1.googlevideo.com/videoplayback'})
            reply = media.start(Path(temp), {'url': page, 'name': 'T', 'video': True, 'allowYoutube': True})
            self.assertEqual(reply['state'], 'queued'); self.assertTrue(asr.read_json(asr.job_dir(Path(temp), reply['id']) / 'spec.json')['allowYoutube'])

    def test_youtube_filter_is_dropped_only_for_an_allowed_page_and_keeps_drm_and_live_guards(self):
        for spec, expect_youtube in (({'video': True, 'url': 'https://www.youtube.com/watch?v=x', 'allowYoutube': True}, False), ({'video': True, 'url': 'https://www.bilibili.com/video/BV1xx411c7mD/'}, True)):
            with tempfile.TemporaryDirectory() as temp:
                directory = Path(temp); commands = []
                def stream(command, env, progress):
                    commands.append(command); (directory / 'audio.mkv').write_bytes(b'complete'); return 0, []
                with patch.object(asr, 'stream', side_effect=stream): media.fetch_full(directory, spec, {}, {'yt-dlp': 'ytdlp', 'ffmpeg': 'ffmpeg'})
                rule = commands[0][commands[0].index('--match-filter') + 1]
                self.assertEqual('youtube' in rule, expect_youtube); self.assertIn('!has_drm', rule); self.assertIn('!is_live', rule)
        with tempfile.TemporaryDirectory() as temp, patch.object(asr, 'find_tool', return_value='/tools/bin'):
            directory = Path(temp); asr.atomic_json(directory / 'spec.json', {})
            media.run_worker(directory, {'url': 'https://www.youtube.com/watch?v=x', 'name': 'T', 'video': True})
            self.assertEqual(asr.read_state(directory)['state'], 'failed')

    def test_ytdlp_video_has_full_stream_selector_merger_and_filter(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);commands=[]
            def stream(command, env, progress):
                commands.append(command);(directory/'audio.mkv').write_bytes(b'complete');progress('[download] 75.0%');return 0,[]
            with patch.object(asr,'stream',side_effect=stream):
                self.assertEqual(media.fetch_full(directory,{'video':True,'url':'https://www.bilibili.com/video/BV1xx411c7mD/'},{},{'yt-dlp':'ytdlp','ffmpeg':'ffmpeg'}).suffix,'.mkv')
            command=commands[0];self.assertEqual(command[command.index('-f')+1],media.PLAYABLE_VIDEO);self.assertEqual(command[command.index('--merge-output-format')+1],'mp4/mkv');self.assertIn('--ffmpeg-location',command);self.assertIn('--ignore-config',command);self.assertIn('youtube',command[command.index('--match-filter')+1]);self.assertIn('!has_drm',command[command.index('--match-filter')+1]);self.assertNotIn('--cookies-from-browser',command)

    def test_youtube_is_tried_without_the_lent_login_first_and_with_it_only_when_needed(self):
        spec = {'url': 'https://www.youtube.com/watch?v=x', 'video': True, 'allowYoutube': True, 'cookiesFile': True}
        for first_ok, calls_expected in ((True, [False]), (False, [False, True])):
            with tempfile.TemporaryDirectory() as temp:
                directory = Path(temp); calls = []
                def stream(command, env, progress):
                    calls.append('--cookies' in command)
                    if first_ok or len(calls) == 2: (directory / 'audio.mp4').write_bytes(b'complete'); return 0, []
                    return 1, ['ERROR: [youtube] x: Requested format is not available']
                with patch.object(asr, 'stream', side_effect=stream): self.assertEqual(media.fetch_full(directory, spec, {}, {'yt-dlp': 'y', 'ffmpeg': 'f'}).suffix, '.mp4')
                self.assertEqual(calls, calls_expected)
        with tempfile.TemporaryDirectory() as temp:  # other sites keep sending the login on the first and only try
            directory = Path(temp); calls = []
            def stream(command, env, progress): calls.append('--cookies' in command); (directory / 'audio.mp4').write_bytes(b'x'); return 0, []
            with patch.object(asr, 'stream', side_effect=stream): media.fetch_full(directory, {'url': 'https://www.bilibili.com/video/BV1xx411c7mD/', 'video': True, 'cookiesFile': True}, {}, {'yt-dlp': 'y', 'ffmpeg': 'f'})
            self.assertEqual(calls, [True])

    def test_selector_prefers_h264_aac_so_the_file_opens_in_any_player(self):
        first = media.PLAYABLE_VIDEO.split('/')[0]
        self.assertIn('avc1', first); self.assertIn('mp4a', first)
        self.assertTrue(media.PLAYABLE_VIDEO.endswith('bv*+ba/b'))

    def test_split_streams_merge_into_mp4_first_and_fall_back_to_mkv(self):
        for fail_mp4, expected in ((False, '.mp4'), (True, '.mkv')):
            with tempfile.TemporaryDirectory() as temp:
                directory = Path(temp); (directory / 'v.mp4').write_bytes(b'picture'); (directory / 'a.m4a').write_bytes(b'sound'); targets = []
                def stream(command, env, progress):
                    target = Path(command[-1]); targets.append(target.suffix)
                    if fail_mp4 and target.suffix == '.mp4': return 1, ['cannot mux']
                    target.write_bytes(b'merged'); return 0, []
                spec = {'url': 'https://www.douyin.com/video/1234567890', 'video': True, 'mediaUrl': 'https://v.douyinvod.com/a/media-video-avc1', 'audioUrl': 'https://v.douyinvod.com/a/media-audio-und'}
                with patch.object(asr, 'download_page_media', side_effect=[directory / 'v.mp4', directory / 'a.m4a']), patch.object(asr, 'stream', side_effect=stream):
                    self.assertEqual(media.fetch_full(directory, spec, {}, {'yt-dlp': 'y', 'ffmpeg': 'f'}).suffix, expected)
                self.assertEqual(targets[0], '.mp4')

    def test_failures_say_why_and_keep_the_tool_output_in_the_private_job_folder(self):
        cases = (
            (['ERROR: [youtube] abc123XYZ99: Requested format is not available. Use --list-formats'], 1, '这条视频暂时没有可下载的格式（YouTube 对它做了额外限制，字幕和学习不受影响）'),
            (['ERROR: [youtube] abc123XYZ99: Video unavailable'], 1, '这条视频不可用，或是私享视频'),
            (['[download] x does not pass filter (!is_live & !has_drm), skipping ..'], 0, '直播和受版权保护（DRM）的视频不能下载'),
            (['ERROR: [youtube] abc123XYZ99: Something odd happened'], 1, 'Something odd happened'),
            ([], 0, '没有得到可保存的文件'),
        )
        for tail, code, reason in cases:
            with tempfile.TemporaryDirectory() as temp:
                directory = Path(temp); asr.write_state(directory, state='downloading')
                with patch.object(asr, 'stream', return_value=(code, tail)):
                    with self.assertRaises(asr.Failed) as caught: media.fetch_full(directory, {'video': True, 'url': 'https://www.bilibili.com/video/BV1xx411c7mD/'}, {}, {'yt-dlp': 'y', 'ffmpeg': 'f'})
                self.assertEqual(str(caught.exception), '下载中断：' + reason)
                if tail: self.assertIn(tail[0].strip()[:40], asr.read_state(directory)['detail'])

    def test_failed_merge_does_not_publish_partial_streams(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);(directory/'audio.f1.mp4').write_bytes(b'picture');(directory/'audio.f2.m4a').write_bytes(b'sound')
            with patch.object(asr,'stream',return_value=(1,['merge failed'])):
                with self.assertRaises(asr.Failed):media.fetch_full(directory,{'video':True,'url':'https://www.bilibili.com/video/BV1xx411c7mD/'},{},{'yt-dlp':'ytdlp','ffmpeg':'ffmpeg'})

    def test_worker_publishes_file_then_cleans_private_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);directory=home/'job';directory.mkdir();(directory/'cookies.txt').write_text('private');source=directory/'audio.mp4';source.write_bytes(b'video-with-sound')
            spec={'id':'a'*32,'purpose':'download','url':'https://www.bilibili.com/video/BV1xx411c7mD/','mediaUrl':'https://cdn/secret','name':'Test','video':True}
            with patch.object(media.Path,'home',return_value=home),patch.object(asr,'find_tool',return_value='tool'),patch.object(media,'fetch_full',return_value=source): media.run_worker(directory,spec)
            state=asr.read_state(directory);self.assertEqual(state['state'],'completed');self.assertEqual(Path(state['path']).read_bytes(),b'video-with-sound');self.assertFalse(source.exists());self.assertFalse((directory/'cookies.txt').exists());self.assertNotIn('mediaUrl',asr.read_json(directory/'spec.json'))

if __name__=='__main__':unittest.main()
