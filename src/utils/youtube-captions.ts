import type { PanelSegment } from './youtube-panel-actions';
import { formatClock } from './youtube-innertube-transcript';

// The well-trodden route used by youtube-transcript-api, yt-dlp and Defuddle: ask InnerTube's player endpoint for the
// caption track list as a mobile client (these are not gated by a player token, unlike the web client), then
// download the chosen track. A track whose URL carries `exp=xpe` is token-gated and is skipped. Runs inside the
// YouTube tab so the request carries the viewer's cookies and origin.
export interface CaptionTrack { baseUrl: string; languageCode: string; kind?: string; name?: unknown }

const CLIENTS: Array<Record<string, unknown>> = [
	{ clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34 },
	{ clientName: 'ANDROID_VR', clientVersion: '1.60.19', androidSdkVersion: 32 },
	{ clientName: 'IOS', clientVersion: '20.10.3' },
];

type Request = typeof fetch;
const ok = async (response: Response) => { if (!response.ok) throw new Error(`YouTube ${response.status}`); return response; };

export const apiKeyFromPage = (doc: Document): string | undefined => {
	for (const script of Array.from(doc.scripts)) { const found = script.textContent?.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)?.[1]; if (found) return found; }
	return undefined;
};

export const tracksOf = (player: any): CaptionTrack[] => {
	const list = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
	return Array.isArray(list) ? list.filter((track: CaptionTrack) => typeof track?.baseUrl === 'string' && track.baseUrl) : [];
};

// The page's own player response, for videos where the mobile clients are refused.
export function playerFromWatchHtml(html: string): any | undefined {
	const start = html.search(/ytInitialPlayerResponse\s*=\s*\{/); if (start < 0) return undefined;
	const open = html.indexOf('{', start); let depth = 0, inString = false, escaped = false;
	for (let i = open; i < html.length; i++) {
		const char = html[i];
		if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
		if (char === '"') inString = true; else if (char === '{') depth++; else if (char === '}' && --depth === 0) { try { return JSON.parse(html.slice(open, i + 1)); } catch { return undefined; } }
	}
	return undefined;
}

export async function fetchCaptionTracks(videoId: string, doc: Document, request: Request = (...args) => fetch(...args)): Promise<CaptionTrack[]> {
	const key = apiKeyFromPage(doc), hl = doc.documentElement.lang || 'en';
	for (const client of CLIENTS) {
		try {
			const response = await ok(await request(`/youtubei/v1/player?prettyPrint=false${key ? `&key=${key}` : ''}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: { ...client, hl } }, videoId, contentCheckOk: true, racyCheckOk: true }) }));
			const tracks = tracksOf(await response.json()); if (tracks.length) return tracks;
		} catch { /* try the next client */ }
	}
	try { const page = await ok(await request(`/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'include' })); return tracksOf(playerFromWatchHtml(await page.text())); } catch { return []; }
}

// Chinese first (manual before automatic), regardless of the page's interface language. Without Chinese,
// preserve the spoken-language fallback. Token-gated tracks are left out.
export function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
	const usable = tracks.filter(track => !/[?&]exp=xpe\b/.test(track.baseUrl));
	const automatic = usable.find(track => track.kind === 'asr'), manual = usable.filter(track => track.kind !== 'asr');
	const chinese = (track: CaptionTrack) => /^zh(?:[-_]|$)/i.test(track.languageCode);
	return manual.find(chinese) || usable.find(chinese) || (automatic && manual.find(track => track.languageCode === automatic.languageCode)) || automatic || manual[0];
}

const decode = (value: string) => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const clean = (value: string) => decode(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// `<text start="1.2" dur="3">…</text>` (classic) and `<p t="1200" d="3000">…</p>` (srv3), or json3 events.
export function parseCaptions(body: string): PanelSegment[] {
	const out: PanelSegment[] = [], trimmed = body.trim();
	if (trimmed.startsWith('{')) {
		try { for (const event of JSON.parse(trimmed).events || []) { const text = clean((event.segs || []).map((seg: { utf8?: string }) => seg.utf8 || '').join('')); if (text && Number.isFinite(event.tStartMs)) out.push({ time: formatClock(event.tStartMs), text }); } } catch { /* not JSON */ }
		return out;
	}
	for (const match of trimmed.matchAll(/<text\b[^>]*?\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) { const text = clean(match[2]); if (text) out.push({ time: formatClock(parseFloat(match[1]) * 1000), text }); }
	if (out.length) return out;
	for (const match of trimmed.matchAll(/<p\b[^>]*?\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) { const text = clean(match[2]); if (text) out.push({ time: formatClock(Number(match[1])), text }); }
	return out;
}

export async function fetchCaptionSegments(videoId: string, doc: Document, request: Request = (...args) => fetch(...args)): Promise<PanelSegment[]> {
	const track = pickTrack(await fetchCaptionTracks(videoId, doc, request)); if (!track) return [];
	const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
	for (const url of [`${base}&fmt=json3`, base]) {
		try { const segments = parseCaptions(await (await ok(await request(url, { credentials: 'include' }))).text()); if (segments.length) return segments; } catch { /* try the plain format */ }
	}
	return [];
}
