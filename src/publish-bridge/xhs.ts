import type { BridgeClient } from './client';
import type { BridgeJob } from './protocol';
import { connectToPage, finalStatus, relayPort, scrubFragment, sendAssets, waitForTab } from './relay';
import browser from '../utils/browser-polyfill';

export const XHS_PORT = 'qiaomu-publish-xhs';
export const XHS_SCRIPT = 'xhs-publish-content.js';
export const XHS_CARD_SCHEME = 'qp-asset://';

/** Fills the Xiaohongshu creator page with the cards, title, body and topics. The person reviews and presses publish. */
export async function runXhsJob(tabId: number, job: BridgeJob, client: BridgeClient): Promise<void> {
	const cards = job.content.cards ?? [];
	if (!cards.length) { await client.status({ state: 'error', error: { message: '没有可上传的图文卡片' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开小红书创作平台…' });
		await waitForTab(tabId);
		await scrubFragment(tabId);
		await browser.scripting.executeScript({ target: { tabId }, files: [XHS_SCRIPT] });
		const port = await connectToPage(tabId, XHS_PORT, '这个标签页不是小红书发布页，请先登录小红书创作平台');
		const result = await relayPort(port, client, async post => {
			const wanted = job.assets.filter(asset => cards.includes(asset.id)).sort((a, b) => cards.indexOf(a.id) - cards.indexOf(b.id));
			await sendAssets(client, wanted, post, asset => `${XHS_CARD_SCHEME}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', title: job.title, text: job.content.text ?? '', topics: job.content.topics ?? [], cards: cards.map(id => `${XHS_CARD_SCHEME}${id}`) });
		});
		await client.status(finalStatus(result, '已预填到小红书，请检查后点「发布」或「暂存离开」。', '没能写入小红书'));
		try { port.disconnect(); } catch { /* done */ }
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) await client.status({ state: 'cancelled', text: '已停止' });
		else await client.status({ state: 'error', error: { message: (error as Error).message || String(error) } });
	}
}
