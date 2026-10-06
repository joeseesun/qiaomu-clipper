import type { WebInfo } from './asr-client';
import type { PanelSegment } from './youtube-panel-actions';
import type { LanguageOption } from './subtitle-language';

export interface TedMedia extends WebInfo { segments: PanelSegment[]; languages: LanguageOption[]; language: string; nativeLanguage: string; metadataUrl?: string; timelineAligned?: boolean }
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
		metadataUrl: player?.resources?.hls?.metadata, segments, language: translation?.language?.internalLanguageCode || player?.nativeLanguage || 'en', nativeLanguage: player?.nativeLanguage || video.language || 'en',
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
		if (media?.metadataUrl && /^https:\/\/hls\.ted\.com\//.test(media.metadataUrl)) {
			try {
				const metadata = JSON.parse(await fetchHtml(media.metadataUrl));
				const track = metadata.subtitles?.find((t: any) => t.code === media!.language);
				const url = track?.webvtt;
				const timed = typeof url === 'string' && /^https:\/\/hls\.ted\.com\//.test(url) ? parseTedVtt(await fetchHtml(url)) : [];
				if (timed.length) { media.segments = timed; media.timelineAligned = true; }
				else if (Array.isArray(metadata.domains) && metadata.domains.some((d: any) => d.primaryDomain)) {
					let offset = 0;
					for (const domain of metadata.domains) { if (domain.primaryDomain) break; if (typeof domain.duration !== 'number' || !Number.isFinite(domain.duration) || domain.duration < 0) throw new Error('Invalid TED timeline'); offset += domain.duration; }
					media.segments = media.segments.map(s => { const start = (s.start ?? 0) + offset; return { ...s, start, time: clock(start) }; }); media.timelineAligned = true;
				}
			} catch { /* Keep the official text; caller can report that timing was not aligned. */ }
		}
		// A failed translation response must never be labelled as the requested language.
		return language && media?.language !== language ? undefined : media;
	} catch { return; }
}

export function parseTedVtt(text: string): PanelSegment[] {
 const lines: PanelSegment[] = [];
 const seconds = (t: string) => t.split(':').reduce((n, p) => n * 60 + Number(p), 0);
 for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
  const parts = block.split('\n'), i = parts.findIndex(s => /\d+:\d+:\d+\.\d+\s+-->/.test(s));
  if (i < 0) continue;
  const match = parts[i].match(/(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)/); if (!match) continue;
  const start = seconds(match[1]), end = seconds(match[2]);
  const doc = new DOMParser().parseFromString(parts.slice(i + 1).join(' '), 'text/html'); const caption = doc.body.textContent?.trim();
  if (caption && Number.isFinite(start) && end > start) lines.push({ time: clock(start), text: caption, start, end });
 }
 return lines;
}
