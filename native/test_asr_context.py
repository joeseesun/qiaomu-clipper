import json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr, asr_cloud, asr_context as c

META = {'title': '153. 和曾鸣聊产业史观', 'show': '张小珺Jùn｜商业访谈录', 'description': '今天的嘉宾是战略学家曾鸣教授。\n关注我们的公众号 https://x.com/a\n00:00 开场\n#AI #曾鸣\n👉 订阅频道领取优惠\n今天的嘉宾是战略学家曾鸣教授。', 'chapters': ['开场', '第一阶段：基础设施']}

class ContextTests(unittest.TestCase):
    def test_cleaning_drops_links_stamps_emoji_tags_and_the_asks_and_adverts(self):
        lines = c.clean_lines(META['description'])
        self.assertEqual(lines, ['今天的嘉宾是战略学家曾鸣教授。', '开场', 'AI 曾鸣'])  # the link, the follow/subscribe lines and the repeat are gone; the hashtag marks and the time stamp too
        self.assertEqual(c.clean_line('  ▶ 看这里 https://a.b/c?x=1  me@x.com 😀 '), '看这里')
        self.assertEqual(c.clean_line('From the album,&nbsp;seen <a href="https://x.example/a">here</a> <b>now</b>'), 'From the album, seen here now')  # sites hand over HTML descriptions
        self.assertEqual(c.clean_lines('12:30\n---\n!!!\na'), [])  # nothing left of a bare stamp, a rule or a row of marks; one word is too little

    def test_background_puts_who_and_what_first_and_fits_the_room(self):
        text = c.background(META, 400)
        self.assertTrue(text.startswith('153. 和曾鸣聊产业史观。张小珺Jùn｜商业访谈录')); self.assertIn('章节：开场；第一阶段：基础设施', text); self.assertIn('曾鸣教授', text)
        short = c.background(META, 60); self.assertLessEqual(len(short), 60); self.assertTrue(short.startswith('153.'))
        self.assertEqual(c.background({}, 400), ''); self.assertEqual(c.background({'description': '关注我们\nhttps://x.com'}, 400), '')  # nothing worth saying: nothing sent

    def test_the_short_prompt_keeps_the_end_where_whisper_looks_and_is_never_longer_than_asked(self):
        text = c.prompt(META, 60)
        self.assertLessEqual(len(text), 60); self.assertTrue(text.endswith('张小珺Jùn｜商业访谈录。')); self.assertEqual(c.prompt({}), '')
        self.assertTrue(c.prompt({'title': 'x' * 500}, 100).startswith('…'))

    def test_doubao_gets_the_documented_context_json(self):
        data = json.loads(c.doubao(META)); self.assertEqual(data['context_type'], 'dialog_ctx'); self.assertIn('曾鸣', data['context_data'][0]['text']); self.assertEqual(c.doubao({}), '')

    def test_it_reads_what_yt_dlp_and_a_podcast_page_say(self):
        info = c.from_ytdlp({'title': 'T', 'uploader': 'U', 'description': 'D', 'chapters': [{'title': 'One'}, {}], 'tags': ['a', 5, 'b']})
        self.assertEqual(info, {'title': 'T', 'author': 'U', 'description': 'D\na b', 'chapters': ['One']}); self.assertEqual(c.from_ytdlp('x'), {})
        page = '<meta property="og:title" content="153. 标题 - 张小珺 | 小宇宙 - 听播客，上小宇宙"/><div class="podcast-title x"><a class="name" href="/p">张小珺Jùn</a></div><div class="sn-content"><article><p><span>嘉宾是曾鸣。</span></p><p>第二段</p></article></div>'
        meta = c.from_podcast_page(page); self.assertEqual(meta['title'], '153. 标题 - 张小珺'); self.assertEqual(meta['show'], '张小珺Jùn'); self.assertIn('嘉宾是曾鸣。', meta['description']); self.assertIn('第二段', meta['description'])

