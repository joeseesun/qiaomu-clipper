import { beforeEach, expect, it } from 'vitest';
import { CACHE_LIMIT, createTranscriptCache, MAX_BYTES, type CacheStorage } from './youtube-transcript-cache';

let data: Record<string, any>;
const storage: CacheStorage = { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])), set: async items => { Object.assign(data, JSON.parse(JSON.stringify(items))); }, remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
const lines = [{ time: '0:05', text: 'Hello' }, { time: '0:09', text: 'there', chapter: 'Intro' }];
const id = (n: number) => `video${String(n).padStart(6, '0')}`;
beforeEach(() => { data = {}; });

it('ignores transcripts cached before Chinese-first selection was introduced', async () => {
	data['qiaomuTranscript:abcdefghijk'] = { segments: lines, at: Date.now() };
	const cache = createTranscriptCache(storage);
	expect(await cache.read('abcdefghijk')).toBeUndefined();
	await cache.write('abcdefghijk', [{ time: '0:05', text: '中文字幕' }]);
	expect(await cache.read('abcdefghijk')).toEqual([{ time: '0:05', text: '中文字幕' }]);
});

it('keeps a transcript per video and returns it as written, chapters included', async () => {
	const cache = createTranscriptCache(storage); expect(await cache.read('abcdefghijk')).toBeUndefined();
	await cache.write('abcdefghijk', lines); expect(await cache.read('abcdefghijk')).toEqual(lines); expect(await cache.read('zzzzzzzzzzz')).toBeUndefined();
});

it('never stores an empty, malformed or oversized transcript, or a made-up id', async () => {
	const cache = createTranscriptCache(storage);
	await cache.write('abcdefghijk', []); await cache.write('abcdefghijk', [{ time: 5, text: 'x' }] as any); await cache.write('bad id', lines);
	await cache.write('abcdefghijk', [{ time: '0:01', text: 'x'.repeat(MAX_BYTES) }]); expect(Object.keys(data)).toEqual([]);
	data['qiaomuTranscript:abcdefghijk'] = { segments: 'corrupt' }; expect(await cache.read('abcdefghijk')).toBeUndefined();
});

it('keeps only the newest transcripts and refreshes a video that is written again', async () => {
	const cache = createTranscriptCache(storage);
	for (let n = 0; n < CACHE_LIMIT + 5; n++) await cache.write(id(n), lines);
	expect(await cache.read(id(0))).toBeUndefined(); expect(await cache.read(id(CACHE_LIMIT + 4))).toEqual(lines); expect(data.qiaomuTranscriptIndex).toHaveLength(CACHE_LIMIT);
	await cache.write(id(10), lines); expect(data.qiaomuTranscriptIndex[0].id).toBe(id(10)); expect(data.qiaomuTranscriptIndex.filter((entry: any) => entry.id === id(10))).toHaveLength(1);
});

it('survives a storage that fails', async () => {
	const broken: CacheStorage = { get: async () => { throw new Error('gone'); }, set: async () => { throw new Error('full'); }, remove: async () => { throw new Error('gone'); } };
	const cache = createTranscriptCache(broken); expect(await cache.read('abcdefghijk')).toBeUndefined(); await expect(cache.write('abcdefghijk', lines)).resolves.toBeUndefined();
});

it('keeps a Bilibili transcript under its own video-and-part key, and nothing under a malformed one', async () => {
	data = {}; const cache = createTranscriptCache(storage);
	await cache.write('bilibili:BV1GJ411x7h7:2', lines); expect(await cache.read('bilibili:BV1GJ411x7h7:2')).toEqual(lines);
	await cache.write('bilibili:../../x:1', lines); await cache.write('bilibili:BV1GJ411x7h7:', lines); await cache.write('BV1GJ411x7h7', lines);
	expect(Object.keys(data).filter(key => key.startsWith('qiaomuTranscript:'))).toEqual(['qiaomuTranscript:bilibili:BV1GJ411x7h7:2']);
});
