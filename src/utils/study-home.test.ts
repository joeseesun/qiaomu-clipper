// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown>, feed: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
vi.mock('./podcast-feed', async importOriginal => ({ ...(await importOriginal<typeof import('./podcast-feed')>()), fetchFeed: (...args: unknown[]) => state.feed(...args) }));
import { classifyLink, episodePath, loadRecents, recordStudy, showStudyHome } from './study-home';
import { CATALOG } from './podcast-catalog';

const EP = '6a97f287f03e74ee6b03ea5b';
beforeEach(() => { state.store = {}; document.head.innerHTML = ''; document.body.innerHTML = ''; });

it('sends each kind of link to its own study page, and anything else to the ordinary reader', () => {
	const yt = classifyLink('https://www.youtube.com/watch?v=dbqweBCynuI')!; expect(yt.kind).toBe('youtube'); expect(yt.path).toContain('study=youtube'); expect(decodeURIComponent(yt.path)).toContain('url=https://www.youtube.com/watch?v=dbqweBCynuI');
	expect(classifyLink('https://youtu.be/dbqweBCynuI')!.kind).toBe('youtube');
	const bv = classifyLink('https://www.bilibili.com/video/BV1hM4m1U7rA/?p=20')!; expect(bv.kind).toBe('bilibili'); expect(bv.path).toContain('study=bilibili');
	const xyz = classifyLink(`https://www.xiaoyuzhoufm.com/episode/${EP}`)!; expect(xyz.kind).toBe('podcast'); expect(xyz.path).toContain('study=audio');
	expect(classifyLink('https://example.com/post')).toMatchObject({ kind: 'page', path: 'reader.html?url=' + encodeURIComponent('https://example.com/post') });
	expect(classifyLink('www.xiaoyuzhoufm.com/episode/' + EP)!.kind).toBe('podcast'); // a missing scheme is forgiven
	expect(classifyLink(`https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962`)!.kind).toBe('page'); // a show, not an episode
});

it('does not take text that is not a link for one', () => {
	for (const bad of ['', '   ', 'hello world', 'localhost', 'javascript:alert(1)', 'ftp://example.com/x', 'file:///etc/passwd', 'a b.com', 'no-dot']) expect(classifyLink(bad)).toBeUndefined();
});

it('keeps what was studied, newest first, once each, at most twenty, and ignores things that are not studyable', async () => {
	await recordStudy({ url: 'https://www.youtube.com/watch?v=dbqweBCynuI', title: ' First ' }); await recordStudy({ url: `https://www.xiaoyuzhoufm.com/episode/${EP}`, title: '' }); await recordStudy({ url: 'https://example.com/post', title: 'article' });
	let recents = await loadRecents(); expect(recents.map(r => [r.kind, r.title])).toEqual([['podcast', `https://www.xiaoyuzhoufm.com/episode/${EP}`], ['youtube', 'First']]);
	await recordStudy({ url: 'https://www.youtube.com/watch?v=dbqweBCynuI', title: 'First again' }); recents = await loadRecents(); expect(recents.map(r => r.title)).toEqual(['First again', `https://www.xiaoyuzhoufm.com/episode/${EP}`]);
	for (let i = 0; i < 25; i++) await recordStudy({ url: `https://www.youtube.com/watch?v=${String(i).padStart(11, 'a')}`, title: 't' + i }); expect(await loadRecents()).toHaveLength(20);
	state.store.qiaomuStudyRecent = [{ url: 'x', title: 5, kind: 'evil', at: 'now' }, null, 'junk']; expect(await loadRecents()).toEqual([]);
});

const open = vi.fn(), openFile = vi.fn();
const home = async () => { open.mockReset(); openFile.mockReset(); await showStudyHome(document, { open, openFile }); };
const input = () => document.querySelector<HTMLInputElement>('.qiaomu-home-form input')!, go = () => document.querySelector<HTMLButtonElement>('.qiaomu-home-go')!, hint = () => document.querySelector('.qiaomu-home-hint > span')!.textContent;
const type = (value: string) => { input().value = value; input().dispatchEvent(new Event('input')); };

