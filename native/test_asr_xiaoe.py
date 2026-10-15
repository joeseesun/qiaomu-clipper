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

class XiaoeAliasTest(unittest.TestCase):
    def test_aliases_and_legacy_mixed_case_ids_keep_the_same_shop(self):
        app='appFixtureAbC123';live='l_5ed8c094db164_GjDIuS0G'
        for suffix in ['h5.xiaoeknow.com','h5.xiaoe-tech.com','xet.citv.cn','h5.xet.citv.cn','xet.pomoho.com','h5.xet.pomoho.com']:
            page=f'https://{app.lower()}.{suffix}/v4/course/alive/{live}?app_id={app}'
            self.assertTrue(asr.xiaoe_media(page,MEDIA),suffix)
            self.assertFalse(asr.xiaoe_media(page.replace('?app_id='+app,'?app_id=appother12345'),MEDIA))
    def test_alias_lookalikes_and_unbound_pages_are_rejected(self):
        for suffix in ['h5.xet.citv.cn.evil.example','evil.pomoho.com','citv.cn','h5.xiaoeknow.com:8080']:
            self.assertFalse(asr.xiaoe_media(f'https://appfixture123.{suffix}/v4/course/alive/l_fixture123456?app_id=appfixture123',MEDIA))

if __name__ == '__main__': unittest.main()

class XiaoePlaylistBoundaryTest(unittest.TestCase):
    def test_nested_segment_key_and_map_are_all_guarded(self):
        from urllib.parse import urljoin
        seen=[]
        def register(url):
            self.assertTrue(asr.xiaoe_resource(PAGE,url));seen.append(url);return 'http://127.0.0.1/fixture/'+str(len(seen))
        body='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\nchild.m3u8\nhttps://video.xet.tech/segment.ts\n'
        rewritten=asr.rewrite_xiaoe_playlist(body,MEDIA,register)
        self.assertEqual(len(seen),4);self.assertNotIn('https:',rewritten);self.assertIn('URI="http://127.0.0.1/fixture/1"',rewritten)
    def test_refuses_insecure_private_external_and_malformed_resources(self):
        def register(url):
            if not asr.xiaoe_resource(PAGE,url):raise OSError('blocked')
            return url
        for url in ['http://video.xet.tech/segment.ts','https://127.0.0.1/key','https://evil.example/key','https://xet.tech.evil.example/key','https://user:secret@video.xet.tech/key','https://video.xet.tech:8080/key']:
            for body in ['#EXTM3U\n'+url, '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="'+url+'"']:
                with self.subTest(url=url),self.assertRaises(OSError):asr.rewrite_xiaoe_playlist(body,MEDIA,register)
        with self.assertRaises(OSError):asr.rewrite_xiaoe_playlist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=https://evil.example/key',MEDIA,register)
    def test_redirect_guard_rejects_other_domains_and_private_addresses(self):
        import urllib.request
        from unittest.mock import patch
        def build(handler):
            for address in ['https://evil.example/playlist.m3u8','http://video.xet.tech/segment.ts','https://127.0.0.1/segment.ts']:
                with self.assertRaises(OSError):handler().redirect_request(None,None,302,'Found',{},address)
            class Opener:
                def open(self,*args,**kw):return 'guarded'
            return Opener()
        with patch.object(urllib.request,'build_opener',side_effect=build):self.assertEqual(asr.open_public(MEDIA,allowed=lambda u:asr.xiaoe_resource(PAGE,u)),'guarded')

