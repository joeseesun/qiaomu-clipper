// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ parse: vi.fn(), fetch: vi.fn(), ready: vi.fn(), store: {} as Record<string, unknown> }));
vi.mock('defuddle', () => ({ default: class { parseAsync() { return state.parse(); } } }));
vi.mock('./page-reload', () => ({ reloadPage: vi.fn() }));
vi.mock('./highlighter', () => ({ setPageTitle: vi.fn(), setPageUrl: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: (...args: unknown[]) => state.fetch(...args) }, storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); }, remove: async (key: string) => { delete state.store[key]; } } } } }));
vi.mock('./reader', () => ({ Reader: {
	isReaderPage: false, preExtractedContent: null,
	apply: vi.fn(async () => { document.body.innerHTML = '<main><h1>Video</h1><article><iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe><div class="youtube-study-toolbar"><span class="youtube-study-status"></span></div></article></main><button id="qiaomu-reader-clip"></button>'; }),
	attachYouTubeTranscript: vi.fn(async (_doc: Document, transcript: HTMLElement) => { document.querySelector('article')!.appendChild(transcript); }),
} }));
vi.mock('./youtube-study', () => ({ mountYouTubeStudy:vi.fn(), transcriptText: (node: HTMLElement) => node.querySelector('.transcript-segment')?.textContent || '' }));
import { firstWithTranscript, startYouTubeStudy, withTranscriptDeadline } from './youtube-study-loader';
import { Reader } from './reader';
import { reloadPage } from './page-reload';
import { youtubeStudyPath } from './youtube-url';
const url = 'https://www.youtube.com/watch?v=dbqweBCynuI';
const result = { content: '<div class="youtube transcript"><p class="transcript-segment">Actual subtitle</p></div>', title: 'Video' };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); state.store = {}; document.body.innerHTML = ''; state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyTranscript' ? {} : { html: '<html><body>source</body></html>' }); });
afterEach(() => vi.useRealTimers());

it('opens a source-linked study route without needing extracted content', () => {
	const path = youtubeStudyPath(url, 42, 'Video');
	expect(path).toContain('reader.html?study=youtube');
	expect(path).toContain('sourceTab=42');
	expect(youtubeStudyPath('https://youtube.com.evil.test/watch?v=dbqweBCynuI', 42)).toBeNull();
	expect(youtubeStudyPath('https://example.com/article', 42)).toBeNull();
});

it('renders the player immediately and attaches late subtitles without replacing it', async () => {
	let resolve!: (value: typeof result) => void;
	state.parse.mockReturnValue(new Promise(done => { resolve = done; }));
	await startYouTubeStudy(url, 42, 'Video', state.ready);
	const iframe = document.querySelector('iframe');
	expect(iframe).not.toBeNull();
	expect(document.querySelector('.youtube-study-status')?.textContent).toContain('正在加载');
	expect(Reader.attachYouTubeTranscript).not.toHaveBeenCalled();
	expect((document.getElementById('qiaomu-reader-clip') as HTMLButtonElement).disabled).toBe(true);
	await flush(); resolve(result); await flush();
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	expect(document.querySelector('iframe')).toBe(iframe);
	expect((document.getElementById('qiaomu-reader-clip') as HTMLButtonElement).disabled).toBe(false);
});

it('quietly tries a second time before asking for a manual retry, then fetches a fresh source on retry', async () => {
	vi.useFakeTimers();
	state.parse.mockResolvedValueOnce({ content: '<p>Description only</p>' }).mockResolvedValueOnce(result);
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	expect(document.querySelector('.youtube-study-status')?.textContent).toContain('重试');
	expect(Reader.attachYouTubeTranscript).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1600); await flush();
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	expect(document.querySelector<HTMLButtonElement>('[aria-label="重新加载字幕"]')!.hidden).toBe(true);
	expect(document.querySelector('iframe')).not.toBeNull();
});

