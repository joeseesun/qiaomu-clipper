import type { WebInfo } from './asr-client';

// 小鹅通 (Xiaoe) live replays. A shop lives at https://<app_id>.h5.xiaoeknow.com; a live is l_<id>. Its replay is a plain HLS
// playlist the shop's own API hands to a signed-in viewer (/_alive/v3/get_lookback_list). Shops that only allow their mini
// program still answer this API in a browser once the viewer has signed in on the shop's web page, so that is what we use.
// Links people get look like https://xxx.xetslk.com/sl/SHARECODE (a short link) → https://<app>.mp.xiaoeknow.com/?params=<base64 json>.

const APP = /^app[0-9a-z]{6,24}$/;
const LIVE = /^l_[0-9a-z]{8,40}$/;
const SHOP = /^(app[0-9a-z]{6,24})\.(?:h5|mp)\.xiaoeknow\.com$/;
// Hosts a pasted link may be on (the short-link host only redirects).
export const XIAOE_HOSTS = ['xiaoeknow.com', 'xetslk.com', 'xiaoe-tech.com'];
// Hosts a replay playlist may come from (the default line, Huawei and ByteDance CDNs of the same file).
const MEDIA_HOSTS = ['xiaoeknow.com', 'xet.tech', 'xiaoe-tech.com', 'xiaoecloud.com'];

const hostIn = (host: string, list: string[]) => list.some(item => host === item || host.endsWith('.' + item));
const decodeBase64Json = (text: string): Record<string, unknown> | null => {
	try {
		const padded = text.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
		const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); const value = JSON.parse(new TextDecoder().decode(bytes));
		return value && typeof value === 'object' ? value as Record<string, unknown> : null;
	} catch { return null; }
};
export const xiaoeLiveAddress = (app: string, live: string) => `https://${app}.h5.xiaoeknow.com/v4/course/alive/${live}?app_id=${app}`;

// The one address a live is known by (the transcript is cached under it), from any of the forms a link takes. Short links need
// following first (resolveXiaoeLink); they give null here.
export function xiaoeAddress(address: string): string | null {
	let url: URL; try { url = new URL(address); } catch { return null; }
	if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) return null;
	const host = url.hostname.toLowerCase(), shop = host.match(SHOP)?.[1];
	if (!shop) return null;
	const app = url.searchParams.get('app_id') || shop; if (app !== shop || !APP.test(app)) return null;
	const live = url.pathname.match(/\/course\/alive\/(l_[0-9a-z]+)/)?.[1];
	if (live && LIVE.test(live)) return xiaoeLiveAddress(app, live);
	// The mini-program landing page carries the item in `params` (base64 JSON with resource_id and the web address).
	const params = url.searchParams.get('params'); const inner = params ? decodeBase64Json(params) : null;
	const fromParams = inner && typeof inner.resource_id === 'string' ? inner.resource_id : '';
	if (LIVE.test(fromParams) && (inner!.app_id === undefined || inner!.app_id === app)) return xiaoeLiveAddress(app, fromParams);
	// The older room address: /content_page/<base64 json with resource_id>.
	const page = url.pathname.match(/\/content_page\/([A-Za-z0-9_\-+/=]+)/)?.[1]; const old = page ? decodeBase64Json(page) : null;
	if (old && (old.app_id === undefined || old.app_id === app) && typeof old.resource_id === 'string' && LIVE.test(old.resource_id)) return xiaoeLiveAddress(app, old.resource_id);
	return null;
}
export const isXiaoeLink = (address: string): boolean => { try { const u = new URL(address); return u.protocol === 'https:' && hostIn(u.hostname.toLowerCase(), XIAOE_HOSTS); } catch { return false; } };
export function xiaoeParts(address: string): { app: string; live: string } | null {
	const canonical = xiaoeAddress(address); if (!canonical) return null;
	const u = new URL(canonical); return { app: u.searchParams.get('app_id')!, live: u.pathname.split('/').pop()! };
}

