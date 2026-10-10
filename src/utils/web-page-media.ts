import type { WebInfo } from './asr-client';
import { webMediaAddress, type WebMedia } from './web-media-page';

import { t } from './ui-text';
// Serialized by scripting.executeScript: keep this function self-contained.
// This also works when an older content script no longer answers after an update.
export function snapshotDouyinPlayer(): { url: string; info?: WebInfo; observed?: true; candidates?: string[] } {
	const page = new URL(location.href), id = page.pathname.match(/^\/video\/(\d+)/)?.[1] || page.searchParams.get('modal_id') || page.searchParams.get('vid');
	if (page.protocol !== 'https:' || !['www.douyin.com', 'douyin.com'].includes(page.hostname) || !/^\d+$/.test(id || '')) return { url: '' };
	const url = `https://www.douyin.com/video/${id}`;
	const players = Array.from(document.querySelectorAll('video')).map(video => {
		const r = video.getBoundingClientRect(), style = getComputedStyle(video);
		const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
		let src: URL; try { src = new URL(video.currentSrc || video.src); } catch { return; }
		if (src.protocol !== 'https:' || src.username || src.password || (src.port && src.port !== '443') || !(src.hostname === 'douyinvod.com' || src.hostname.endsWith('.douyinvod.com')) || (src.searchParams.has('__vid') && src.searchParams.get('__vid') !== id)) return;
		if (!area || style.display === 'none' || style.visibility === 'hidden') return;
		return { video, score: area + (video.paused ? 0 : 1e9) };
	}).filter((entry): entry is { video: HTMLVideoElement; score: number } => Boolean(entry)).sort((a, b) => b.score - a.score);
	const title = (document.querySelector('h1')?.textContent || document.title).trim().slice(0, 600);
	const video = players[0]?.video;
	if (!video) {
		// MSE supplies separate video/audio files. Only accept a single observed
		// pair from a document loaded for this exact item; SPA/preload ambiguity
		// must never attach another video's speech to this transcript.
		const shown = Array.from(document.querySelectorAll('video')).filter(v => {
			const r = v.getBoundingClientRect(), css = getComputedStyle(v);
			return v.currentSrc.startsWith('blob:') && r.width > 0 && r.height > 0 && css.visibility !== 'hidden' && css.display !== 'none';
		});
		const visible = shown.find(v => !v.paused) || shown[0];
		if (!visible || typeof performance.getEntriesByType !== 'function') return { url };
		const files = [...new Set(performance.getEntriesByType('resource').map(e => e.name))].filter(name => {
			try { const u = new URL(name); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && u.hostname.endsWith('.douyinvod.com'); } catch { return false; }
		});
		// Newer players stream ordinary mp4 renditions of the same item (one `l` group,
		// different bitrates), also when opened from the feed. Take the lightest, but only
		// as an observation: the caller confirms its duration against the playing video.
		const plain = files.filter(name => !/\/media-(?:audio|video)-/.test(new URL(name).pathname) && new URL(name).searchParams.get('mime_type') === 'video_mp4');
		// One lightest rendition per request group; the caller keeps the one whose duration matches.
		const byGroup = new Map<string, string[]>();
		for (const name of plain) { const key = new URL(name).searchParams.get('l') || ''; if (key) byGroup.set(key, [...(byGroup.get(key) || []), name]); }
		const candidates = [...byGroup.values()].map(names => names.map(name => ({ name, rate: Number(new URL(name).searchParams.get('br')) || Infinity })).sort((x, y) => x.rate - y.rate)[0].name);
		if (candidates.length && candidates.length <= 6 && Number.isFinite(visible.duration)) {
			return { url, observed: true, candidates, info: { ok: true, title, author: '', site: t('抖音'), video: true, thumbnail: null, seconds: visible.duration, mediaUrl: candidates[0], description: title } };
		}
		const navigation = performance.getEntriesByType('navigation')[0];
		if (!navigation) return { url };
		const opened = new URL(navigation.name), openedId = opened.pathname.match(/^\/video\/(\d+)/)?.[1] || opened.searchParams.get('modal_id') || opened.searchParams.get('vid');
		if (openedId !== id || opened.origin !== page.origin) return { url };
		// The player asks for the same file more than once (different range/signature): one file, not two candidates.
		const distinct = (names: string[]) => [...new Map(names.reverse().map(name => [new URL(name).pathname.replace(/^\/[0-9a-f]{32}\/[0-9a-f]+(?=\/)/, ''), name])).values()].reverse();
		const audio = distinct(files.filter(name => new URL(name).pathname.includes('/media-audio-')));
		const picture = distinct(files.filter(name => new URL(name).pathname.includes('/media-video-')));
		if (audio.length !== 1 || picture.length !== 1 || !new URL(audio[0]).searchParams.get('l') || new URL(audio[0]).searchParams.get('l') !== new URL(picture[0]).searchParams.get('l')) return { url };
		return { url, info: { ok: true, title, author: '', site: t('抖音'), video: true, thumbnail: null,
			seconds: Number.isFinite(visible.duration) ? visible.duration : null, mediaUrl: picture[0], audioUrl: audio[0], description: title } };
	}
	return { url, info: { ok: true, title, author: '', site: t('抖音'), video: true,
		seconds: Number.isFinite(video.duration) ? video.duration : null, thumbnail: null,
		mediaUrl: video.currentSrc || video.src, description: title } };
}

