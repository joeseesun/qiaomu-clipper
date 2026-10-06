import { siteOf, xStatus } from './study-sites';

// Only a supported media detail address, never a site's home/search/profile feed.
export function webMediaAddress(address: string): string | null {
	const site = siteOf(address); if (!site || site.builtin) return null;
	let url: URL; try { url = new URL(address); } catch { return null; }
	if (url.protocol !== 'https:') return null;
	if (site.id === 'x') return xStatus(address);
	if (site.id === 'douyin') {
		const id = url.pathname.match(/^\/(?:video|note)\/(\d+)/)?.[1] || url.searchParams.get('modal_id')?.match(/^\d+$/)?.[0] || url.searchParams.get('vid')?.match(/^\d+$/)?.[0];
		return id ? `https://www.douyin.com/video/${id}` : null;
	}
	const patterns: Record<string, RegExp> = {
		tiktok: /^\/@[^/]+\/(?:video|photo)\/\d+/, instagram: /^\/(?:p|reel|reels)\/[^/]+/,
		facebook: /(?:\/videos\/|\/reel\/|\/watch\/?$)/, reddit: /\/comments\//,
		vimeo: /\/(?:video\/)?\d+(?:\/|$)/, twitch: /^\/(?:videos\/\d+|[^/]+\/clip\/[^/]+)/,
		dailymotion: /^\/video\//, bandcamp: /^\/track\//, niconico: /^\/watch\//,
		weibo: /^\/(?:tv\/show\/|\d+\/[A-Za-z0-9]+)/, ximalaya: /\/sound\/\d+/,
		ted: /^\/talks\//, applepodcasts: /^\/.*\/podcast\//,
	};
	if (site.id === 'soundcloud' && !/^\/(?:discover|search|you|stream)(?:\/|$)/.test(url.pathname) && url.pathname.split('/').filter(Boolean).length === 2) { url.hash = ''; return url.href; }
	if (site.id === 'netease') return /(?:^|[\/#])song\??/.test(url.pathname + url.hash) ? url.href : null;
	if (['fb.watch', 'dai.ly', 'nico.ms', 'v.redd.it', 'clips.twitch.tv'].includes(url.hostname) && url.pathname.length > 1) return url.href;
	if (!patterns[site.id]?.test(url.pathname)) return null;
	if (site.id === 'facebook' && /\/watch\/?$/.test(url.pathname) && !url.searchParams.get('v')) return null;
	if (site.id === 'applepodcasts' && !url.searchParams.get('i')) return null;
	url.hash = ''; return url.href;
}

// Ignore preloaded/offscreen players and choose the playing, most visible media.
export type WebMedia = HTMLMediaElement | HTMLIFrameElement;
export function activeWebMedia(doc: Document): WebMedia | undefined {
	const win = doc.defaultView; if (!win) return;
	const candidates = Array.from(doc.querySelectorAll<WebMedia>('video, audio, iframe[src*="player.vimeo.com"], iframe[src*="player.twitch.tv"], iframe[src*="dailymotion.com"]')).filter(media => !media.closest('.qiaomu-web-bar, .qiaomu-x'));
	const score = (media: WebMedia) => {
		const r = media.getBoundingClientRect(), css = win.getComputedStyle(media);
		const area = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
		if (css.display === 'none' || css.visibility === 'hidden') return media.tagName === 'AUDIO' && ('paused' in media && !media.paused) ? 1e9 : -1;
		return area > 0 ? area + (('paused' in media && !media.paused) ? 1e9 : 0) : media.tagName === 'AUDIO' ? 0 : -1;
	};
	return candidates.filter(media => score(media) >= 0).sort((a, b) => score(b) - score(a))[0];
}

export function currentWebMediaAddress(doc: Document, media: WebMedia, address: string): string | null {
	const site = siteOf(address); if (!site || site.builtin) return null;
	// The current URL wins for modal_id navigation; a feed card can provide the item address.
	const own = webMediaAddress(address); if (own) return own;
	const card = media.closest('article, [data-e2e="recommend-list-item-container"], [data-e2e="feed-active-video"], [data-e2e="video-detail"]');
	for (const a of Array.from(card?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])) {
		if (siteOf(a.href)?.id !== site.id) continue;
		const detail = webMediaAddress(a.href); if (detail) return detail;
	}
	// TikTok's current feed player carries its item id even when no detail link is rendered.
	if (site.id === 'tiktok') {
		const id = media.closest('[id^="xgwrapper-"]')?.id.match(/^xgwrapper-\d+-(\d+)$/)?.[1];
		const author = Array.from(card?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []).find(a => /^\/@[^/]+\/?$/.test(new URL(a.href).pathname));
		if (id && author && siteOf(author.href)?.id === 'tiktok') return `https://www.tiktok.com${new URL(author.href).pathname.replace(/\/$/, '')}/video/${id}`;
	}
	return null;
}

// Some players live in inaccessible frames or are created only after pressing play.
// Item-only routes let us offer study without falsely claiming source-page time control.
const ITEM_ONLY_SITES = ['vimeo', 'tiktok', 'douyin', 'twitch', 'dailymotion', 'soundcloud', 'bandcamp', 'niconico', 'ximalaya', 'netease', 'ted', 'applepodcasts'];
export const isMediaItemAddress = (address: string): boolean => Boolean(webMediaAddress(address) && ITEM_ONLY_SITES.includes(siteOf(address)?.id ?? ''));
export function declaredWebMediaAddress(doc: Document, address: string): string | null {
	const detail = webMediaAddress(address), site = siteOf(address); if (!detail || !site) return null;
	if (isMediaItemAddress(detail) || doc.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"]')) return detail;
	return null;
}
