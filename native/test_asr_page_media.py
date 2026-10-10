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
        for bad in ('http://v11.douyinvod.com/a','https://douyinvod.com.evil.org/a','https://user:pw@v11.douyinvod.com/a','https://v11.douyinvod.com:8080/a','blob:https://www.douyin.com/x', MEDIA+'&__vid=456'):
            self.assertFalse(asr.douyin_media(PAGE,bad))
        self.assertFalse(asr.douyin_media('https://vimeo.com/123',MEDIA))
    def test_direct_download_never_runs_cookie_extractor_and_detects_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec={'videoKey':'web:'+asr.sha(PAGE,12),'url':PAGE,'mediaUrl':MEDIA,'cookies':'chrome'}
            with patch.object(asr,'open_public',return_value=Response(b'VIDEO',5)) as fetch, patch.object(asr,'stream') as extract:
                path=asr.download(Path(tmp),spec,{},{}); self.assertEqual(path.read_bytes(),b'VIDEO'); extract.assert_not_called()
                args=fetch.call_args.kwargs; self.assertEqual(args['headers']['Referer'],PAGE); self.assertIn('Chrome/',args['headers']['User-Agent'])
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

class ChannelsMediaTests(unittest.TestCase):
    PAGE = 'https://weixin.qq.com/sph/Fixture123'
    MEDIA = 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture&token=fixture'
    def test_source_and_cdn_are_strict(self):
        self.assertTrue(asr.channels_media(self.PAGE, self.MEDIA))
        self.assertTrue(asr.channels_media('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Fixture123', self.MEDIA))
        for page in ('https://mp.weixin.qq.com/s/x', self.PAGE+'?id=other', 'https://weixin.qq.com.evil.org/sph/Fixture123', 'https://user:pw@weixin.qq.com/sph/Fixture123', 'https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture'):
            self.assertFalse(asr.channels_media(page,self.MEDIA))
        for media in ('http://finder.video.qq.com/251/20302/stodownload', 'https://finder.video.qq.com.evil.org/251/20302/stodownload', 'https://finder.video.qq.com:8443/251/20302/stodownload', 'https://user:pw@finder.video.qq.com/251/20302/stodownload', 'https://finder.video.qq.com/other', 'https://127.0.0.1/251/20302/stodownload'):
            self.assertFalse(asr.channels_media(self.PAGE,media))
    def test_download_and_job_use_the_direct_source_without_lending_cookies(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(asr,'open_public',return_value=Response(b'VIDEO',5)) as fetch, patch.object(asr,'stream') as extractor:
                p=asr.download(Path(tmp),{'videoKey':'web:'+asr.sha(self.PAGE,12),'url':self.PAGE,'mediaUrl':self.MEDIA},{},{})
                self.assertEqual(p.read_bytes(),b'VIDEO');extractor.assert_not_called()
                self.assertNotIn('Cookie',fetch.call_args.kwargs['headers'])
                self.assertFalse(fetch.call_args.kwargs['allowed']('https://example.com/x'))
            with patch.object(asr,'status',return_value={'ready':True,'missing':[],'hints':[],'engine':'mlx'}),patch.object(asr,'spawn_worker',return_value=424242):
                r=asr.handle({'action':'asrStart','videoKey':'web:'+asr.sha(self.PAGE,12),'web':{'url':self.PAGE,'mediaUrl':self.MEDIA}},Path(tmp))
                self.assertTrue(r['ok']);self.assertEqual(asr.read_json(asr.job_dir(Path(tmp),r['id'])/'spec.json')['mediaUrl'],self.MEDIA)

    def test_failed_worker_scrubs_signed_media_without_creating_a_success_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);directory=base/'asr'/'jobs'/'fixture';directory.mkdir(parents=True)
            spec={'videoKey':'web:'+asr.sha(self.PAGE,12),'url':self.PAGE,'mediaUrl':self.MEDIA}
            asr.atomic_json(directory/'spec.json',spec)
            with patch.object(asr,'unquarantine'),patch.object(asr,'status',return_value={'ready':False,'missing':['fixture']}):asr.run_worker(str(directory))
            self.assertNotIn('mediaUrl',asr.read_json(directory/'spec.json'));self.assertEqual(asr.read_state(directory)['state'],'failed')
            self.assertFalse(asr.result_path(base,spec['videoKey']).exists())
