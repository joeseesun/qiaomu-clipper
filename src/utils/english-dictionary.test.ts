import { describe, it, expect, vi, afterEach } from 'vitest';
import { englishContextSentences, parseDictionary, isDictionaryQuery, pronunciationUrl, pronunciationWords, validateEnglishContext, parseEnglishLesson, lookupDictionary } from './english-dictionary';
import { englishCatalogs, englishLabels, englishText } from './english-ui';

describe('English learning data boundaries', () => {
	it('keeps dictionary senses, both accents, forms and plain examples without rendering HTML', () => {
		const value = parseDictionary('run', { ec: { word: [{ 'return-phrase': { l: { i: 'run' } }, ukphone: 'rʌn', usphone: 'rʌn', trs: [{ tr: [{ l: { i: ['v. 跑；经营', 'n. 跑步', '没有词性的释义'] } }] }], wfs: [{ wf: { name: '过去式', value: 'ran' } }] }] }, blng_sents_part: { 'sentence-pair': [{ 'sentence-eng': 'They <b>run</b> a shop.', 'sentence-translation': '他们经营一家店。' }] } });
		expect(value.meanings).toEqual([{ pos: 'v.', text: '跑；经营' }, { pos: 'n.', text: '跑步' }, { pos: '', text: '没有词性的释义' }]);
		expect(value.examples[0].en).toBe('They run a shop.'); expect(value.forms[0].value).toBe('ran'); expect(value.uk).toBe('rʌn'); expect(value.us).toBe('rʌn');
	});
	it('does not label web or AI definitions as standard dictionary material', () => {
		expect(parseDictionary('unknown', { web_trans: { result: 'fake' }, aiDefinition: { text: 'fake' } }).meanings).toEqual([]);
		expect(parseDictionary('unknown', { ec: { word: 'bad' } }).meanings).toEqual([]);
	});
	it('uses dictionary for words/phrases, not complete sentences or prompt-like punctuation', () => {
		for (const text of ['I', 'resilient', 'take for granted', "don't", 'well-being']) expect(isDictionaryQuery(text)).toBe(true);
		for (const text of ['It was raining, so we stayed in.', 'a '.repeat(12), '<script>', '你好']) expect(isDictionaryQuery(text)).toBe(false);
	});
	it('bounds context and selection before any provider request', () => {
		expect(validateEnglishContext({ text: ' a ', context: '', title: '' })?.text).toBe('a');
		for (const input of [{ text: '中文', context: '', title: '' }, { text: 'a'.repeat(1501), context: '', title: '' }, { text: 'a', context: 'x'.repeat(3001), title: '' }]) expect(validateEnglishContext(input)).toBeUndefined();
	});
	it('keeps quoted words, Latin loanwords and abbreviations on the dictionary path', () => {
		for (const word of ['“resilient,”', '(running)', 'quickly!', 'café', 'naïve', 'U.S.', 'U.S.,', 'state‑of‑the‑art']) expect(isDictionaryQuery(word), word).toBe(true);
	});
	it('preserves case and accented letters for sentence pronunciation queries', () => {
		expect(pronunciationWords('US and us, Polish polish, café and naïve. U.S.')).toEqual(['US', 'and', 'us', 'Polish', 'polish', 'café', 'naïve', 'U.S.']);
	});
	it('separates combined parts of speech and standard abbreviation categories', () => {
		const entry = parseDictionary('test', { ec: { word: [{ trs: [{ tr: [{ l: { i: ['adj./adv. 两种词性', 'abbr. 缩写', 'contr. 缩略形式'] } }] }] }] } });
		expect(entry.meanings.map(m => m.pos)).toEqual(['adj. adv.', 'abbr.', 'contr.']);
	});
	it('has one audio origin, encodes content and keeps the accent switch distinct', () => {
		const uk = new URL(pronunciationUrl('hello & world', 'uk')), us = new URL(pronunciationUrl('hello & world', 'us'));
		expect(uk.hostname).toBe('dict.youdao.com'); expect(uk.searchParams.get('audio')).toBe('hello & world'); expect(uk.searchParams.get('type')).toBe('1'); expect(us.searchParams.get('type')).toBe('2');
	});
	it('rejects incomplete model output rather than silently dropping requested teaching sections', () => {
		expect(() => parseEnglishLesson('{"translation":"你好"}')).toThrow();
		const lesson = { translation: 't', contextual: 'c', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' };
		expect(parseEnglishLesson('```json\n' + JSON.stringify(lesson) + '\n```')).toEqual(lesson);
	});
	it('requires the separate full context translation when context was supplied', () => {
		const lesson = { translation: 't', contextual: '只解释选中片段', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' };
		expect(() => parseEnglishLesson(JSON.stringify(lesson), true)).toThrow('Missing complete context translation');
		const full = '第一句完整译文。\n第二句完整译文，保留限定。';
		expect(parseEnglishLesson(JSON.stringify({ ...lesson, contextTranslation: full }), true).contextTranslation).toBe(full);
	});
	it('keeps every source character when splitting context, including abbreviations and quoted attribution', () => {
		const text = 'Dr. Smith works in the U.S. office. It costs $2.50. “Really?” she asked.\nWe agreed.';
		const sentences = englishContextSentences(text);
		expect(sentences).toEqual(['Dr. Smith works in the U.S. office. ', 'It costs $2.50. ', '“Really?” she asked.\n', 'We agreed.']);
		expect(sentences.join('')).toBe(text);
	});
	it('requires one complete translation per supplied sentence instead of guessing how a paragraph aligns', () => {
		const fields = { translation: 't', contextual: 'c', grammar: 'g', examples: 'e', memory: 'm', pronunciation: 'p' };
		const parsed = parseEnglishLesson(JSON.stringify({ ...fields, contextTranslations: ['第一句。', '第二句，含有限定。'] }), true, 2);
		expect(parsed.contextTranslations).toEqual(['第一句。', '第二句，含有限定。']);
		expect(parsed.contextTranslation).toBe('第一句。\n第二句，含有限定。');
		for (const contextTranslations of [undefined, ['合并后的全部译文'], ['第一句。', ''], ['第一句。', '第二句。', '多余一句。']]) {
			expect(() => parseEnglishLesson(JSON.stringify({ ...fields, contextTranslation: '旧段落译文', contextTranslations }), true, 2)).toThrow();
		}
	});
	it('requests only the dictionary sections, without cookies, with caller cancellation', async () => {
		const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal('fetch', fetcher);
		const signal = new AbortController().signal; await lookupDictionary('run', signal);
		const [url, options] = fetcher.mock.calls[0]; expect(new URL(url).hostname).toBe('dict.youdao.com'); expect(new URL(url).searchParams.get('dicts')).toContain('blng_sents_part'); expect(options).toMatchObject({ credentials: 'omit', signal });
	});
	afterEach(() => vi.unstubAllGlobals());
	it('supplies every control in all nine interface languages', () => {
		for (const [locale, values] of Object.entries(englishCatalogs)) { expect(values.split('|')).toHaveLength(englishLabels.length); for (const label of englishLabels) expect(englishText(locale)(label)?.trim()).toBeTruthy(); }
	});
});