it('recognises what was pasted as it is typed, and opens it for study when started', async () => {
	await home(); expect(go().disabled).toBe(true); expect(hint()).toBe('');
	type('hello'); expect(go().disabled).toBe(true); expect(hint()).toBe('这不像一个链接');
	type(`https://www.xiaoyuzhoufm.com/episode/${EP}`); expect(go().disabled).toBe(false); expect(hint()).toContain('小宇宙播客'); expect(hint()).toContain('没有字幕会自动转写');
	document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(open).toHaveBeenCalledWith(expect.stringContaining('study=audio'));
	type('https://example.com/post'); expect(hint()).toContain('网页（普通阅读）'); expect(hint()).not.toContain('自动转写');
	type('nonsense'); document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(open).toHaveBeenCalledTimes(1);
});

it('takes a chosen or dropped audio or video file, and refuses other kinds', async () => {
	await home(); const files = document.querySelector<HTMLInputElement>('input[type=file]')!; const set = (file: File) => { Object.defineProperty(files, 'files', { value: [file], configurable: true }); files.dispatchEvent(new Event('change')); };
	set(new File(['x'], 'notes.pdf')); expect(openFile).not.toHaveBeenCalled(); expect(hint()).toContain('不支持');
	const talk = new File(['x'], 'talk.m4a'); set(talk); expect(openFile).toHaveBeenCalledWith(talk);
	const dropped = new File(['x'], 'meeting.mp4'), event = new Event('drop', { cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { files: [dropped] } }); document.querySelector('.qiaomu-home-hero')!.dispatchEvent(event); expect(openFile).toHaveBeenLastCalledWith(dropped);
});

it('lists what was studied before, opens it on a click, and removes an item without opening it', async () => {
	await recordStudy({ url: 'https://www.youtube.com/watch?v=dbqweBCynuI', title: 'A talk' }); await recordStudy({ url: `https://www.xiaoyuzhoufm.com/episode/${EP}`, title: 'An episode' });
	await home(); const items = () => Array.from(document.querySelectorAll<HTMLElement>('.qiaomu-home-item'));
	expect(items().map(i => i.querySelector('.qiaomu-home-title')!.textContent)).toEqual(['An episode', 'A talk']); expect(items()[0].textContent).toContain('小宇宙播客'); expect(items()[1].textContent).toContain('YouTube 视频');
	items()[1].click(); expect(open).toHaveBeenCalledWith(expect.stringContaining('study=youtube')); open.mockClear();
	items()[0].querySelector<HTMLButtonElement>('.qiaomu-home-x')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); expect(open).not.toHaveBeenCalled(); expect(items().map(i => i.querySelector('.qiaomu-home-title')!.textContent)).toEqual(['A talk']); expect((await loadRecents()).map(r => r.title)).toEqual(['A talk']);
});

it('shows no list before anything has been studied', async () => { await home(); expect(document.querySelector('.qiaomu-home-item')).toBeNull(); expect(document.body.textContent).not.toContain('最近学习'); });

const FEED = { show: 'Latent Space: The AI Engineer Podcast', cover: 'https://img.example.com/c.jpg', episodes: Array.from({ length: 10 }, (_, i) => ({ guid: 'g' + i, title: 'Episode ' + i, date: '2026-10-0' + (i % 9 + 1) + 'T00:00:00.000Z', seconds: 5400 + i * 60, audio: 'https://a.example.com/' + i + '.mp3', notesHtml: '' })) };
const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.qiaomu-show')), dialog = () => document.querySelector<HTMLElement>('.qiaomu-modal-wrap');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

it('suggests the shows in two groups, Chinese first, and fetches nothing until one is opened', async () => {
	state.feed.mockReset(); await home();
	expect(Array.from(document.querySelectorAll('.qiaomu-shows-label')).map(l => l.textContent)).toEqual(['中文', '海外 · AI']); expect(cards()).toHaveLength(CATALOG.length); expect(cards().map(c => c.querySelector('b')!.textContent)).toEqual(CATALOG.map(s => s.name));
	expect(document.body.textContent).toContain('推荐播客'); expect(state.feed).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
});

