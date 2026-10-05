// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import Defuddle from 'defuddle';
import { bilibiliCaptionOptions, restoreBilibiliTranscript } from './bilibili-captions';

let video = 0;
const track = (lan: string, ai = false) => ({ lan, lan_doc: lan, is_ai_subtitle: ai, subtitle_url: `https://aisubtitle.hdslb.com/${lan}.json` });

async function extract(tracks: ReturnType<typeof track>[], field = 'subtitles', cacheOriginal = false) {
	const url = `https://www.bilibili.com/video/BV1Chinese${String(++video).padStart(2, '0')}/?p=2`;
	const request = vi.fn(async (input: RequestInfo | URL) => {
		const href = String(input);
		const data = href.includes('/x/web-interface/view')
			? { code: 0, data: { aid: 12, title: 'Bilibili test', owner: { name: 'Author' }, pages: [{ cid: 101 }, { cid: 202 }] } }
			: href.includes('/x/player/') ? { code: 0, data: { subtitle: { [field]: tracks } } }
			: { body: [{ from: 2, to: 4, content: href.includes('/en') ? 'English captions' : '中文字幕内容' }] };
		return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
	});
	const doc = new DOMParser().parseFromString('<html><head><title>Video</title></head><body></body></html>', 'text/html');
	Object.defineProperty(doc, 'URL', { value: url, configurable: true });
	if (cacheOriginal) {
		const original = await new Defuddle(doc, { url, fetch: request }).parseAsync();
		expect(original.content).toContain('English captions');
	}
	const result = restoreBilibiliTranscript(await new Defuddle(doc, { url, ...bilibiliCaptionOptions(url, request) }).parseAsync(), url);
	return { result, request };
}

it.each(['ai-zh', 'ai-zh-CN', 'zh-CN', 'zh-Hans', 'zh-Hant', 'zh-TW', 'zh', 'ZH_HANS'])('downloads %s Chinese captions before manual English captions', async language => {
	const { result, request } = await extract([track('en'), track(language, true)]);
	expect(result.content).toContain('中文字幕内容');
	const displayed = new DOMParser().parseFromString(result.content, 'text/html');
	expect(displayed.querySelector('.bilibili.transcript .transcript-segment')?.textContent).toContain('中文字幕内容');
	expect(displayed.querySelector('.timestamp')?.getAttribute('data-timestamp')).toBe('2');
	expect(request.mock.calls.map(([url]) => String(url))).toContain(`https://aisubtitle.hdslb.com/${language}.json`);
	expect(request.mock.calls.map(([url]) => String(url)).some(url => url.includes('cid=202'))).toBe(true);
});

it('prefers manual traditional Chinese to automatic simplified Chinese', async () => {
	const { request } = await extract([track('en'), track('ai-zh', true), track('zh-Hant')]);
	expect(request.mock.calls.map(([url]) => String(url))).toContain('https://aisubtitle.hdslb.com/zh-Hant.json');
});

it.each(['list', 'tracks'])('handles the %s subtitle-list response shape', async field => {
	const { result } = await extract([track('en'), track('ai-zh', true)], field);
	expect(result.content).toContain('中文字幕内容');
});

it('keeps the existing fallback when Chinese captions are unavailable', async () => {
	const { result, request } = await extract([track('en'), track('ja', true)]);
	expect(result.content).toContain('English captions');
	expect(request.mock.calls.map(([url]) => String(url))).toContain('https://aisubtitle.hdslb.com/en.json');
});

it('uses a Chinese preference to separate cached transcripts and leaves other sites alone', () => {
	expect(bilibiliCaptionOptions('https://www.bilibili.com/video/BV1234567890').language).toBe('zh');
	expect(bilibiliCaptionOptions('https://www.youtube.com/watch?v=abcdefghijk')).toEqual({});
	expect(bilibiliCaptionOptions('https://www.bilibili.com/read/cv123')).toEqual({});
});

it('does not reuse an English transcript previously cached by the default extractor', async () => {
	const { result } = await extract([track('en'), track('ai-zh', true)], 'subtitles', true);
	expect(result.content).toContain('中文字幕内容');
});

it('preserves request options and leaves other responses and malformed player data readable', async () => {
	const request = vi.fn(async () => new Response('{invalid json', { headers: { 'content-type': 'application/json' } }));
	const options = bilibiliCaptionOptions('https://www.bilibili.com/video/BV1234567890', request);
	const init = { credentials: 'include' as const, headers: { Accept: 'application/json' } };
	const malformed = await options.fetch!('https://api.bilibili.com/x/player/v2?cid=1', init);
	expect(await malformed.text()).toBe('{invalid json');
	expect(request).toHaveBeenCalledWith('https://api.bilibili.com/x/player/v2?cid=1', init);
	const other = await options.fetch!('https://www.bilibili.com/video/BV1234567890', init);
	expect(await other.text()).toBe('{invalid json');
});

it('restores study-mode rows and hour-long timestamps without replacing the player or description', () => {
	const url = 'https://www.bilibili.com/video/BV1234567890';
	const original = { title: 'Video', content: '<iframe src="https://player.bilibili.com/player.html?bvid=BV1234567890"></iframe><p>Description</p><div><h2>Transcript</h2><p><strong><span>1:02:03</span></strong> · 中文内容</p></div>', variables: { transcript: '**1:02:03** · 中文内容' } };
	const repaired = restoreBilibiliTranscript(original, url);
	const doc = new DOMParser().parseFromString(repaired.content, 'text/html');
	expect(doc.querySelector('.bilibili.transcript .transcript-segment .timestamp')?.getAttribute('data-timestamp')).toBe('3723');
	expect(doc.querySelector('iframe')?.getAttribute('src')).toBe('https://player.bilibili.com/player.html?bvid=BV1234567890');
	expect(doc.querySelector('body > p')?.textContent).toBe('Description');
	expect(doc.querySelectorAll('.transcript-segment')).toHaveLength(1);
	expect(repaired.title).toBe(original.title);
	expect(restoreBilibiliTranscript(repaired, url)).toBe(repaired);
	expect(restoreBilibiliTranscript(original, 'https://example.com')).toBe(original);
});

it('keeps results without timed transcript lines unchanged', () => {
	const url = 'https://www.bilibili.com/video/BV1234567890';
	const description = { content: '<p>Description only</p>' };
	expect(restoreBilibiliTranscript(description, url)).toBe(description);
	const empty = { content: '<div><h2>Transcript</h2><p>No timed lines</p></div>', variables: { transcript: 'No timed lines' } };
	expect(restoreBilibiliTranscript(empty, url)).toBe(empty);
});


it('keeps the upstream protection against subtitles belonging to another video when preferring Chinese', async () => {
	const request = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } })));
	const options = bilibiliCaptionOptions('https://www.bilibili.com/video/BV1xx411c7mD/', request);
	const preferred = options.fetch!;
	await preferred('https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2');
	const response = await preferred('https://api.bilibili.com/x/player/v2?bvid=BV1xx411c7mD&cid=2');
	expect((await response.json()).data.subtitle.subtitles).toEqual([]);
	expect(request).toHaveBeenCalledTimes(1);
});