it('shows the retry button after both automatic attempts fail, and retry reads a fresh source', async () => {
	vi.useFakeTimers();
	state.parse.mockResolvedValueOnce({ content: '<p>Description only</p>' }).mockResolvedValueOnce({ content: '<p>Still none</p>' }).mockResolvedValueOnce(result);
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	await vi.advanceTimersByTimeAsync(1600); await flush();
	const retry = document.querySelector<HTMLButtonElement>('[aria-label="重新加载字幕"]')!;
	expect(retry.hidden).toBe(false); expect(Reader.attachYouTubeTranscript).not.toHaveBeenCalled();
	retry.click(); await flush();
	expect(state.fetch.mock.calls.filter(([message]) => message?.action === 'qiaomuYouTubeStudySource')).toHaveLength(3);
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
});

it('mounts the normal reading shell before extraction and keeps its chat and bar when captions arrive', async () => {
	let resolve!: (value: typeof result) => void;
	state.parse.mockReturnValue(new Promise(done => { resolve = done; }));
	const chat = {toggle:vi.fn(() => true)}; const ready=vi.fn();
	const mount=vi.fn(() => { const bar=document.createElement('header');bar.className='clip-bar';document.body.prepend(bar);return {chat,ready}; });
	await startYouTubeStudy(url,42,'Video',state.ready,mount);
	const bar=document.querySelector('.clip-bar');expect(mount).toHaveBeenCalledOnce();expect(ready).not.toHaveBeenCalled();
	await flush();resolve(result);await flush();
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledWith(document,expect.any(HTMLElement),'Video',chat);
	expect(ready).toHaveBeenCalledOnce();expect(document.querySelector('.clip-bar')).toBe(bar);
});

it('makes the ordinary source actions ready even when captions are unavailable, while keeping caption retry', async () => {
	vi.useFakeTimers();
	state.parse.mockResolvedValue({title:'Video',content:'<p>Video description</p>'});
	const ready=vi.fn();const chat={toggle:vi.fn(() => true)};
	await startYouTubeStudy(url,42,'Video',state.ready,()=>({chat,ready}));await flush();await vi.advanceTimersByTimeAsync(1600);await flush();
	expect(state.ready).toHaveBeenCalledWith(expect.objectContaining({content:'<p>Video description</p>'}));
	expect(ready).toHaveBeenCalled();
	expect(document.querySelector<HTMLButtonElement>('[aria-label="重新加载字幕"]')!.hidden).toBe(false);
	expect(Reader.attachYouTubeTranscript).not.toHaveBeenCalled();
});

it('bounds a stalled extraction, aborts it and ignores its eventual result', async () => {
	vi.useFakeTimers();
	let signal!: AbortSignal;
	let resolve!: (value: string) => void;
	const extraction = withTranscriptDeadline(s => { signal = s; return new Promise(done => { resolve = done; }); }, 100);
	const checked = expect(extraction).rejects.toThrow('字幕加载超时');
	await vi.advanceTimersByTimeAsync(100); await checked;
	expect(signal.aborted).toBe(true);
	resolve('late subtitles'); await flush();
});

it('prefers subtitles read inside the video tab when the copied page has none', async () => {
	state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyLiveExtract' ? { ...result, extractedContent: { transcript: 'x' } } : { html: '<html><body>source</body></html>' });
	state.parse.mockResolvedValue({ content: '<p>Description only</p>' });
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	expect(state.fetch.mock.calls.some(([message]) => message?.action === 'qiaomuStudyLiveExtract' && message.sourceTabId === 42)).toBe(true);
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	expect(state.ready).toHaveBeenCalledWith(expect.objectContaining({ variables: { transcript: 'x' } }));
});

it('still works from the copied page when the video tab cannot be read', async () => {
	state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyLiveExtract' ? { error: '原页面不可用' } : { html: '<html><body>source</body></html>' });
	state.parse.mockResolvedValue(result);
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
});

it('takes the first route that has subtitles, keeps a description-only answer as a fallback, rejects only when all fail', async () => {
	const withText = { content: result.content, title: 'with' }, without = { content: '<p>none</p>', title: 'without' };
	expect(await firstWithTranscript([Promise.resolve(without), new Promise<typeof withText>(r => setTimeout(() => r(withText), 5))])).toBe(withText);
	expect(await firstWithTranscript([Promise.reject(new Error('x')), Promise.resolve(without)])).toBe(without);
	await expect(firstWithTranscript([Promise.reject(new Error('first')), Promise.reject(new Error('last'))])).rejects.toThrow();
});

