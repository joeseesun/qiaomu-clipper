// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { parseTedMedia, readTedMedia } from './ted-media';
const address = 'https://www.ted.com/talks/example';
const html = (language = 'en') => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {
	videoData: { slug: 'example', title: 'Title', videoPlayerData: { nativeLanguage: 'en', duration: 60, resources: { h264: [{ file: 'https://py.tedcdn.com/talk.mp4', bitrate: 1200 }] }, languages: [{ languageCode: 'en', endonym: 'English' }, { languageCode: 'zh-cn', endonym: '中文' }] } },
	transcriptData: { translation: { language: { internalLanguageCode: language }, paragraphs: [{ cues: [{ text: 'Official line', time: 359 }, { text: 'Second', time: 4355 }, { text: '', time: 9000 }] }] } }
} } })}</script>`;
const doc = (language = 'en') => new DOMParser().parseFromString(html(language), 'text/html');
it('reads official timed cues, language choices and video file from TED page data', () => {
	const result = parseTedMedia(doc(), address)!;
	expect(result.segments.map(s => [s.time, s.text])).toEqual([['0:00', 'Official line'], ['0:04', 'Second']]);
	expect(result.mediaUrl).toBe('https://py.tedcdn.com/talk.mp4'); expect(result.languages).toHaveLength(2);
	expect(parseTedMedia(doc(), 'https://www.ted.com/talks/another')).toBeUndefined();
});
it('uses the spoken language by default and fetches the selected official translation without relabelling failures', async () => {
	const fetch = vi.fn().mockResolvedValue(html());
	expect((await readTedMedia(address, fetch, doc('zh-cn')))?.language).toBe('en');
	expect(fetch).toHaveBeenCalledWith(address + '?language=en');
	fetch.mockResolvedValue(html('zh-cn')); expect((await readTedMedia(address, fetch, doc(), 'zh-cn'))?.language).toBe('zh-cn');
	fetch.mockResolvedValue(html()); expect(await readTedMedia(address, fetch, doc(), 'zh-cn')).toBeUndefined();
});
it('uses no network for a ready original-language page and rejects other hosts', async () => {
	const fetch = vi.fn(); expect((await readTedMedia(address, fetch, doc()))?.segments).toHaveLength(2); expect(fetch).not.toHaveBeenCalled();
	expect(await readTedMedia('https://ted.com.evil.test/talks/example', fetch, doc())).toBeUndefined();
});
