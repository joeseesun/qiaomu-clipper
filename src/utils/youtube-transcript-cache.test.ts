import { beforeEach, expect, it } from 'vitest';
import { CACHE_LIMIT, createTranscriptCache, MAX_BYTES, type CacheStorage } from './youtube-transcript-cache';

let data: Record<string, any>;
const storage: CacheStorage = { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])), set: async items => { Object.assign(data, JSON.parse(JSON.stringify(items))); }, remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
const lines = [{ time: '0:05', text: 'Hello' }, { time: '0:09', text: 'there', chapter: 'Intro' }];
const id = (n: number) => `video${String(n).padStart(6, '0')}`;
beforeEach(() => { data = {}; });

it('keeps a transcript per video and returns it as written, chapters included', async () => {
	const cache = createTranscriptCache(storage); expect(await cache.read('abcdefghijk')).toBeUndefined();
	await cache.write('abcdefghijk', lines); expect(await cache.read('abcdefghijk')).toEqual(lines); expect(await cache.read('zzzzzzzzzzz')).toBeUndefined();
});

it('never stores an empty, malformed or oversized transcript, or a made-up id', async () => {
	const cache = createTranscriptCache(storage);
	await cache.write('abcdefghijk', []); await cache.write('abcdefghijk', [{ time: 5, text: 'x' }] as any); await cache.write('bad id', lines);
	await cache.write('abcdefghijk', [{ time: '0:01', text: 'x'.repeat(MAX_BYTES) }]); expect(Object.keys(data)).toEqual([]);
	data['qiaomuTranscript3:abcdefghijk'] = { segments: 'corrupt' }; expect(await cache.read('abcdefghijk')).toBeUndefined();
});

it('keeps only the newest transcripts and refreshes a video that is written again', async () => {
	const cache = createTranscriptCache(storage);
	for (let n = 0; n < CACHE_LIMIT + 5; n++) await cache.write(id(n), lines);
	expect(await cache.read(id(0))).toBeUndefined(); expect(await cache.read(id(CACHE_LIMIT + 4))).toEqual(lines); expect(data.qiaomuTranscriptIndex3).toHaveLength(CACHE_LIMIT);
	await cache.write(id(10), lines); expect(data.qiaomuTranscriptIndex3[0].id).toBe(id(10)); expect(data.qiaomuTranscriptIndex3.filter((entry: any) => entry.id === id(10))).toHaveLength(1);
});

it('survives a storage that fails', async () => {
	const broken: CacheStorage = { get: async () => { throw new Error('gone'); }, set: async () => { throw new Error('full'); }, remove: async () => { throw new Error('gone'); } };
	const cache = createTranscriptCache(broken); expect(await cache.read('abcdefghijk')).toBeUndefined(); await expect(cache.write('abcdefghijk', lines)).resolves.toBeUndefined();
});

it('keeps a Bilibili transcript under its own video-and-part key, and nothing under a malformed one', async () => {
	data = {}; const cache = createTranscriptCache(storage);
	await cache.write('bilibili:BV1GJ411x7h7:2', lines); expect(await cache.read('bilibili:BV1GJ411x7h7:2')).toEqual(lines);
	await cache.write('bilibili:../../x:1', lines); await cache.write('bilibili:BV1GJ411x7h7:', lines); await cache.write('BV1GJ411x7h7', lines);
	expect(Object.keys(data).filter(key => key.startsWith('qiaomuTranscript3:'))).toEqual(['qiaomuTranscript3:bilibili:BV1GJ411x7h7:2']);
});

