import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import { submitQiaomuClip, validateQiaomuClip } from './qiaomu-rss';
const clip = { url: 'https://example.com/article', title: 'A clip', markdown: 'Selected **text**' };
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accepted: true, sourceId: 'user-submitted', entryId: 'one' })))); });
afterEach(() => { vi.useRealTimers(); });
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
		vi.useFakeTimers();
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));
		const pending = submitQiaomuClip(clip);
		await vi.runAllTimersAsync();
		expect((await pending).error).toContain('网络连接失败');
	});
	it('recovers a transient connection failure using the same payload and device', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
		const pending = submitQiaomuClip(clip);
		await vi.runAllTimersAsync();
		expect((await pending).accepted).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(2);
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
		expect(calls[1][1]?.headers).toEqual(calls[0][1]?.headers);
	});
	it('accepts a slow connection without aborting it at fifteen seconds', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((resolve, reject) => {
			options?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
			setTimeout(() => resolve(new Response(JSON.stringify({ accepted: true, sourceId: 'user-submitted', entryId: 'slow' }))), 20000);
		}));
		const pending = submitQiaomuClip(clip);
		await vi.advanceTimersByTimeAsync(20000);
		expect((await pending).accepted).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('does not label malformed server replies as a network failure or retry them', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Unexpected reply</html>'));
		expect((await submitQiaomuClip(clip)).error).toContain('结果无效');
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('bounds offline retries to two attempts', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
		const pending = submitQiaomuClip(clip);
		await vi.runAllTimersAsync();
		expect((await pending).error).toContain('网络连接失败');
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('retries a connection lost while reading the acknowledgement', async () => {
		vi.useFakeTimers();
		const interrupted = new Response('{}');
		vi.spyOn(interrupted, 'json').mockRejectedValueOnce(new TypeError('Connection terminated'));
		vi.mocked(fetch).mockResolvedValueOnce(interrupted);
		const pending = submitQiaomuClip(clip);
		await vi.runAllTimersAsync();
		expect((await pending).accepted).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('retries a gateway outage but does not retry rejected or rate-limited submissions', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }));
		const pending = submitQiaomuClip(clip);
		await vi.runAllTimersAsync();
		expect((await pending).accepted).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(2);
		for (const status of [400, 403, 429]) {
			vi.mocked(fetch).mockClear().mockResolvedValueOnce(new Response('', { status }));
			expect((await submitQiaomuClip(clip)).error).toBeTruthy();
			expect(fetch).toHaveBeenCalledTimes(1);
		}
	});
	it('uses a fresh signal on timeout retry and explains an exhausted timeout', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
			options?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
		}));
		const pending = submitQiaomuClip(clip);
		await vi.runAllTimersAsync();
		expect((await pending).error).toContain('连接超时');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(vi.mocked(fetch).mock.calls[1][1]?.signal).not.toBe(vi.mocked(fetch).mock.calls[0][1]?.signal);
		expect(vi.getTimerCount()).toBe(0);
	});
});
