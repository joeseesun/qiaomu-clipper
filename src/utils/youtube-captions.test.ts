// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { apiKeyFromPage, audioLanguageFromDocument, audioLanguageOf, fetchCaptionResult, fetchCaptionSegments, fetchCaptionTracks, parseCaptions, pickTrack, playerFromWatchHtml, sameLanguage, tracksOf } from './youtube-captions';

const track = (languageCode: string, kind?: string, extra = '') => ({ baseUrl: `https://www.youtube.com/api/timedtext?v=abc&lang=${languageCode}${kind ? '&kind=asr' : ''}${extra}`, languageCode, ...(kind ? { kind } : {}) });
const player = (...tracks: unknown[]) => ({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } });
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }) as unknown as Response;
beforeEach(() => { document.head.innerHTML = '<script>ytcfg.set({"INNERTUBE_API_KEY":"KEY123"});</script>'; document.documentElement.lang = 'zh-CN'; });

it('reads the API key from the page and the track list from a player response', () => {
	expect(apiKeyFromPage(document)).toBe('KEY123'); document.head.innerHTML = ''; expect(apiKeyFromPage(document)).toBeUndefined();
	expect(tracksOf(player(track('en'), { nope: 1 }))).toHaveLength(1); expect(tracksOf({})).toEqual([]);
});

it('asks the mobile clients in turn and stops at the first one that returns tracks', async () => {
	const names: string[] = [];
	const request = vi.fn(async (url: string, init: any) => { const name = JSON.parse(init.body).context.client.clientName; names.push(name); expect(url).toContain('/youtubei/v1/player'); expect(url).toContain('key=KEY123'); expect(init.credentials).toBe('include'); return response(name === 'IOS' ? player(track('en')) : { playabilityStatus: { status: 'LOGIN_REQUIRED' } }); });
	expect(await fetchCaptionTracks('abc', document, request as any)).toHaveLength(1); expect(names).toEqual(['ANDROID', 'ANDROID_VR', 'IOS']);
});

