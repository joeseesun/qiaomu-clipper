import type { WebInfo } from './asr-client';
import type { PanelSegment } from './youtube-panel-actions';
import type { LanguageOption } from './subtitle-language';

export interface TedMedia extends WebInfo { segments: PanelSegment[]; languages: LanguageOption[]; language: string; nativeLanguage: string }
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function parseTedMedia(doc: Document, address: string): TedMedia | undefined {
	let data; try { data = JSON.parse(doc.querySelector('#__NEXT_DATA__')?.textContent || '{}').props?.pageProps; } catch { return; }
	const video = data?.videoData, player = video?.videoPlayerData, translation = data?.transcriptData?.translation;
	// Reject stale SPA data from a different talk.
	if (!video?.slug || new URL(address).pathname !== `/talks/${video.slug}`) return;
	const cues = (translation?.paragraphs ?? []).flatMap((p: any) => p.cues ?? []).filter((c: any) => typeof c.text === 'string' && c.text.trim() && typeof c.time === 'number' && c.time >= 0);
	const segments = cues.map((c: any) => ({ time: clock(c.time / 1000), text: c.text.trim(), start: c.time / 1000 }));
	const files = (player?.resources?.h264 ?? []).filter((f: any) => typeof f.file === 'string' && /^https:\/\/[^/]+\.tedcdn\.com\//.test(f.file));
	files.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
	return { ok: true, title: video.title || '', author: video.presenterDisplayName || '', seconds: player?.duration || video.duration || null, thumbnail: player?.thumb || null, site: 'TED', mediaUrl: files[0]?.file || null, video: true, description: video.description || '', date: video.recordedOn || null,
		segments, language: translation?.language?.internalLanguageCode || player?.nativeLanguage || 'en', nativeLanguage: player?.nativeLanguage || video.language || 'en',
		languages: (player?.languages ?? []).map((l: any) => ({ id: l.languageCode, label: l.endonym || l.languageName || l.languageCode })).filter((l: LanguageOption) => typeof l.id === 'string') };
}

export async function readTedMedia(address: string, fetchHtml: (url: string) => Promise<string>, doc?: Document, language?: string): Promise<TedMedia | undefined> {
	const url = new URL(address); if (!['www.ted.com', 'ted.com'].includes(url.hostname) || !url.pathname.startsWith('/talks/')) return;
	try {
		let media = doc ? parseTedMedia(doc, address) : undefined;
		if (!media) media = parseTedMedia(new DOMParser().parseFromString(await fetchHtml(url.href), 'text/html'), address);
		const wanted = language || media?.nativeLanguage;
		if (wanted && media?.language !== wanted) {
			url.search = ''; if (wanted) url.searchParams.set('language', wanted);
			media = parseTedMedia(new DOMParser().parseFromString(await fetchHtml(url.href), 'text/html'), address);
		}
		// A failed translation response must never be labelled as the requested language.
		return language && media?.language !== language ? undefined : media;
	} catch { return; }
}
