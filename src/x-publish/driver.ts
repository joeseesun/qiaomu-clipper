import browser from '../utils/browser-polyfill';
import { t } from '../utils/ui-text';

export const PORT_NAME = 'qiaomu-write-x';
export const COMPOSE_URL = 'https://x.com/compose/articles';

// Finding the X tab, injecting the editor engine and connecting to it. Shared by the writer page and the Obsidian hand-off.
export async function waitComplete(tabId: number, timeoutMs = 30000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const tab = await browser.tabs.get(tabId);
		if (tab.status === 'complete') return;
		await new Promise(resolve => setTimeout(resolve, 300));
	}
	throw new Error(t('X 页面加载太慢，请检查网络后重试'));
}

export async function openComposeTab(): Promise<number> {
	const existing = await browser.tabs.query({ url: ['https://x.com/compose/articles*', 'https://twitter.com/compose/articles*'] });
	const tab = existing.sort((a, b) => Number((b as { lastAccessed?: number }).lastAccessed ?? 0) - Number((a as { lastAccessed?: number }).lastAccessed ?? 0))[0];
	if (tab?.id) {
		await browser.tabs.update(tab.id, { active: true });
		if (tab.windowId) await browser.windows.update(tab.windowId, { focused: true });
		return tab.id;
	}
	const created = await browser.tabs.create({ url: COMPOSE_URL, active: true });
	await waitComplete(created.id!);
	return created.id!;
}

export async function injectEngine(tabId: number): Promise<void> {
	await browser.scripting.executeScript({ target: { tabId }, files: ['x-publish-main.js'], world: 'MAIN' as never });
	await browser.scripting.executeScript({ target: { tabId }, files: ['x-publish-content.js'] });
}

export async function connect(tabId: number): Promise<ReturnType<typeof browser.tabs.connect>> {
	for (let attempt = 0; attempt < 12; attempt++) {
		const port = browser.tabs.connect(tabId, { name: PORT_NAME });
		const alive = await new Promise<{ route?: boolean } | null>(resolve => {
			const timer = setTimeout(() => resolve(null), 700);
			port.onMessage.addListener((message: any) => { if (message?.type === 'pong') { clearTimeout(timer); resolve(message); } });
			port.onDisconnect.addListener(() => { clearTimeout(timer); resolve(null); });
			try { port.postMessage({ type: 'ping' }); } catch { resolve(null); }
		});
		if (alive) {
			if (!alive.route) { port.disconnect(); throw new Error(t('X 没有打开文章页。请先登录 X（需要 Premium），再试一次')); }
			return port;
		}
		port.disconnect();
		await new Promise(resolve => setTimeout(resolve, 400));
	}
	throw new Error(t('连不上 X 页面，请刷新 X 标签页后重试'));
}

