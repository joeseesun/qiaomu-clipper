import type { WebInfo } from './asr-client';

// 小鹅通 (Xiaoe) live replays. A shop lives at https://<app_id>.h5.xiaoeknow.com; a live is l_<id>. Its replay is a plain HLS
// playlist the shop's own API hands to a signed-in viewer (/_alive/v3/get_lookback_list). Shops that only allow their mini
// program still answer this API in a browser once the viewer has signed in on the shop's web page, so that is what we use.
// Links people get look like https://xxx.xetslk.com/sl/SHARECODE (a short link) → https://<app>.mp.xiaoeknow.com/?params=<base64 json>.

import { isXiaoeLink, xiaoeAddress, xiaoeParts } from './xiaoe-address';
export { XIAOE_HOSTS, isXiaoeLink, xiaoeAddress, xiaoeLiveAddress, xiaoeParts } from './xiaoe-address';
const MEDIA_HOSTS = ['xiaoeknow.com', 'xet.tech', 'xiaoe-tech.com', 'xiaoecloud.com'];
const hostIn = (host: string, list: string[]) => list.some(item => host === item || host.endsWith('.' + item));

// A short link answers with a redirect (or a page that moves on by script) to the shop's address.
export async function followXiaoeLink(address: string, get: typeof fetch = (...args) => fetch(...args)): Promise<string | null> {
	const own = xiaoeAddress(address); if (own) return own;
	if (!isXiaoeLink(address)) return null;
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
	try {
		const response = await get(address, { redirect: 'follow', credentials: 'omit', signal: controller.signal });
		const landed = xiaoeAddress(response.url); if (landed) return landed;
		// A landing page that moves on by script: the shop address is written in it.
		const html = (await response.text()).slice(0, 200000);
		for (const found of html.match(/https:\/\/app[0-9a-z]+\.[^"'\s<>\\]+/gi) || []) { const next = xiaoeAddress(found.replace(/&amp;/g, '&')); if (next) return next; }
	} catch { /* not reachable */ } finally { clearTimeout(timer); }
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

const loginUrlOf = (origin: string) => `${origin}/p/t/free/v1/basic-platform/h5_basic/login/auth?redirect_url=${encodeURIComponent(origin + '/p/decorate/personal_center')}`;

// Read the replay through the shop's API (`api` runs the request as the signed-in viewer), then measure the playlist.
export async function readXiaoeLive(address: string, api: Api, playlist: (url: string) => Promise<string>): Promise<XiaoeReply> {
	const parts = xiaoeParts(address); if (!parts) return { ok: false, error: 'not-live' };
	const { app, live, origin } = parts, canonical = xiaoeAddress(address)!;
	const lines = await api(`/_alive/v3/get_lookback_list?app_id=${app}&alive_id=${live}`);
	if (!lines) return { ok: false, error: 'failed', address: canonical };
	if (lines.code === 11302) return { ok: false, error: 'login', address: canonical, loginUrl: loginUrlOf(origin) };
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

// Bound the actual response body, including slow readers; slicing text after download is too late.
export async function fetchXiaoePlaylist(url: string, get: typeof fetch = fetch, maxBytes = 4_000_000, timeoutMs = 20000): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Replay playlist timed out')); }, timeoutMs); });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const read = async () => {
        const response = await get(url, {credentials:'omit', redirect:'error', signal:controller.signal});
        if (!response.ok || !response.body) throw new Error('Replay playlist unavailable');
        if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Replay playlist too large');
        reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, text = '';
        while (true) {
            const {value, done} = await reader.read(); if (done) break;
            bytes += value.byteLength; if (bytes > maxBytes) throw new Error('Replay playlist too large');
            text += decoder.decode(value, {stream:true});
        }
        return text + decoder.decode();
    };
    try { return await Promise.race([read(), timedOut]); }
    finally { clearTimeout(timer!); controller.abort(); void reader?.cancel().catch(() => {}); }
}