class XiaoeRelayTest(unittest.TestCase):
    def test_relay_localizes_nested_manifest_keys_and_segments_and_rejects_private_uris(self):
        import io, urllib.request
        from unittest.mock import patch
        class Response(io.BytesIO):
            def __init__(self,url,data):super().__init__(data);self.url=url;self.headers={'Content-Type':'application/octet-stream'};self.status=200
            def geturl(self):return self.url
        seen=[]
        def fetch(url,**options):
            self.assertTrue(options['allowed'](url));self.assertFalse(options['allowed']('https://evil.example/segment.ts'));seen.append(url)
            body=b'#EXTM3U\nchild.m3u8\n' if url==MEDIA else b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1\nsegment.ts\n#EXT-X-ENDLIST\n' if url.endswith('child.m3u8') else b'fixture'
            return Response(url,body)
        with patch.object(asr,'open_public',side_effect=fetch),asr.xiaoe_hls_relay(PAGE,MEDIA) as relay:
            master=urllib.request.urlopen(relay).read().decode();child=master.splitlines()[1];nested=urllib.request.urlopen(child).read().decode()
            key=__import__('re').search(r'URI="([^"]+)"',nested).group(1);segment=next(line for line in nested.splitlines() if line.startswith('http'))
            self.assertEqual(urllib.request.urlopen(key).read(),b'fixture');self.assertEqual(urllib.request.urlopen(segment).read(),b'fixture');self.assertNotIn('https:',master+nested)
        self.assertEqual(len(seen),4)
        with patch.object(asr,'open_public',return_value=Response(MEDIA,b'#EXTM3U\nhttps://127.0.0.1/private.ts\n')),asr.xiaoe_hls_relay(PAGE,MEDIA) as relay:
            with self.assertRaises(urllib.error.HTTPError) as failed:urllib.request.urlopen(relay)
            self.assertEqual(failed.exception.code,502)


