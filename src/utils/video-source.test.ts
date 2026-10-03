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
