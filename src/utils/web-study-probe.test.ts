// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { probeDouyinPage, probeWebStudy } from './web-study-probe';
vi.mock('./asr-client', () => ({ asrProbe: vi.fn(), thisBrowser: () => 'chrome' }));
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
it('reads anonymously first and lends the selected browser only on a click, with recoverable retries', async () => {
	const status = document.createElement('p'), holder = document.createElement('div'); document.body.replaceChildren(status, holder);
	const success = { ok: true, title: 'Video', mediaUrl: 'https://cdn.example/a.mp4', video: true };
	const probe = vi.fn().mockResolvedValueOnce({ ok: false, error: 'needs-cookies' }).mockResolvedValueOnce({ ok: false, error: 'needs-cookies' }).mockResolvedValueOnce(success);
	const done = probeWebStudy('https://www.douyin.com/video/123', status, holder, probe);
	await settle(); expect(probe).toHaveBeenCalledTimes(1); expect(probe).toHaveBeenLastCalledWith('https://www.douyin.com/video/123');
	const button = holder.querySelector('button')!, select = holder.querySelector('select')!; select.value = 'firefox';
	button.click(); await settle(); expect(probe).toHaveBeenLastCalledWith('https://www.douyin.com/video/123', 'firefox');
	expect(status.textContent).toContain('仍失败'); expect(button.disabled).toBe(false);
	button.click(); expect(await done).toEqual({ info: success, cookies: 'firefox' }); expect(holder.children.length).toBe(0);
});
it('does not offer browser access for ordinary failures', async () => {
	const holder = document.createElement('div'), info = { ok: false as const, error: 'unsupported' };
	expect(await probeWebStudy('https://example.com', document.createElement('p'), holder, vi.fn().mockResolvedValue(info))).toEqual({ info });
	expect(holder.children.length).toBe(0);
});
it('recovers a Douyin player that loads late without any cookie request', async () => {
	const status = document.createElement('p'), holder = document.createElement('div'); document.body.replaceChildren(status, holder);
	const info = { ok: true as const, title: 'Video', author: '', site: '抖音', seconds: 30, thumbnail: null, mediaUrl: 'https://v11.douyinvod.com/a', video: true };
	const read = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Not ready')).mockResolvedValueOnce(info);
	const done = probeDouyinPage('https://www.douyin.com/video/123', status, holder, read, 0); await settle();
	expect(holder.querySelector('select')).toBeNull(); expect(holder.textContent).not.toContain('Cookie');
	const button = holder.querySelector('button')!; button.click(); await settle();
	expect(holder.textContent).toContain('还是没读到'); expect(button.disabled).toBe(false);
	button.click(); expect(await done).toEqual({ info }); expect(read).toHaveBeenCalledTimes(3); expect(holder.children).toHaveLength(0);
});
it('uses an already loaded Douyin player immediately', async () => {
	const holder = document.createElement('div'), info = { ok: true as const, title: 'Video' };
	expect(await probeDouyinPage('https://www.douyin.com/video/123', document.createElement('p'), holder, vi.fn().mockResolvedValue(info), 0)).toEqual({ info });
	expect(holder.children).toHaveLength(0);
});