it('opens a show in a dialog with its newest episodes, and one press on an episode starts study mode for it', async () => {
	state.feed.mockReset(); state.feed.mockResolvedValue(FEED); await home(); const show = CATALOG.find(s => s.id === 'latent-space')!;
	cards().find(c => c.dataset.id === 'latent-space')!.click(); expect(dialog()!.textContent).toContain('正在读取最新节目'); expect(dialog()!.getAttribute('aria-modal')).toBe('true'); await settle();
	expect(state.feed).toHaveBeenCalledWith(show.feed); expect(dialog()!.querySelector('.qiaomu-modal-title b')!.textContent).toBe('Latent Space: The AI Engineer Podcast'); expect(dialog()!.querySelector('.qiaomu-modal-head img')!.getAttribute('src')).toBe('https://img.example.com/c.jpg');
	const rows = Array.from(dialog()!.querySelectorAll<HTMLElement>('.qiaomu-home-item')); expect(rows).toHaveLength(8); expect(rows[0].textContent).toContain('Episode 0'); expect(rows[0].textContent).toContain('2026-10-01'); expect(rows[0].textContent).toContain('1 小时 30 分钟');
	expect(rows[0].querySelector('button')!.textContent).toBe('学习'); rows[2].click(); expect(open).toHaveBeenCalledWith(episodePath(show.feed, 'g2'));
});

