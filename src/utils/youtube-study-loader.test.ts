// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ parse: vi.fn(), fetch: vi.fn(), ready: vi.fn() }));
vi.mock('defuddle', () => ({ default: class { parseAsync() { return state.parse(); } } }));
vi.mock('./highlighter', () => ({ setPageTitle: vi.fn(), setPageUrl: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: (...args: unknown[]) => state.fetch(...args) } } }));
vi.mock('./reader', () => ({ Reader: {
	isReaderPage: false, preExtractedContent: null,
	apply: vi.fn(async () => { document.body.innerHTML = '<main><h1>Video</h1><article><iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe><div class="youtube-study-toolbar"><span class="youtube-study-status"></span></div></article></main><button id="qiaomu-reader-clip"></button>'; }),
	attachYouTubeTranscript: vi.fn(async (_doc: Document, transcript: HTMLElement) => { document.querySelector('article')!.appendChild(transcript); }),
} }));
vi.mock('./youtube-study', () => ({ transcriptText: (node: HTMLElement) => node.querySelector('.transcript-segment')?.textContent || '' }));
import { startYouTubeStudy, withTranscriptDeadline } from './youtube-study-loader';
import { Reader } from './reader';
import { youtubeStudyPath } from './youtube-url';
const url = 'https://www.youtube.com/watch?v=dbqweBCynuI';
const result = { content: '<div class="youtube transcript"><p class="transcript-segment">Actual subtitle</p></div>', title: 'Video' };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; state.fetch.mockResolvedValue({ html: '<html><body>source</body></html>' }); });
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

it('shows a retry after missing subtitles and fetches a fresh source on retry', async () => {
	state.parse.mockResolvedValueOnce({ content: '<p>Description only</p>' }).mockResolvedValueOnce(result);
	await startYouTubeStudy(url, 42, 'Video', state.ready); await flush();
	const retry = document.querySelector<HTMLButtonElement>('[aria-label="重新加载字幕"]')!;
	expect(retry.hidden).toBe(false);
	expect(document.querySelector('iframe')).not.toBeNull();
	retry.click(); await flush();
	expect(state.fetch).toHaveBeenCalledTimes(2);
	expect(Reader.attachYouTubeTranscript).toHaveBeenCalledOnce();
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
