import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr

PAGE = 'https://appgkag2ca42109.h5.xiaoeknow.com/v4/course/alive/l_6ac7568ae4b023c0862f252b?app_id=appgkag2ca42109'
MEDIA = 'https://encrypt-k-vod.xet.tech/522ff1e0vodcq1252524126/c9908e5d5001834823418950542/playlist_eof.m3u8?sign=abc&t=6ac970df&us=x'

class XiaoeMediaTest(unittest.TestCase):
    def test_accepts_shop_playlists(self):
        self.assertTrue(asr.xiaoe_media(PAGE, MEDIA))
        self.assertTrue(asr.xiaoe_media(PAGE, 'https://c-vod.hw-cdn.xiaoeknow.com/a/b/playlist_eof.m3u8?sign=1'))
    def test_refuses_other_pages_and_hosts(self):
        self.assertFalse(asr.xiaoe_media('https://www.douyin.com/video/1', MEDIA))
        self.assertFalse(asr.xiaoe_media(PAGE.replace('app_id=appgkag2ca42109', 'app_id=appother123'), MEDIA))
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

if __name__ == '__main__': unittest.main()
