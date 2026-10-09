import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr

PAGE = 'https://appfixture123.h5.xiaoeknow.com/v4/course/alive/l_fixture123456?app_id=appfixture123'
MEDIA = 'https://encrypt-k-vod.xet.tech/fixture/playlist_eof.m3u8?sign=fixture&t=123&us=x'

class XiaoeMediaTest(unittest.TestCase):
    def test_accepts_shop_playlists(self):
        self.assertTrue(asr.xiaoe_media(PAGE, MEDIA))
        self.assertTrue(asr.xiaoe_media(PAGE, 'https://c-vod.hw-cdn.xiaoeknow.com/a/b/playlist_eof.m3u8?sign=1'))
    def test_refuses_other_pages_and_hosts(self):
        self.assertFalse(asr.xiaoe_media('https://www.douyin.com/video/1', MEDIA))
        self.assertFalse(asr.xiaoe_media(PAGE.replace('app_id=appfixture123', 'app_id=appother123'), MEDIA))
        self.assertFalse(asr.xiaoe_media(PAGE, 'https://evil.example.com/playlist.m3u8'))
        self.assertFalse(asr.xiaoe_media(PAGE, 'https://xiaoeknow.com.evil.cn/playlist.m3u8'))
        self.assertFalse(asr.xiaoe_media(PAGE, 'http://c-vod.hw-cdn.xiaoeknow.com/a/playlist.m3u8'))
        self.assertFalse(asr.xiaoe_media(PAGE, 'https://c-vod.hw-cdn.xiaoeknow.com/a/video.mp4'))
        self.assertFalse(asr.xiaoe_media(PAGE, 'https://127.0.0.1/a.m3u8'))
    def test_start_accepts_xiaoe_media(self):
        import tempfile
        with tempfile.TemporaryDirectory() as base:
            key = 'web:' + asr.sha(PAGE, 12)
            orig = asr.status
            asr.status = lambda **kw: {'ready': False, 'missing': ['x'], 'hints': [], 'installable': {}}
            try:
                reply = asr.start(Path(base), {'videoKey': key, 'web': {'url': PAGE, 'mediaUrl': MEDIA}})
                self.assertEqual(reply.get('error'), 'missing')  # validated, then stopped only by the missing tools
                with self.assertRaises(ValueError): asr.start(Path(base), {'videoKey': key, 'web': {'url': PAGE, 'mediaUrl': 'https://evil.example.com/a.m3u8'}})
            finally: asr.status = orig

class XiaoeDownloadTest(unittest.TestCase):
    def test_hls_download_uses_only_the_playlist_and_progress_without_cookies(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            def stream(command, env, progress):
                progress('[download] 50.0%');(directory/'audio.mp4').write_bytes(b'fixture transport stream');return 0,[]
            with patch.object(asr,'stream',side_effect=stream) as execute:
                result=asr.download(directory,{'videoKey':'web:'+asr.sha(PAGE,12),'url':PAGE,'mediaUrl':MEDIA,'cookies':'chrome'},{},{'yt-dlp':'fixture-ytdlp'})
            self.assertEqual(result.read_bytes(),b'fixture transport stream')
            command=execute.call_args.args[0];self.assertIn('--concurrent-fragments',command);self.assertIn('--abort-on-unavailable-fragments',command);self.assertNotIn('--cookies',command);self.assertNotIn('--cookies-from-browser',command)
            self.assertEqual(asr.read_json(directory/'state.json')['progress'],7.5)
    def test_failed_hls_download_does_not_expose_the_signed_address(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp, patch.object(asr.time,'sleep',return_value=None) as clock, patch.object(asr,'stream',return_value=(1,['ERROR: signed-url='+MEDIA])):
            with self.assertRaises(asr.Failed) as failure:asr.download(Path(tmp),{'videoKey':'web:'+asr.sha(PAGE,12),'url':PAGE,'mediaUrl':MEDIA},{},{'yt-dlp':'fixture-ytdlp'})
        self.assertNotIn('sign=',str(failure.exception));self.assertNotIn(MEDIA,str(failure.exception))

    def test_partial_hls_never_returns_an_audio_file(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            def stream(command,env,progress):
                (directory/'audio.mp4').write_bytes(b'incomplete fixture')
                return 1,['ERROR: fragment unavailable']
            with patch.object(asr,'stream',side_effect=stream) as execute,patch.object(asr.time,'sleep',return_value=None):
                with self.assertRaises(asr.Failed):asr.download(directory,{'videoKey':'web:'+asr.sha(PAGE,12),'url':PAGE,'mediaUrl':MEDIA},{},{'yt-dlp':'fixture-ytdlp'})
            self.assertEqual(execute.call_count,3)

if __name__ == '__main__': unittest.main()
