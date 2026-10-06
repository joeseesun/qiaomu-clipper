// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { probeWebStudy } from './web-study-probe';
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
