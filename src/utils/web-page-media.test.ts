// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { getWebPageMedia, isDouyinMedia, readPageMedia } from './web-page-media';
const url = 'https://www.douyin.com/video/123', mediaUrl = 'https://v11-weba.douyinvod.com/video/123/?signature=x';
it('reads the current player without cookies and accepts only HTTPS media on Douyin’s CDN', () => {
	document.body.innerHTML = '<h1>科普动画</h1><video></video>';
	const video = document.querySelector('video')!;
	Object.defineProperty(video, 'currentSrc', { configurable: true, value: mediaUrl });
	Object.defineProperty(video, 'duration', { value: 261.247 });
	expect(readPageMedia(document, url, video)).toMatchObject({ mediaUrl, seconds: 261.247, title: '科普动画', video: true });
	for (const bad of ['http://v11.douyinvod.com/a', 'https://douyinvod.com.evil.org/a', 'https://user:pw@v11.douyinvod.com/a', 'https://127.0.0.1/a', 'https://v11.douyinvod.com:8080/a', 'blob:https://www.douyin.com/x']) expect(isDouyinMedia(url, bad)).toBe(false);
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
