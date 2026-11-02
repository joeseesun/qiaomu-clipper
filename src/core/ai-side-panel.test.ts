// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
	const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
	return { query: vi.fn(), get: vi.fn(), activated: event(), updated: event(), removed: event(), changed: event() };
});
vi.mock('../utils/browser-polyfill', () => ({ default: {
	windows: { getCurrent: async () => ({ id: 7 }) },
	tabs: { query: state.query, get: state.get, onActivated: state.activated, onUpdated: state.updated, onRemoved: state.removed },
	storage: { onChanged: state.changed },
	runtime: { getURL: (path: string) => `https://extension.test/${path}` },
} }));
vi.mock('../utils/storage-utils', () => ({ loadSettings: async () => {} }));
vi.mock('../utils/i18n', () => ({ initializeI18n: async () => {} }));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const tab = { id: 10, windowId: 7, active: true, url: 'https://example.com/a', status: 'complete' };
beforeEach(() => {
	vi.resetModules(); vi.clearAllMocks();
	history.replaceState(null, '', '/?tab=10');
	document.body.innerHTML = '<main id="ai-sidebar-root"></main>';
	state.query.mockResolvedValue([tab]);
	state.get.mockResolvedValue(tab);
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
const start = async () => { await import('./ai-side-panel'); await flush(); };
const update = (change: object) => state.updated.addListener.mock.calls[0][0](10, change, tab);

it('waits for navigation to complete before mounting the page conversation', async () => {
	state.query.mockResolvedValue([{ ...tab, status: 'loading' }]);
	state.get.mockResolvedValue({ ...tab, status: 'loading' });
	await start();
	expect(document.querySelector('iframe')).toBeNull();
	state.query.mockResolvedValue([tab]);
	state.get.mockResolvedValue(tab);
	update({ status: 'complete' }); await flush();
	expect(document.querySelector('iframe')).not.toBeNull();
});

it('keeps the mounted conversation on duplicate completion events', async () => {
	await start();
	const frame = document.querySelector('iframe');
	update({ status: 'complete' }); await flush();
	expect(document.querySelector('iframe')).toBe(frame);
});

it('disposes the child synchronously before navigation and removes browser listeners on close', async () => {
	await start();
	const frame = document.querySelector('iframe')!;
	const dispose = vi.fn(() => expect(frame.isConnected).toBe(true));
	frame.contentWindow!.addEventListener('qiaomu-ai-dispose', dispose);
	state.query.mockResolvedValue([{ ...tab, status: 'loading' }]);
	state.get.mockResolvedValue({ ...tab, status: 'loading' });
	update({ status: 'loading' });
	expect(dispose).toHaveBeenCalledTimes(1);
	expect(document.querySelector('iframe')).toBeNull();
	window.dispatchEvent(new Event('pagehide'));
	for (const event of [state.updated, state.removed, state.changed]) {
		expect(event.removeListener).toHaveBeenCalledWith(event.addListener.mock.calls[0][0]);
	}
	await flush();
	expect(document.querySelector('iframe')).toBeNull();
});

it('keeps its conversation when another tab is activated or navigates', async () => {
	await start();
	const frame = document.querySelector('iframe');
	state.query.mockResolvedValue([{ ...tab, id: 20, url: 'https://example.com/b' }]);
	for (const [activated] of state.activated.addListener.mock.calls) activated({ windowId: 7, tabId: 20 });
	state.updated.addListener.mock.calls[0][0](20, { status: 'complete' }, { ...tab, id: 20 });
	await flush();
	expect(document.querySelector('iframe')).toBe(frame);
	expect(frame!.src).toContain('tab=10');
});

it('ignores a superseded asynchronous lookup of its own tab', async () => {
	await start();
	let resolve!: (tab: object) => void;
	state.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
	update({ url: 'https://example.com/b' });
	state.get.mockResolvedValue({ ...tab, url: 'https://example.com/c' });
	update({ url: 'https://example.com/c' });
	await flush();
	resolve({ ...tab, url: 'https://example.com/b' }); await flush();
	expect(document.querySelector('iframe')!.src).toContain(encodeURIComponent('https://example.com/c'));
});

it('never falls back to following the active tab without an owner', async () => {
	history.replaceState(null, '', '/');
	await start();
	expect(document.querySelector('iframe')).toBeNull();
});

it('disposes only when its owning tab closes', async () => {
	await start();
	const frame = document.querySelector('iframe');
	state.removed.addListener.mock.calls[0][0](20); await flush();
	expect(document.querySelector('iframe')).toBe(frame);
	state.removed.addListener.mock.calls[0][0](10); await flush();
	expect(document.querySelector('iframe')).toBeNull();
});
