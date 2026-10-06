import type { PanelSegment } from './youtube-panel-actions';
import { formatClock } from './youtube-innertube-transcript';
import { chooseTrack, languageBase, type TrackInfo } from './subtitle-language';

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

export const audioLanguageOf = (player: any): string | undefined => {
	const language = player?.videoDetails?.defaultAudioLanguage || player?.microformat?.playerMicroformatRenderer?.defaultAudioLanguage;
	if (typeof language === 'string' && language.trim()) return language.trim();
	const renderer = player?.captions?.playerCaptionsTracklistRenderer;
	const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex];
	// Multi-audio videos may omit videoDetails.defaultAudioLanguage entirely.
	// Track IDs contain the language followed by a numeric rendition suffix.
	const fromId = (id: unknown) => typeof id === 'string' ? id.match(/^([a-z]{2,3}(?:-[a-zA-Z0-9]+)*)\.\d+$/)?.[1] : undefined;
	const selected = fromId(audio?.audioTrackId);
	if (selected) return selected;
	const formats = player?.streamingData?.adaptiveFormats;
	const defaultAudio = Array.isArray(formats) ? formats.find(format => format.audioTrack?.audioIsDefault)?.audioTrack : undefined;
	const fromFormat = fromId(defaultAudio?.id);
	if (fromFormat) return fromFormat;
	const index = audio?.defaultCaptionTrackIndex;
	return Number.isInteger(index) ? renderer?.captionTracks?.[index]?.languageCode : undefined;
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

export const audioLanguageFromDocument = (doc: Document, videoId?: string): string | undefined => {
	for (const script of Array.from(doc.scripts)) {
		const player = playerFromWatchHtml(script.textContent || '');
		if (videoId && player?.videoDetails?.videoId && player.videoDetails.videoId !== videoId) continue;
		const language = audioLanguageOf(player); if (language) return language;
	}
	return undefined;
};

interface CaptionTrackSource { tracks: CaptionTrack[]; audioLanguage?: string }
async function fetchCaptionSource(videoId: string, doc: Document, request: Request): Promise<CaptionTrackSource> {
	const key = apiKeyFromPage(doc), hl = doc.documentElement.lang || 'en';
	const pageLanguage = audioLanguageFromDocument(doc, videoId);
	for (const client of CLIENTS) {
		try {
			const response = await ok(await request(`/youtubei/v1/player?prettyPrint=false${key ? `&key=${key}` : ''}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: { ...client, hl } }, videoId, contentCheckOk: true, racyCheckOk: true }) }));
			const player = await response.json();
			const tracks = tracksOf(player); if (tracks.length) return { tracks, audioLanguage: pageLanguage || audioLanguageOf(player) };
		} catch { /* try the next client */ }
	}
	try {
		const page = await ok(await request(`/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'include' }));
		const player = playerFromWatchHtml(await page.text());
		return { tracks: tracksOf(player), audioLanguage: audioLanguageOf(player) || pageLanguage };
	} catch { return { tracks: [], audioLanguage: pageLanguage }; }
}

export async function fetchCaptionTracks(videoId: string, doc: Document, request: Request = (...args) => fetch(...args)): Promise<CaptionTrack[]> {
	return (await fetchCaptionSource(videoId, doc, request)).tracks;
}

const normalizedLanguage = (language: string) => language.trim().toLowerCase().replace(/_/g, '-');
export const sameLanguage = (left: string, right: string): boolean => {
	const a = normalizedLanguage(left), b = normalizedLanguage(right);
	return Boolean(a && b) && (a === b || a.split('-')[0] === b.split('-')[0]);
};

export interface YouTubeTrack extends TrackInfo { track: CaptionTrack }
const nameOf = (name: any): string => (typeof name?.simpleText === 'string' ? name.simpleText : Array.isArray(name?.runs) ? name.runs.map((run: { text?: string }) => run.text || '').join('') : '').trim();
// Every caption track the video offers (token-gated ones left out), with its language and whether YouTube made it from the audio.
export function trackInfos(tracks: CaptionTrack[]): YouTubeTrack[] {
	const seen = new Map<string, number>();
	return tracks.filter(track => !/[?&]exp=xpe\b/.test(track.baseUrl)).map(track => {
		const auto = track.kind === 'asr', base = `${track.languageCode || 'und'}${auto ? '-auto' : ''}`, count = (seen.get(base) ?? 0) + 1; seen.set(base, count);
		return { id: count > 1 ? `${base}~${count}` : base, label: nameOf(track.name) || `${track.languageCode}${auto ? ' (auto-generated)' : ''}`, language: languageBase(track.languageCode), auto, track };
	});
}
// Spoken language first (see chooseTrack); `preferred` is a language the viewer picked for this video.
export function pickTrack(tracks: CaptionTrack[], audioLanguage?: string): CaptionTrack | undefined {
	const usable = tracks.filter(track => !/[?&]exp=xpe\b/.test(track.baseUrl));
	const manual = usable.filter(track => track.kind !== 'asr'), automatic = usable.filter(track => track.kind === 'asr');
	const exact = audioLanguage ? usable.filter(track => normalizedLanguage(track.languageCode) === normalizedLanguage(audioLanguage)) : [];
	const matching = exact.length ? exact : audioLanguage ? usable.filter(track => sameLanguage(track.languageCode, audioLanguage)) : [];
	if (matching.length) return matching.find(track => track.kind !== 'asr') || matching[0];
	if (automatic.length === 1) return manual.find(track => sameLanguage(track.languageCode, automatic[0].languageCode)) || automatic[0];
	return manual.find(track => /^en(?:-|$)/i.test(track.languageCode))
		|| automatic.find(track => /^en(?:-|$)/i.test(track.languageCode))
		|| automatic[0] || manual[0];
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

export async function fetchTrackSegments(track: CaptionTrack, request: Request = (...args) => fetch(...args)): Promise<PanelSegment[]> {
	const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
	for (const url of [`${base}&fmt=json3`, base]) {
		try { const segments = parseCaptions(await (await ok(await request(url, { credentials: 'include' }))).text()); if (segments.length) return segments; } catch { /* try the plain format */ }
	}
	return [];
}

export type CaptionSource = 'manual' | 'automatic';
export interface CaptionResult { segments: PanelSegment[]; tracks: YouTubeTrack[]; selected?: string; language?: string; source?: CaptionSource }
export async function fetchCaptionResult(videoId: string, doc: Document, request: Request = (...args) => fetch(...args), preferred?: string): Promise<CaptionResult> {
	const source = await fetchCaptionSource(videoId, doc, request), tracks = trackInfos(source.tracks);
	const defaultTrack = pickTrack(source.tracks, source.audioLanguage);
	const chosen = preferred ? chooseTrack(tracks, preferred) : tracks.find(item => item.track === defaultTrack);
	if (!chosen) return { segments: [], tracks };
	return { segments: await fetchTrackSegments(chosen.track, request), tracks, selected: chosen.id, language: chosen.track.languageCode, source: chosen.auto ? 'automatic' : 'manual' };
}
export async function fetchCaptionSegments(videoId: string, doc: Document, request: Request = (...args) => fetch(...args)): Promise<PanelSegment[]> {
	return (await fetchCaptionResult(videoId, doc, request)).segments;
}
