import type { PanelSegment } from './youtube-panel-actions';

// Subtitles of a Bilibili video, read from the viewer's own page (their login and site context are real there).
// Bilibili returns subtitle tracks only to a signed-in viewer; without one the list is empty and says so.
export type GetJson = (url: string, withCookies: boolean) => Promise<any>;
export interface BilibiliCaptions { segments: PanelSegment[]; needLogin: boolean; language?: string }

interface Track { id?: number; lan?: string; lan_doc?: string; is_ai_subtitle?: boolean; subtitle_url?: string }
const MAX_LINES = 20000;
const BILIBILI_HOST = /(^|\.)(bilibili\.com|hdslb\.com)$/;

export const stampOf = (seconds: number): string => {
	const total = Math.max(0, Math.floor(seconds)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
	return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
};

// A human subtitle beats an AI one; then Simplified Chinese, other Chinese, English, the rest.
const languageRank = (code: string): number => { const lan = code.toLowerCase().replace(/_/g, '-'); return /^(ai-)?zh-(cn|hans)$/.test(lan) || lan === 'zh' || lan === 'ai-zh' ? 0 : lan.startsWith('zh') || lan.startsWith('ai-zh') ? 1 : /^(ai-)?en/.test(lan) ? 2 : 3; };
export function pickTrack(tracks: Track[]): Track | undefined {
	const usable = tracks.filter(track => typeof track.subtitle_url === 'string' && track.subtitle_url);
	const ai = (track: Track) => track.is_ai_subtitle || /^ai-/i.test(track.lan || '') || /自动|ai/i.test(track.lan_doc || '') ? 1 : 0;
	return usable.map((track, index) => ({ track, index })).sort((a, b) => ai(a.track) - ai(b.track) || languageRank(a.track.lan || '') - languageRank(b.track.lan || '') || (a.track.id ?? Infinity) - (b.track.id ?? Infinity) || a.index - b.index)[0]?.track;
}

// The subtitle file is public and lives on Bilibili's own hosts; anything else is not fetched.
export function subtitleUrl(raw: string): string | undefined {
	try {
		const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
		return url.protocol === 'https:' && BILIBILI_HOST.test(url.hostname) ? url.href : undefined;
	} catch { return undefined; }
}

export async function fetchBilibiliCaptions(bvid: string, page: number, getJson: GetJson): Promise<BilibiliCaptions> {
	const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, true);
	const data = view?.code === 0 ? view.data : undefined;
	const cid = data?.pages?.[page - 1]?.cid ?? data?.pages?.[0]?.cid ?? data?.cid;
	if (!data?.aid || !cid) throw new Error('无法读取视频信息');
	let player: any;
	for (const path of ['wbi/v2', 'v2']) {
		try { const answer = await getJson(`https://api.bilibili.com/x/player/${path}?aid=${data.aid}&cid=${cid}`, true); if (answer?.code === 0 && answer.data) { player = answer.data; break; } } catch { /* try the older endpoint */ }
	}
	if (!player) throw new Error('无法读取字幕列表');
	const tracks: Track[] = Array.isArray(player.subtitle?.subtitles) ? player.subtitle.subtitles : [];
	const track = pickTrack(tracks), href = track?.subtitle_url ? subtitleUrl(track.subtitle_url) : undefined;
	if (!track || !href) return { segments: [], needLogin: player.need_login_subtitle === true && !tracks.length };
	const file = await getJson(href, false);
	const lines: Array<{ from?: unknown; content?: unknown }> = Array.isArray(file?.body) ? file.body : [];
	const segments: PanelSegment[] = [];
	for (const line of lines.slice(0, MAX_LINES)) {
		const text = typeof line.content === 'string' ? line.content.replace(/\s+/g, ' ').trim() : '', from = Number(line.from);
		if (text && Number.isFinite(from) && from >= 0) segments.push({ time: stampOf(from), text });
	}
	return { segments, needLogin: false, language: track.lan };
}

// Bilibili's older player endpoint, when asked by bvid, answers a part that has no subtitles with a subtitle that belongs
// to some other video (seen on part 20 of BV1hM4m1U7rA: a travel vlog's lines under a lecture). Defuddle tries it after
// the reliable endpoints come back empty and takes whatever it gets, so the reader, a clip and study mode would all show
// another video's text. Once a reliable endpoint has answered for a part, that answer stands: the older endpoint is then
// answered with "no subtitles" for the same part. When the reliable ones fail, it stays available as a fallback.
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const playerRequest = (raw: string): { path: string; bvid: boolean; cid: string } | undefined => {
	try { const url = new URL(raw); return url.hostname === 'api.bilibili.com' && /^\/x\/player\/(wbi\/)?v2$/.test(url.pathname) ? { path: url.pathname, bvid: url.searchParams.has('bvid'), cid: url.searchParams.get('cid') || '' } : undefined; } catch { return undefined; }
};
export const isUnreliablePlayerUrl = (raw: string): boolean => { const request = playerRequest(raw); return Boolean(request && request.path === '/x/player/v2' && request.bvid); };
export function withReliableBilibili(base: FetchLike = (input, init) => fetch(input, init)): FetchLike {
	const answered = new Set<string>(); // parts for which a reliable endpoint replied successfully
	return async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const request = playerRequest(url);
		if (request && isUnreliablePlayerUrl(url) && request.cid && answered.has(request.cid)) return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }), { status: 200 });
		const response = await base(input, init);
		if (request && !isUnreliablePlayerUrl(url) && request.cid && response.ok) {
			try { if ((await response.clone().json())?.code === 0) answered.add(request.cid); } catch { /* not JSON: nothing is vouched for */ }
		}
		return response;
	};
}
