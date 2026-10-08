// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { isTikTokMedia, pickTikTokMedia, snapshotTikTokPlayer, tabMayLendTikTokMedia, tiktokVideoPath } from './web-page-media';

const file = (host: string, id = 'abc') => `https://${host}/video/tos/alisg/tos-alisg-pve-0037c001/${id}/?mime_type=video_mp4&expire=1&l=x`;

describe('TikTok media in the study reader', () => {
	it('accepts only video files from TikTok\'s own hosts', () => {
		expect(isTikTokMedia(file('v16-webapp-prime.tiktok.com'))).toBe(true);
		expect(isTikTokMedia(file('v77.tiktokcdn.com'))).toBe(true);
		expect(isTikTokMedia(file('v16.tiktokcdn-us.com'))).toBe(true);
		for (const bad of [file('evil.example.com'), file('tiktok.com.evil.example'), 'http://v16.tiktok.com/video/tos/x', 'https://u:p@v16.tiktok.com/video/tos/x', 'https://v16.tiktok.com:8443/video/tos/x', 'https://v16.tiktok.com/other/x', 42, undefined]) expect(isTikTokMedia(bad), String(bad)).toBe(false);
	});

	it('picks the candidate as long as the item, not another preloaded video', async () => {
		const durations: Record<string, number> = { a: 31.2, b: 15.4, c: 15.9 };
		const measure = vi.fn(async (src: string) => durations[src.match(/\/(\w)\/\?/)![1]]);
		const picked = await pickTikTokMedia([file('v1.tiktok.com', 'a'), file('v2.tiktok.com', 'b'), file('v3.tiktok.com', 'c')], 15.5, measure);
		expect(picked).toContain('/b/');
		expect(await pickTikTokMedia([file('v1.tiktok.com', 'a')], 15.5, measure)).toBeUndefined();
		expect(await pickTikTokMedia([file('v1.tiktok.com', 'b')], null, measure)).toBeUndefined();
		expect(await pickTikTokMedia([file('evil.example.com', 'b')], 15.4, measure)).toBeUndefined();
	});

	it('reads the files the page itself loaded, newest first, and the length of the video on screen', () => {
		document.body.innerHTML = '<video id="v"></video>';
		const video = document.querySelector<HTMLVideoElement>('#v')!;
		vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 500, width: 300, height: 500 } as DOMRect);
		Object.defineProperty(video, 'duration', { value: 15.4 });
		Object.defineProperty(video, 'paused', { value: false });
		const names = [file('v1.tiktok.com', 'old'), 'https://p16.tiktokcdn.com/x.image', file('v2.tiktok.com', 'new'), file('v2.tiktok.com', 'old')];
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue(names.map(name => ({ name })) as unknown as PerformanceEntryList);
		Object.defineProperty(window, 'location', { configurable: true, value: new URL('https://www.tiktok.com/@a/video/123') });
		const snapshot = snapshotTikTokPlayer();
		expect(snapshot.seconds).toBe(15.4);
		expect(snapshot.candidates.length).toBe(2);           // the repeated request for the same file counts once
		expect(snapshot.candidates[0]).toContain('/new/');    // the item that appeared last comes first
		expect(snapshot.candidates[1]).toContain('v2.tiktok.com');  // and a repeated request keeps the latest address of that file
		expect(snapshot.candidates.every(isTikTokMedia)).toBe(true);
	});

	it('puts the addresses from the video page\'s own data first, and ignores data about another item', () => {
		const item = (id: string) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id, video: { playAddr: file('v16.tiktok.com', 'own'), bitrateInfo: [{ PlayAddr: { UrlList: [file('v19.tiktok.com', 'rate'), 'https://www.tiktok.com/aweme/v1/play/?x=1'] } }] } } } } } })}</script>`;
		document.body.innerHTML = item('123');
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: file('v2.tiktok.com', 'seen') }] as unknown as PerformanceEntryList);
		Object.defineProperty(window, 'location', { configurable: true, value: new URL('https://www.tiktok.com/@a/video/123') });
		const own = snapshotTikTokPlayer().candidates;
		expect(own[0]).toContain('/own/'); expect(own[1]).toContain('/rate/'); expect(own.some(x => x.includes('/seen/'))).toBe(true);
		expect(own.filter(isTikTokMedia).length).toBe(3);   // the plain address of the site's own play endpoint is not accepted
		document.body.innerHTML = item('999');             // data about a different item: not this video
		expect(snapshotTikTokPlayer().candidates.every(x => x.includes('/seen/'))).toBe(true);
	});

	it('lets a feed tab or the same video page lend its player, but not another video\'s page or another site', () => {
		const wanted = tiktokVideoPath('https://www.tiktok.com/@a/video/123?lang=en');
		expect(wanted).toBe('/@a/video/123');
		expect(tabMayLendTikTokMedia('https://www.tiktok.com/foryou', wanted)).toBe(true);     // opened from a feed item
		expect(tabMayLendTikTokMedia('https://www.tiktok.com/', wanted)).toBe(true);
		expect(tabMayLendTikTokMedia('https://www.tiktok.com/@a/video/123', wanted)).toBe(true);
		expect(tabMayLendTikTokMedia('https://www.tiktok.com/@a/video/999', wanted)).toBe(false);
		expect(tabMayLendTikTokMedia('https://example.com/foryou', wanted)).toBe(false);
		expect(tabMayLendTikTokMedia('http://www.tiktok.com/foryou', wanted)).toBe(false);
		expect(tiktokVideoPath('https://www.tiktok.com/foryou')).toBe('');
	});

	it('does nothing away from tiktok.com', () => {
		Object.defineProperty(window, 'location', { configurable: true, value: new URL('https://example.com/@a/video/1') });
		expect(snapshotTikTokPlayer()).toEqual({ url: '', seconds: null, candidates: [] });
	});
});
