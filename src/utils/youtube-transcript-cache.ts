import type { PanelSegment } from './youtube-panel-actions';

// A transcript that has been read once is kept, so reopening the video (or refreshing the page, when YouTube is slow to
// build its own transcript UI) shows it at once and study mode does not wait. Kept per video in extension storage,
// newest 30 / 4 MiB of refetchable captions. Generated results are retained separately.
export interface CacheStorage { get(keys: string | string[]): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> }
// v3 retains precise cue boundaries for player captions. Keep generated v2 results as a fallback to avoid repeating paid transcription.
const INDEX = 'qiaomuTranscriptIndex3';
const cacheKey = (id: string) => (id.startsWith('generated:') ? 'qiaomuTranscript2:' : 'qiaomuTranscript3:') + id;
const VALID_KEY = /^(?:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|generated:(?:youtube:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|xiaoyuzhou:[0-9a-f]{24}|file:[0-9a-f]{32}|rss:[0-9a-f]{12}:[0-9a-f]{16}|web:[0-9a-f]{12}))(?:#[a-z]{2,8})?$/;
export const CACHE_LIMIT = 30, MAX_BYTES = 800_000;
const CACHE_BYTES = 4 * 1024 * 1024;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const queues = new WeakMap<CacheStorage, Promise<unknown>>();
async function withCacheLock(storage: CacheStorage, work: () => Promise<void>): Promise<void> {
 const run = () => typeof navigator !== 'undefined' && navigator.locks
  ? navigator.locks.request('qiaomu-transcript-cache', work) : work();
 const next = (queues.get(storage) || Promise.resolve()).catch(() => {}).then(run);
 queues.set(storage, next);
 try { await next; } finally { if (queues.get(storage) === next) queues.delete(storage); }
}

const valid = (value: unknown): value is PanelSegment[] => Array.isArray(value) && value.length > 0 && value.every(line => typeof line?.time === 'string' && typeof line?.text === 'string');

export function createTranscriptCache(storage: CacheStorage) {
	return {
		async read(videoId: string): Promise<PanelSegment[] | undefined> {
			try { const key = cacheKey(videoId); const value = (await storage.get(key))[key]; return valid(value?.segments) ? value.segments : undefined; } catch { return undefined; }
		},
		async write(videoId: string, segments: PanelSegment[]): Promise<void> {
            const generated = videoId.startsWith('generated:');
            if (!VALID_KEY.test(videoId) || !valid(segments) || (!generated && bytes(segments) > MAX_BYTES)) return;
            try { await withCacheLock(storage, async () => {
                const raw = (await storage.get(INDEX))[INDEX];
                const index: Array<{id:string;at:number}> = Array.isArray(raw) ? raw.filter(entry => entry && VALID_KEY.test(entry.id) && Number.isFinite(entry.at)) : [];
                const next = [{id:videoId,at:Date.now()}, ...index.filter(entry => entry.id !== videoId)];
                const official = next.filter(entry => !entry.id.startsWith('generated:'));
                const values = official.length ? await storage.get(official.map(entry => cacheKey(entry.id))) : {};
                const value = {segments,at:Date.now()};
                const keep = [], drop: string[] = [];
                let size = 0, count = 0;
                for (const entry of next) {
                    if (entry.id.startsWith('generated:')) { keep.push(entry); continue; }
                    const item = entry.id === videoId ? value : values[cacheKey(entry.id)];
                    if (!item) continue;
                    const cost = bytes(item) + bytes(cacheKey(entry.id));
                    if (count >= CACHE_LIMIT || size + cost > CACHE_BYTES) { drop.push(cacheKey(entry.id)); continue; }
                    size += cost; count++; keep.push(entry);
                }
                // Reclaim space before allocating the new value. Never evict paid/generated transcripts.
                if (drop.length) await storage.remove(drop);
                await storage.set({[cacheKey(videoId)]:value,[INDEX]:keep});
            }); } catch { /* Cache failure must not block playback. */ }
		},
	};
}
