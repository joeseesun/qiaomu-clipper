import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import { submitQiaomuClip, validateQiaomuClip } from './qiaomu-rss';
const clip = { url: 'https://example.com/article', title: 'A clip', markdown: 'Selected **text**' };
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accepted: true, sourceId: 'user-submitted', entryId: 'one' })))); });
describe('Qiaomu anonymous RSS submission', () => {
	it('submits from the installed client without cookies or a website login', async () => {
		expect((await submitQiaomuClip(clip)).accepted).toBe(true);
		expect(fetch).toHaveBeenCalledWith('https://rss.qiaomu.ai/api/clipper/clips', expect.objectContaining({ credentials: 'omit', body: JSON.stringify(clip), headers: expect.objectContaining({ 'X-Qiaomu-Client': 'web-clipper', 'X-Qiaomu-Submission-Version': '2', 'X-Qiaomu-Device': expect.stringMatching(/^[a-f0-9-]{36}$/) }) }));
	});
	it('rejects invalid clipping before any network request', async () => {
		for (const url of ['file:///secret', 'javascript:alert(1)', 'https://user:password@example.com']) expect(() => validateQiaomuClip({ ...clip, url })).toThrow();
		await expect(submitQiaomuClip({ ...clip, markdown: '' })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
	});
	it('includes the extracted page cover with a selected-text clip', async () => {
		const payload = { ...clip, image: 'https://example.com/cover.jpg' };
		await submitQiaomuClip(payload);
		expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify(payload) }));
	});
	it('handles rate limits and network failure with retry messages', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('', { status: 429 })); expect((await submitQiaomuClip(clip)).error).toContain('过于频繁');
		vi.mocked(fetch).mockRejectedValue(new Error('offline')); expect((await submitQiaomuClip(clip)).error).toContain('网络连接失败');
	});
});
