// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());
const network = vi.hoisted(() => vi.fn());
vi.mock('./x-setup-network', () => ({ checkXSetupConnection: network }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: send, getPlatformInfo: async () => ({ os: 'win', arch: 'x86-64' }) } } }));
import { openXSetup } from './x-setup-view';
import { xInstaller, X_HELPER_RELEASE } from './x-setup-release';
import { xSetupProblem } from './x-setup-state';
const ready = { ok: true, xSetup: 1, xArticles: 1, version: '1.16.11', grokAvailable: true, setupSupported: true };
const wasPublished = X_HELPER_RELEASE.published;
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)!;
const dismiss = () => (document.querySelector('[data-x-setup-close]') as HTMLButtonElement)?.click();
const setup = async (resume?: () => void, problem?: 'helper' | 'grok' | 'login') => {
	await openXSetup(resume, problem); button('检查连接并设置').click(); await vi.advanceTimersByTimeAsync(1);
};
beforeEach(() => {
	vi.useFakeTimers(); send.mockReset(); send.mockResolvedValue(ready); X_HELPER_RELEASE.published = false;
	network.mockReset(); network.mockResolvedValue(true);
	Object.defineProperty(document, 'hidden', { value: false, configurable: true });
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { dismiss(); vi.useRealTimers(); document.body.replaceChildren(); X_HELPER_RELEASE.published = wasPublished; });
it('starts with conditions and sizes, with no network, helper polling or downloads until chosen', async () => {
	await openXSetup(); await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event('focus'));
	expect(document.body.textContent).toContain('首次最多约 171 MB');
	expect(document.body.textContent).toContain('暂不启用不影响其他功能');
	expect(network).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
	button('暂不启用').click(); expect(document.querySelector('dialog')).toBeNull();
});
it('keeps an unreachable service optional and does not offer or start a download', async () => {
	network.mockResolvedValue(false); await setup();
	expect(document.body.textContent).toContain('暂时无法连接 Grok');
	expect(send).not.toHaveBeenCalled();
	expect(button('下载 X 阅读组件（约 155 MB）').hidden).toBe(true);
	network.mockResolvedValue(true); button('检查连接并设置').click(); await vi.advanceTimersByTimeAsync(1);
	expect(document.body.textContent).toContain('本地助手已连接：1.16.11');
});
it('detects installation after returning from installer and never links to an unshipped version', async () => {
	send.mockResolvedValue({ ok: false, error: 'native host not found' });
	await setup();
	expect(document.body.textContent).toContain('qiaomu-clipper-helper-windows-x64.exe');
	expect(document.querySelector('a.qm-x-setup-primary')?.hasAttribute('hidden')).toBe(true);
	send.mockResolvedValue(ready); window.dispatchEvent(new Event('focus'));
	await vi.advanceTimersByTimeAsync(1);
	expect(document.body.textContent).toContain('本地助手已连接：1.16.11');
	button('关闭').click(); const calls = send.mock.calls.length;
	await vi.advanceTimersByTimeAsync(5000); expect(send).toHaveBeenCalledTimes(calls);
	expect(X_HELPER_RELEASE.published).toBe(false); expect(xInstaller('linux', 'x86-64')).toBeUndefined();
});
it('requires browser login when expired and resumes the original request only after success', async () => {
	const resume = vi.fn();
	send.mockImplementation(async r => r.action === 'xSetupPoll' ? { ok: true, state: 'ready', operation: 'login' } : ready);
	await setup(resume, 'login'); expect(button('继续原来的请求').disabled).toBe(true);
	button('在浏览器登录 Grok').click(); await vi.advanceTimersByTimeAsync(2);
	expect(button('继续原来的请求').disabled).toBe(false);
	button('继续原来的请求').click(); expect(resume).toHaveBeenCalledOnce();
});
it('closing while start is in flight cancels again after the start response and never leaves timers', async () => {
	let finish!: (reply: any) => void;
	send.mockImplementation(r => r.action === 'xSetupStart' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(ready));
	await setup(); button('在浏览器登录 Grok').click(); button('关闭').click();
	finish({ ok: true }); await vi.advanceTimersByTimeAsync(10);
	expect(send.mock.calls.filter(([m]) => m.action === 'xSetupCancel')).toHaveLength(2);
	expect(vi.getTimerCount()).toBe(0);
});
it('reports download failure and offers retry without asking to reinstall a working helper', async () => {
	const state = { ...ready, grokAvailable: false };
	send.mockImplementation(async r => r.action === 'xSetupPoll' ? { ok: true, state: 'failed', error: 'setup-integrity-failed' } : state);
	await setup(); button('下载 X 阅读组件（约 155 MB）').click(); await vi.advanceTimersByTimeAsync(2);
	expect(document.body.textContent).toContain('下载校验失败'); expect(button('下载 X 阅读组件（约 155 MB）').disabled).toBe(false);
	expect(document.querySelector('a.qm-x-setup-primary')?.hasAttribute('hidden')).toBe(true);
});
it('classifies setup failures without turning incomplete X content into an installation problem', () => {
	expect(xSetupProblem(new Error('grok-login-required'))).toBe('login');
	expect(xSetupProblem(new Error('grok-missing'))).toBe('grok');
	expect(xSetupProblem(new Error('x-source-unverified'))).toBeUndefined();
});
it('published downloads always point at the versioned platform asset, never latest', () => {
	X_HELPER_RELEASE.published = true;
	expect(xInstaller('mac', 'arm')?.url).toContain('/releases/download/helper-v1.16.13/qiaomu-clipper-helper.pkg');
	expect(xInstaller('win', 'arm')?.url).toContain('windows-arm64.exe');
	expect(xInstaller('win', 'x86-32')).toBeUndefined();
});
