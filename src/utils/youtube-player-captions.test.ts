// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captionAddress, fetchBestCaptions, fetchCaptionsViaPlayer, isCaptionAddress, proofFor, type PlayerIo } from './youtube-player-captions';
import type { BridgeSnapshot } from './youtube-player-bridge-protocol';

const base = 'https://www.youtube.com/api/timedtext?v=abc&ei=1&caps=asr&opi=2&exp=xpe&xoaf=5&hl=en&ip=0.0.0.0&sparams=ip&signature=S&key=yt8&kind=&lang=';
const snap = (extra: Partial<BridgeSnapshot> = {}): BridgeSnapshot => ({
	videoId: 'abc', state: 1, device: 'cbrand=apple&cbr=Chrome&cbrver=140&cos=Macintosh&cosver=10_15_7&cplatform=DESKTOP', clientVersion: '2.2026', requestUrl: null, captionsOn: false,
	tracks: [{ url: base + 'en-orig&kind=asr', languageCode: 'en', kind: 'asr', vssId: 'a.en' }, { url: base + 'en', languageCode: 'en', vssId: '.en', name: 'English' }, { url: base + 'zh', languageCode: 'zh-Hans', vssId: '.zh-Hans' }],
	audioTracks: [{ url: base + 'en&pot=POT_EN&potc=1', languageCode: 'en', vssId: '.en' }, { url: base + 'en-orig&kind=asr&pot=POT_ASR&potc=1', languageCode: 'en', kind: 'asr', vssId: 'a.en' }],
	...extra,
});
const body = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'How much are you sleeping?' }] }, { tStartMs: 4000, segs: [{ utf8: 'Not enough.' }] }] });
const io = (snapshots: BridgeSnapshot[], fetched: string[] = [], reply = body): PlayerIo & { sent: unknown[] } => {
	const sent: unknown[] = []; let next = 0;
	return {
		sent, sleep: async () => {},
		ask: (async (message: { type: string }) => { sent.push(message); if (message.type === 'snapshot') return snapshots[Math.min(next++, snapshots.length - 1)]; return { changed: true }; }) as PlayerIo['ask'],
		fetch: (async (address: string) => { fetched.push(address); return { ok: true, text: async () => reply }; }) as unknown as typeof fetch,
	};
};

afterEach(() => vi.unstubAllGlobals());

describe('the proof the player holds', () => {
	it('is taken from the player\'s own address for that track, else the same language, else a request it made', () => {
		expect(proofFor({ languageCode: 'en', vssId: '.en' }, snap())).toEqual({ pot: 'POT_EN', potc: '1' });
		expect(proofFor({ languageCode: 'en', kind: 'asr', vssId: 'x' }, snap())).toEqual({ pot: 'POT_ASR', potc: '1' });
		expect(proofFor({ languageCode: 'zh-Hans', vssId: '.zh-Hans' }, snap({ requestUrl: 'https://www.youtube.com/api/timedtext?v=abc&pot=SEEN&potc=2' }))).toEqual({ pot: 'SEEN', potc: '2' });
		expect(proofFor({ languageCode: 'zh-Hans' }, snap())).toEqual({ pot: null, potc: null });
	});
	it('goes into the address with the usual parameters, and only addresses on YouTube are fetched', () => {
		const address = new URL(captionAddress({ baseUrl: base + 'en' }, snap(), { pot: 'P', potc: '1' }));
		expect(Object.fromEntries(['fmt', 'c', 'cplayer', 'cbrand', 'cver', 'pot', 'potc'].map(key => [key, address.searchParams.get(key)]))).toEqual({ fmt: 'json3', c: 'WEB', cplayer: 'UNIPLAYER', cbrand: 'apple', cver: '2.2026', pot: 'P', potc: '1' });
		expect(isCaptionAddress(address.toString())).toBe(true);
		for (const bad of ['http://www.youtube.com/api/timedtext?v=1', 'https://evil.example/api/timedtext?v=1', 'https://www.youtube.com.evil.example/api/timedtext', 'https://www.youtube.com/other', 'nonsense']) expect(isCaptionAddress(bad)).toBe(false);
	});
});

