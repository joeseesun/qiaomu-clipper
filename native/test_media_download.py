import json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
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
                target.unlink();target.parent.rmdir();target.parent.symlink_to(directory,target_is_directory=True)
                with self.assertRaises(ValueError):media.export_file(directory,source,'Test')

    def test_ytdlp_video_has_full_stream_selector_merger_and_filter(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);commands=[]
            def stream(command, env, progress):
                commands.append(command);(directory/'audio.mkv').write_bytes(b'complete');progress('[download] 75.0%');return 0,[]
            with patch.object(asr,'stream',side_effect=stream):
                self.assertEqual(media.fetch_full(directory,{'video':True,'url':'https://www.bilibili.com/video/BV1xx411c7mD/'},{},{'yt-dlp':'ytdlp','ffmpeg':'ffmpeg'}).suffix,'.mkv')
            command=commands[0];self.assertEqual(command[command.index('-f')+1],'bv*+ba/b');self.assertIn('--ffmpeg-location',command);self.assertIn('--ignore-config',command);self.assertIn('youtube',command[command.index('--match-filter')+1]);self.assertIn('!has_drm',command[command.index('--match-filter')+1]);self.assertNotIn('--cookies-from-browser',command)

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
