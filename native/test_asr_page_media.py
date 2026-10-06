import io, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr
PAGE='https://www.douyin.com/video/123'
MEDIA='https://v11-weba.douyinvod.com/video/a/?signature=x'
class Response(io.BytesIO):
    def __init__(self, data, size): super().__init__(data); self.headers={'Content-Length':str(size)}
    def __enter__(self): return self
    def __exit__(self,*args): self.close()
class PageMediaTests(unittest.TestCase):
    def test_only_current_douyin_cdn_is_accepted(self):
        self.assertTrue(asr.douyin_media(PAGE,MEDIA))
        for bad in ('http://v11.douyinvod.com/a','https://douyinvod.com.evil.org/a','https://user:pw@v11.douyinvod.com/a','https://v11.douyinvod.com:8080/a','blob:https://www.douyin.com/x'):
            self.assertFalse(asr.douyin_media(PAGE,bad))
        self.assertFalse(asr.douyin_media('https://vimeo.com/123',MEDIA))
    def test_direct_download_never_runs_cookie_extractor_and_detects_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec={'videoKey':'web:'+asr.sha(PAGE,12),'url':PAGE,'mediaUrl':MEDIA,'cookies':'chrome'}
            with patch.object(asr,'open_public',return_value=Response(b'VIDEO',5)) as fetch, patch.object(asr,'stream') as extract:
                path=asr.download(Path(tmp),spec,{},{}); self.assertEqual(path.read_bytes(),b'VIDEO'); extract.assert_not_called()
                args=fetch.call_args.kwargs; self.assertEqual(args['headers'],{'Referer':PAGE})
                self.assertFalse(args['allowed']('https://example.com/redirect'))
            with patch.object(asr,'open_public',return_value=Response(b'VIDEO',50)):
                with self.assertRaises(asr.Failed): asr.download(Path(tmp),spec,{}, {})
    def test_job_preserves_valid_media_but_rejects_foreign_url_before_spawn(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(asr,'status',return_value={'ready':True,'missing':[],'hints':[],'engine':'mlx'}), patch.object(asr,'spawn_worker',return_value=424242) as spawn:
            request={'action':'asrStart','videoKey':'web:'+asr.sha(PAGE,12),'web':{'url':PAGE,'mediaUrl':'https://example.com/a'}}
            with self.assertRaises(ValueError): asr.handle(request,Path(tmp))
            spawn.assert_not_called();request['web']['mediaUrl']=MEDIA
            reply=asr.handle(request,Path(tmp));self.assertTrue(reply['ok'],reply)
            self.assertEqual(asr.read_json(asr.job_dir(Path(tmp),reply['id'])/'spec.json')['mediaUrl'],MEDIA)
