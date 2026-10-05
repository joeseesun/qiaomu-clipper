// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./storage-utils', () => ({ getLocalStorage: async () => undefined, setLocalStorage: async () => {}, loadSettings: async () => {} }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./clip-chat', () => ({ mountClipChat: () => ({ toggle: () => true }) }));
import { bilibiliEmbedUrl, bilibiliVideo, isBilibiliEmbed, videoKey, videoStudyPath } from './video-source';
import { wireTranscript } from './reader-transcript';
import { restoreYouTubePlayer } from './youtube-study';

const page = 'https://www.bilibili.com/video/BV1cSec6tEux/?trackid=web_pegasus_0&spm_id_from=333.1007&vd_source=709a';
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

it('recognises Bilibili video pages, parts and rejects look-alikes', () => {
	expect(bilibiliVideo(page)).toEqual({ bvid: 'BV1cSec6tEux', page: 1 });
	expect(bilibiliVideo('https://www.bilibili.com/video/BV1cSec6tEux?p=3')).toEqual({ bvid: 'BV1cSec6tEux', page: 3 });
	expect(bilibiliVideo('https://m.bilibili.com/video/BV1cSec6tEux')).not.toBeNull();
	for (const bad of ['https://evilbilibili.com/video/BV1cSec6tEux', 'https://www.bilibili.com/read/cv123', 'https://www.bilibili.com/video/av170001', 'ftp://www.bilibili.com/video/BV1cSec6tEux', 'nope']) expect(bilibiliVideo(bad)).toBeNull();
});

it('builds the trusted embed URL, study path and a key that tells parts apart', () => {
	const url = new URL(bilibiliEmbedUrl({ bvid: 'BV1cSec6tEux', page: 2 }, { start: 61.8, autoplay: true }));
	expect(url.origin + url.pathname).toBe('https://player.bilibili.com/player.html'); expect(url.searchParams.get('bvid')).toBe('BV1cSec6tEux');
	expect(url.searchParams.get('p')).toBe('2'); expect(url.searchParams.get('t')).toBe('61'); expect(url.searchParams.get('autoplay')).toBe('1');
	expect(isBilibiliEmbed(url.toString())).toBe(true); expect(isBilibiliEmbed('https://player.bilibili.com.evil.test/player.html')).toBe(false);
	expect(videoStudyPath(page, 7, 'T')).toBe(`reader.html?study=bilibili&url=${encodeURIComponent(page)}&sourceTab=7&title=T`);
	expect(videoStudyPath('https://www.youtube.com/watch?v=dbqweBCynuI', 1)).toContain('study=youtube'); expect(videoStudyPath('https://example.com/', 1)).toBeNull();
	expect(videoKey(page)).toBe('bilibili:BV1cSec6tEux:1'); expect(videoKey('https://www.bilibili.com/video/BV1cSec6tEux?p=2')).not.toBe(videoKey(page));
});

it('restores a Bilibili player ahead of the transcript when the page only has text', () => {
	document.body.innerHTML = '<article><p>x</p><div class="bilibili transcript"><h2>Transcript</h2></div></article>';
	const article = document.querySelector('article')!; expect(restoreYouTubePlayer(article, page)).toBe(true);
	const frame = article.querySelector('iframe')!; expect(isBilibiliEmbed(frame.src)).toBe(true); expect(frame.nextElementSibling?.classList.contains('transcript')).toBe(true);
	expect(restoreYouTubePlayer(article, page)).toBe(true); expect(article.querySelectorAll('iframe')).toHaveLength(1);
});

