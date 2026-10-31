import browser from '../utils/browser-polyfill';
import { connect, injectEngine } from '../x-publish/driver';
import type { BridgeClient } from './client';
import type { BridgeJob } from './protocol';
import { finalStatus, relayPort, sendAssets, waitForTab } from './relay';

const IMAGE_HOST = 'https://qm-image.local/';

const PROGRESS: [RegExp, (m: RegExpMatchArray) => string][] = [
	[/^Setting title/i, () => '正在设置标题…'],
	[/^Setting cover/i, () => '正在设置封面…'],
	[/^Pasting structured/i, () => '正在写入正文…'],
	[/^Inserting (\d+)/i, m => `正在插入 ${m[1]} 个特殊块…`],
	[/^Uploading image (\d+)\/(\d+)/i, m => `正在上传图片 ${m[1]}/${m[2]}…`],
	[/^Retrying X image (\d+)\/(\d+)/i, m => `图片 ${m[1]}/${m[2]} 上传失败，正在重试…`],
	[/^Image (\d+)\/(\d+) is in the editor/i, m => `图片 ${m[1]}/${m[2]} 已放入编辑器…`],
	[/^Reordering/i, () => '正在整理图片位置…'],
	[/^Cleaning up/i, () => '正在收尾…'],
];
export const describeX = (text: string) => { for (const [pattern, make] of PROGRESS) { const m = text.match(pattern); if (m) return make(m); } return text; };

/** Writes the article into the X Articles editor of `tabId`, using the same engine as the Clipper writer. */
export async function runXJob(tabId: number, job: BridgeJob, client: BridgeClient): Promise<void> {
	if (!job.content.markdown) { await client.status({ state: 'error', error: { message: '这篇笔记没有可写入的正文' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开 X 文章…' });
		await waitForTab(tabId);
		await injectEngine(tabId);
		const port = await connect(tabId);
		const markdown = job.content.markdown;
		const result = await relayPort(port, client, async post => {
			await sendAssets(client, job.assets, post, asset => `${IMAGE_HOST}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', markdown });
		}, describeX);
		await client.status(finalStatus(result, '草稿已写入，请在 X 里检查后再发布。', '没能写入 X'));
		if (result.ok) void browser.tabs.update(tabId, { active: true }).catch(() => {});
		try { port.disconnect(); } catch { /* done */ }
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) await client.status({ state: 'cancelled', text: '已停止' });
		else await client.status({ state: 'error', error: { message: (error as Error).message || String(error) } });
	}
}