it('uses the transcript the video tab already prefetched, reading only the metadata from the copy and never the network', async () => {
	const prefetched = '<div class="youtube transcript"><p class="transcript-segment">Prefetched line</p></div>';
	let offline: (() => Promise<unknown>) | undefined;
	state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyTranscript' ? { html: prefetched, count: 1 } : { html: '<html><body>source</body></html>' });
	state.parse.mockResolvedValue({ content: '<p>Description</p>', title: 'Video' });
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	expect(state.ready).toHaveBeenCalledWith(expect.objectContaining({ content: '<p>Description</p>' + prefetched }));
	expect(state.fetch.mock.calls.some(([message]) => message?.action === 'qiaomuStudyLiveExtract')).toBe(false);
	expect(offline).toBeUndefined();
});

it('falls back to the full extraction when the tab has no prefetched transcript', async () => {
	state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyTranscript' ? { html: '', count: 0 } : message.action === 'qiaomuStudyLiveExtract' ? { ...result } : { html: '<html><body>source</body></html>' });
	state.parse.mockResolvedValue({ content: '<p>Description only</p>' });
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	expect(state.fetch.mock.calls.some(([message]) => message?.action === 'qiaomuStudyLiveExtract')).toBe(true);
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
});

const KEY = 'youtube:dbqweBCynuI';
const emptyEverywhere = () => state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyTranscript' ? { html: '', count: 0 } : message.action === 'qiaomuStudyLiveExtract' ? { content: '<p>Description only</p>', title: 'Video' } : { html: '<html><body>source</body></html>' });
const generationButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.qiaomu-yt-gen-button'));

it('offers to generate subtitles when the platform has none, checks the helper, asks first, then attaches what it generates', async () => {
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
	vi.useFakeTimers(); emptyEverywhere(); state.parse.mockResolvedValue({ content: '<p>Description only</p>', title: 'Video' });
	const asr: Array<Record<string, unknown>> = [];
	const base = state.fetch.getMockImplementation()!;
	state.fetch.mockImplementation(async (message: { action: string; payload?: Record<string, unknown> }) => {
		if (message.action !== 'qiaomuAsr') return base(message);
		asr.push(message.payload!);
		if (message.payload!.mode === 'status') return { ok: true, ready: true, missing: [], hints: [], engine: 'mlx', modelDownloadNeeded: false };
		return { ok: true, id: 'c'.repeat(32), videoKey: KEY, state: 'completed', stage: 'done', progress: 100, language: 'zh', segmentCount: 2, next: 2, segments: [{ start: 0, end: 2, text: '第一句' }, { start: 65, end: 67, text: '第二句' }] };
	});
	await startYouTubeStudy(url, 42, 'Video', state.ready); await vi.advanceTimersByTimeAsync(3000);
	expect(Reader.attachYouTubeTranscript).not.toHaveBeenCalled(); expect(generationButtons().map(b => b.textContent)).toEqual(['生成字幕']);
	generationButtons()[0].click(); await vi.advanceTimersByTimeAsync(50);
	expect(asr).toEqual([{ mode: 'status', videoKey: KEY }]); expect(Array.from(document.querySelectorAll('.qiaomu-dlg-btn')).map(b => b.textContent)).toEqual(['取消', '生成字幕']); // nothing starts until the viewer agrees
	document.querySelector<HTMLElement>('.qiaomu-dlg-btn.is-primary')!.click(); await vi.advanceTimersByTimeAsync(2500);
	expect(asr[1]).toMatchObject({ mode: 'start', videoKey: KEY });
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	const attached = (Reader.attachYouTubeTranscript as any).mock.calls[0][1] as HTMLElement;
	expect(Array.from(attached.querySelectorAll('.transcript-segment')).map(n => n.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('第一句'), expect.stringContaining('第二句')]));
	expect(Object.keys(state.store)).toContain('qiaomuTranscript2:generated:' + KEY); // kept for the next visit
	expect(document.querySelector('.qiaomu-yt-gen')!.textContent).toContain('字幕由「本机识别」生成');
	expect(document.querySelector<HTMLElement>('.youtube-study-status')!.textContent).toBe('');
	// Made again with another model: the new lines are saved and the page is loaded again, since its transcript is wired once.
	expect(reloadPage).not.toHaveBeenCalled(); asr.length = 0;
	state.fetch.mockImplementation(async (message: { action: string; payload?: Record<string, unknown> }) => {
		if (message.action !== 'qiaomuAsr') return base(message);
		asr.push(message.payload!); if (message.payload!.mode === 'status') return { ok: true, ready: true, missing: [], hints: [], engine: 'mlx', modelDownloadNeeded: false, local: [] };
		return { ok: true, id: 'd'.repeat(32), videoKey: KEY, state: 'completed', stage: 'done', progress: 100, language: 'zh', segmentCount: 1, next: 1, segments: [{ start: 0, end: 2, text: '换了模型的新句子' }] };
	});
	Array.from(document.querySelectorAll<HTMLButtonElement>('.qiaomu-yt-gen-button')).find(b => b.textContent === '换模型生成文字稿')!.click(); await vi.advanceTimersByTimeAsync(50);
	document.querySelector<HTMLElement>('.qiaomu-dlg-btn.is-primary')!.click(); await vi.advanceTimersByTimeAsync(2500);
	expect(asr.find(m => m.mode === 'start')).toMatchObject({ mode: 'start', videoKey: KEY, force: true }); // asked for again, not read from the helper's cache
	expect(JSON.stringify(state.store['qiaomuTranscript2:generated:' + KEY])).toContain('换了模型的新句子'); expect(reloadPage).toHaveBeenCalledTimes(1);
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce(); // not attached a second time
});