it('keeps a transcript per subtitle language the viewer chose, next to the default one, and rejects a malformed language', async () => {
	data = {}; const cache = createTranscriptCache(storage); const other = [{ time: '0:01', text: '中文' }];
	await cache.write('abcdefghijk', lines); await cache.write('abcdefghijk#zh', other); await cache.write('bilibili:BV1GJ411x7h7:2#en', lines); await cache.write('generated:youtube:abcdefghijk#ja', lines);
	expect(await cache.read('abcdefghijk')).toEqual(lines); expect(await cache.read('abcdefghijk#zh')).toEqual(other); expect(await cache.read('bilibili:BV1GJ411x7h7:2#en')).toEqual(lines);
	await cache.write('abcdefghijk#ZH', lines); await cache.write('abcdefghijk#zh-CN', lines); await cache.write('abcdefghijk#', lines); await cache.write('abcdefghijk#../x', lines);
	expect(Object.keys(data).filter(key => /^qiaomuTranscript[23]:/.test(key)).sort()).toEqual(['qiaomuTranscript2:generated:youtube:abcdefghijk#ja', 'qiaomuTranscript3:abcdefghijk', 'qiaomuTranscript3:abcdefghijk#zh', 'qiaomuTranscript3:bilibili:BV1GJ411x7h7:2#en']);
});

 it('caches the new original-caption default separately from the legacy default', async () => {
 const data: Record<string, any> = {};
 const cache = createTranscriptCache({get:async key => typeof key === 'string' ? {[key]:data[key]} : data, set:async values=>{Object.assign(data,values);}, remove:async keys=>{for(const key of typeof keys === 'string' ? [keys] : keys) delete data[key];}});
 const old=[{time:'0:00',text:'old dubbed captions'}], current=[{time:'0:00',text:'original captions'}];
 await cache.write('abcdefghijk',old); await cache.write('abcdefghijk#original',current);
 expect(await cache.read('abcdefghijk#original')).toEqual(current);
 expect(await cache.read('abcdefghijk')).toEqual(old);
 });


it('refreshes old official cues but preserves generated results to avoid repeating transcription', async () => {
 const data:Record<string,any>={'qiaomuTranscript2:abcdefghijk':{segments:[{time:'0:01',text:'old'}]},'qiaomuTranscript2:generated:youtube:abcdefghijk':{segments:[{time:'0:01',text:'paid result'}]}};
 const cache=createTranscriptCache({get:async key=>data,set:async()=>{},remove:async()=>{}});
 expect(await cache.read('abcdefghijk')).toBeUndefined();
 expect(await cache.read('generated:youtube:abcdefghijk')).toEqual([{time:'0:01',text:'paid result'}]);
});


it('measures UTF-8 bytes rather than characters', async () => {
 const cache=createTranscriptCache(storage);
 await cache.write('abcdefghijk',[{time:'0:00',text:'中'.repeat(300_000)}]);
 expect(await cache.read('abcdefghijk')).toBeUndefined();
});

it('bounds refetchable captions by total bytes and never evicts generated results', async () => {
 const cache=createTranscriptCache(storage);
 await cache.write('generated:youtube:abcdefghijk',lines);
 for(let n=0;n<35;n++) await cache.write(id(n),[{time:'0:00',text:'a'.repeat(500_000)}]);
 expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThan(4_300_000);
 expect(await cache.read('generated:youtube:abcdefghijk')).toEqual(lines);
 expect(await cache.read(id(34))).toBeDefined();
});

it('evicts before writing so a full cache can accept the next transcript', async () => {
 const limited={...storage,set:async(items:Record<string,unknown>)=>{
  if(new TextEncoder().encode(JSON.stringify({...data,...items})).length>4_300_000) throw new Error('Resource::kQuotaBytes quota exceeded');
  await storage.set(items);
 }};
 const cache=createTranscriptCache(limited);
 for(let n=0;n<12;n++) await cache.write(id(n),[{time:'0:00',text:'a'.repeat(500_000)}]);
 expect(await cache.read(id(11))).toBeDefined();
});

it('retains large generated word timings instead of silently treating them as expendable cache', async () => {
 const cache=createTranscriptCache(storage);
 const generated=[{time:'0:00',text:'中'.repeat(300_000),words:[{start:0,end:1,text:'中'}]}];
 await cache.write('generated:youtube:abcdefghijk',generated);
 expect(await cache.read('generated:youtube:abcdefghijk')).toEqual(generated);
});
