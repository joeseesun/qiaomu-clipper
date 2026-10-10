import browser from './browser-polyfill';
import { bilibiliEmbedsToLinks } from './bilibili-embed';

import { t } from './ui-text';
export const QIAOMU_ORIGIN = 'https://rss.qiaomu.ai';
export interface QiaomuClip { url: string; title: string; markdown: string; image?: string }
export interface QiaomuResult { accepted?: boolean; entryId?: string; error?: string; duplicate?: boolean }

export function validateQiaomuClip(clip: QiaomuClip): QiaomuClip {
	const url = new URL(clip.url);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(t('请剪藏公开网页链接'));
	if (!clip.title.trim() || !clip.markdown.trim() || clip.markdown.length > 500000) throw new Error(t('剪藏标题或正文无效（正文最多 50 万字符）'));
	// The site shows clips as text and never runs page HTML, so a video embed travels as a link.
	return { ...clip, url: url.href, markdown: bilibiliEmbedsToLinks(clip.markdown) };
}

let devicePromise: Promise<string> | undefined;
function getDeviceId(): Promise<string> {
	if (!devicePromise) devicePromise = browser.storage.local.get('qiaomuDeviceId').then(async saved => {
		const id = typeof saved.qiaomuDeviceId === 'string' ? saved.qiaomuDeviceId : crypto.randomUUID();
		await browser.storage.local.set({ qiaomuDeviceId: id });
		return id;
	}).catch(error => { devicePromise = undefined; throw error; });
	return devicePromise;
}

/** An installed client submits directly; no account, cookies or website tab required. */
export async function submitQiaomuClip(clip: QiaomuClip): Promise<QiaomuResult> {
	const payload = validateQiaomuClip(clip);
	const deviceId = await getDeviceId();
	const body = JSON.stringify(payload);
	const headers = { 'Content-Type': 'application/json', 'X-Qiaomu-Client': 'web-clipper', 'X-Qiaomu-Submission-Version': '2', 'X-Qiaomu-Device': deviceId };
	// The server deduplicates by source URL, including when an acknowledgement
	// was lost. Reuse the exact payload/device for one bounded retry. Keep each
	// fetch below Chrome's 30-second service-worker response deadline.
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt) {
			await new Promise(resolve => setTimeout(resolve, 750));
			// An extension API call resets the worker's inactivity timer before
			// another slow fetch; a pending Promise alone does not keep it alive.
			await browser.storage.local.get('qiaomuDeviceId');
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 25000);
		try {
			const response = await fetch(`${QIAOMU_ORIGIN}/api/clipper/clips`, {
				method: 'POST', credentials: 'omit', headers, body, signal: controller.signal,
			});
			if (response.status === 429) return { error: t('剪藏提交过于频繁，请稍后重试') };
			if (!response.ok) {
				if (attempt === 0 && [502, 503, 504].includes(response.status)) continue;
				return { error: t('RSS 同步失败（HTTP {0}），请稍后重试', [response.status]) };
			}
			let result: any;
			try { result = await response.json(); }
			catch (error) {
				if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error;
				return { error: t('RSS 返回的剪藏结果无效') };
			}
			return result?.accepted && ['user-submitted', 'qiaomu-clippings'].includes(result.sourceId) && typeof result.entryId === 'string' ? result : { error: t('RSS 返回的剪藏结果无效') };
		} catch {
			if (attempt === 1) return { error: controller.signal.aborted ? t('RSS 连接超时，请检查网络或代理后重试') : t('RSS 网络连接失败，请稍后重试') };
		} finally { clearTimeout(timer); }
	}
	return { error: t('RSS 网络连接失败，请稍后重试') };
}