it('falls back to the player response embedded in the watch page when every client is refused', async () => {
	const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player(track('de')))};var other = {"a":"}"};</script></html>`;
	expect(playerFromWatchHtml(html).captions.playerCaptionsTracklistRenderer.captionTracks[0].languageCode).toBe('de'); expect(playerFromWatchHtml('<html></html>')).toBeUndefined();
	const request = vi.fn(async (url: string) => url.includes('/youtubei/') ? response({}, false) : response(html));
	expect((await fetchCaptionTracks('abc', document, request as any))[0].languageCode).toBe('de');
	expect(await fetchCaptionTracks('abc', document, (async () => { throw new Error('offline'); }) as any)).toEqual([]);
});

it('picks the spoken language, prefers a hand-made track in it, and never a token-gated one', () => {
	expect(pickTrack([track('fr'), track('en'), track('en', 'asr')])!.languageCode).toBe('en');
	expect(pickTrack([track('fr'), track('en', 'asr')])!.kind).toBe('asr'); // no hand-made track in the spoken language
	expect(pickTrack([track('en'), track('fr', 'asr')])!.languageCode).toBe('fr');
	expect(pickTrack([track('fr'), track('en'), track('fr', 'asr')])!.languageCode).toBe('fr');
	expect(pickTrack([track('fr'), track('es')])!.languageCode).toBe('fr');
	expect(pickTrack([track('ar'), track('en')])!.languageCode).toBe('en');
	expect(pickTrack([track('ar', 'asr'), track('en', 'asr')], 'en-US')!.languageCode).toBe('en');
	expect(pickTrack([track('ar', 'asr'), track('en', 'asr')])!.languageCode).toBe('en');
	expect(pickTrack([track('ar', 'asr'), track('en', 'asr')], 'ar')!.languageCode).toBe('ar');
	expect(pickTrack([track('zh-CN', 'asr'), track('zh-TW', 'asr')], 'zh-TW')!.languageCode).toBe('zh-TW');
	expect(sameLanguage('en-US', 'en')).toBe(true);
	expect(sameLanguage('ar', 'en')).toBe(false);
	expect(pickTrack([track('en', undefined, '&exp=xpe'), track('en', 'asr', '&exp=xpe')])).toBeUndefined();
	expect(pickTrack([track('en', undefined, '&exp=xpe'), track('fr')])!.languageCode).toBe('fr'); expect(pickTrack([])).toBeUndefined();
});

it('uses the video audio language when the first automatic caption is a different language', async () => {
	const captions = player(track('ar', 'asr'), track('en', 'asr'));
	const request = vi.fn(async (url: string) => url.includes('/youtubei/')
		? response({ ...captions, videoDetails: { defaultAudioLanguage: 'en' } })
		: response({ events: [{ tStartMs: 1200, segs: [{ utf8: 'English audio' }] }] }));
	const result = await fetchCaptionResult('abc', document, request as any);
	expect(result).toEqual({ segments: [{ time: '0:01', text: 'English audio' }], language: 'en', source: 'automatic' });
	expect(request.mock.calls[1][0]).toContain('lang=en');
});

it('uses the current watch player language when the mobile response omits it', async () => {
	const current = { ...player(), videoDetails: { videoId: 'abc', defaultAudioLanguage: 'en-US' } };
	document.head.innerHTML += `<script>var ytInitialPlayerResponse = ${JSON.stringify(current)};</script>`;
	expect(audioLanguageFromDocument(document, 'abc')).toBe('en-US');
	expect(audioLanguageFromDocument(document, 'other-video')).toBeUndefined();
	expect(audioLanguageOf({ microformat: { playerMicroformatRenderer: { defaultAudioLanguage: 'fr' } } })).toBe('fr');
	const request = vi.fn(async (url: string) => url.includes('/youtubei/')
		? response(player(track('ar', 'asr'), track('en', 'asr')))
		: response({ events: [{ tStartMs: 0, segs: [{ utf8: 'Hello' }] }] }));
	expect((await fetchCaptionResult('abc', document, request as any)).language).toBe('en');
});

it('reads default audio metadata on multi-language auto-dubbed videos without videoDetails language', async () => {
	const current = player(track('ar', 'asr'), track('en', 'asr'), track('fr', 'asr'));
	Object.assign(current.captions.playerCaptionsTracklistRenderer, {
		audioTracks: [
			{ audioTrackId: 'ar.10', defaultCaptionTrackIndex: 1 },
			{ audioTrackId: 'en-US.4', defaultCaptionTrackIndex: 1 },
		],
		defaultAudioTrackIndex: 1,
	});
	expect(audioLanguageOf(current)).toBe('en-US');
	document.head.innerHTML += `<script>var ytInitialPlayerResponse = ${JSON.stringify(current)};</script>`;
	const request = vi.fn(async (url: string) => url.includes('/youtubei/')
		? response(player(track('ar', 'asr'), track('en', 'asr')))
		: response({ events: [{ tStartMs: 0, segs: [{ utf8: 'Original English audio' }] }] }));
	expect((await fetchCaptionResult('abc', document, request as any)).language).toBe('en');
	expect(audioLanguageOf({ streamingData: { adaptiveFormats: [
		{ audioTrack: { id: 'ar.10', audioIsDefault: false } },
		{ audioTrack: { id: 'fr-FR.4', audioIsDefault: true } },
	] } })).toBe('fr-FR');
});

it('parses json3, the classic XML and the srv3 XML, decoding entities and dropping markup', () => {
	expect(parseCaptions(JSON.stringify({ events: [{ tStartMs: 1200, segs: [{ utf8: 'Hello ' }, { utf8: 'there' }] }, { tStartMs: 3723000, segs: [{ utf8: '\n' }] }, { tStartMs: 5000, segs: [{ utf8: 'Next &amp; last' }] }] }))).toEqual([{ time: '0:01', text: 'Hello there' }, { time: '0:05', text: 'Next & last' }]);
	expect(parseCaptions('<?xml version="1.0"?><transcript><text start="1.5" dur="2">It&#39;s &quot;fine&quot; &amp; <i>ok</i></text><text start="3725" dur="1">Later</text></transcript>')).toEqual([{ time: '0:01', text: 'It\'s "fine" & ok' }, { time: '1:02:05', text: 'Later' }]);
	expect(parseCaptions('<timedtext><body><p t="4000" d="2000"><s>Hi</s> <s>all</s></p></body></timedtext>')).toEqual([{ time: '0:04', text: 'Hi all' }]);
	expect(parseCaptions('not captions')).toEqual([]); expect(parseCaptions('{broken')).toEqual([]);
});

it('downloads the chosen track as json3 first, then plain, and returns nothing for gated or empty tracks', async () => {
	const urls: string[] = [];
	const request = vi.fn(async (url: string) => { urls.push(url); if (url.includes('/youtubei/')) return response(player(track('en', 'asr', '&fmt=srv3'))); return url.includes('fmt=json3') ? response({ events: [] }) : response('<transcript><text start="2" dur="1">From XML</text></transcript>'); });
	expect(await fetchCaptionSegments('abc', document, request as any)).toEqual([{ time: '0:02', text: 'From XML' }]);
	expect(urls[1]).toContain('&fmt=json3'); expect(urls[1]).not.toContain('srv3'); expect(urls[2]).not.toContain('fmt=');
	expect(await fetchCaptionSegments('abc', document, (async (url: string) => response(url.includes('/youtubei/') ? player(track('en', undefined, '&exp=xpe')) : '')) as any)).toEqual([]);
});