// Metadata is checked before pairing MSE files. A preload can be the only entry
// in resource timing; sharing a request group alone does not prove it is current.
// No async/await here: the build turns it into a helper that does not exist in the page it is injected into.
export function validateDouyinTracks(page: string, picture: string, audio: string, seconds: number): Promise<boolean> {
	const current = () => {
		const u = new URL(location.href), id = u.pathname.match(/^\/video\/(\d+)/)?.[1] || u.searchParams.get('modal_id') || u.searchParams.get('vid');
		return `https://www.douyin.com/video/${id}` === page;
	};
	if (!current() || !Number.isFinite(seconds) || seconds <= 0) return Promise.resolve(false);
	const read = (src: string, kind: 'video' | 'audio') => new Promise<number>(resolve => {
		const node = document.createElement(kind); node.preload = 'metadata';
		const finish = (value: number) => { clearTimeout(timer); node.onloadedmetadata = null; node.onerror = null; node.removeAttribute('src'); node.load(); resolve(value); };
		const timer = setTimeout(() => finish(NaN), 5000);
		node.onloadedmetadata = () => finish(node.duration); node.onerror = () => finish(NaN); node.src = src;
	});
	return Promise.all([read(picture, 'video'), read(audio, 'audio')]).then(durations =>
		current() && durations.every(d => Number.isFinite(d) && Math.abs(d - seconds) <= Math.max(.5, seconds * .005)));
}

// A page can lend only its own Douyin player, never an arbitrary download URL.
export function isDouyinMedia(page: string, media: unknown): media is string {
	if (typeof media !== 'string' || media.length > 8000 || !/^https:\/\/www\.douyin\.com\/video\/\d+$/.test(webMediaAddress(page) || '')) return false;
	try {
		const url = new URL(media);
		return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
			&& (url.hostname === 'douyinvod.com' || url.hostname.endsWith('.douyinvod.com'))
			&& (!url.searchParams.has('__vid') || url.searchParams.get('__vid') === webMediaAddress(page)!.split('/').pop());
	} catch { return false; }
}

export function readPageMedia(doc: Document, page: string, media?: WebMedia): WebInfo | undefined {
	if (!media || !('currentSrc' in media) || !isDouyinMedia(page, media.currentSrc)) return;
	const title = (doc.querySelector('h1')?.textContent || doc.title).trim().slice(0, 600);
	return { ok: true, title, author: '', seconds: Number.isFinite(media.duration) ? media.duration : null,
		thumbnail: media instanceof HTMLVideoElement ? media.poster || null : null,
		site: t('抖音'), mediaUrl: media.currentSrc, video: media.tagName === 'VIDEO', description: title };
}