class XiaoeExtensionlessRelayTest(unittest.TestCase):
    def response(self, url, body, mime='application/octet-stream'):
        import io
        class Response(io.BytesIO):
            def geturl(inner): return url
        result = Response(body)
        result.headers = {'Content-Type': mime, 'Content-Length': str(len(body))}
        result.status = 200
        return result

    def test_extensionless_master_variant_key_and_segment_are_localized(self):
        import urllib.request, re
        from unittest.mock import patch
        child = 'https://video.xet.tech/variant?id=1'
        seen = []
        bodies = {MEDIA: b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nhttps://video.xet.tech/variant?id=1\n',
                  child: b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/key?id=2"\n#EXTINF:1,\n/segment?id=3\n#EXT-X-ENDLIST\n'}
        def fetch(url, **options):
            self.assertTrue(options['allowed'](url)); seen.append(url)
            return self.response(url, bodies.get(url, b'fixture'))
        with patch.object(asr, 'open_public', side_effect=fetch), asr.xiaoe_hls_relay(PAGE, MEDIA) as relay:
            master = urllib.request.urlopen(relay).read().decode()
            variant = next(line for line in master.splitlines() if line.startswith('http'))
            self.assertTrue(variant.endswith('.m3u8'))
            nested = urllib.request.urlopen(variant).read().decode()
            self.assertNotIn('https:', nested)
            key = re.search(r'URI="([^"]+)"', nested).group(1)
            segment = next(line for line in nested.splitlines() if line.startswith('http'))
            self.assertEqual(urllib.request.urlopen(key).read(), b'fixture')
            self.assertEqual(urllib.request.urlopen(segment).read(), b'fixture')
        self.assertEqual(len(seen), 4)

    def test_extensionless_and_mislabelled_playlists_reject_external_key_or_segment(self):
        import urllib.request, urllib.error
        from unittest.mock import patch
        for role in ['', '#EXT-X-STREAM-INF:BANDWIDTH=100000\n', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="variant?id=1"\n# ignored\n']:
            for address in ['https://evil.example/segment.ts', 'https://127.0.0.1/segment.ts', 'http://video.xet.tech/key']:
                for payload in [address, '#EXT-X-KEY:METHOD=AES-128,URI="' + address + '"']:
                    def fetch(url, **options):
                        if url == MEDIA:
                            body = ('#EXTM3U\n' + role + ('' if role.startswith('#EXT-X-MEDIA') else 'variant?id=1\n')).encode()
                        else: body = ('#EXTM3U\n' + payload + '\n').encode()
                        return self.response(url, body)
                    with self.subTest(role=role, address=address, payload=payload), patch.object(asr, 'open_public', side_effect=fetch), asr.xiaoe_hls_relay(PAGE, MEDIA) as relay:
                        master = urllib.request.urlopen(relay).read().decode()
                        nested = __import__('re').search(r'URI="([^"]+)"', master).group(1) if role.startswith('#EXT-X-MEDIA') else next(line for line in master.splitlines() if line.startswith('http'))
                        with self.assertRaises(urllib.error.HTTPError) as failed: urllib.request.urlopen(nested)
                        self.assertEqual(failed.exception.code, 502)

    def test_content_sniff_catches_playlist_returned_for_segment_or_key(self):
        import urllib.request, urllib.error, re
        from unittest.mock import patch
        for prefix in [b'', b'\xef\xbb\xbf', b' \n']:
            for line in ['segment', '#EXT-X-KEY:METHOD=AES-128,URI="key"']:
                def fetch(url, **options):
                    body = ('#EXTM3U\n' + line + '\n').encode() if url == MEDIA else prefix + b'#EXTM3U\nhttps://evil.example/escape.ts\n'
                    return self.response(url, body)
                with self.subTest(prefix=prefix, line=line), patch.object(asr, 'open_public', side_effect=fetch), asr.xiaoe_hls_relay(PAGE, MEDIA) as relay:
                    master = urllib.request.urlopen(relay).read().decode()
                    resource = re.search(r'URI="([^"]+)"', master).group(1) if line.startswith('#') else next(row for row in master.splitlines() if row.startswith('http'))
                    with self.assertRaises(urllib.error.HTTPError) as failed: urllib.request.urlopen(resource)
                    self.assertEqual(failed.exception.code, 502)


    def test_fragmented_manifest_signature_is_still_rewritten(self):
        import urllib.request, urllib.error
        from unittest.mock import patch
        def fetch(url, **options):
            body = b'#EXTM3U\nsegment\n' if url == MEDIA else b'#EXTM3U\nhttps://evil.example/escape.ts\n'
            response = self.response(url, body)
            read = response.read1
            response.read1 = lambda size: read(min(size, 1))
            return response
        with patch.object(asr, 'open_public', side_effect=fetch), asr.xiaoe_hls_relay(PAGE, MEDIA) as relay:
            manifest = urllib.request.urlopen(relay).read().decode()
            resource = next(row for row in manifest.splitlines() if row.startswith('http'))
            with self.assertRaises(urllib.error.HTTPError) as failed: urllib.request.urlopen(resource)
            self.assertEqual(failed.exception.code, 502)

    def test_playlist_roles_and_mime_require_valid_bounded_manifests(self):
        import urllib.request, urllib.error
        from unittest.mock import patch
        for mime, body in [('application/octet-stream', b'not a playlist'), ('application/vnd.apple.mpegurl', b'not a playlist'), ('application/octet-stream', b'#EXTM3U\n' + b'#' * 4_000_000)]:
            def fetch(url, **options):
                if url == MEDIA: return self.response(url, b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nvariant?id=1\n')
                return self.response(url, body, mime)
            with self.subTest(mime=mime, size=len(body)), patch.object(asr, 'open_public', side_effect=fetch), asr.xiaoe_hls_relay(PAGE, MEDIA) as relay:
                manifest = urllib.request.urlopen(relay).read().decode()
                resource = next(row for row in manifest.splitlines() if row.startswith('http'))
                with self.assertRaises(urllib.error.HTTPError) as failed: urllib.request.urlopen(resource)
                self.assertEqual(failed.exception.code, 502)

    def test_content_steering_is_rejected_instead_of_passing_external_index(self):
        with self.assertRaises(OSError):
            asr.rewrite_xiaoe_playlist('#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI="steering.json"\n', MEDIA, lambda address: address)