it('wires a Bilibili transcript: jumps by reloading at the clicked second, once per drag, without YouTube API params', () => {
	vi.useFakeTimers(); vi.stubGlobal('CSS', {});
	document.body.innerHTML = `<article><iframe src="${bilibiliEmbedUrl({ bvid: 'BV1cSec6tEux', page: 1 })}"></iframe><div class="bilibili transcript"><h2>Transcript</h2>
		<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="0">0:00</span></strong> · first</p>
		<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="75">1:15</span></strong> · second</p></div></article>`;
	const article = document.querySelector('article')!, frame = article.querySelector('iframe')!, before = frame.src;
	wireTranscript(document, article, { pinPlayer: true, autoScroll: false, highlightActiveLine: true }, { getStickyOffset: () => 0, scrollTo: () => {}, programmaticScroll: () => false });
	expect(frame.src).toBe(before); expect(frame.src).not.toContain('enablejsapi'); expect(article.querySelectorAll('.player-container')).toHaveLength(1);
	const second = article.querySelectorAll<HTMLElement>('.transcript-segment')[1];
	second.querySelector<HTMLElement>('.timestamp')!.click(); second.querySelector<HTMLElement>('.timestamp')!.click();
	expect(frame.src).toBe(before); vi.advanceTimersByTime(300);
	const url = new URL(frame.src); expect(Number(url.searchParams.get('t'))).toBeGreaterThanOrEqual(75); // somewhere inside the clicked line expect(url.searchParams.get('autoplay')).toBe('1'); expect(second.classList.contains('is-active')).toBe(true);
	vi.unstubAllGlobals();
});

it('recognises the video on a playlist, favourites or watch-later page from its ?bvid= and keeps the same key as the plain page', () => {
	const list = 'https://www.bilibili.com/list/ml118372123?oid=113718453081471&bvid=BV1XJCzYyEcp';
	expect(bilibiliVideo(list)).toEqual({ bvid: 'BV1XJCzYyEcp', page: 1 });
	expect(bilibiliVideo('https://www.bilibili.com/list/watchlater?bvid=BV1XJCzYyEcp&p=2')).toEqual({ bvid: 'BV1XJCzYyEcp', page: 2 });
	expect(videoKey(list)).toBe(videoKey('https://www.bilibili.com/video/BV1XJCzYyEcp/'));
	for (const bad of ['https://www.bilibili.com/list/ml1?oid=1', 'https://www.bilibili.com/list/ml1?bvid=nope', 'https://www.bilibili.com/read/cv1?bvid=BV1XJCzYyEcp', 'https://evilbilibili.com/list/ml1?bvid=BV1XJCzYyEcp']) expect(bilibiliVideo(bad)).toBeNull();
});

it('opens study mode for a playlist page on the plain video page, so the subtitles can be read', () => {
	const path = videoStudyPath('https://www.bilibili.com/list/ml118372123?oid=1&bvid=BV1XJCzYyEcp', 7, '电磁学')!;
	expect(path).toContain('study=bilibili'); expect(decodeURIComponent(path)).toContain('url=https://www.bilibili.com/video/BV1XJCzYyEcp/&sourceTab=7');
	expect(decodeURIComponent(videoStudyPath('https://www.bilibili.com/list/watchlater?bvid=BV1XJCzYyEcp&p=3', 7)!)).toContain('url=https://www.bilibili.com/video/BV1XJCzYyEcp/?p=3');
});

it('recognises a Xiaoyuzhou episode page and builds its study address', async () => {
	const { xiaoyuzhouEpisode, audioKey, audioStudyPath, LOCAL_AUDIO_STUDY_PATH } = await import('./video-source');
	const id = '6a97f287f03e74ee6b03ea5b';
	expect(xiaoyuzhouEpisode(`https://www.xiaoyuzhoufm.com/episode/${id}`)).toBe(id); expect(xiaoyuzhouEpisode(`https://xiaoyuzhoufm.com/episode/${id}/`)).toBe(id);
	for (const bad of ['https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962', `http://www.xiaoyuzhoufm.com/episode/${id}`, `https://xiaoyuzhoufm.com.evil.example/episode/${id}`, 'https://www.xiaoyuzhoufm.com/episode/short', 'nope']) expect(xiaoyuzhouEpisode(bad)).toBeNull();
	expect(audioKey(`https://www.xiaoyuzhoufm.com/episode/${id}`)).toBe(`xiaoyuzhou:${id}`);
	expect(audioStudyPath(`https://www.xiaoyuzhoufm.com/episode/${id}`, '标题')).toBe(`reader.html?study=audio&url=${encodeURIComponent(`https://www.xiaoyuzhoufm.com/episode/${id}`)}&title=${encodeURIComponent('标题')}`);
	expect(audioStudyPath('https://example.com/')).toBeNull(); expect(LOCAL_AUDIO_STUDY_PATH).toBe('reader.html?study=file');
});
