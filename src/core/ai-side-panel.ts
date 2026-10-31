import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { initializeI18n } from '../utils/i18n';
import { t } from '../utils/ui-text';

async function start() {
	const root = document.getElementById('ai-sidebar-root')!;
	let disposed = false, generation = 0, activeId: number | undefined;
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
	const ownWindow = await browser.windows.getCurrent();
	if (disposed) return;

	async function follow(invalidate = true) {
		if (disposed) return;
		const request = ++generation;
		if (invalidate) clearPage();
		try {
			const [tab] = await browser.tabs.query({ active: true, windowId: ownWindow.id });
			if (disposed || request !== generation) return;
			activeId = tab?.id;
			if (tab?.id === undefined || tab.status === 'loading') { clearPage(); return; }
			const page = JSON.stringify([tab.id, tab.url || '']);
			if (page === mountedPage) return;
			clearPage();
			const frame = document.createElement('iframe');
			frame.title = t('AI 对话');
			const query = new URLSearchParams({ tab: String(tab.id), url: tab.url || '', window: String(ownWindow.id) });
			frame.src = browser.runtime.getURL('ai-chat-page.html?' + query);
			mountedPage = page;
			root.replaceChildren(frame);
		} catch {
			if (!disposed && request === generation) clearPage();
		}
	}
	const activated: Parameters<typeof browser.tabs.onActivated.addListener>[0] = info => {
		if (info.windowId === ownWindow.id) { activeId = info.tabId; void follow(); }
	};
	const updated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (id, change, tab) => {
		if (id !== activeId && !(tab.active && tab.windowId === ownWindow.id)) return;
		if (change.url !== undefined || change.status === 'loading') void follow();
		else if (change.status === 'complete') void follow(false);
	};
	const removed: Parameters<typeof browser.tabs.onRemoved.addListener>[0] = id => {
		if (id === activeId) { activeId = undefined; void follow(); }
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
	browser.tabs.onActivated.addListener(activated);
	browser.tabs.onUpdated.addListener(updated);
	browser.tabs.onRemoved.addListener(removed);
	browser.storage.onChanged.addListener(changed);
	window.addEventListener('message', message);
	cleanup.push(
		() => browser.tabs.onActivated.removeListener(activated),
		() => browser.tabs.onUpdated.removeListener(updated),
		() => browser.tabs.onRemoved.removeListener(removed),
		() => browser.storage.onChanged.removeListener(changed),
		() => window.removeEventListener('message', message),
	);
	await follow();
}
void start();
