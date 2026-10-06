// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { getWebPageMedia, isDouyinMedia, readPageMedia, snapshotDouyinPlayer, validateDouyinTracks } from './web-page-media';
const url = 'https://www.douyin.com/video/123', mediaUrl = 'https://v11-weba.douyinvod.com/video/123/?signature=x';
it('reads the current player without cookies and accepts only HTTPS media on Douyin’s CDN', () => {
	document.body.innerHTML = '<h1>科普动画</h1><video></video>';
	const video = document.querySelector('video')!;
	Object.defineProperty(video, 'currentSrc', { configurable: true, value: mediaUrl });
	Object.defineProperty(video, 'duration', { value: 261.247 });
	expect(readPageMedia(document, url, video)).toMatchObject({ mediaUrl, seconds: 261.247, title: '科普动画', video: true });
	for (const bad of ['http://v11.douyinvod.com/a', 'https://douyinvod.com.evil.org/a', 'https://user:pw@v11.douyinvod.com/a', 'https://127.0.0.1/a', 'https://v11.douyinvod.com:8080/a', 'blob:https://www.douyin.com/x', mediaUrl + '&__vid=456']) expect(isDouyinMedia(url, bad)).toBe(false);
	expect(isDouyinMedia('https://vimeo.com/123', mediaUrl)).toBe(false);
});
it('rejects a switched source item and untrusted media before the reader uses it', async () => {
	const api = { get: vi.fn().mockResolvedValue({ url }), query: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ url, info: { mediaUrl, title: 'Current', seconds: 261 } }) };
	expect(await getWebPageMedia(url, 7, api)).toMatchObject({ mediaUrl, title: 'Current' });
	api.get.mockResolvedValue({ url: 'https://www.douyin.com/video/456' });
	expect(await getWebPageMedia(url, 7, api)).toBeUndefined(); expect(api.sendMessage).toHaveBeenCalledTimes(1);
	api.get.mockResolvedValue({ url }); api.sendMessage.mockResolvedValue({ url: 'https://www.douyin.com/video/456', info: { mediaUrl } });
	expect(await getWebPageMedia(url, 7, api)).toBeUndefined();
	api.sendMessage.mockResolvedValue({ url, info: { mediaUrl: 'https://example.com/a' } });
	expect(await getWebPageMedia(url, 7, api)).toBeUndefined();
});
it('reopens a stored study link using only the matching public source tab', async () => {
	const api = { get: vi.fn(), query: vi.fn().mockResolvedValue([{ id: 8, url: 'https://www.douyin.com/video/456' }, { id: 9, url }]), sendMessage: vi.fn().mockResolvedValue({ url, info: { mediaUrl } }) };
	expect(await getWebPageMedia(url, undefined, api)).toMatchObject({ mediaUrl });
	expect(api.sendMessage).toHaveBeenCalledWith(9, { action: 'qiaomuWebMediaSource' });
});
it('recovers the original-video link in another tab when the previous source was closed or switched', async () => {
	const api = { get: vi.fn().mockRejectedValue(new Error('Closed')), query: vi.fn().mockResolvedValue([{ id: 9, url }]), sendMessage: vi.fn().mockResolvedValue({ url, info: { mediaUrl } }) };
	expect(await getWebPageMedia(url, 7, api)).toMatchObject({ mediaUrl });
	api.get.mockResolvedValue({ url: 'https://www.douyin.com/video/456' });
	expect(await getWebPageMedia(url, 7, api)).toMatchObject({ mediaUrl });
	expect(api.sendMessage.mock.calls.map(call => call[0])).toEqual([9, 9]);
});
it('reads the live DOM when an old or unavailable content script cannot return media', async () => {
	const api = { get: vi.fn().mockResolvedValue({ url }), query: vi.fn(), sendMessage: vi.fn().mockRejectedValue(new Error('Extension updated')) };
	const live = vi.fn().mockResolvedValue({ url, info: { mediaUrl, title: 'Recovered' } });
	expect(await getWebPageMedia(url, 7, api, live)).toMatchObject({ mediaUrl, title: 'Recovered' });
	api.sendMessage.mockResolvedValue({ url });
	expect(await getWebPageMedia(url, 7, api, live)).toMatchObject({ mediaUrl });
	api.get.mockResolvedValue({ url: 'https://www.douyin.com/video/456' });
	expect(await getWebPageMedia(url, 7, api, live)).toBeUndefined(); expect(live).toHaveBeenCalledTimes(2);
	api.get.mockResolvedValue({ url }); live.mockResolvedValue({ url: 'https://www.douyin.com/video/456', info: { mediaUrl } });
	expect(await getWebPageMedia(url, 7, api, live)).toBeUndefined();
});
it('the serialized DOM reader skips empty and hidden videos and verifies an explicit player item id', () => {
	vi.stubGlobal('location', { href: url });
	document.body.innerHTML = '<h1>Current item</h1><video id="hidden"></video><video id="empty"></video><video id="current"></video>';
	const video = document.querySelector<HTMLVideoElement>('#current')!;
	for (const player of Array.from(document.querySelectorAll('video'))) vi.spyOn(player, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 } as DOMRect);
	const hidden = document.querySelector<HTMLVideoElement>('#hidden')!; hidden.style.visibility = 'hidden';
	Object.defineProperty(hidden, 'currentSrc', { value: mediaUrl });
	Object.defineProperty(video, 'currentSrc', { configurable: true, value: mediaUrl + '&__vid=123' });
	expect(snapshotDouyinPlayer()).toMatchObject({ url, info: { title: 'Current item', mediaUrl: mediaUrl + '&__vid=123' } });
	Object.defineProperty(video, 'currentSrc', { configurable: true, value: mediaUrl + '&__vid=456' });
	expect(snapshotDouyinPlayer()).toEqual({ url });
	vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('pairs one loaded MSE video/audio for the exact opened item and refuses preloaded or stale resource pairs', () => {
	vi.stubGlobal('location', { href: url });
	document.body.innerHTML = '<video></video>';
	const video = document.querySelector('video')!;
	Object.defineProperty(video, 'currentSrc', { value: 'blob:https://www.douyin.com/stream' });
	vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 } as DOMRect);
	const picture = 'https://v11.douyinvod.com/v/media-video-hvc1/?l=pair', audio = 'https://v11.douyinvod.com/a/media-audio-und-mp4a/?l=pair';
	let navigation = url, files = [picture, audio];
	vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ name: navigation }] : files.map(name => ({ name })) });
	expect(snapshotDouyinPlayer()).toMatchObject({ url, info: { mediaUrl: picture, audioUrl: audio, video: true } });
	files = [picture, audio, audio + '&ds=2']; expect(snapshotDouyinPlayer()).toMatchObject({ info: { mediaUrl: picture, audioUrl: audio } });
	files = [picture, audio, audio.replace('/a/', '/preloaded/')]; expect(snapshotDouyinPlayer()).toEqual({ url });
	files = [picture, audio.replace('pair', 'other')]; expect(snapshotDouyinPlayer()).toEqual({ url });
	files = [picture, audio]; navigation = url.replace('123', '456'); expect(snapshotDouyinPlayer()).toEqual({ url });
	vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('reads plain mp4 renditions of one item even when the player was opened from the feed', () => {
	vi.stubGlobal('location', { href: url });
	document.body.innerHTML = '<video></video>';
	const video = document.querySelector('video')!;
	Object.defineProperty(video, 'currentSrc', { value: 'blob:https://www.douyin.com/stream' });
	Object.defineProperty(video, 'duration', { value: 899.24 });
	vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 } as DOMRect);
	const rendition = (rate: number, group = 'one') => `https://v11-weba.douyinvod.com/video/tos/x?mime_type=video_mp4&br=${rate}&l=${group}`;
	let files = [rendition(896), rendition(189)];
	vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ name: 'https://www.douyin.com/jingxuan' }] : files.map(name => ({ name })) });
	expect(snapshotDouyinPlayer()).toMatchObject({ url, observed: true, info: { mediaUrl: rendition(189), seconds: 899.24 } });
	files = [rendition(896), rendition(189, 'preloaded')]; expect(snapshotDouyinPlayer()).toMatchObject({ observed: true, candidates: [rendition(896), rendition(189, 'preloaded')] });
	vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('validates separate track durations and rejects a changed page or mismatched preload before showing it', async () => {
	vi.stubGlobal('location', { href: url });
	const nodes: HTMLMediaElement[] = [], create = document.createElement.bind(document);
	vi.spyOn(document, 'createElement').mockImplementation((tag: string) => { const node = create(tag); if (tag === 'video' || tag === 'audio') nodes.push(node as HTMLMediaElement); return node; });
	vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
	const complete = (durations: number[]) => { nodes.splice(0).forEach((node, i) => { Object.defineProperty(node, 'duration', { value: durations[i] }); node.dispatchEvent(new Event('loadedmetadata')); }); };
	let done = validateDouyinTracks(url, mediaUrl, mediaUrl, 70.13); complete([70.13, 70.133]); expect(await done).toBe(true);
	done = validateDouyinTracks(url, mediaUrl, mediaUrl, 70.13); complete([83.7, 83.7]); expect(await done).toBe(false);
	done = validateDouyinTracks(url, mediaUrl, mediaUrl, 70.13); vi.stubGlobal('location', { href: url.replace('123', '456') }); complete([70.13, 70.13]); expect(await done).toBe(false);
	vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('keeps the injected page functions free of async syntax, which the build turns into helpers missing in the page', () => {
	for (const injected of [snapshotDouyinPlayer, validateDouyinTracks]) expect(String(injected)).not.toMatch(/\basync\b|\bawait\b|__awaiter|_asyncToGenerator/);
});
