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
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15000);
	try {
		const response = await fetch(`${QIAOMU_ORIGIN}/api/clipper/clips`, {
			method: 'POST', credentials: 'omit',
			headers: { 'Content-Type': 'application/json', 'X-Qiaomu-Client': 'web-clipper', 'X-Qiaomu-Submission-Version': '2', 'X-Qiaomu-Device': deviceId },
			body: JSON.stringify(payload), signal: controller.signal,
		});
		if (response.status === 429) return { error: t('剪藏提交过于频繁，请稍后重试') };
		if (!response.ok) return { error: t('RSS 同步失败（HTTP {0}），请稍后重试', [response.status]) };
		const result = await response.json();
		return result.accepted && ['user-submitted', 'qiaomu-clippings'].includes(result.sourceId) && typeof result.entryId === 'string' ? result : { error: t('RSS 返回的剪藏结果无效') };
	} catch { return { error: t('RSS 网络连接失败，请稍后重试') }; }
	finally { clearTimeout(timer); }
}