export async function getWebPageMedia(url: string, sourceTabId: number | undefined,
	api: { get(id: number): Promise<{ url?: string }>; query(options: object): Promise<Array<{ id?: number; url?: string }>>; sendMessage(id: number, message: object): Promise<unknown> },
	readLive?: (id: number) => Promise<unknown>): Promise<WebInfo | undefined> {
	const canonical = webMediaAddress(url); if (!canonical || !canonical.startsWith('https://www.douyin.com/video/')) return;
	try {
		let tab: { id?: number; url?: string } | undefined;
		if (Number.isInteger(sourceTabId) && sourceTabId! >= 0) {
			try { tab = { ...(await api.get(sourceTabId!)), id: sourceTabId }; } catch { /* original tab was closed */ }
		}
		// Opening the original-video link creates another tab. Recover only the
		// exact requested item, never the video the old tab switched to.
		if (!tab?.url || (webMediaAddress(tab.url) && webMediaAddress(tab.url) !== canonical)) {
			tab = ((await api.query({ url: 'https://*.douyin.com/*' })) || []).find(t => webMediaAddress(t.url || '') === canonical);
		}
		if (tab?.id === undefined || !tab.url || !/^https:\/\/(?:www\.)?douyin\.com\//.test(tab.url) || (webMediaAddress(tab.url) && webMediaAddress(tab.url) !== canonical)) return;
		let answer: { url?: string; info?: WebInfo } | undefined;
		try { answer = await api.sendMessage(tab.id, { action: 'qiaomuWebMediaSource' }) as typeof answer; } catch { /* old or not-yet-loaded adapter */ }
		if (answer?.url && webMediaAddress(answer.url) !== canonical) return;
		if (answer?.info?.audioUrl && !readLive) return;
		if ((!answer?.info || answer.info.audioUrl) && readLive) answer = await readLive(tab.id) as typeof answer;
		if (webMediaAddress(answer?.url || '') !== canonical || !answer?.info || !isDouyinMedia(canonical, answer.info.mediaUrl)) return;
		if (answer.info.audioUrl && !isDouyinMedia(canonical, answer.info.audioUrl)) return;
		return { ok: true, title: String(answer.info.title || '').slice(0, 600), author: String(answer.info.author || '').slice(0, 200),
			seconds: Number.isFinite(answer.info.seconds) ? answer.info.seconds : null, thumbnail: null,
			site: t('抖音'), mediaUrl: answer.info.mediaUrl, ...(answer.info.audioUrl ? { audioUrl: answer.info.audioUrl } : {}), video: true, description: String(answer.info.description || '').slice(0, 6000) };
	} catch { return; }
}

// TikTok's player streams from blob: URLs, and the file address the download tool reports only works inside that tool's own session.
// The files the page itself fetched do play for the study reader once they carry the site as Referer (see the media rule in background).
// Serialized by scripting.executeScript: keep this function self-contained, without async/await.
export function snapshotTikTokPlayer(): { url: string; seconds: number | null; candidates: string[] } {
	const page = new URL(location.href);
	if (page.protocol !== 'https:' || !(page.hostname === 'www.tiktok.com' || page.hostname === 'tiktok.com')) return { url: '', seconds: null, candidates: [] };
	const shown = Array.from(document.querySelectorAll('video')).filter(v => {
		const r = v.getBoundingClientRect(), css = getComputedStyle(v);
		return r.width > 0 && r.height > 0 && css.visibility !== 'hidden' && css.display !== 'none' && Number.isFinite(v.duration);
	});
	const visible = shown.find(v => !v.paused) || shown[0];
	const names = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource').map(e => e.name) : [];
	const files = new Map<string, string>();
	for (const name of names) {
		try {
			const u = new URL(name), host = u.hostname;
			const own = host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'tiktokcdn.com' || host.endsWith('.tiktokcdn.com') || host.endsWith('.tiktokcdn-us.com');
			if (u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && own && u.pathname.includes('/video/tos/') && u.searchParams.get('mime_type') === 'video_mp4') files.set(u.pathname, name);
		} catch { /* not an address */ }
	}
	const found = Array.from(files.values()).slice(-6).reverse();
	// A video page also carries its own item in the page data, with the addresses the player starts from. That list names this item
	// (so a preloaded neighbour cannot be mistaken for it) and does not depend on the browser still remembering the network requests,
	// which a busy page overflows.
	const own: string[] = [];
	try {
		const id = page.pathname.match(/\/video\/(\d+)/)?.[1];
		const data = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '{}');
		const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
		if (id && item?.id === id && item.video) {
			if (typeof item.video.playAddr === 'string') own.push(item.video.playAddr);
			for (const rate of item.video.bitrateInfo || []) for (const address of rate?.PlayAddr?.UrlList || []) if (typeof address === 'string') own.push(address);
		}
	} catch { /* no usable page data */ }
	return { url: page.href, seconds: visible ? visible.duration : null, candidates: Array.from(new Set(own.concat(found))).slice(0, 12) };
}

