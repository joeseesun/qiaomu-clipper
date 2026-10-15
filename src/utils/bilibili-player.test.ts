// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountBilibiliPictureClicks } from '../bilibili-embed-content';
import { mountBilibiliQualityLink } from './bilibili-embed';

const origin = 'chrome-extension://mock-id';
let stop = () => {};
afterEach(() => { stop(); stop = () => {}; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

function setup(ancestor = origin) {
	document.body.innerHTML = '<div class="bpx-player-video-area"><div class="bpx-player-video-wrap"><video></video></div><div class="bpx-player-row-dm-wrap"><span>danmaku</span></div><div class="bpx-player-control-wrap"><button>play</button><input></div><div class="bpx-player-video-wrap"><a href="https://www.bilibili.com/">author</a><div role="button">HD</div></div></div>';
	const original = window, parent = {}, scope = Object.create(original);
	Object.defineProperties(scope, { top: { value: {} }, parent: { value: parent }, addEventListener: { value: original.addEventListener.bind(original) }, removeEventListener: { value: original.removeEventListener.bind(original) } });
	vi.stubGlobal('window', scope); vi.stubGlobal('location', { ancestorOrigins: ancestor ? [ancestor] : [] });
	const video = document.querySelector('video')!;
	const play = vi.spyOn(video, 'play').mockResolvedValue(), pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
	const redirect = vi.fn(); document.querySelector('.bpx-player-video-area')!.addEventListener('click', redirect);
	const click = (selector = 'video', options: MouseEventInit = {}) => {
		const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1, ...options });
		document.querySelector(selector)!.dispatchEvent(event); return event;
	};
	const trust = (from = origin, source = parent) => original.dispatchEvent(new MessageEvent('message', { origin: from, source: source as any }));
	stop = mountBilibiliPictureClicks();
	return { video, play, pause, redirect, click, trust };
}

it('plays and pauses picture clicks without opening Bilibili, including the danmaku layer', () => {
	const { video, play, pause, redirect, click } = setup();
	expect(click().defaultPrevented).toBe(true); expect(play).toHaveBeenCalledOnce();
	Object.defineProperty(video, 'paused', { value: false, configurable: true });
	click('.bpx-player-row-dm-wrap span'); expect(pause).toHaveBeenCalledOnce(); expect(redirect).not.toHaveBeenCalled();
});

it.each(['button', 'input', 'a', '[role="button"]'])('preserves native controls and explicit source actions: %s', selector => {
	const { click, play, redirect } = setup(); expect(click(selector).defaultPrevented).toBe(false);
	expect(play).not.toHaveBeenCalled(); expect(redirect).toHaveBeenCalledOnce();
});

it('does not intercept another site’s embedded player', () => {
	const { click, play, redirect, trust } = setup('https://example.com'); trust(); click();
	expect(play).not.toHaveBeenCalled(); expect(redirect).toHaveBeenCalledOnce();
});

it('requires a trusted parent message when ancestorOrigins is unavailable', () => {
	const { click, play, trust } = setup(''); click(); trust('https://example.com'); click(); trust(origin, {}); click();
	expect(play).not.toHaveBeenCalled(); trust(); click(); expect(play).toHaveBeenCalledOnce();
});

it('leaves modified clicks alone and avoids a second toggle on double click', () => {
	const { click, play } = setup(); click('video', { ctrlKey: true }); expect(play).not.toHaveBeenCalled();
	click(); expect(click('video', { detail: 2 }).defaultPrevented).toBe(true); expect(play).toHaveBeenCalledOnce();
});

it('removes the picture handler on cleanup', () => {
	const { click, play, redirect } = setup(); stop(); click(); expect(play).not.toHaveBeenCalled(); expect(redirect).toHaveBeenCalledOnce();
});

it('keeps one quality link, preserves the part, and moves it beside a subsequently created player', () => {
	const article = document.createElement('article'); article.innerHTML = '<iframe src="https://player.bilibili.com/player.html"></iframe>';
	const iframe = article.querySelector('iframe'); mountBilibiliQualityLink(article, 'https://www.bilibili.com/video/BV1Wqp46GEbP/?p=20');
	const link = article.querySelector<HTMLAnchorElement>('.bilibili-quality-link')!;
	expect(link.href).toBe('https://www.bilibili.com/video/BV1Wqp46GEbP/?p=20'); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer');
	expect(link.textContent).toBe('原站高清'); expect(link.title).toContain('外嵌画质受限'); expect(link.style.gridColumn).toBe('1/-1');
	const host = document.createElement('div'); host.className = 'player-container'; article.append(host); host.append(iframe!);
	mountBilibiliQualityLink(article, link.href); expect(host.querySelector('.bilibili-quality-link')).toBe(link);
	expect(article.querySelectorAll('.bilibili-quality-link')).toHaveLength(1); expect(article.querySelector('iframe')).toBe(iframe);
});

it('opens the explicit source link normally without the reader’s follow-links handler', () => {
	const article = document.createElement('article'); mountBilibiliQualityLink(article, 'https://www.bilibili.com/video/BV1Wqp46GEbP/');
	const navigate = vi.fn((event: Event) => event.preventDefault()); article.addEventListener('click', navigate);
	const event = new MouseEvent('click', { bubbles: true, cancelable: true }); article.querySelector('a')!.dispatchEvent(event);
	expect(navigate).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
});

it.each(['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://www.bilibili.com.evil.example/video/BV1Wqp46GEbP/'])('does not add a Bilibili link for %s', url => {
	const article = document.createElement('article'); mountBilibiliQualityLink(article, url); expect(article.childElementCount).toBe(0);
});