it('closes the dialog with the × button, a click outside it or Escape, and puts the focus back on the show', async () => {
	state.feed.mockReset(); state.feed.mockResolvedValue(FEED); await home(); const card = () => cards()[0];
	card().click(); await settle(); expect(document.activeElement!.classList.contains('qiaomu-home-x')).toBe(true); dialog()!.querySelector<HTMLElement>('.qiaomu-home-x')!.click(); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(card());
	card().click(); await settle(); dialog()!.querySelector<HTMLElement>('.qiaomu-modal-scrim')!.click(); expect(dialog()).toBeNull();
	card().click(); await settle(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(dialog()).toBeNull();
	card().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await settle(); expect(dialog()).not.toBeNull(); // the keyboard opens it too
});

it('shows one show at a time, ignores a slow answer for the one left, and offers to retry a failure', async () => {
	state.feed.mockReset(); let release: (value: unknown) => void = () => {};
	state.feed.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce({ ...FEED, show: 'Second' }).mockRejectedValueOnce(new Error('网络不通')).mockResolvedValueOnce(FEED);
	await home(); cards()[0].click(); cards()[1].click(); await settle(); expect(document.querySelectorAll('.qiaomu-modal-wrap')).toHaveLength(1); expect(dialog()!.textContent).toContain('Second');
	release({ ...FEED, show: 'First (late)' }); await settle(); expect(dialog()!.textContent).not.toContain('First (late)'); expect(dialog()!.textContent).toContain('Second');
	cards()[2].click(); await settle(); expect(dialog()!.textContent).toContain('读取失败：网络不通');
	dialog()!.querySelector<HTMLButtonElement>('.qiaomu-modal-body button')!.click(); await settle(); expect(dialog()!.querySelectorAll('.qiaomu-home-item')).toHaveLength(8);
});

it('keeps an episode of a feed in the recent list, and reopens it by its own path', async () => {
	const path = episodePath('https://f.example.com/feed', 'g1');
	await recordStudy({ url: 'https://f.example.com/feed#g1', title: 'A feed episode', path, kind: 'podcast' }); await recordStudy({ url: 'https://example.com', title: 'x', path: 'reader.html?evil', kind: 'podcast' });
	const recents = await loadRecents(); expect(recents.map(r => [r.title, r.path])).toEqual([['x', undefined], ['A feed episode', path]]); // only a feed path is kept
	state.feed.mockReset(); await home(); const row = Array.from(document.querySelectorAll<HTMLElement>('.qiaomu-home-item')).find(r => r.textContent!.includes('A feed episode'))!; row.click(); expect(open).toHaveBeenCalledWith(path);
});

it('sends a known site to its own study page, offers the media way for an unknown page, and obeys the sites that are switched off', () => {
	const on = { off: [], other: true };
	const vimeo = classifyLink('https://vimeo.com/123456', on)!; expect(vimeo).toMatchObject({ kind: 'web', site: 'Vimeo' }); expect(vimeo.path).toBe('reader.html?study=web&url=' + encodeURIComponent('https://vimeo.com/123456'));
	expect(classifyLink('https://example.com/post', on)).toMatchObject({ kind: 'page', maybeMedia: true }); expect(classifyLink('https://example.com/post', { off: [], other: false })).toMatchObject({ kind: 'page', maybeMedia: false });
	expect(classifyLink('https://vimeo.com/123456', { off: ['vimeo'], other: true })).toMatchObject({ kind: 'page', maybeMedia: false }); // switched off: an ordinary page, and not offered as media either
	expect(classifyLink('https://www.youtube.com/watch?v=dbqweBCynuI', { off: ['youtube'], other: true })!.kind).toBe('page'); expect(classifyLink(`https://www.xiaoyuzhoufm.com/episode/${EP}`, { off: ['xiaoyuzhou'], other: true })!.kind).toBe('page');
	expect(classifyLink('https://www.bilibili.com/video/BV1hM4m1U7rA/', { off: ['bilibili'], other: true })!.kind).toBe('page');
});

it('shows a second button to study an unknown page as audio or video, only when allowed, and opens it that way', async () => {
	await home(); const media = () => document.querySelector<HTMLButtonElement>('.qiaomu-home-secondary')!;
	expect(media().hidden).toBe(true); type('https://example.com/post'); expect(media().hidden).toBe(false); expect(hint()).toContain('按音视频学习');
	media().click(); expect(open).toHaveBeenCalledWith('reader.html?study=web&url=' + encodeURIComponent('https://example.com/post'));
	type('https://vimeo.com/123456'); expect(media().hidden).toBe(true); expect(hint()).toContain('识别为：Vimeo'); document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(open).toHaveBeenLastCalledWith(expect.stringContaining('study=web'));
	state.store.qiaomuStudySites = { off: [], other: false }; await home(); type('https://example.com/post'); expect(media().hidden).toBe(true); // switched off in the settings
	state.store.qiaomuStudySites = { off: ['vimeo'], other: true }; await home(); type('https://vimeo.com/123456'); expect(hint()).toContain('网页（普通阅读）');
});

it('routes Xiaoetong and Channels shares without retaining passwords or promising automatic ASR', async () => {
 const url = 'https://school.xetslk.com/sl/fixture';
 expect(classifyLink('直播链接：' + url + '\n直播密码：fixture-secret')).toMatchObject({kind:'web',url,site:'小鹅通'});
 expect(classifyLink('[视频号](https://weixin.qq.com/sph/fixture)')?.kind).toBe('web');
 expect(classifyLink(url, {off:['xiaoe'],other:true})?.kind).toBe('page');
 expect(classifyLink('https://user:password@school.xetslk.com/sl/x')).toBeUndefined();
 await home(); type(url); expect(hint()).toContain('原网页'); expect(hint()).not.toContain('自动转写');
 document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(open).toHaveBeenCalledWith(expect.stringContaining('study=web'));
});


it('starts Xiaoetong xet.tech shares in media study rather than the ordinary reader', () => {
 const url='https://school.xet.tech/s/Fixture123';
 expect(classifyLink(url)).toMatchObject({kind:'web',site:'小鹅通',path:'reader.html?study=web&url='+encodeURIComponent(url)});
 expect(classifyLink(url,{off:['xiaoe'],other:true})).toMatchObject({kind:'page',maybeMedia:false});
 expect(classifyLink('https://school.xet.tech.evil.example/s/Fixture123')?.kind).toBe('page');
});


it('uses the shared Xiaoetong catalogue for both short-link path forms and upgrades legacy HTTP links',async()=>{
 const {XIAOE_SHORT_HOSTS,XIAOE_PAGE_HOSTS}=await import('./xiaoe-address');
 for(const host of XIAOE_SHORT_HOSTS)for(const path of ['s','sl']){
  const url=`https://school.${host}/${path}/Fixture123`;
  expect(classifyLink(url)).toMatchObject({kind:'web',site:'小鹅通',url});
  expect(classifyLink(url.replace('https:','http:'))).toMatchObject({kind:'web',url});
  expect(classifyLink(`school.${host}/${path}/Fixture123`)).toMatchObject({kind:'web',url});
  expect(classifyLink(url,{off:['xiaoe'],other:true})).toMatchObject({kind:'page',maybeMedia:false});
 }
 for(const host of XIAOE_PAGE_HOSTS)expect(classifyLink(`https://appfixture123.h5.${host}/v3/course/alive/l_fixture123456`)?.kind).toBe('web');
});
