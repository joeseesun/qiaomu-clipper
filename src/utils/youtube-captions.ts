import { originalAudioLanguage } from './youtube-audio-language';
import type { PanelSegment } from './youtube-panel-actions';
import { formatClock } from './youtube-innertube-transcript';
import { chooseTrack, languageBase, type TrackInfo } from './subtitle-language';

// The well-trodden route used by youtube-transcript-api, yt-dlp and Defuddle: ask InnerTube's player endpoint for the
// caption track list as a mobile client (these are not gated by a player token, unlike the web client), then
// download the chosen track. A track whose URL carries `exp=xpe` is token-gated and is skipped. Runs inside the
// YouTube tab so the request carries the viewer's cookies and origin.
export interface CaptionTrack { baseUrl: string; languageCode: string; kind?: string; name?: unknown; vssId?: string; original?: boolean }

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
	const language = originalAudioLanguage(player);
	return Array.isArray(list) ? list.filter((track: CaptionTrack) => typeof track?.baseUrl === 'string' && track.baseUrl).map((track: CaptionTrack) => ({ ...track, original: Boolean(language && languageBase(track.languageCode) === language && !/[?&]tlang=/.test(track.baseUrl)) })) : [];
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

export interface YouTubeTrack extends TrackInfo { track: CaptionTrack }
const nameOf = (name: any): string => (typeof name?.simpleText === 'string' ? name.simpleText : Array.isArray(name?.runs) ? name.runs.map((run: { text?: string }) => run.text || '').join('') : '').trim();
// Every caption track the video offers, with its language and whether YouTube made it from the audio.
// A track whose address carries exp=xpe needs the player's proof; it is left out unless the caller can supply that (the player route).
export function trackInfos(tracks: CaptionTrack[], includeGated = false, originalLanguage?: string): YouTubeTrack[] {
	const seen = new Map<string, number>();
	return tracks.filter(track => includeGated || !/[?&]exp=xpe\b/.test(track.baseUrl)).map(track => {
		const auto = track.kind === 'asr', base = `${track.languageCode || 'und'}${auto ? '-auto' : ''}`, count = (seen.get(base) ?? 0) + 1; seen.set(base, count);
		return { id: count > 1 ? `${base}~${count}` : base, label: nameOf(track.name) || `${track.languageCode}${auto ? ' (auto-generated)' : ''}`, language: languageBase(track.languageCode), auto, translated: /[?&]tlang=/.test(track.baseUrl), original: !/[?&]tlang=/.test(track.baseUrl) && Boolean(track.original || (originalLanguage && languageBase(track.languageCode) === languageBase(originalLanguage))), track };
	});
}
// Spoken language first (see chooseTrack); `preferred` is a language the viewer picked for this video.
export function pickTrack(tracks: CaptionTrack[], preferred?: string): CaptionTrack | undefined { return chooseTrack(trackInfos(tracks), preferred)?.track; }

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

export async function fetchTrackSegments(track: CaptionTrack, request: Request = (...args) => fetch(...args)): Promise<PanelSegment[]> {
	const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
	for (const url of [`${base}&fmt=json3`, base]) {
		try { const segments = parseCaptions(await (await ok(await request(url, { credentials: 'include' }))).text()); if (segments.length) return segments; } catch { /* try the plain format */ }
	}
	return [];
}

// `fetchTrack` is there when the tracks were read through the player: a track other than the chosen one needs the same proof.
export interface CaptionResult { segments: PanelSegment[]; tracks: YouTubeTrack[]; selected?: string; fetchTrack?: (track: CaptionTrack) => Promise<PanelSegment[]> }
export async function fetchCaptionResult(videoId: string, doc: Document, request: Request = (...args) => fetch(...args), preferred?: string): Promise<CaptionResult> {
	const tracks = trackInfos(await fetchCaptionTracks(videoId, doc, request)), chosen = chooseTrack(tracks, preferred);
	if (!chosen) return { segments: [], tracks };
	return { segments: await fetchTrackSegments(chosen.track, request), tracks, selected: chosen.id };
}
export async function fetchCaptionSegments(videoId: string, doc: Document, request: Request = (...args) => fetch(...args)): Promise<PanelSegment[]> {
	return (await fetchCaptionResult(videoId, doc, request)).segments;
}
