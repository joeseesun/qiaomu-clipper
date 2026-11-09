import browser from '../utils/browser-polyfill';
import type { BridgeClient } from './client';
import type { BridgeJob } from './protocol';
import { connectToPage, finalStatus, relayPort, sendAssets, waitForTab } from './relay';

export const WEIBO_ARTICLE_PORT = 'qiaomu-publish-weibo-article';
export const WEIBO_ARTICLE_SCRIPT = 'weibo-article-publish-content.js';
export const WEIBO_ARTICLE_IMAGE_SCHEME = 'qp-asset://';

/** This function runs in the editor's MAIN world without an extension module closure. */
export function readWeiboAccount(): string {
	if (location.hostname !== 'card.weibo.com') return '';
	const page = window as Window & { ERR_UID?: unknown; userInfo?: { uid?: unknown }; __WB_GET_CONFIG?: () => { config?: { uid?: unknown } } };
	const direct = [page.ERR_UID, page.userInfo?.uid].map(value => String(value ?? '')).find(value => /^\d{1,20}$/.test(value));
	if (direct) return direct;
	try {
		const uid = String(page.__WB_GET_CONFIG?.()?.config?.uid ?? '');
		return /^\d{1,20}$/.test(uid) ? uid : '';
	} catch { return ''; }
}

/** The Weibo headline-article API calls run inside the card.weibo.com tab, so they carry the person's own login. */
export async function runWeiboArticleJob(tabId: number, job: BridgeJob, client: BridgeClient): Promise<void> {
	if (!job.content.html) { await client.status({ state: 'error', error: { message: '这篇笔记没有可写入的正文' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开微博长文编辑器…' });
		await waitForTab(tabId);
		// Do not inject inline script text: the site's CSP may block it.
		const accountProbe = await browser.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readWeiboAccount }).catch(() => []);
		const pageAccount = accountProbe[0]?.result ?? '';
		await browser.scripting.executeScript({ target: { tabId }, files: [WEIBO_ARTICLE_SCRIPT] });
		const port = await connectToPage(tabId, WEIBO_ARTICLE_PORT, '这个标签页不是微博长文编辑器，请先登录微博');
		const content = job.content;
		const result = await relayPort(port, client, async post => {
			await sendAssets(client, job.assets, post, asset => `${WEIBO_ARTICLE_IMAGE_SCHEME}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', title: job.title, html: content.html, cover: content.cover ? `${WEIBO_ARTICLE_IMAGE_SCHEME}${content.cover}` : '', summary: content.summary ?? '', pageAccount });
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
