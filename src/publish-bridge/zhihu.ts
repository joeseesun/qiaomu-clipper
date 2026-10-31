import browser from '../utils/browser-polyfill';
import type { BridgeClient } from './client';
import type { BridgeJob } from './protocol';
import { connectToPage, finalStatus, relayPort, scrubFragment, sendAssets, waitForTab } from './relay';

export const ZHIHU_PORT = 'qiaomu-publish-zhihu';
export const ZHIHU_SCRIPT = 'zhihu-publish-content.js';
export const ZHIHU_IMAGE_SCHEME = 'qp-asset://';

/** The Zhihu API calls run inside the Zhihu tab itself, so they carry the page's own origin and cookies. */
export async function runZhihuJob(tabId: number, job: BridgeJob, client: BridgeClient): Promise<void> {
	if (!job.content.html) { await client.status({ state: 'error', error: { message: '这篇笔记没有可写入的正文' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开知乎…' });
		await waitForTab(tabId);
		await scrubFragment(tabId);
		await browser.scripting.executeScript({ target: { tabId }, files: [ZHIHU_SCRIPT] });
		const port = await connectToPage(tabId, ZHIHU_PORT, '这个标签页不是知乎写文章页');
		const content = job.content;
		const result = await relayPort(port, client, async post => {
			await sendAssets(client, job.assets, post, asset => `${ZHIHU_IMAGE_SCHEME}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', title: job.title, html: content.html, cover: content.cover ? `${ZHIHU_IMAGE_SCHEME}${content.cover}` : '', summary: content.summary ?? '' });
		});
		await client.status(finalStatus(result, '草稿已写入知乎，请检查后再发布。', '没能写入知乎'));
		try { port.disconnect(); } catch { /* done */ }
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) await client.status({ state: 'cancelled', text: '已停止' });
		else await client.status({ state: 'error', error: { message: (error as Error).message || String(error) } });
	}
}
