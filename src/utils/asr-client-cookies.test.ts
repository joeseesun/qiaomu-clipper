import { expect, it, vi } from 'vitest';
const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: send } } }));
import { asrProbe, asrStart, useWebCookies } from './asr-client';
it('keeps explicit browser permission scoped to the item and carries it into subtitle generation', async () => {
	await asrProbe('https://www.douyin.com/video/123'); expect(send).toHaveBeenLastCalledWith({ action: 'qiaomuAsr', payload: { mode: 'probe', url: 'https://www.douyin.com/video/123' } });
	useWebCookies('web:aaaaaaaaaaaa', 'firefox');
	await asrStart('web:aaaaaaaaaaaa'); expect(send.mock.lastCall![0].payload.cookies).toBe('firefox');
	await asrStart('web:bbbbbbbbbbbb'); expect(send.mock.lastCall![0].payload).not.toHaveProperty('cookies');
});