describe('reading the captions through the player', () => {
	it('downloads the official track with the player\'s proof, listing every track including the gated ones', async () => {
		const fetched: string[] = [], feed = io([snap()], fetched);
		const result = await fetchCaptionsViaPlayer('abc', undefined, feed);
		expect(result?.segments.map(item => item.text)).toEqual(['How much are you sleeping?', 'Not enough.']);
		expect(result?.selected).toBe('en');                           // the official English track, not the auto-generated one
		expect(result?.tracks.map(item => item.id)).toEqual(['en-auto', 'en', 'zh-Hans']);
		expect(new URL(fetched[0]).searchParams.get('pot')).toBe('POT_EN');
		expect(feed.sent.some(item => (item as { type: string }).type === 'captions')).toBe(false);   // no need to touch the player's switch
		expect(await result!.fetchTrack!(result!.tracks[2].track)).toHaveLength(2);
	});
	it('switches the captions on for a moment when the player has no proof yet, and switches them back', async () => {
		const bare = snap({ audioTracks: [] }), later = snap({ audioTracks: [], requestUrl: 'https://www.youtube.com/api/timedtext?v=abc&pot=LATER&potc=1' });
		const fetched: string[] = [], feed = io([bare, bare, later], fetched);
		const result = await fetchCaptionsViaPlayer('abc', undefined, feed);
		expect(result?.segments).toHaveLength(2);
		expect(new URL(fetched[0]).searchParams.get('pot')).toBe('LATER');
		expect(feed.sent.filter(item => (item as { type: string }).type === 'captions')).toEqual([{ type: 'captions', on: true }, { type: 'captions', on: false }]);
	});
	it('says nothing when the bridge is not there, the page is another video, or the video has no tracks', async () => {
		const silent: PlayerIo = { sleep: async () => {}, ask: (async () => undefined) as PlayerIo['ask'], fetch: (async () => { throw new Error('no'); }) as unknown as typeof fetch };
		expect(await fetchCaptionsViaPlayer('abc', undefined, silent)).toBeUndefined();
		expect(await fetchCaptionsViaPlayer('abc', undefined, io([snap({ videoId: 'other' })]))).toBeUndefined();
		expect(await fetchCaptionsViaPlayer('abc', undefined, io([snap({ tracks: [], audioTracks: [] })]))).toBeUndefined();
	});
	it('falls back to the older routes when the player route gives nothing', async () => {
		const silent: PlayerIo = { sleep: async () => {}, ask: (async () => undefined) as PlayerIo['ask'], fetch: (async () => { throw new Error('no'); }) as unknown as typeof fetch };
		const older = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', older);
		const result = await fetchBestCaptions('abc', document, undefined, silent);
		expect(result.segments).toEqual([]);
		expect(older).toHaveBeenCalled();   // the InnerTube route was tried
	});
});

it('downloads original audio captions rather than the first dub in the bridge listing', async () => {
 const snapshot = snap({originalLanguage:'fr', tracks:[
  {url:base+'ar',languageCode:'ar',kind:'asr'},
  {url:base+'en',languageCode:'en',kind:'asr'},
  {url:base+'fr',languageCode:'fr',kind:'asr'},
  {url:base+'zh',languageCode:'zh-Hans'}
 ],requestUrl:'https://www.youtube.com/api/timedtext?v=abc&pot=VALID'});
 const fetched:string[]=[];
 const result=await fetchCaptionsViaPlayer('abc',undefined,io([snapshot],fetched));
 expect(result?.selected).toBe('fr-auto');
 expect(fetched[0]).toContain('lang=fr');
 expect((await fetchCaptionsViaPlayer('abc','zh',io([snapshot])))?.selected).toBe('zh-Hans');
});
