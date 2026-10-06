import { expect, it, vi } from 'vitest';
import { fetchBilibiliCaptions, listBilibiliTracks, stampOf, subtitleUrl, tracksOfPlayer } from './bilibili-captions';

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
	expect(await fetchBilibiliCaptions('BV1xx411c7mD', 1, route({ code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } }))).toEqual({ segments: [], needLogin: true, tracks: [] });
	expect(await fetchBilibiliCaptions('BV1xx411c7mD', 1, route({ code: 0, data: { need_login_subtitle: false, subtitle: { subtitles: [] } } }))).toEqual({ segments: [], needLogin: false, tracks: [] });
});

it('falls back to the older player endpoint and fails clearly when nothing answers', async () => {
	const getJson = vi.fn(async (url: string) => { if (url.includes('web-interface/view')) return view; if (url.includes('wbi/v2')) throw new Error('blocked'); return { code: 0, data: { subtitle: { subtitles: [track({})] } } }; });
	expect((await fetchBilibiliCaptions('BV1xx411c7mD', 1, getJson as any)).segments).toEqual([]);
	expect(getJson.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/x/player/')).map(url => url.includes('wbi') ? 'wbi' : 'v2')).toEqual(['wbi', 'v2']);
	await expect(fetchBilibiliCaptions('BV1xx411c7mD', 1, async () => ({ code: -404 }))).rejects.toThrow('视频信息');
	await expect(fetchBilibiliCaptions('BV1xx411c7mD', 1, async url => url.includes('view') ? view : { code: -1 })).rejects.toThrow('字幕列表');
});

it('lists every track with its language and whether it was made from the audio, in upload order', () => {
	const tracks = tracksOfPlayer([track({ lan: 'en', lan_doc: 'English', id: 5, subtitle_url: '//x.hdslb.com/en.json' }), track({ lan: 'ai-zh', lan_doc: '中文（自动生成）', is_ai_subtitle: true, id: 2, subtitle_url: '//x.hdslb.com/ai.json' }), track({ lan: 'zh-CN', lan_doc: '中文（中国）', id: 9, subtitle_url: '//x.hdslb.com/cn.json' }), { lan: 'ja' } as any, track({ lan: 'fr', subtitle_url: 'https://evil.example.com/fr.json' })]);
	expect(tracks.map(t => [t.id, t.language, t.auto, t.label])).toEqual([['ai-zh', 'zh', true, '中文（自动生成）'], ['en', 'en', false, 'English'], ['zh-CN', 'zh', false, '中文（中国）']]); // no URL, or a foreign host, is left out
	expect(tracksOfPlayer([track({ lan: 'en', id: 1, subtitle_url: '//x.hdslb.com/a.json' }), track({ lan: 'en', id: 2, subtitle_url: '//x.hdslb.com/b.json' })]).map(t => t.id)).toEqual(['en', 'en~2']);
	expect(tracksOfPlayer([track({ lan: 'ai-en', lan_doc: 'English', is_ai_subtitle: false, subtitle_url: '//x.hdslb.com/e.json' })])[0]).toMatchObject({ auto: true, label: 'English（AI）' });
});

it('shows the spoken language by default, so an English video is not shown in Chinese, and the viewer can pick another', async () => {
	const english = { code: 0, data: { subtitle: { subtitles: [track({ lan: 'zh-CN', lan_doc: '中文（中国）', id: 1, subtitle_url: '//x.hdslb.com/cn.json' }), track({ lan: 'ai-en', lan_doc: 'English (AI)', is_ai_subtitle: true, id: 2, subtitle_url: '//x.hdslb.com/en.json' })] } } };
	const files: Record<string, unknown> = { 'https://x.hdslb.com/cn.json': { body: [{ from: 0, content: '你好' }] }, 'https://x.hdslb.com/en.json': { body: [{ from: 0, content: 'Hello' }] } };
	const getJson = vi.fn(async (url: string) => url.includes('web-interface/view') ? view : url.includes('/x/player/') ? english : files[url]);
	const byDefault = await fetchBilibiliCaptions('BV1xx411c7mD', 1, getJson as any);
	expect(byDefault.selected).toBe('ai-en'); expect(byDefault.language).toBe('en'); expect(byDefault.segments[0].text).toBe('Hello'); expect(byDefault.tracks.map(t => t.id)).toEqual(['zh-CN', 'ai-en']);
	const chosen = await fetchBilibiliCaptions('BV1xx411c7mD', 1, getJson as any, 'zh');
	expect(chosen.selected).toBe('zh-CN'); expect(chosen.segments[0].text).toBe('你好');
	expect((await listBilibiliTracks('BV1xx411c7mD', 1, getJson as any)).tracks).toHaveLength(2);
	const files2 = getJson.mock.calls.map(([url]) => String(url)).filter(url => url.includes('hdslb')); expect(files2).toEqual(['https://x.hdslb.com/en.json', 'https://x.hdslb.com/cn.json']); // only the chosen file is read
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
