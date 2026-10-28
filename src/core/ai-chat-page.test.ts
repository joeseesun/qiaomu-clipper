// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
	query: vi.fn(), execute: vi.fn(), load: vi.fn(), mount: vi.fn(), sessionGet: vi.fn(), sessionRemove: vi.fn(), changed: vi.fn(), removed: vi.fn(),
	chat: { toggle: vi.fn(), quote: vi.fn(), destroy: vi.fn() },
}));
vi.mock('../utils/browser-polyfill', () => ({ default: {
	tabs: { query: state.query }, scripting: { executeScript: state.execute },
	storage: { session: { get: state.sessionGet, remove: state.sessionRemove }, onChanged: { addListener: state.changed, removeListener: state.removed } },
} }));
vi.mock('../utils/storage-utils', () => ({ loadSettings: state.load }));
vi.mock('../utils/i18n', () => ({
	initializeI18n: async () => {}, translatePage: async () => {},
}));
vi.mock('../utils/clip-chat', () => ({ mountClipChat: state.mount }));
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const url = 'https://example.com/a';
const result = (page = url, documentId = 'doc-a') => [{
	documentId, result: { url: page, title: 'A', html: '', text: 'Page A evidence', selection: 'Quote A' },
}];
beforeEach(() => {
	vi.resetModules(); vi.clearAllMocks();
	history.replaceState(null, '', `/?tab=10&window=7&url=${encodeURIComponent(url)}`);
	document.body.innerHTML = '<strong id="ai-page-title"></strong><p id="ai-page-status"></p><button id="ai-page-quote"></button>';
	state.load.mockResolvedValue(undefined);
	state.sessionGet.mockResolvedValue({});
	state.sessionRemove.mockResolvedValue(undefined);
	state.query.mockResolvedValue([{ id: 10, url, status: 'complete' }]);
	state.execute.mockResolvedValue(result());
	state.mount.mockReturnValue(state.chat);
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
const start = async () => { await import('./ai-chat-page'); await flush(); };

it('does not treat a different snapshot URL as an unreadable current page', async () => {
	state.execute.mockResolvedValue(result('https://example.com/b'));
	await start();
	expect(state.mount).not.toHaveBeenCalled();
});
it('rejects same-URL document replacement before sending', async () => {
	await start();
	const options = state.mount.mock.calls[0][0];
	state.execute.mockResolvedValue(result(url, 'doc-reloaded'));
	await expect(options.prepareContext()).rejects.toThrow();
});
it('rejects a page that has started loading before sending', async () => {
	await start();
	state.query.mockResolvedValue([{ id: 10, url, status: 'loading' }]);
	await expect(state.mount.mock.calls[0][0].prepareContext()).rejects.toThrow();
});
it('disposes the mounted chat on synchronous frame removal', async () => {
	await start();
	window.dispatchEvent(new Event('qiaomu-ai-dispose'));
	expect(state.chat.destroy).toHaveBeenCalledTimes(1);
	await expect(state.mount.mock.calls[0][0].prepareContext()).rejects.toThrow();
});
it('cannot mount after disposal while settings are still loading', async () => {
	let resolve!: () => void;
	state.load.mockReturnValue(new Promise<void>(r => { resolve = r; }));
	await start();
	window.dispatchEvent(new Event('qiaomu-ai-dispose'));
	resolve(); await flush();
	expect(state.mount).not.toHaveBeenCalled();
});

it('quotes the toolbar selection only for its matching current page', async () => {
 state.sessionGet.mockImplementation(async (key: string) => key === 'qiaomuSelectionQuote:10' ? { [key]: { text: 'resilient', url, at: Date.now() } } : {});
 await start(); expect(state.chat.quote).toHaveBeenCalledWith('resilient');
 expect(state.sessionRemove).toHaveBeenCalledWith('qiaomuSelectionQuote:10');
});
it('ignores a stale or different-page selection', async () => {
 state.sessionGet.mockImplementation(async (key: string) => key === 'qiaomuSelectionQuote:10' ? { [key]: { text: 'private', url: 'https://example.com/other', at: Date.now() } } : {});
 await start(); expect(state.chat.quote).not.toHaveBeenCalled();
});
