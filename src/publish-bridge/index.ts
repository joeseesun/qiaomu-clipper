import browser from '../utils/browser-polyfill';
import { BridgeClient } from './client';
import { parseHandoff, TARGET_HOSTS, type PublishTargetId } from './protocol';
import { scrubFragment } from './relay';
import { runXJob } from './x';
import { runXhsJob } from './xhs';
import { runZhihuJob } from './zhihu';

const handled = new Set<string>();

async function runHandoff(tabId: number, target: PublishTargetId, client: BridgeClient): Promise<void> {
	let job;
	try { job = await client.fetchJob(); } catch (error) { console.warn('[qiaomu publish]', (error as Error).message); return; }
	await scrubFragment(tabId);
	if (job.target !== target) { await client.status({ state: 'error', error: { code: 'wrong-page', message: '打开的网页和要发布的平台对不上，请重新发布。' } }); return; }
	void browser.tabs.update(tabId, { active: true }).catch(() => {});
	if (target === 'x') await runXJob(tabId, job, client);
	else if (target === 'zhihu') await runZhihuJob(tabId, job, client);
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
		const parsed = parseHandoff(changeInfo.url ?? tab.url);
		if (!parsed || handled.has(parsed.handoff.token)) return;
		handled.add(parsed.handoff.token);
		void runHandoff(tabId, parsed.target, new BridgeClient(parsed.handoff));
	});
}

export { TARGET_HOSTS };