// A page can lend only a file from TikTok's own video hosts, never an arbitrary address.
export function isTikTokMedia(media: unknown): media is string {
	if (typeof media !== 'string' || media.length > 8000) return false;
	try {
		const u = new URL(media), host = u.hostname;
		return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && u.pathname.includes('/video/tos/')
			&& (host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'tiktokcdn.com' || host.endsWith('.tiktokcdn.com') || host.endsWith('.tiktokcdn-us.com'));
	} catch { return false; }
}

// Several videos can be preloaded in a feed: the one as long as the item being studied is the one to play.
export async function pickTikTokMedia(candidates: string[], seconds: number | null | undefined, measure: (src: string) => Promise<number>): Promise<string | undefined> {
	if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return;
	for (const candidate of candidates.filter(isTikTokMedia)) {
		const duration = await measure(candidate);
		if (Number.isFinite(duration) && Math.abs(duration - seconds) <= Math.max(.5, seconds * .01)) return candidate;
	}
}

export function measureMediaDuration(doc: Document, src: string, timeoutMs = 6000): Promise<number> {
	return new Promise(resolve => {
		const node = doc.createElement('video'); node.preload = 'metadata'; node.muted = true;
		const finish = (value: number) => { clearTimeout(timer); node.onloadedmetadata = null; node.onerror = null; node.removeAttribute('src'); node.load(); resolve(value); };
		const timer = setTimeout(() => finish(NaN), timeoutMs);
		node.onloadedmetadata = () => finish(node.duration); node.onerror = () => finish(NaN); node.src = src;
	});
}

// TikTok pages: a video page names its item in the address; the feed ("for you", following) shows whichever item is on screen.
export const tiktokVideoPath = (address: string): string => {
	try { const u = new URL(address); return /(^|\.)tiktok\.com$/.test(u.hostname) && /^\/@[^/]+\/video\/\d+/.test(u.pathname) ? u.pathname : ''; } catch { return ''; }
};
export const isTikTokPage = (address: string): boolean => { try { const u = new URL(address); return u.protocol === 'https:' && /(^|\.)tiktok\.com$/.test(u.hostname); } catch { return false; } };
// A tab may lend its player when it is TikTok and is not showing a different video page. A feed tab is allowed: the study reader opened from
// a feed item has only the feed to ask, and the length of the video (checked by the caller) tells the item from its preloaded neighbours.
export const tabMayLendTikTokMedia = (tabUrl: string, wantedPath: string): boolean => isTikTokPage(tabUrl) && (!tiktokVideoPath(tabUrl) || tiktokVideoPath(tabUrl) === wantedPath);
