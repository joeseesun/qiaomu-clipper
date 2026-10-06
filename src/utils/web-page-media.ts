import type { WebInfo } from './asr-client';
import { webMediaAddress, type WebMedia } from './web-media-page';

// A page can lend only its own Douyin player, never an arbitrary download URL.
export function isDouyinMedia(page: string, media: unknown): media is string {
	if (typeof media !== 'string' || media.length > 8000 || !/^https:\/\/www\.douyin\.com\/video\/\d+$/.test(webMediaAddress(page) || '')) return false;
	try {
		const url = new URL(media);
		return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
			&& (url.hostname === 'douyinvod.com' || url.hostname.endsWith('.douyinvod.com'));
	} catch { return false; }
}

export function readPageMedia(doc: Document, page: string, media?: WebMedia): WebInfo | undefined {
	if (!media || !('currentSrc' in media) || !isDouyinMedia(page, media.currentSrc)) return;
	const title = (doc.querySelector('h1')?.textContent || doc.title).trim().slice(0, 600);
	return { ok: true, title, author: '', seconds: Number.isFinite(media.duration) ? media.duration : null,
		thumbnail: media instanceof HTMLVideoElement ? media.poster || null : null,
		site: '抖音', mediaUrl: media.currentSrc, video: media.tagName === 'VIDEO', description: title };
}

export async function getWebPageMedia(url: string, sourceTabId: number | undefined,
	api: { get(id: number): Promise<{ url?: string }>; query(options: object): Promise<Array<{ id?: number; url?: string }>>; sendMessage(id: number, message: object): Promise<unknown> }): Promise<WebInfo | undefined> {
	const canonical = webMediaAddress(url); if (!canonical || !canonical.startsWith('https://www.douyin.com/video/')) return;
	try {
		const tab = Number.isInteger(sourceTabId) && sourceTabId! >= 0 ? { ...(await api.get(sourceTabId!)), id: sourceTabId }
			: (await api.query({ url: 'https://*.douyin.com/*' })).find(t => webMediaAddress(t.url || '') === canonical);
		if (tab?.id === undefined || !tab.url || !/^https:\/\/(?:www\.)?douyin\.com\//.test(tab.url) || (webMediaAddress(tab.url) && webMediaAddress(tab.url) !== canonical)) return;
		const answer = await api.sendMessage(tab.id, { action: 'qiaomuWebMediaSource' }) as { url?: string; info?: WebInfo } | undefined;
		if (webMediaAddress(answer?.url || '') !== canonical || !answer?.info || !isDouyinMedia(canonical, answer.info.mediaUrl)) return;
		return { ok: true, title: String(answer.info.title || '').slice(0, 600), author: String(answer.info.author || '').slice(0, 200),
			seconds: Number.isFinite(answer.info.seconds) ? answer.info.seconds : null, thumbnail: null,
			site: '抖音', mediaUrl: answer.info.mediaUrl, video: true, description: String(answer.info.description || '').slice(0, 6000) };
	} catch { return; }
}
