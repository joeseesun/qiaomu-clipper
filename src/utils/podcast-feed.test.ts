// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
import { CATALOG } from './podcast-catalog';
import { durationSeconds, fetchFeed, parseFeed, rssKey } from './podcast-feed';

const FEED = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title><![CDATA[Great Show]]></title><itunes:image href="https://img.example.com/cover.jpg"/>
<item><title><![CDATA[Ep 2 &amp; more]]></title><guid isPermaLink="false">guid-two</guid><pubDate>Thu, 01 Oct 2026 15:28:28 GMT</pubDate><itunes:duration>01:30:10</itunes:duration><enclosure url="https://cdn.example.com/two.mp3?x=1&amp;y=2" type="audio/mpeg"/><content:encoded><![CDATA[<p>Guest: Ada. 12:30 Topic</p><script>x()</script>]]></content:encoded></item>
<item><title>Ep 1</title><guid>guid-one</guid><pubDate>Wed, 30 Sep 2026 20:00:00 +0800</pubDate><itunes:duration>6245</itunes:duration><enclosure url="https://cdn.example.com/one.mp3"/><description>First</description></item>
<item><title>Insecure</title><guid>g3</guid><enclosure url="http://cdn.example.com/three.mp3"/></item>
<item><title>No audio</title><guid>g4</guid></item>
<item><title>Cut off here`;

it('reads the newest episodes: title, date, length, audio and notes (cleaned), skipping what cannot be played', () => {
	const feed = parseFeed(FEED);
	expect(feed).toMatchObject({ show: 'Great Show', cover: 'https://img.example.com/cover.jpg' }); expect(feed.episodes.map(e => e.guid)).toEqual(['guid-two', 'guid-one']);
	expect(feed.episodes[0]).toMatchObject({ title: 'Ep 2 & more', audio: 'https://cdn.example.com/two.mp3?x=1&y=2', seconds: 5410, date: '2026-10-01T15:28:28.000Z' }); expect(feed.episodes[0].notesHtml).toContain('Guest: Ada.'); expect(feed.episodes[0].notesHtml).not.toContain('<script'); expect(feed.episodes[0].notesHtml).toContain('data-time="750"');
	expect(feed.episodes[1]).toMatchObject({ seconds: 6245, date: '2026-09-30T12:00:00.000Z' }); expect(feed.episodes[1].notesHtml).toContain('First');
});

it('copes with a feed cut off in the middle, an empty one, and a show with no image', () => {
	expect(parseFeed('<rss><channel><title>T</title><item><title>A</title><guid>1</guid><enclosure url="https://a.example.com/x.mp3"/></item><item><title>cut').episodes).toHaveLength(1);
	expect(parseFeed('<rss></rss>')).toEqual({ show: '', cover: undefined, episodes: [] }); expect(parseFeed('<rss><channel><title>T</title><item><guid>1</guid><enclosure url="https://a.example.com/x.mp3"/></item></channel></rss>').cover).toBeUndefined();
	const many = '<rss><channel><title>T</title>' + Array.from({ length: 40 }, (_, i) => `<item><title>${i}</title><guid>${i}</guid><enclosure url="https://a.example.com/${i}.mp3"/></item>`).join('') + '</channel></rss>'; expect(parseFeed(many).episodes).toHaveLength(12);
});

it('reads lengths written as seconds or as clock times', () => { expect(['90', '1:30', '01:30:10', '', 'x', '1:2:3:4', undefined].map(durationSeconds)).toEqual([90, 90, 5410, undefined, undefined, undefined, undefined]); });

it('names an episode by the hash of its feed and guid, the same way the helper does', async () => {
	expect(await rssKey('https://feed.xyzfm.space/dk4yh3pkpjp3', 'guid-中文')).toBe('rss:5fd3c935e554:ecb57c45c71d45fe'); // sha1 of each, cut to 12 and 16: what the helper computes
	expect(await rssKey('https://a.example/f', 'x')).not.toBe(await rssKey('https://a.example/f', 'y'));
});

it('lists the suggested shows: five Chinese ones then five overseas AI ones, each with an https feed', () => {
	expect(CATALOG.filter(s => s.lang === 'zh').map(s => s.name.split(/[ |｜]/)[0])).toEqual(['张小珺Jùn', '42章经', '半拿铁', '晚点聊', 'Next']); expect(CATALOG.filter(s => s.lang === 'en')).toHaveLength(5);
	expect(new Set(CATALOG.map(s => s.id)).size).toBe(CATALOG.length); expect(CATALOG.every(s => /^https:\/\//.test(s.feed))).toBe(true); expect(CATALOG.map(s => s.lang).join('')).toBe('zhzhzhzhzhenenenenen');
});

const respond = (text: string, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 404, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }) }));
beforeEach(() => { state.store = {}; vi.unstubAllGlobals(); });

it('fetches only https feeds, reads the top, and remembers the answer for a while (without the notes)', async () => {
	const fetcher = respond(FEED); vi.stubGlobal('fetch', fetcher);
	await expect(fetchFeed('http://a.example/feed')).rejects.toThrow('https'); expect(fetcher).not.toHaveBeenCalled();
	const first = await fetchFeed('https://a.example/feed', { now: 1000 }); expect(first.episodes).toHaveLength(2); expect(fetcher).toHaveBeenCalledTimes(1);
	const again = await fetchFeed('https://a.example/feed', { now: 2000 }); expect(fetcher).toHaveBeenCalledTimes(1); expect(again.episodes[0].notesHtml).toBe(''); // the list does not need notes
	const fresh = await fetchFeed('https://a.example/feed', { now: 3000, fresh: true }); expect(fetcher).toHaveBeenCalledTimes(2); expect(fresh.episodes[0].notesHtml).toContain('Guest');
	await fetchFeed('https://a.example/feed', { now: 1000 + 31 * 60_000 }); expect(fetcher).toHaveBeenCalledTimes(3); // old: read again
});

it('says so when a feed cannot be read or has nothing to play', async () => {
	vi.stubGlobal('fetch', respond('', false)); await expect(fetchFeed('https://a.example/feed')).rejects.toThrow('读取订阅源失败');
	vi.stubGlobal('fetch', respond('<rss><channel><title>T</title></channel></rss>')); await expect(fetchFeed('https://b.example/feed')).rejects.toThrow('没有找到可播放');
});
