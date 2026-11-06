import browser from '../utils/browser-polyfill';
import type { BridgeClient } from './client';
import type { BridgeJob } from './protocol';
import { connectToPage, finalStatus, relayPort, scrubFragment, sendAssets, waitForTab } from './relay';

export const WEIBO_ARTICLE_PORT = 'qiaomu-publish-weibo-article';
export const WEIBO_ARTICLE_SCRIPT = 'weibo-article-publish-content.js';
export const WEIBO_ARTICLE_IMAGE_SCHEME = 'qp-asset://';

/** The Weibo headline-article API calls run inside the card.weibo.com tab, so they carry the person's own login. */
export async function runWeiboArticleJob(tabId: number, job: BridgeJob, client: BridgeClient): Promise<void> {
	if (!job.content.html) { await client.status({ state: 'error', error: { message: '这篇笔记没有可写入的正文' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开微博长文编辑器…' });
		await waitForTab(tabId);
		await scrubFragment(tabId);
		await browser.scripting.executeScript({ target: { tabId }, files: [WEIBO_ARTICLE_SCRIPT] });
		const port = await connectToPage(tabId, WEIBO_ARTICLE_PORT, '这个标签页不是微博长文编辑器，请先登录微博');
		const content = job.content;
		const result = await relayPort(port, client, async post => {
			await sendAssets(client, job.assets, post, asset => `${WEIBO_ARTICLE_IMAGE_SCHEME}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', title: job.title, html: content.html, cover: content.cover ? `${WEIBO_ARTICLE_IMAGE_SCHEME}${content.cover}` : '', summary: content.summary ?? '' });
		});
		await client.status(finalStatus(result, '草稿已写入微博，请检查后再发布。', '没能写入微博'));
		try { port.disconnect(); } catch { /* done */ }
		if (result.ok && result.summary?.url) {
			try { await browser.tabs.update(tabId, { url: String(result.summary.url) }); } catch { /* best-effort navigation */ }
		}
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) await client.status({ state: 'cancelled', text: '已停止' });
		else await client.status({ state: 'error', error: { message: (error as Error).message || String(error) } });
	}
}
