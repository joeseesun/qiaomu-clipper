// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchTranscriptSegments, findTranscriptParams, formatClock, innertubeContext, parseTranscriptResponse } from './youtube-innertube-transcript';
import { groupSegments, transcriptHtml } from './youtube-dom-transcript';

const next = { contents: { x: [{ engagementPanels: [{ engagementPanelSectionListRenderer: { content: { continuationItemRenderer: { continuationEndpoint: { getTranscriptEndpoint: { params: 'PARAMS123' } } } } } }] }] } };
const line = (startMs: string, text: string) => ({ transcriptSegmentRenderer: { startMs, endMs: String(Number(startMs) + 2000), snippet: { runs: [{ text }] } } });
const transcript = { actions: [{ updateEngagementPanelAction: { content: { transcriptSearchPanelRenderer: { body: { transcriptSegmentListRenderer: { initialSegments: [line('0', 'Hello  there'), line('3723000', 'Later'), { transcriptSectionHeaderRenderer: { snippet: { simpleText: 'Chapter' } } }, line('5000', '')] } } } } } }] };
beforeEach(() => { document.head.innerHTML = ''; document.documentElement.lang = 'zh-CN'; });

it('formats clock labels and finds the transcript endpoint anywhere in the response', () => {
	expect(formatClock(0)).toBe('0:00'); expect(formatClock(75000)).toBe('1:15'); expect(formatClock(3723900)).toBe('1:02:03');
	expect(findTranscriptParams(next)).toBe('PARAMS123'); expect(findTranscriptParams({ a: [{ b: 1 }] })).toBeUndefined(); expect(findTranscriptParams(null)).toBeUndefined();
});

it('parses segment lines, skips headers and empty text, tolerates the view-model shape', () => {
	expect(parseTranscriptResponse(transcript)).toEqual([{ time: '0:00', text: 'Hello there' }, { time: '1:02:03', text: 'Later' }]);
	expect(parseTranscriptResponse({ x: { transcriptSegmentViewModel: { startMs: '61000', snippet: { content: 'View model line' } } } })).toEqual([{ time: '1:01', text: 'View model line' }]);
	expect(parseTranscriptResponse('nope')).toEqual([]);
});

it('uses the page\'s own client version, visitor data and language', () => {
	const script = document.createElement('script'); script.textContent = 'ytcfg.set({"INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260101.01.00","visitorData":"VISITOR"});'; document.head.append(script);
	expect(innertubeContext(document)).toEqual({ client: { clientName: 'WEB', clientVersion: '2.20260101.01.00', hl: 'zh-CN', visitorData: 'VISITOR' } });
	document.head.innerHTML = ''; expect((innertubeContext(document) as any).client.clientVersion).toMatch(/^2\./);
});

it('asks /next for the endpoint, then get_transcript, with cookies, and returns nothing when the video has none', async () => {
	const calls: any[] = [];
	const request = vi.fn(async (url: string, init: any) => { calls.push([url, JSON.parse(init.body), init.credentials]); return { ok: true, json: async () => url.includes('/next') ? next : transcript } as Response; });
	expect(await fetchTranscriptSegments('abc', document, request as any)).toHaveLength(2);
	expect(calls[0][0]).toContain('/youtubei/v1/next'); expect(calls[0][1].videoId).toBe('abc'); expect(calls[1][0]).toContain('/get_transcript'); expect(calls[1][1].params).toBe('PARAMS123'); expect(calls.every(call => call[2] === 'include')).toBe(true);
	expect(await fetchTranscriptSegments('abc', document, (async () => ({ ok: true, json: async () => ({}) })) as any)).toEqual([]);
	await expect(fetchTranscriptSegments('abc', document, (async () => ({ ok: false, status: 403 })) as any)).rejects.toThrow('403');
});

it('groups two-second caption lines into paragraphs, keeping the first line\'s time and not splitting CJK words with spaces', () => {
	const lines = [['0:00', 'The more free you are,'], ['0:03', 'the better you can allocate.'], ['0:14', 'Next idea starts here'], ['0:50', 'A much later line']].map(([time, text]) => ({ time, text }));
	expect(groupSegments(lines)).toEqual([{ time: '0:00', text: 'The more free you are, the better you can allocate.' }, { time: '0:14', text: 'Next idea starts here' }, { time: '0:50', text: 'A much later line' }]);
	expect(groupSegments([{ time: '0:00', text: '默认说不' }, { time: '0:02', text: '是为了自由' }])[0].text).toBe('默认说不是为了自由');
	expect(transcriptHtml(lines)).toContain('data-timestamp="14"');
});