it('tells the viewer what is missing when the helper cannot generate, and never starts a job', async () => {
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
	vi.useFakeTimers(); emptyEverywhere(); state.parse.mockResolvedValue({ content: '<p>d</p>', title: 'Video' });
	const base = state.fetch.getMockImplementation()!; const started = vi.fn();
	state.fetch.mockImplementation(async (message: { action: string; payload?: { mode?: string } }) => message.action !== 'qiaomuAsr' ? base(message) : message.payload!.mode === 'status' ? { ok: true, ready: false, missing: ['yt-dlp'], hints: ['brew install yt-dlp ffmpeg'], engine: null, modelDownloadNeeded: false } : (started(), { ok: false, error: 'x' }));
	await startYouTubeStudy(url, 42, 'Video', state.ready); await vi.advanceTimersByTimeAsync(3000);
	generationButtons()[0].click(); await vi.advanceTimersByTimeAsync(50);
	expect(document.querySelector('.qiaomu-yt-gen-code')!.textContent).toBe('brew install yt-dlp ffmpeg'); expect(started).not.toHaveBeenCalled();
});

it('uses a transcript generated earlier when the platform still has none, without offering again', async () => {
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
	vi.useFakeTimers(); emptyEverywhere(); state.parse.mockResolvedValue({ content: '<p>d</p>', title: 'Video' });
	state.store['qiaomuTranscript2:generated:' + KEY] = { segments: [{ time: '0:05', text: '之前生成的' }], at: Date.now() };
	await startYouTubeStudy(url, 42, 'Video', state.ready); await vi.advanceTimersByTimeAsync(3000);
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	expect(((Reader.attachYouTubeTranscript as any).mock.calls[0][1] as HTMLElement).textContent).toContain('之前生成的');
	expect(generationButtons().filter(b => b.textContent === '生成字幕')).toHaveLength(0);
});

it('asks the Bilibili page for its transcript too, so a generated one shows up in study mode', async () => {
	const prefetched = '<div class="youtube transcript"><p class="transcript-segment">B站字幕行</p></div>';
	state.fetch.mockImplementation(async (message: { action: string }) => message.action === 'qiaomuStudyTranscript' ? { html: prefetched, count: 1 } : { html: '<html><body>source</body></html>' });
	state.parse.mockResolvedValue({ content: '<p>Description</p>', title: 'Video' });
	await startYouTubeStudy('https://www.bilibili.com/video/BV1hM4m1U7rA/?p=20', 42, 'Video', state.ready); await flush();
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
	expect(state.fetch.mock.calls.some(([message]) => message?.action === 'qiaomuStudyLiveExtract')).toBe(false);
});
