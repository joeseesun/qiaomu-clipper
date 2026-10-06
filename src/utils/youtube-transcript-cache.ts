import type { PanelSegment } from './youtube-panel-actions';
import type { CaptionSource } from './youtube-captions';

// A transcript that has been read once is kept, so reopening the video (or refreshing the page, when YouTube is slow to
// build its own transcript UI) shows it at once and study mode does not wait. Kept per video in extension storage,
// newest 30 only, and never an empty or oversized one.
export interface CacheStorage { get(keys: string | string[]): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> }
// v2: transcripts are cached per subtitle language the viewer chose, and the default language changed (the spoken one, not Chinese).
const INDEX = 'qiaomuTranscriptIndex2', prefix = 'qiaomuTranscript2:';
const VALID_KEY = /^(?:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|generated:(?:youtube:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|xiaoyuzhou:[0-9a-f]{24}|file:[0-9a-f]{32}|rss:[0-9a-f]{12}:[0-9a-f]{16}|web:[0-9a-f]{12}))(?:#[a-z]{2,8})?$/;
export const CACHE_LIMIT = 30, MAX_BYTES = 800_000;
export interface CachedTranscript { segments: PanelSegment[]; language?: string; source?: CaptionSource }

const valid = (value: unknown): value is PanelSegment[] => Array.isArray(value) && value.length > 0 && value.every(line => typeof line?.time === 'string' && typeof line?.text === 'string');

export function createTranscriptCache(storage: CacheStorage) {
	return {
		async read(videoId: string): Promise<CachedTranscript | undefined> {
			try {
				const value = (await storage.get(prefix + videoId))[prefix + videoId];
				return valid(value?.segments) ? { segments: value.segments, ...(typeof value.language === 'string' ? { language: value.language } : {}), ...(value.source === 'manual' || value.source === 'automatic' ? { source: value.source } : {}) } : undefined;
			} catch { return undefined; }
		},
		async write(videoId: string, segments: PanelSegment[], language?: string, source?: CaptionSource): Promise<void> {
			if (!VALID_KEY.test(videoId) || !valid(segments) || JSON.stringify(segments).length > MAX_BYTES) return;
			try {
				const index: Array<{ id: string; at: number }> = ((await storage.get(INDEX))[INDEX] as Array<{ id: string; at: number }> | undefined) || [];
				const next = [{ id: videoId, at: Date.now() }, ...index.filter(entry => entry.id !== videoId)];
				const drop = next.slice(CACHE_LIMIT);
				await storage.set({ [prefix + videoId]: { segments, ...(language ? { language } : {}), ...(source ? { source } : {}), at: Date.now() }, [INDEX]: next.slice(0, CACHE_LIMIT) });
				if (drop.length) await storage.remove(drop.map(entry => prefix + entry.id));
			} catch { /* a full or unavailable store only means no cache */ }
		},
	};
}
