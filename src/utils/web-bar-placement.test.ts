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
