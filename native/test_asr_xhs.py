import io, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr

PAGE = 'https://www.xiaohongshu.com/explore/6abc2b40000000000a023366?xsec_token=fixture'
MEDIA = 'https://sns-video-v3.xhscdn.com/stream/1/110/101/fixture.m4a?sign=fixture'

class XhsMediaTests(unittest.TestCase):
    def test_only_detail_pages_and_video_cdn_files_are_accepted(self):
        self.assertTrue(asr.page_media(PAGE, MEDIA))
        self.assertTrue(asr.xhs_media(PAGE, MEDIA.replace('.m4a', '.mp4')))
        for page in (PAGE.replace('https:', 'http:'), PAGE.replace('xiaohongshu.com', 'xiaohongshu.com.evil.org'), PAGE.replace('/explore/', '/user/profile/'), PAGE.replace('www.', 'user:pw@www.')):
            self.assertFalse(asr.xhs_media(page, MEDIA), page)
        for media in (MEDIA.replace('https:', 'http:'), MEDIA.replace('xhscdn.com', 'xhscdn.com.evil.org'), MEDIA.replace('sns-video-v3', 'sns-avatar'), MEDIA.replace('.com/', '.com:8443/'), MEDIA.replace('.m4a', '.m3u8'), 'https://127.0.0.1/a.mp4', 'blob:'+PAGE):
            self.assertFalse(asr.xhs_media(PAGE, media), media)

    def test_direct_download_does_not_read_cookies_or_run_extractor(self):
        class Response(io.BytesIO):
            headers = {'Content-Length': '5'}
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        with tempfile.TemporaryDirectory() as tmp, patch.object(asr, 'open_public', return_value=Response(b'AUDIO')) as fetch, patch.object(asr, 'stream') as extract:
            spec = {'videoKey':'web:'+asr.sha(PAGE,12), 'url':PAGE, 'mediaUrl':MEDIA}
            result = asr.download(Path(tmp),spec,{}, {})
            self.assertEqual(result.read_bytes(), b'AUDIO')
            extract.assert_not_called()
            self.assertNotIn('Cookie', fetch.call_args.kwargs['headers'])
            self.assertFalse(fetch.call_args.kwargs['allowed']('https://example.com/a.mp4'))

    def test_job_validates_before_spawning_and_preserves_current_source(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(asr,'status',return_value={'ready':True,'missing':[],'hints':[],'engine':'mlx'}), patch.object(asr,'spawn_worker',return_value=424242) as spawn:
            req={'action':'asrStart','videoKey':'web:'+asr.sha(PAGE,12),'web':{'url':PAGE,'mediaUrl':'https://example.com/a.mp4'}}
            with self.assertRaises(ValueError): asr.handle(req,Path(tmp))
            spawn.assert_not_called()
            req['web']['mediaUrl']=MEDIA
            reply=asr.handle(req,Path(tmp)); self.assertTrue(reply['ok'])
            self.assertEqual(asr.read_json(asr.job_dir(Path(tmp),reply['id'])/'spec.json')['mediaUrl'],MEDIA)
