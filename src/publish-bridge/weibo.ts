import type { BridgeClient } from './client';
import type { BridgeJob } from './protocol';
import { connectToPage, finalStatus, relayPort, sendAssets, waitForTab } from './relay';
import browser from '../utils/browser-polyfill';

export const WEIBO_PORT = 'qiaomu-publish-weibo';
export const WEIBO_SCRIPT = 'weibo-publish-content.js';
export const WEIBO_IMAGE_SCHEME = 'qp-asset://';

/** Fills the Weibo composer with the body, the #话题# topics and the pictures. The person reviews and presses 发送. */
export async function runWeiboJob(tabId: number, job: BridgeJob, client: BridgeClient): Promise<void> {
	const text = job.content.text ?? '';
	const images = job.content.images ?? [];
	if (!text.trim() && !images.length) { await client.status({ state: 'error', error: { message: '这条微博既没有正文也没有图片' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开微博…' });
		await waitForTab(tabId);
		await browser.scripting.executeScript({ target: { tabId }, files: [WEIBO_SCRIPT] });
		const port = await connectToPage(tabId, WEIBO_PORT, '这个标签页不是微博发布页，请先登录微博');
		const result = await relayPort(port, client, async post => {
			const wanted = job.assets.filter(asset => images.includes(asset.id)).sort((a, b) => images.indexOf(a.id) - images.indexOf(b.id));
			await sendAssets(client, wanted, post, asset => `${WEIBO_IMAGE_SCHEME}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', text, topics: job.content.topics ?? [], images: images.map(id => `${WEIBO_IMAGE_SCHEME}${id}`) });
		});
		await client.status(finalStatus(result, '已填入微博发布框，请检查后点「发送」。', '没能写入微博'));
		try { port.disconnect(); } catch { /* done */ }
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) await client.status({ state: 'cancelled', text: '已停止' });
		else await client.status({ state: 'error', error: { message: (error as Error).message || String(error) } });
	}
}
