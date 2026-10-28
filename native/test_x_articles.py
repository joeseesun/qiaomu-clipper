import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

import x_articles as jobs
from x_article_source import extract_page, page_payloads, render_article

URL = 'https://x.com/poteto/status/2094457600259842065'
ARTICLE_ID = '2094151284949688320'


def article():
    return {'id': base64.b64encode(('ArticleEntity:' + ARTICLE_ID).encode()).decode(), 'title': 'A <complete> guide',
            'plain_text': 'THIS FIELD OMITS CODE', 'content_state': {'blocks': [
                {'type': 'unstyled', 'text': 'Hello 😀 link', 'entity_ranges': [{'offset': 9, 'length': 4, 'key': 1}]},
                {'type': 'atomic', 'entity_ranges': [{'key': 2}]},
                {'type': 'atomic', 'entity_ranges': [{'key': 3}]},
                {'type': 'unstyled', 'text': 'THE EXACT END'}],
            'entity_map': [{'key': 1, 'value': {'type': 'LINK', 'data': {'url': 'https://example.org/a(b)'}}},
                {'key': 2, 'value': {'type': 'MARKDOWN', 'data': {'markdown': '```python\nprint("<tag>\\x3C")\n```'}}},
                {'key': 3, 'value': {'type': 'MEDIA', 'data': {'media_items': [{'media_id': '42'}]}}}]},
            'media_entities': [{'media_id': '42', 'media_info': {'original_img_url': 'https://pbs.twimg.com/a.png'}}]}


def page(a=None, post_id='2094457600259842065', **fields):
    tweet = {'article': {'article_results': {'result': a or article()}}, **fields}
    data = {'data': {'tweet_result_by_rest_id': {'rest_id': post_id, 'result': tweet}}}
    return 'ignored code(); {value:' + json.dumps(json.dumps(data, ensure_ascii=False), ensure_ascii=False).replace('<', '\\x3C') + '}'


class SourceTests(unittest.TestCase):
    def test_original_blocks_links_code_media_and_last_line(self):
        result, raw = extract_page(page(), URL)
        self.assertEqual(raw, article())
        self.assertIn('Hello 😀 [link](https://example.org/a%28b%29)', result['content'])
        self.assertIn('print("<tag>\\x3C")', result['content'])
        self.assertTrue(result['content'].endswith('THE EXACT END'))
        self.assertNotIn('THIS FIELD', result['content'])
        self.assertEqual(result['structure'], {'blocks': 4, 'codeBlocks': 1, 'images': 1, 'embeddedPosts': 0})
        self.assertEqual(result['sha256'], hashlib.sha256(result['content'].encode()).hexdigest())

    def test_article_id_and_unrelated_posts(self):
        self.assertTrue(extract_page(page(), 'https://x.com/i/article/' + ARTICLE_ID)[0]['complete'])
        for url in ['https://x.com/a/status/12345', 'https://x.com/i/article/12345']:
            with self.assertRaisesRegex(ValueError, 'x-body-missing'): extract_page(page(), url)

    def test_preview_is_not_full_post_even_when_legacy_has_text(self):
        with self.assertRaisesRegex(ValueError, 'x-body-missing'):
            extract_page(page({'title': 'preview', 'plain_text': 'short preview'}, legacy={'full_text': 'short preview'}), URL)

    def test_missing_atomic_code_does_not_succeed(self):
        a = article(); a['content_state']['entity_map'].pop(1)
        with self.assertRaisesRegex(ValueError, 'x-source-unverified'): render_article(a)

    def test_javascript_is_never_executed_and_escaped_backslashes_stay(self):
        self.assertEqual(list(page_payloads('{value:globalThis.secret}')), [])
        for sample in ['\\x3C', '\\u1234', '\\\\x3C', '</script>', '😀', '\n']:
            payload = {'body': sample}
            text = '{value:' + json.dumps(json.dumps(payload)).replace('<', '\\x3C') + '}'
            self.assertEqual(list(page_payloads(text)), [payload])

    def test_long_post_and_truncated_post(self):
        result, _ = extract_page(page(note_tweet={'note_tweet_results': {'result': {'text': 'full note'}}},
                                     **{'article': None, 'legacy': {'truncated': True, 'full_text': 'preview'}}), URL)
        self.assertEqual(result['content'], 'full note')
        self.assertEqual(result['kind'], 'post')
        with self.assertRaisesRegex(ValueError, 'x-source-truncated'):
            extract_page(page(**{'article': None, 'legacy': {'truncated': True, 'full_text': 'preview'}}), URL)


