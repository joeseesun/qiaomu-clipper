// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { placeWebBar, WEB_BAR_STYLE } from './web-bar-placement';
it('places TED subtitles in page flow immediately below the player, outside its clipping box', () => {
	document.body.innerHTML = '<div><div class="aspect-video" style="overflow:hidden"><video></video></div><h1>Talk</h1></div>';
	const host = document.createElement('div'); host.className = 'qiaomu-web-bar'; const style = document.createElement('style'); style.textContent = WEB_BAR_STYLE; document.head.append(style);
	placeWebBar(host, document.querySelector('video')!, 'ted');
	expect(host.previousElementSibling).toBe(document.querySelector('.aspect-video')); expect(host.nextElementSibling?.tagName).toBe('H1');
	expect(getComputedStyle(host).position).toBe('relative'); expect(getComputedStyle(host).zIndex).toBe('auto');
});
it('anchors a TikTok bar beside the video and action rail, then follows player movement', () => {
	document.body.innerHTML = '<video></video>'; const media = document.querySelector('video')!, host = document.createElement('div');
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1512 });
	const rect = vi.spyOn(media, 'getBoundingClientRect').mockReturnValue({ top: 16, right: 963 } as DOMRect);
	placeWebBar(host, media, 'tiktok'); expect(host.style.left).toBe('1051px'); expect(host.style.top).toBe('28px');
	rect.mockReturnValue({ top: 100, right: 900 } as DOMRect); placeWebBar(host, media, 'tiktok'); expect(host.style.left).toBe('988px'); expect(host.style.top).toBe('112px');
});
it('anchors TED before its video loads and follows a replaced player without moving an already placed strip', () => {
	document.body.innerHTML = '<div><div class="aspect-video"><media-controller id="video-player-container"></media-controller></div><h1>Talk</h1></div>';
	const host = document.createElement('div');
	placeWebBar(host, undefined, 'ted');
	expect(host.previousElementSibling?.className).toBe('aspect-video');
	const observer = new MutationObserver(() => {}); observer.observe(host.parentElement!, { childList: true });
	placeWebBar(host, undefined, 'ted'); expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
	const replacement = document.createElement('div'); replacement.className = 'aspect-video';
	replacement.innerHTML = '<media-controller id="video-player-container"></media-controller>';
	document.querySelector('.aspect-video')!.replaceWith(replacement);
	placeWebBar(host, undefined, 'ted'); expect(host.previousElementSibling).toBe(replacement);
});
it('ignores Douyin’s hidden duplicate recommendation panel and leaves the author row above the strip', () => {
	document.body.innerHTML = '<video></video><div hidden><h2>推荐视频</h2></div><aside><header>作者与关注</header><section><h2>推荐视频</h2><p>Recommendations</p></section></aside>';
	const video = document.querySelector('video')!, section = document.querySelector('section')!, heading = section.querySelector('h2')!;
	vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ right: 1400 } as DOMRect);
	vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ left: 1420, width: 405, height: 26 } as DOMRect);
	vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ left: 1420, width: 405, height: 2306 } as DOMRect);
	const host = document.createElement('div'); placeWebBar(host, video, 'douyin');
	expect(host.previousElementSibling?.tagName).toBe('HEADER'); expect(host.nextElementSibling).toBe(section);
	expect(host.classList.contains('is-inline')).toBe(true); expect(host.style.top).toBe('');
});
it('floats the Douyin bar above a full-window pop-up player instead of hiding behind it', () => {
	document.body.innerHTML = '<video></video>'; const video = document.querySelector('video')!, host = document.createElement('div'); host.className = 'qiaomu-web-bar';
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
	vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1440, width: 1440, height: 853 } as DOMRect);
	placeWebBar(host, video, 'douyin');
	expect(host.parentElement).toBe(document.body); expect(host.classList.contains('is-inline')).toBe(false);
	expect(host.style.right).toBe('84px'); expect(host.style.top).toBe('58px'); expect(host.classList.contains('is-floating')).toBe(true); expect(Number(host.style.zIndex)).toBeGreaterThan(504);
});
