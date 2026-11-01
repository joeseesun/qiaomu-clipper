import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { initializeI18n } from '../utils/i18n';
import { t } from '../utils/ui-text';

async function start() {
	const root = document.getElementById('ai-sidebar-root')!;
	const owner = new URLSearchParams(location.search).get('tab');
	// Never turn an unbound/legacy window panel into an active-tab follower.
	if (!owner || !/^\d+$/.test(owner)) return;
	const tabId = Number(owner);
	if (!Number.isSafeInteger(tabId)) return;
	let disposed = false, generation = 0;
	let mountedPage = '';
	const cleanup: Array<() => void> = [];
	function clearPage() {
		// Removing an iframe does not reliably dispatch pagehide in every browser.
		// Both documents are extension-owned; abort work before detaching the child.
		root.querySelector('iframe')?.contentWindow?.dispatchEvent(new Event('qiaomu-ai-dispose'));
		root.replaceChildren();
		mountedPage = '';
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		generation++;
		clearPage();
		cleanup.forEach(remove => remove());
		window.removeEventListener('pagehide', dispose);
	}
	window.addEventListener('pagehide', dispose);
	await loadSettings();
	await initializeI18n();
	if (disposed) return;

	async function follow(invalidate = true) {
		if (disposed) return;
		const request = ++generation;
		if (invalidate) clearPage();
		try {
			const tab = await browser.tabs.get(tabId);
			if (disposed || request !== generation) return;
			if (tab.id !== tabId || tab.status === 'loading') { clearPage(); return; }
			const page = JSON.stringify([tab.id, tab.url || '']);
			if (page === mountedPage) return;
			clearPage();
			const frame = document.createElement('iframe');
			frame.title = t('AI 对话');
			const query = new URLSearchParams({ tab: String(tabId), url: tab.url || '', window: String(tab.windowId) });
			frame.src = browser.runtime.getURL('ai-chat-page.html?' + query);
			mountedPage = page;
			root.replaceChildren(frame);
		} catch {
			if (!disposed && request === generation) clearPage();
		}
	}
	const updated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (id, change, tab) => {
		if (id !== tabId) return;
		if (change.url !== undefined || change.status === 'loading') void follow();
		else if (change.status === 'complete') void follow(false);
	};
	const removed: Parameters<typeof browser.tabs.onRemoved.addListener>[0] = id => {
		if (id === tabId) dispose();
	};
	const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
		if (area === 'sync' && changes.general_settings) void follow();
	};
	const message = (event: MessageEvent) => {
		const frame = root.querySelector('iframe');
		if (event.source === frame?.contentWindow && event.origin === location.origin && event.data === 'close-ai-sidebar') {
			dispose();
			window.close();
		}
	};
	browser.tabs.onUpdated.addListener(updated);
	browser.tabs.onRemoved.addListener(removed);
	browser.storage.onChanged.addListener(changed);
	window.addEventListener('message', message);
	cleanup.push(
		() => browser.tabs.onUpdated.removeListener(updated),
		() => browser.tabs.onRemoved.removeListener(removed),
		() => browser.storage.onChanged.removeListener(changed),
		() => window.removeEventListener('message', message),
	);
	await follow();
}
void start();
