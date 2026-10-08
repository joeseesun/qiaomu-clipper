import io, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr

FEED = '''<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title><![CDATA[Great Show]]></title>
<item><title><![CDATA[Ep 2 &amp; more]]></title><guid isPermaLink="false">guid-two</guid><enclosure url="https://cdn.example.com/two.mp3?x=1&amp;y=2" type="audio/mpeg"/><description>short</description><content:encoded><![CDATA[<p>Guest: Ada Lovelace.</p><p>00:00 Intro</p>]]></content:encoded></item>
<item><title>Ep 1</title><guid>guid-one</guid><enclosure url="https://cdn.example.com/one.mp3" type="audio/mpeg"/><description>First</description></item>
<item><title>No audio</title><guid>guid-none</guid></item></channel></rss>'''

class Response(io.BytesIO):
    def __init__(self, data, headers=None): super().__init__(data); self.headers = headers or {}
    def __enter__(self): return self
    def __exit__(self, *a): self.close()

class RssTests(unittest.TestCase):
    def test_it_finds_an_episode_by_the_hash_of_its_guid_and_reads_what_the_feed_says(self):
        with patch.object(asr, 'open_public', lambda url, timeout=30: Response(FEED.encode())):
            item = asr.rss_item('https://f.example.com/feed', asr.sha('guid-two', 16))
            self.assertEqual(item['audio'], 'https://cdn.example.com/two.mp3?x=1&y=2'); self.assertEqual(item['meta']['title'], 'Ep 2 & more'); self.assertEqual(item['meta']['show'], 'Great Show')
            self.assertIn('Ada Lovelace', item['meta']['description']); self.assertNotIn('<p>', item['meta']['description'])
            self.assertEqual(asr.rss_item('https://f.example.com/feed', asr.sha('guid-one', 16))['audio'], 'https://cdn.example.com/one.mp3')
            with self.assertRaises(asr.Failed): asr.rss_item('https://f.example.com/feed', asr.sha('guid-none', 16))  # no audio
            with self.assertRaises(asr.Failed): asr.rss_item('https://f.example.com/feed', asr.sha('missing', 16))  # too old or not there

    def test_only_https_to_a_real_host_name_is_fetched(self):
        for bad in ('http://example.com/x', 'https://localhost/x', 'https://user:pw@example.com/x', 'ftp://example.com', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://192.168.1.1/x', 'https://8.8.8.8/x', 'https://printer.local/x', 'https://db.internal/x', 'https://intranet/x', 'nope', ''): self.assertFalse(asr.public_https(bad), bad)
        for good in ('https://example.com/feed', 'https://feeds.fireside.fm/latetalk/rss', 'https://dts-api.xiaoyuzhoufm.com/a.m4a?x=1'): self.assertTrue(asr.public_https(good), good)  # names are not resolved: a proxy's own DNS answers with private addresses

    def test_a_request_must_name_the_feed_and_episode_it_is_for_and_a_public_feed(self):
        base = Path(tempfile.mkdtemp()); feed = 'https://f.example.com/feed'; key = f"rss:{asr.sha(feed, 12)}:{asr.sha('guid-two', 16)}"
        patcher = [patch.object(asr, 'status', lambda **k: {'ready': True, 'missing': [], 'hints': [], 'engine': 'mlx'}), patch.object(asr, 'spawn_worker', lambda d, key=None: 424242), patch.object(asr, 'public_https', lambda url: url.startswith('https://f.'))]
        for p in patcher: p.start()
        try:
            for bad in ({}, {'feed': feed}, {'feed': feed, 'guid': 'other'}, {'feed': 'https://evil.example.com/feed', 'guid': 'guid-two'}, {'feed': feed, 'guid': 'x' * 900}):
                with self.assertRaises(ValueError): asr.handle({'action': 'asrStart', 'videoKey': key, 'rss': bad}, base)
            reply = asr.handle({'action': 'asrStart', 'videoKey': key, 'rss': {'feed': feed, 'guid': 'guid-two'}}, base); self.assertTrue(reply['ok'], reply)
            spec = json.loads((asr.job_dir(base, reply['id']) / 'spec.json').read_text()); self.assertEqual(spec['rss'], {'feed': feed})
            with self.assertRaises(ValueError): asr.video_url('rss:abc:def')
        finally:
            for p in patcher: p.stop()

    def test_the_audio_is_downloaded_from_the_feed_and_the_page_text_is_kept_for_the_recogniser(self):
        directory = Path(tempfile.mkdtemp()); feed = 'https://f.example.com/feed'
        def fake(url, timeout=30): return Response(FEED.encode()) if url == feed else Response(b'AUDIO' * 100, {'Content-Length': '500'})
        with patch.object(asr, 'open_public', fake):
            path = asr.download_rss(directory, {'videoKey': f"rss:{asr.sha(feed, 12)}:{asr.sha('guid-two', 16)}", 'rss': {'feed': feed}})
        self.assertEqual(path.name, 'audio.src.mp3'); self.assertEqual(path.read_bytes(), b'AUDIO' * 100); self.assertIn('Ada Lovelace', json.loads((directory / 'meta.json').read_text())['description'])

if __name__ == '__main__': unittest.main()

class WebTests(unittest.TestCase):
    def test_a_request_for_any_other_site_names_its_address_by_hash_and_must_be_public_https(self):
        base = Path(tempfile.mkdtemp()); url = 'https://vimeo.com/123456'; key = 'web:' + asr.sha(url, 12)
        patchers = [patch.object(asr, 'status', lambda **k: {'ready': True, 'missing': [], 'hints': [], 'engine': 'mlx'}), patch.object(asr, 'spawn_worker', lambda d, key=None: 424242)]
        for p in patchers: p.start()
        try:
            for bad in ({}, {'url': 5}, {'url': 'https://vimeo.com/other'}, {'url': 'http://vimeo.com/123456'}, {'url': 'https://127.0.0.1/x'}, {'url': 'https://x.example.com/' + 'a' * 1600}):
                with self.assertRaises(ValueError): asr.handle({'action': 'asrStart', 'videoKey': key, 'web': bad}, base)
            with self.assertRaises(ValueError): asr.video_url('web:xyz')
            reply = asr.handle({'action': 'asrStart', 'videoKey': key, 'web': {'url': url}}, base); self.assertTrue(reply['ok'], reply)
            self.assertEqual(json.loads((asr.job_dir(base, reply['id']) / 'spec.json').read_text())['url'], url)  # yt-dlp is given the address the page named
        finally:
            for p in patchers: p.stop()

    def test_probe_says_what_an_address_is_or_why_it_cannot_be_read(self):
        ok = json.dumps({'title': 'T', 'uploader': 'U', 'duration': 61.5, 'thumbnail': 'https://i.example.com/t.jpg', 'extractor_key': 'Vimeo', 'description': 'The words of the post', 'upload_date': '20261006', 'url': 'https://cdn.example.com/a.mp4', 'protocol': 'https', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'mp4a', 'height': 480})
        run = lambda code, out='', err='': type('R', (), {'returncode': code, 'stdout': out, 'stderr': err})()
        with patch.object(asr, 'find_tool', lambda name: '/usr/bin/true'), patch.object(asr, 'public_https', lambda url: url.startswith('https://') and not url.startswith('https://127.')):
            with patch('subprocess.run', lambda *a, **k: run(0, ok)): info = asr.probe({'url': 'https://vimeo.com/1'})
            self.assertEqual((info['title'], info['author'], info['seconds'], info['site'], info['video']), ('T', 'U', 61.5, 'Vimeo', True)); self.assertEqual(info['mediaUrl'], 'https://cdn.example.com/a.mp4'); self.assertEqual((info['description'], info['date']), ('The words of the post', '2026-10-06'))
            hls = json.loads(ok); hls['protocol'] = 'm3u8_native'
            with patch('subprocess.run', lambda *a, **k: run(0, json.dumps(hls))): self.assertIsNone(asr.probe({'url': 'https://vimeo.com/1'})['mediaUrl'])  # a stream the page cannot play
            with patch('subprocess.run', lambda *a, **k: run(1, '', 'ERROR: Unsupported URL: https://x')): self.assertEqual(asr.probe({'url': 'https://x.example.com/p'})['error'], 'unsupported')
            with patch('subprocess.run', lambda *a, **k: run(1, '', 'ERROR: Sign in to confirm you’re not a bot')): self.assertEqual(asr.probe({'url': 'https://x.example.com/p'})['error'], 'needs-cookies')
            with patch('subprocess.run', lambda *a, **k: run(1, '', 'ERROR: [TikTok] 1: Your IP address is blocked from accessing this post')): self.assertEqual(asr.probe({'url': 'https://x.example.com/p'})['error'], 'needs-cookies')  # offered the signed-in browser instead of a raw error
            with self.assertRaises(ValueError): asr.probe({'url': 'https://127.0.0.1/x'})
            with self.assertRaises(ValueError): asr.probe({'url': 'http://x.example.com/p'})
        with patch.object(asr, 'find_tool', lambda name: None): self.assertEqual(asr.probe({'url': 'https://vimeo.com/1'})['error'], 'missing')

    def test_douyin_cookie_errors_are_retryable_and_probe_uses_only_an_explicit_allowed_browser(self):
        from unittest.mock import Mock
        failed = type('R', (), {'returncode': 1, 'stdout': '', 'stderr': 'ERROR: [Douyin] 123: Fresh cookies (not necessarily logged in) are needed'})()
        run = Mock(return_value=failed)
        with patch.object(asr, 'find_tool', lambda name: '/usr/bin/true'), patch.object(asr, 'public_https', lambda url: True), patch('subprocess.run', run):
            url = 'https://www.douyin.com/video/123'
            self.assertEqual(asr.probe({'url': url})['error'], 'needs-cookies')
            self.assertNotIn('--cookies-from-browser', run.call_args[0][0])
            asr.probe({'url': url, 'cookies': 'chrome'})
            args = run.call_args[0][0]
            self.assertEqual(args[args.index('--cookies-from-browser') + 1], 'chrome')
            for bad in ['chrome; echo bad', '/tmp/cookies.txt']:
                with self.assertRaises(ValueError): asr.probe({'url': url, 'cookies': bad})

    def test_probe_picks_a_plain_file_with_the_picture_when_a_site_offers_streams_and_files(self):
        run = lambda out: type('R', (), {'returncode': 0, 'stdout': out, 'stderr': ''})()
        formats = [{'format_id': 'hls-audio', 'url': 'https://v.example.com/a.m3u8', 'protocol': 'm3u8_native', 'ext': 'mp4', 'vcodec': 'none'},
                   {'format_id': 'http-256', 'url': 'https://v.example.com/256.mp4', 'protocol': 'https', 'ext': 'mp4', 'height': 256, 'vcodec': 'avc1', 'acodec': 'mp4a'},
                   {'format_id': 'http-832', 'url': 'https://v.example.com/832.mp4', 'protocol': 'https', 'ext': 'mp4', 'height': 480, 'vcodec': 'avc1', 'acodec': 'mp4a'},
                   {'format_id': 'http-2176', 'url': 'https://v.example.com/2176.mp4', 'protocol': 'https', 'ext': 'mp4', 'height': 1080, 'vcodec': 'avc1', 'acodec': 'mp4a'},
                   {'format_id': 'cookie', 'url': 'https://v.example.com/c.mp4', 'protocol': 'https', 'ext': 'mp4', 'height': 720, 'vcodec': 'avc1', 'acodec': 'mp4a', 'http_headers': {'Cookie': 'x'}}]
        base = {'title': 'T', 'url': 'https://v.example.com/a.m3u8', 'protocol': 'm3u8_native', 'ext': 'mp4', 'vcodec': 'none'}
        with patch.object(asr, 'find_tool', lambda name: '/usr/bin/true'), patch.object(asr, 'public_https', lambda url: url.startswith('https://')):
            with patch('subprocess.run', lambda *a, **k: run(json.dumps({**base, 'formats': formats}))): info = asr.probe({'url': 'https://x.com/a/status/1'})
            self.assertEqual((info['mediaUrl'], info['video']), ('https://v.example.com/832.mp4', True))  # the largest picture up to 720 lines, never the stream, never one that needs a cookie
            only_sound = [{'format_id': 's', 'url': 'https://v.example.com/s.m4a', 'protocol': 'https', 'ext': 'm4a', 'vcodec': 'none', 'abr': 128}]
            with patch('subprocess.run', lambda *a, **k: run(json.dumps({**base, 'formats': only_sound}))): info = asr.probe({'url': 'https://x.com/a/status/1'})
            self.assertEqual((info['mediaUrl'], info['video']), ('https://v.example.com/s.m4a', False))
            with patch('subprocess.run', lambda *a, **k: run(json.dumps({**base, 'formats': formats[:1]}))): self.assertIsNone(asr.probe({'url': 'https://x.com/a/status/1'})['mediaUrl'])
            for videos in ([formats[3]], [{**formats[2], 'height': None}]):
                with patch('subprocess.run', lambda *a, **k: run(json.dumps({**base, 'formats': videos}))): self.assertTrue(asr.probe({'url': 'https://x.com/a/status/1'})['video'])
            with patch('subprocess.run', lambda *a, **k: run(json.dumps({**base, 'formats': [{**formats[2], 'acodec': 'none'}]}))): self.assertIsNone(asr.probe({'url': 'https://x.com/a/status/1'})['mediaUrl'])
