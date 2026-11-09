import browser from '../utils/browser-polyfill';
import { BridgeClient } from './client';
import { parseHandoff, TARGET_HOSTS, type PublishTargetId } from './protocol';
import { waitForTab } from './relay';
import { runXJob } from './x';
import { runWeiboJob } from './weibo';
import { runWeiboArticleJob } from './weibo-article';
import { runXhsJob } from './xhs';
import { runZhihuJob } from './zhihu';

const handled = new Set<string>();

async function runHandoff(tabId: number, target: PublishTargetId, address: string, client: BridgeClient): Promise<void> {
	let job;
	try { job = await client.fetchJob(); } catch (error) { console.warn('[qiaomu publish]', (error as Error).message); return; }
	if (job.target !== target) { await client.status({ state: 'error', error: { code: 'wrong-page', message: '打开的网页和要发布的平台对不上，请重新发布。' } }); return; }
	await client.status({ state: 'running', text: '正在打开发布页…' });
	try {
		if (!client.cancelled) {
			const source = await browser.tabs.get(tabId);
			if ((source.pendingUrl || source.url) !== address) throw new Error('发布页已离开');
			const cleanUrl = new URL(address);
			cleanUrl.hash = '';
			// Navigate to a clean document instead of calling replaceState during the site's startup.
			await browser.tabs.update(tabId, { url: cleanUrl.href });
			const ready = await waitForTab(tabId, 30000, address);
			const destination = new URL(ready.url ?? '');
			if (destination.protocol !== 'https:' || !TARGET_HOSTS[target].includes(destination.hostname) ||
				destination.pathname.replace(/\/$/, '') !== cleanUrl.pathname.replace(/\/$/, '') || destination.hash.startsWith('#qp=')) {
				throw new Error('打开的网页和要发布的平台对不上');
			}
		}
	} catch {
		await client.status({ state: 'error', error: { code: 'navigation-failed', message: '发布页未能打开，请回到 Obsidian 重新发布。' } });
		return;
	}
	// Check for a stop request made while the editor was loading before dispatching.
	if (!client.cancelled) await client.status({ state: 'running' });
	if (client.cancelled) { await client.status({ state: 'cancelled', text: '已停止' }); return; }
	void browser.tabs.update(tabId, { active: true }).catch(() => {});
	if (target === 'x') await runXJob(tabId, job, client);
	else if (target === 'zhihu') await runZhihuJob(tabId, job, client);
	else if (target === 'weibo') await runWeiboJob(tabId, job, client);
	else if (target === 'weibo-article') await runWeiboArticleJob(tabId, job, client);
	else await runXhsJob(tabId, job, client);
}

/**
 * Obsidian (the Qiaomu Publish plugin) opens a platform's editor page with `#qp=<port>.<token>`. Seeing that, this fetches the
 * article from the plugin's one-job loopback server and writes it into the page. Nothing here listens on a port.
 */
export function registerPublishBridge(): void {
	if (!browser.tabs?.onUpdated || !browser.scripting) return;
	browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		if (!changeInfo.url && !changeInfo.status) return;
		const address = changeInfo.url ?? tab.pendingUrl ?? tab.url;
		if (!address) return;
		const parsed = parseHandoff(address);
		if (!parsed || handled.has(parsed.handoff.token)) return;
		handled.add(parsed.handoff.token);
		void runHandoff(tabId, parsed.target, address, new BridgeClient(parsed.handoff));
	});
}

export { TARGET_HOSTS };
