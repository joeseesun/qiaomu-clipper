import type { PanelSegment } from './youtube-panel-actions';

// A transcript that has been read once is kept, so reopening the video (or refreshing the page, when YouTube is slow to
// build its own transcript UI) shows it at once and study mode does not wait. Kept per video in extension storage,
// newest 30 only, and never an empty or oversized one.
export interface CacheStorage { get(keys: string | string[]): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> }
const INDEX = 'qiaomuTranscriptIndex', prefix = 'qiaomuTranscript:';
// Older entries may contain the default language even when Chinese captions exist.
const VERSION = 2;
export const CACHE_LIMIT = 30, MAX_BYTES = 800_000;

const valid = (value: unknown): value is PanelSegment[] => Array.isArray(value) && value.length > 0 && value.every(line => typeof line?.time === 'string' && typeof line?.text === 'string');

export function createTranscriptCache(storage: CacheStorage) {
	return {
		async read(videoId: string): Promise<PanelSegment[] | undefined> {
			try { const value = (await storage.get(prefix + videoId))[prefix + videoId]; return value?.version === VERSION && valid(value?.segments) ? value.segments : undefined; } catch { return undefined; }
		},
		async write(videoId: string, segments: PanelSegment[]): Promise<void> {
			if (!/^[\w-]{11}$|^bilibili:BV[0-9A-Za-z]{10}:\d{1,4}$/.test(videoId) || !valid(segments) || JSON.stringify(segments).length > MAX_BYTES) return;
			try {
				const index: Array<{ id: string; at: number }> = ((await storage.get(INDEX))[INDEX] as Array<{ id: string; at: number }> | undefined) || [];
				const next = [{ id: videoId, at: Date.now() }, ...index.filter(entry => entry.id !== videoId)];
				const drop = next.slice(CACHE_LIMIT);
				await storage.set({ [prefix + videoId]: { version: VERSION, segments, at: Date.now() }, [INDEX]: next.slice(0, CACHE_LIMIT) });
				if (drop.length) await storage.remove(drop.map(entry => prefix + entry.id));
			} catch { /* a full or unavailable store only means no cache */ }
		},
	};
}
