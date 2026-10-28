import { afterEach, expect, it, vi } from 'vitest';
import { checkXSetupConnection } from './x-setup-network';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('checks only the fixed public endpoint, without cookies or component bodies', async () => {
	const fetcher = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetcher);
	expect(await checkXSetupConnection(new AbortController().signal)).toBe(true);
	expect(fetcher).toHaveBeenCalledWith('https://x.ai/cli/stable', expect.objectContaining({ method: 'HEAD', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }));
	fetcher.mockResolvedValue({ ok: false }); expect(await checkXSetupConnection(new AbortController().signal)).toBe(false);
});
it('bounds a stalled connection and cancels immediately when the dialog closes', async () => {
	vi.useFakeTimers();
	vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
		options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	})));
	const request = checkXSetupConnection(new AbortController().signal);
	await vi.advanceTimersByTimeAsync(10_000); expect(await request).toBe(false); expect(vi.getTimerCount()).toBe(0);
	const controller = new AbortController(), closed = checkXSetupConnection(controller.signal);
	controller.abort(); expect(await closed).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
