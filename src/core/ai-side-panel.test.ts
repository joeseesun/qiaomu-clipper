// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
	const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
	return { query: vi.fn(), activated: event(), updated: event(), removed: event(), changed: event() };
});
vi.mock('../utils/browser-polyfill', () => ({ default: {
	windows: { getCurrent: async () => ({ id: 7 }) },
	tabs: { query: state.query, onActivated: state.activated, onUpdated: state.updated, onRemoved: state.removed },
	storage: { onChanged: state.changed },
	runtime: { getURL: (path: string) => `https://extension.test/${path}` },
} }));
vi.mock('../utils/storage-utils', () => ({ loadSettings: async () => {} }));
vi.mock('../utils/i18n', () => ({ initializeI18n: async () => {} }));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const tab = { id: 10, windowId: 7, active: true, url: 'https://example.com/a', status: 'complete' };
beforeEach(() => {
	vi.resetModules(); vi.clearAllMocks();
	document.body.innerHTML = '<main id="ai-sidebar-root"></main>';
	state.query.mockResolvedValue([tab]);
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
const start = async () => { await import('./ai-side-panel'); await flush(); };
const update = (change: object) => state.updated.addListener.mock.calls[0][0](10, change, tab);

it('waits for navigation to complete before mounting the page conversation', async () => {
	state.query.mockResolvedValue([{ ...tab, status: 'loading' }]);
	await start();
	expect(document.querySelector('iframe')).toBeNull();
	state.query.mockResolvedValue([tab]);
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
	update({ status: 'loading' });
	expect(dispose).toHaveBeenCalledTimes(1);
	expect(document.querySelector('iframe')).toBeNull();
	window.dispatchEvent(new Event('pagehide'));
	for (const event of [state.activated, state.updated, state.removed, state.changed]) {
		expect(event.removeListener).toHaveBeenCalledWith(event.addListener.mock.calls[0][0]);
	}
	await flush();
	expect(document.querySelector('iframe')).toBeNull();
});

it('ignores a superseded asynchronous tab lookup', async () => {
	await start();
	let resolve!: (tabs: object[]) => void;
	state.query.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
	state.activated.addListener.mock.calls[0][0]({ windowId: 7, tabId: 20 });
	state.query.mockResolvedValue([{ ...tab, id: 30, url: 'https://example.com/c' }]);
	state.activated.addListener.mock.calls[0][0]({ windowId: 7, tabId: 30 });
	await flush();
	resolve([{ ...tab, id: 20, url: 'https://example.com/b' }]); await flush();
	expect(document.querySelector('iframe')!.src).toContain('tab=30');
});