class CloudContextTests(unittest.TestCase):
    cfg = lambda self, mode: {'protocol': 'doubao-flash' if mode == 'doubao' else 'openai-transcriptions', 'baseUrl': 'https://x.example/v1', 'model': 'm', 'timestamps': 'none', 'languageParam': False, 'contextMode': mode}
    def test_only_services_where_it_helped_get_it(self):
        self.assertIn('曾鸣', asr_cloud.context_for(self.cfg('doubao'), META, 'auto')); self.assertIn('曾鸣', asr_cloud.context_for(self.cfg('prompt'), META, 'zh'))
        self.assertEqual(asr_cloud.context_for(self.cfg(None), META, 'zh'), ''); self.assertEqual(asr_cloud.context_for(self.cfg('prompt'), {}, 'zh'), '')
        self.assertEqual(asr_cloud.context_for(self.cfg('prompt'), META, 'en'), '')  # Chinese background on English audio would pull it the wrong way
    def test_the_request_carries_it_in_the_form_the_service_reads(self):
        with tempfile.TemporaryDirectory() as d:
            audio = Path(d) / 'a.mp3'; audio.write_bytes(b'x'); context = '背景'
            doubao = asr_cloud.build_request(self.cfg('doubao'), 'k', audio, 'auto', asr_cloud.context_for(self.cfg('doubao'), META, 'auto'))
            body = json.loads(doubao.data); self.assertIn('曾鸣', body['request']['corpus']['context'])
            self.assertNotIn('corpus', json.loads(asr_cloud.build_request(self.cfg('doubao'), 'k', audio, 'auto').data)['request'])
            openai = asr_cloud.build_request(self.cfg('prompt'), 'k', audio, 'auto', context); self.assertIn(b'name="prompt"', openai.data); self.assertIn('背景'.encode(), openai.data)
            plain = asr_cloud.build_request(self.cfg(None), 'k', audio, 'auto', context); self.assertNotIn(b'name="prompt"', plain.data)  # a service that was not seen to use it is sent nothing
    def test_the_page_may_only_ask_for_known_context_modes(self):
        base = {'protocol': 'openai-transcriptions', 'baseUrl': 'https://x.example/v1', 'model': 'm'}
        self.assertEqual(asr_cloud.clean_config({**base, 'contextMode': 'doubao'})['contextMode'], 'doubao'); self.assertIsNone(asr_cloud.clean_config({**base, 'contextMode': 'evil'})['contextMode']); self.assertIsNone(asr_cloud.clean_config(base)['contextMode'])

class WorkerContextTests(unittest.TestCase):
    def test_the_language_of_the_background_must_suit_the_speech(self):
        self.assertTrue(asr.fits_language('中文背景', 'zh')); self.assertFalse(asr.fits_language('中文背景', 'en')); self.assertTrue(asr.fits_language('English background', 'en')); self.assertFalse(asr.fits_language('English background', 'zh')); self.assertTrue(asr.fits_language('中文', 'auto')); self.assertTrue(asr.fits_language('', 'en'))
    def test_the_page_meta_is_used_only_when_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d); asr.save_meta(directory, META)
            self.assertIn('title', asr.page_meta(directory, {})); self.assertEqual(asr.page_meta(directory, {'context': False}), {})
            asr.save_meta(directory, {'title': 'x' * 9000, 'junk': 'y', 'chapters': ['c'] * 100}); saved = json.loads((directory / 'meta.json').read_text()); self.assertNotIn('junk', saved); self.assertEqual(len(saved['title']), 6000); self.assertEqual(len(saved['chapters']), 60)

if __name__ == '__main__': unittest.main()

class ResplitTests(unittest.TestCase):
    def test_a_paragraph_returned_as_one_line_is_broken_at_its_sentences_and_the_rest_is_left_alone(self):
        long = {'start': 0.0, 'end': 24.0, 'text': '好了，下面继续来给大家介绍关于管理知识当中的其他内容。我们来看一下第三个部分，就是管理学当中的一些重要原理及定律。这部分内容相对来说非常重要。'}
        short = {'start': 24.0, 'end': 26.0, 'text': '人本原理'}; fine = {'start': 26.0, 'end': 40.0, 'text': '没有标点的一长串字但是没有句子可以拆开所以保持原样不动哦哦哦哦哦哦哦'}
        out = asr.resplit([long, short, fine]); self.assertGreater(len(out), 3); self.assertEqual(out[0]['start'], 0.0); self.assertAlmostEqual(out[-3]['end'], 24.0, delta=0.05)
        self.assertEqual(''.join(p['text'] for p in out[:-2]), long['text'].replace(' ', '')); self.assertEqual(out[-2:], [short, fine])
        self.assertTrue(all(p['end'] - p['start'] <= 12 for p in out[:-2]))