class JobTests(unittest.TestCase):
    def test_login_redirect_is_unavailable_without_following_it(self):
        from urllib.request import Request
        from x_article_source import XRedirects
        for destination in ['https://x.com/i/flow/login', 'https://example.org/redirect']:
            with self.assertRaisesRegex(ValueError, 'x-page-unavailable'):
                XRedirects().redirect_request(Request(URL),None,302,'Found',{},destination)

    def test_unavailable_direct_page_reaches_existing_grok_locator(self):
        with patch('x_article_source.fetch_html', side_effect=ValueError('x-page-unavailable')), patch.object(jobs,'find_grok',side_effect=ValueError('grok-missing')) as find:
            jobs.run(self.folder)
        find.assert_called_once()
        self.assertEqual(jobs.handle({'action':'xArticlePoll','id':self.id},self.base)['error'],'grok-missing')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.base = Path(self.temp.name)
        self.id = str(uuid.uuid4()); self.folder = jobs.job_dir(self.base, self.id)
        self.folder.mkdir(parents=True)
        jobs.atomic_json(self.folder / 'job.json', {'state': 'queued', 'url': URL, 'created': __import__('time').time()})
    def tearDown(self): self.temp.cleanup()

    def test_urls_cannot_be_commands_or_internal_addresses(self):
        self.assertEqual(jobs.canonical_url(URL + '?s=20'), URL)
        for url in ['http://x.com/a/status/12345', 'https://x.com@localhost/a/status/12345',
                    'https://x.com.evil/a/status/12345', 'https://x.com/a/status/12345\n',
                    'https://x.com/a/status/12345;touch', 'file:///tmp/a', 'https://x.com:443/a/status/12345']:
            with self.assertRaisesRegex(ValueError, 'invalid-x-url'): jobs.canonical_url(url)

    def test_worker_original_source_succeeds_without_grok(self):
        with patch('x_article_source.fetch_html', return_value=page()), patch.object(jobs, 'find_grok') as cli:
            jobs.run(self.folder)
        cli.assert_not_called()
        self.assertEqual(jobs.handle({'action': 'xArticlePoll', 'id': self.id}, self.base)['state'], 'ready')
        saved = json.loads((self.folder / 'source.json').read_text()); self.assertEqual(saved, article())
        response = jobs.handle({'action': 'xArticleRead', 'id': self.id, 'offset': 0}, self.base)
        self.assertTrue(response['done']); self.assertTrue(response['content'].endswith('THE EXACT END'))

    def test_utf16_transport_crosses_chunk_boundary_and_hashes_identically(self):
        body = 'a' * 47999 + '😀' + 'B' * 90000 + 'TAIL'
        jobs.atomic_json(self.folder / 'article.json', jobs._article(URL, 'Test', '', body, 'post'))
        jobs.atomic_json(self.folder / 'job.json', {'state': 'ready', 'url': URL})
        offset = 0; text = ''
        while True:
            part = jobs.handle({'action': 'xArticleRead', 'id': self.id, 'offset': offset}, self.base)
            self.assertEqual(part['next'], offset + len(part['content'].encode('utf-16-le')) // 2)
            offset = part['next']; text += part['content']
            if part['done']: break
        self.assertEqual(text, body)

    def test_cancelled_job_never_fetches(self):
        jobs.handle({'action': 'xArticleCancel', 'id': self.id}, self.base)
        with patch('x_article_source.fetch_html') as fetch: jobs.run(self.folder)
        fetch.assert_not_called()
        self.assertEqual(jobs.handle({'action': 'xArticlePoll', 'id': self.id}, self.base)['state'], 'cancelled')

    def test_duplicate_start_is_idempotent_and_active_job_blocks_another(self):
        with patch.object(jobs.subprocess, 'Popen') as spawn:
            self.assertTrue(jobs.handle({'action': 'xArticleStart', 'id': self.id, 'url': URL}, self.base)['ok'])
            with self.assertRaisesRegex(ValueError, 'x-busy'):
                jobs.handle({'action': 'xArticleStart', 'id': str(uuid.uuid4()), 'url': URL}, self.base)
        spawn.assert_not_called()

    def test_grok_assistant_text_without_x_call_is_not_evidence(self):
        lines = [json.dumps({'type': 'text', 'data': json.dumps({'urls': [URL]})}), json.dumps({'type': 'end', 'stopReason': 'end_turn'})]
        with self.assertRaisesRegex(ValueError, 'x-source-unverified'): jobs.located_urls(lines)
        lines.insert(0, json.dumps({'type': 'tool_call_update', 'status': 'completed', 'rawOutput': {'name': 'x_thread_fetch'}}))
        self.assertEqual(jobs.located_urls(lines), [URL])

    def test_grok_locator_cannot_substitute_wrong_article(self):
        # Locator output still has to pass the source's exact-ID check.
        with self.assertRaisesRegex(ValueError, 'x-body-missing'): extract_page(page(post_id='12345'), URL)

if __name__ == '__main__': unittest.main()
