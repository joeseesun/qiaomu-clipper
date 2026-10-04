import { expect, it, vi } from 'vitest';
import { fetchBilibiliCaptions, pickTrack, stampOf, subtitleUrl } from './bilibili-captions';

const view = { code: 0, data: { aid: 11, cid: 1, pages: [{ cid: 100 }, { cid: 200 }] } };
const track = (extra: object) => ({ lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//aisubtitle.hdslb.com/a.json', ...extra });
const route = (player: unknown, file: unknown = { body: [] }) => vi.fn(async (url: string) => url.includes('web-interface/view') ? view : url.includes('/x/player/') ? player : file);

it('reads the subtitle file of the requested part and turns it into timed lines', async () => {
	const getJson = route({ code: 0, data: { subtitle: { subtitles: [track({})] } } }, { body: [{ from: 0.4, to: 2, content: ' 你好\n世界 ' }, { from: 3725.9, to: 4, content: 'later' }, { from: 5, content: '   ' }, { from: -1, content: 'bad' }] });
	const result = await fetchBilibiliCaptions('BV1xx411c7mD', 2, getJson);
	expect(result.segments).toEqual([{ time: '0:00', text: '你好 世界' }, { time: '1:02:05', text: 'later' }]);
	expect(getJson.mock.calls.some(([url]) => String(url).includes('cid=200'))).toBe(true);
	expect(getJson).toHaveBeenCalledWith('https://aisubtitle.hdslb.com/a.json', false); // the public file is fetched without the account's cookies
});

it('says a signed-out viewer needs to log in, and does not call that "no subtitles"', async () => {
	expect(await fetchBilibiliCaptions('BV1xx411c7mD', 1, route({ code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } }))).toEqual({ segments: [], needLogin: true });
	expect(await fetchBilibiliCaptions('BV1xx411c7mD', 1, route({ code: 0, data: { need_login_subtitle: false, subtitle: { subtitles: [] } } }))).toEqual({ segments: [], needLogin: false });
});

it('falls back to the older player endpoint and fails clearly when nothing answers', async () => {
	const getJson = vi.fn(async (url: string) => { if (url.includes('web-interface/view')) return view; if (url.includes('wbi/v2')) throw new Error('blocked'); return { code: 0, data: { subtitle: { subtitles: [track({})] } } }; });
	expect((await fetchBilibiliCaptions('BV1xx411c7mD', 1, getJson as any)).segments).toEqual([]);
	expect(getJson.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/x/player/')).map(url => url.includes('wbi') ? 'wbi' : 'v2')).toEqual(['wbi', 'v2']);
	await expect(fetchBilibiliCaptions('BV1xx411c7mD', 1, async () => ({ code: -404 }))).rejects.toThrow('视频信息');
	await expect(fetchBilibiliCaptions('BV1xx411c7mD', 1, async url => url.includes('view') ? view : { code: -1 })).rejects.toThrow('字幕列表');
});

it('prefers a human subtitle over an AI one, then Simplified Chinese, then English', () => {
	const ai = track({ lan: 'ai-zh', lan_doc: '中文（自动生成）', is_ai_subtitle: true, id: 1, subtitle_url: '//x.hdslb.com/ai.json' });
	const en = track({ lan: 'en', id: 3, subtitle_url: '//x.hdslb.com/en.json' }), cn = track({ id: 2, subtitle_url: '//x.hdslb.com/cn.json' });
	expect(pickTrack([ai, en, cn])?.subtitle_url).toContain('cn.json');
	expect(pickTrack([ai, en])?.subtitle_url).toContain('en.json');
	expect(pickTrack([ai])?.subtitle_url).toContain('ai.json');
	expect(pickTrack([{ lan: 'zh-CN' }])).toBeUndefined();
});

it('only fetches subtitle files from Bilibili hosts over https', () => {
	expect(subtitleUrl('//aisubtitle.hdslb.com/x.json')).toBe('https://aisubtitle.hdslb.com/x.json');
	expect(subtitleUrl('https://i0.hdslb.com/x.json')).toBeTruthy();
	for (const bad of ['http://aisubtitle.hdslb.com/x.json', 'https://evil.example.com/x.json', 'https://hdslb.com.evil.com/x.json', 'javascript:alert(1)', 'not a url']) expect(subtitleUrl(bad)).toBeUndefined();
});

it('formats times like the YouTube bar does', () => { expect(stampOf(0)).toBe('0:00'); expect(stampOf(95.9)).toBe('1:35'); expect(stampOf(3725)).toBe('1:02:05'); expect(stampOf(-3)).toBe('0:00'); });

import { isUnreliablePlayerUrl, withReliableBilibili } from './bilibili-captions';
const json = (value: unknown) => new Response(JSON.stringify(value));
const WBI = 'https://api.bilibili.com/x/player/wbi/v2?bvid=BV1hM4m1U7rA&aid=1&cid=2', BY_BVID = 'https://api.bilibili.com/x/player/v2?bvid=BV1hM4m1U7rA&cid=2', BY_AID = 'https://api.bilibili.com/x/player/v2?aid=1&cid=2';
it('once a reliable endpoint has answered for a part, the older bvid endpoint (which can return another video\'s subtitles) is answered with "no subtitles"', async () => {
	const base = vi.fn(async (url: any) => String(url).includes('bvid=BV1hM4m1U7rA&cid') ? json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: '//x.hdslb.com/other.json' }] } } }) : json({ code: 0, data: { subtitle: { subtitles: [] } } }));
	const safe = withReliableBilibili(base as any);
	await safe(WBI); await safe(BY_AID);
	expect(await (await safe(BY_BVID)).json()).toEqual({ code: 0, data: { subtitle: { subtitles: [] } } });
	expect(base.mock.calls.map(([url]) => String(url))).toEqual([WBI, BY_AID]); // the unreliable one was never even sent
});
it('keeps the older endpoint as a fallback when the reliable ones failed, for another part, or for another request type', async () => {
	const base = vi.fn(async (url: any) => String(url).includes('wbi') ? json({ code: -352 }) : json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh' }] } } }));
	const safe = withReliableBilibili(base as any);
	await safe(WBI); // risk-control error: nothing vouched for
	expect((await (await safe(BY_BVID)).json()).data.subtitle.subtitles).toHaveLength(1);
	const ok = withReliableBilibili((async (url: any) => json({ code: 0, data: { subtitle: { subtitles: [] } } })) as any);
	await ok(WBI); // part 2 answered; part 3 was not
	expect((await (await ok(BY_BVID.replace('cid=2', 'cid=3'))).json()).code).toBe(0);
	const other = vi.fn(async () => new Response('real')); const passthrough = withReliableBilibili(other);
	for (const fine of ['https://api.bilibili.com/x/web-interface/view?bvid=BV1hM4m1U7rA', 'https://example.com/x/player/v2?bvid=BV1hM4m1U7rA&cid=2', 'https://aisubtitle.hdslb.com/a.json']) expect(await (await passthrough(fine)).text()).toBe('real');
	expect(isUnreliablePlayerUrl(BY_BVID)).toBe(true); expect(isUnreliablePlayerUrl(BY_AID)).toBe(false); expect(isUnreliablePlayerUrl(WBI)).toBe(false); expect(isUnreliablePlayerUrl('not a url')).toBe(false);
});
it('does not consume the response a caller is about to read', async () => {
	const safe = withReliableBilibili((async () => json({ code: 0, data: { subtitle: { subtitles: [] } } })) as any);
	expect((await (await safe(WBI)).json()).code).toBe(0);
});