// A short link answers with a redirect (or a page that moves on by script) to the shop's address.
export async function followXiaoeLink(address: string, get: typeof fetch = (...args) => fetch(...args)): Promise<string | null> {
	const own = xiaoeAddress(address); if (own) return own;
	if (!isXiaoeLink(address)) return null;
	try {
		const response = await get(address, { redirect: 'follow', credentials: 'omit' });
		const landed = xiaoeAddress(response.url); if (landed) return landed;
		// A landing page that moves on by script: the shop address is written in it.
		const html = (await response.text()).slice(0, 200000);
		for (const found of html.match(/https:\/\/app[0-9a-z]+\.(?:h5|mp)\.xiaoeknow\.com\/[^"'\s<>\\]+/g) || []) { const next = xiaoeAddress(found.replace(/&amp;/g, '&')); if (next) return next; }
	} catch { /* not reachable */ }
	return null;
}

// A replay playlist of this shop, on one of the shop's media hosts. Anything else is refused.
export function isXiaoeMedia(page: unknown, media: unknown): media is string {
	if (typeof page !== 'string' || typeof media !== 'string' || media.length > 4000 || !xiaoeAddress(page) || xiaoeAddress(page) !== page) return false;
	try {
		const u = new URL(media);
		return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && hostIn(u.hostname.toLowerCase(), MEDIA_HOSTS) && /\.m3u8$/i.test(u.pathname);
	} catch { return false; }
}

// Length of an HLS playlist (sum of its segments), or null when it is not a finished replay.
export function playlistSeconds(text: string): number | null {
	if (!/^#EXTM3U/.test(text.trim()) || !/^#EXT-X-ENDLIST\s*$/m.test(text)) return null;
	let total = 0; for (const match of text.matchAll(/^#EXTINF:([0-9.]+)/gm)) total += Number(match[1]) || 0;
	return Number.isFinite(total) && total > 0 ? Math.round(total * 10) / 10 : null;
}
// A playlist the helper can read as it is: no encryption (or plain AES-128 whose key ffmpeg fetches itself).
export const playlistIsPlain = (text: string): boolean => !/#EXT-X-KEY:(?![^\n]*METHOD=(?:NONE|AES-128)(?:,|\s|$))/i.test(text);

export type XiaoeReply = { ok: true; info: WebInfo; address: string } | { ok: false; error: 'login'; address: string; loginUrl: string } | { ok: false; error: 'not-live' | 'no-replay' | 'denied' | 'failed'; address?: string; message?: string };
type Api = (path: string) => Promise<{ code?: number; msg?: string; message?: string; data?: unknown } | null>;

const loginUrlOf = (app: string) => `https://${app}.h5.xiaoeknow.com/p/t/free/v1/basic-platform/h5_basic/login/auth?redirect_url=${encodeURIComponent(`https://${app}.h5.xiaoeknow.com/p/decorate/personal_center`)}`;

// Read the replay through the shop's API (`api` runs the request as the signed-in viewer), then measure the playlist.
export async function readXiaoeLive(address: string, api: Api, playlist: (url: string) => Promise<string>): Promise<XiaoeReply> {
	const parts = xiaoeParts(address); if (!parts) return { ok: false, error: 'not-live' };
	const { app, live } = parts, canonical = xiaoeLiveAddress(app, live);
	const lines = await api(`/_alive/v3/get_lookback_list?app_id=${app}&alive_id=${live}`);
	if (!lines) return { ok: false, error: 'failed', address: canonical };
	if (lines.code === 11302) return { ok: false, error: 'login', address: canonical, loginUrl: loginUrlOf(app) };
	if (lines.code !== 0) return { ok: false, error: 'denied', address: canonical, message: String(lines.msg || lines.message || lines.code || '').slice(0, 200) };
	const urls: string[] = [];
	for (const line of Array.isArray(lines.data) ? lines.data as Array<{ default?: boolean; line_sharpness?: Array<{ url?: unknown; default?: boolean }> }> : []) {
		const sharp = Array.isArray(line?.line_sharpness) ? line.line_sharpness : [];
		for (const item of [...sharp].sort((a, b) => Number(Boolean(b?.default)) - Number(Boolean(a?.default)))) if (typeof item?.url === 'string' && isXiaoeMedia(canonical, item.url)) urls.push(item.url);
	}
	if (!urls.length) return { ok: false, error: 'no-replay', address: canonical };
	// The first line whose playlist reads and is complete.
	let mediaUrl = '', seconds: number | null = null;
	for (const url of urls.slice(0, 4)) {
		try { const text = await playlist(url); const length = playlistSeconds(text); if (length && playlistIsPlain(text)) { mediaUrl = url; seconds = length; break; } } catch { /* try the next line */ }
	}
	if (!mediaUrl) return { ok: false, error: 'no-replay', address: canonical };
	const base = await api(`/_alive/v3/base_info?resource_id=${live}&type=12&is_direct=1&file_tag=1`).catch(() => null);
	const data = (base?.code === 0 ? base.data : null) as { alive_info?: Record<string, unknown>; alive_conf?: Record<string, unknown> } | null;
	const about = data?.alive_info || {}, conf = data?.alive_conf || {};
	const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
	const start = typeof about.zb_start_at === 'number' ? new Date(about.zb_start_at * 1000).toISOString() : null;
	const cover = text(about.alive_img_url, 1000) || text(about.img_url, 1000);
	return { ok: true, address: canonical, info: {
		ok: true, title: text(about.title, 300) || '小鹅通直播回放', author: text(conf.wx_app_name, 120) || text(about.product_name, 120),
		seconds, thumbnail: /^https:\/\//.test(cover) ? cover : null, site: '小鹅通', mediaUrl, video: true,
		description: [text(about.product_name, 200), text(about.summary, 2000)].filter(Boolean).join('\n'), date: start,
	} };
}
