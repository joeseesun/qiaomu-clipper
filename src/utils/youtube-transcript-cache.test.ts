import { beforeEach, expect, it } from 'vitest';
import { CACHE_LIMIT, createTranscriptCache, MAX_BYTES, type CacheStorage } from './youtube-transcript-cache';

let data: Record<string, any>;
const storage: CacheStorage = { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])), set: async items => { Object.assign(data, JSON.parse(JSON.stringify(items))); }, remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
const lines = [{ time: '0:05', text: 'Hello' }, { time: '0:09', text: 'there', chapter: 'Intro' }];
const id = (n: number) => `video${String(n).padStart(6, '0')}`;
beforeEach(() => { data = {}; });

it('reads v2 cache entries without language and preserves metadata on new entries', async () => {
	data['qiaomuTranscript2:abcdefghijk'] = { segments: lines, at: 1 };
	const cache = createTranscriptCache(storage);
	expect(await cache.read('abcdefghijk')).toEqual({ segments: lines });
	await cache.write('abcdefghijk', lines, 'en');
	expect(await cache.read('abcdefghijk')).toEqual({ segments: lines, language: 'en' });
});

it('keeps a transcript per video and returns it as written, chapters included', async () => {
	const cache = createTranscriptCache(storage); expect(await cache.read('abcdefghijk')).toBeUndefined();
	await cache.write('abcdefghijk', lines, 'en'); expect(await cache.read('abcdefghijk')).toEqual({ segments: lines, language: 'en' }); expect(await cache.read('zzzzzzzzzzz')).toBeUndefined();
});

it('never stores an empty, malformed or oversized transcript, or a made-up id', async () => {
	const cache = createTranscriptCache(storage);
	await cache.write('abcdefghijk', []); await cache.write('abcdefghijk', [{ time: 5, text: 'x' }] as any); await cache.write('bad id', lines);
	await cache.write('abcdefghijk', [{ time: '0:01', text: 'x'.repeat(MAX_BYTES) }]); expect(Object.keys(data)).toEqual([]);
	data['qiaomuTranscript2:abcdefghijk'] = { segments: 'corrupt' }; expect(await cache.read('abcdefghijk')).toBeUndefined();
});

it('keeps only the newest transcripts and refreshes a video that is written again', async () => {
	const cache = createTranscriptCache(storage);
	for (let n = 0; n < CACHE_LIMIT + 5; n++) await cache.write(id(n), lines);
	expect(await cache.read(id(0))).toBeUndefined(); expect(await cache.read(id(CACHE_LIMIT + 4))).toEqual({ segments: lines }); expect(data.qiaomuTranscriptIndex2).toHaveLength(CACHE_LIMIT);
	await cache.write(id(10), lines); expect(data.qiaomuTranscriptIndex2[0].id).toBe(id(10)); expect(data.qiaomuTranscriptIndex2.filter((entry: any) => entry.id === id(10))).toHaveLength(1);
});

it('survives a storage that fails', async () => {
	const broken: CacheStorage = { get: async () => { throw new Error('gone'); }, set: async () => { throw new Error('full'); }, remove: async () => { throw new Error('gone'); } };
	const cache = createTranscriptCache(broken); expect(await cache.read('abcdefghijk')).toBeUndefined(); await expect(cache.write('abcdefghijk', lines)).resolves.toBeUndefined();
});

it('preserves whether a cached transcript came from YouTube automatic speech recognition', async () => {
	data = {}; const cache = createTranscriptCache(storage);
	await cache.write('abcdefghijk', lines, 'en', 'automatic');
	expect(await cache.read('abcdefghijk')).toEqual({ segments: lines, language: 'en', source: 'automatic' });
});

it('keeps a Bilibili transcript under its own video-and-part key, and nothing under a malformed one', async () => {
	data = {}; const cache = createTranscriptCache(storage);
	await cache.write('bilibili:BV1GJ411x7h7:2', lines); expect(await cache.read('bilibili:BV1GJ411x7h7:2')).toEqual({ segments: lines });
	await cache.write('bilibili:../../x:1', lines); await cache.write('bilibili:BV1GJ411x7h7:', lines); await cache.write('BV1GJ411x7h7', lines);
	expect(Object.keys(data).filter(key => key.startsWith('qiaomuTranscript2:'))).toEqual(['qiaomuTranscript2:bilibili:BV1GJ411x7h7:2']);
});

it('keeps a transcript per subtitle language the viewer chose, next to the default one, and rejects a malformed language', async () => {
	data = {}; const cache = createTranscriptCache(storage); const other = [{ time: '0:01', text: '中文' }];
	await cache.write('abcdefghijk', lines); await cache.write('abcdefghijk#zh', other); await cache.write('bilibili:BV1GJ411x7h7:2#en', lines); await cache.write('generated:youtube:abcdefghijk#ja', lines);
	expect(await cache.read('abcdefghijk')).toEqual({ segments: lines }); expect(await cache.read('abcdefghijk#zh')).toEqual({ segments: other }); expect(await cache.read('bilibili:BV1GJ411x7h7:2#en')).toEqual({ segments: lines });
	await cache.write('abcdefghijk#ZH', lines); await cache.write('abcdefghijk#zh-CN', lines); await cache.write('abcdefghijk#', lines); await cache.write('abcdefghijk#../x', lines);
	expect(Object.keys(data).filter(key => key.startsWith('qiaomuTranscript2:')).sort()).toEqual(['qiaomuTranscript2:abcdefghijk', 'qiaomuTranscript2:abcdefghijk#zh', 'qiaomuTranscript2:bilibili:BV1GJ411x7h7:2#en', 'qiaomuTranscript2:generated:youtube:abcdefghijk#ja']);
});
