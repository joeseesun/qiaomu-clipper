import browser from '../utils/browser-polyfill';
import { connect, injectEngine } from '../x-publish/driver';
import type { PublishClient } from './client';
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
export async function runXJob(tabId: number, job: BridgeJob, client: PublishClient): Promise<void> {
	if (!job.content.markdown) { await client.status({ state: 'error', error: { message: '这篇笔记没有可写入的正文' } }); return; }
	try {
		await client.status({ state: 'running', text: '正在打开 X 文章…' });
		await waitForTab(tabId);
		await injectEngine(tabId);
		const port = await connect(tabId);
		const markdown = job.content.markdown;
		let result = await relayPort(port, client, async post => {
			await sendAssets(client, job.assets, post, asset => `${IMAGE_HOST}${asset.id}`, text => void client.status({ state: 'running', text }));
			post({ type: 'run', markdown });
		}, describeX);
		if (result.ok && typeof result.summary?.bodyMediaExpected === 'number') {
			await client.status({ state: 'running', text: '正在核对保存后的完整草稿…' });
			await new Promise(resolve => setTimeout(resolve, 3000));
			if (client.cancelled) throw Object.assign(new Error('已停止'), { stopped: true });
			await browser.tabs.reload(tabId);
			await waitForTab(tabId);
			let verified = false;
			for (let attempt = 0; attempt < 20; attempt++) {
				if (client.cancelled) throw Object.assign(new Error('已停止'), { stopped: true });
				const replies = await browser.scripting.executeScript({ target: { tabId }, func: () => {
					const editor = document.querySelector('[contenteditable="true"][role="textbox"]');
					return { text: editor?.textContent || '', media: editor?.querySelectorAll('section[data-block="true"]').length || 0 };
				} });
				const actual = replies[0]?.result as { text: string; media: number } | undefined;
				if (actual?.text && !/__XPOSTER_\w+__/.test(actual.text) && actual.media >= result.summary.bodyMediaExpected) { verified = true; break; }
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			if (!verified) result = { ok: false, message: '草稿保存后仍有媒体缺失或占位符，已保留草稿，请勿公开发布。' };
		}
		await client.status(finalStatus(result, '草稿已写入，请在 X 里检查后再发布。', '没能写入 X'));
		if (result.ok) void browser.tabs.update(tabId, { active: true }).catch(() => {});
		try { port.disconnect(); } catch { /* done */ }
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) await client.status({ state: 'cancelled', text: '已停止' });
		else await client.status({ state: 'error', error: { message: (error as Error).message || String(error) } });
	}
}
