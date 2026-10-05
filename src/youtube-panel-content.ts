import type { PanelSegment } from './utils/youtube-panel-actions';
import { BAR_STYLE, buildTranscriptBar, syncTranscriptBar, type BarState, type TranscriptBar } from './utils/youtube-transcript-bar';
import { audioLanguageFromDocument, fetchCaptionResult, sameLanguage } from './utils/youtube-captions';
import { createTranscriptCache } from './utils/youtube-transcript-cache';
import { markAutoOpenedPanel, openTranscriptPanel, readYouTubeTranscriptFromDom, releaseAutoPanel, resetOpenAttempts, transcriptHtml, transcriptPanelOpen } from './utils/youtube-dom-transcript';
import { readPanelSegments } from './utils/youtube-panel-actions';
import { pauseVideoForStudy } from './utils/study-playback';

// Runs on YouTube pages only. Adds the transcript bar (subtitles, copy, download, study, settings, dropdown) to the
// top of the watch page's right column, and fetches the transcript in the background as soon as a video page is idle, so opening study mode,
// copying or downloading is instant instead of waiting for YouTube's lazily built panel.
declare global { interface Window { qiaomuYouTubePanelLoaded?: boolean } }

try {
	if (!window.qiaomuYouTubePanelLoaded) {
		window.qiaomuYouTubePanelLoaded = true;
		type Api = {
			runtime: {
				sendMessage(message: unknown): Promise<unknown> | undefined;
				onMessage: { addListener(listener: (request: any, sender: unknown, respond: (response: unknown) => void) => boolean | void): void };
			};
			i18n: { getMessage(key: string): string };
			storage: {
				local?: { get(keys: string | string[]): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> };
				sync?: { get(key: string): Promise<Record<string, any>> };
				onChanged: { addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void };
			};
		};
		const api = (typeof browser !== 'undefined' ? browser : chrome) as unknown as Api;
		const zh = /^zh/i.test(navigator.language);
		const text = (key: string, zhText: string, enText: string) => api.i18n.getMessage(key) || (zh ? zhText : enText);
		const strings = {
			heading: text('', '乔木剪藏', 'Qiaomu Clipper'),
			subtitles: text('youtubeBarSubtitles', '字幕', 'Subtitles'),
			copy: text('youtubePanelCopy', '复制', 'Copy'),
			download: text('youtubePanelDownload', '下载', 'Download'),
			study: text('youtubePanelStudy', '沉浸学习', 'Study'),
			settings: text('youtubeBarSettings', '设置', 'Settings'),
			expand: text('youtubeBarExpand', '展开字幕', 'Show transcript'),
			collapse: text('youtubeBarCollapse', '收起', 'Collapse'),
			copied: text('youtubePanelCopied', '已复制', 'Copied'),
			empty: text('youtubePanelEmpty', '没有读到字幕，请先展开转写文稿', 'No transcript lines found. Open the transcript first.'),
			reload: text('youtubePanelReload', '扩展刚更新过，请刷新此页面后再试', 'The extension was updated — reload this page and try again'),
			loading: text('youtubePanelCardLoading', '正在读取字幕…', 'Reading the transcript…'),
			ready: text('youtubePanelCardReady', '字幕已就绪，点击时间可跳转', 'Transcript ready — click a time to jump'),
			none: text('youtubePanelCardNone', '没有读到字幕。可以试试在 YouTube 里展开“转写文稿”。', 'No transcript found. Try opening “Transcript” on YouTube.'),
			retry: text('youtubeBarRetry', '重试', 'Retry'),
			more: text('youtubeBarMore', '更多内容请在沉浸学习里查看', 'Open study mode to read the rest'),
			search: text('youtubeBarSearch', '搜索字幕', 'Search transcript'),
			clear: text('youtubeBarClear', '清除搜索', 'Clear search'),
			noMatch: text('youtubeBarNoMatch', '无结果', 'No results'),
			follow: text('youtubeBarFollow', '字幕跟随播放：开（点击关闭）', 'Following playback — click to turn off'),
			followOff: text('youtubeBarFollowOff', '字幕跟随播放：关（点击开启）', 'Not following — click to follow playback'),
			here: text('youtubeBarHere', '回到当前位置', 'Back to current line'),
		};
		let enabled = true, autoOpen = true, hideNative = true, weOpenedPanel = false, openedAt = 0;
		const autoOpened = new Set<string>(); // one automatic opening per video: if the viewer closes the panel, it stays closed

		const cache = api.storage.local ? createTranscriptCache(api.storage.local) : undefined;

		// --- transcript prefetch -------------------------------------------------------------------------------
		interface Entry { state: BarState; segments: PanelSegment[]; language?: string; source?: 'manual' | 'automatic' | 'cached'; done: Promise<PanelSegment[]> }
		const store = new Map<string, Entry>();
		const liveStudy = new Map<string, PanelSegment[]>();
		const currentVideo = () => location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') : null;
		// YouTube answers get_transcript with "precondition failed" when it wants a player token (seen in signed-out
		// sessions). After two such refusals in a row stop asking on this page; the transcript panel still works.
		let refusals = 0;
		const prefetch = (videoId: string, force = false): Entry => {
			const known = store.get(videoId); if (known) return known;
			const entry: Entry = { state: 'loading', segments: [], done: Promise.resolve([]) };
			// A transcript read before is shown at once; otherwise ask YouTube, and keep what comes back.
			const fresh = (): Promise<{ segments: PanelSegment[]; language?: string; source?: 'manual' | 'automatic' }> => refusals >= 2 ? Promise.resolve({ segments: [] as PanelSegment[] }) : fetchCaptionResult(videoId, document).then(result => { refusals = 0; return result; }, () => { refusals++; return { segments: [] as PanelSegment[] }; });
			const request = (cache ? cache.read(videoId) : Promise.resolve(undefined as { segments: PanelSegment[]; language?: string; source?: 'manual' | 'automatic' } | undefined)).then(async cached => {
				const audioLanguage = audioLanguageFromDocument(document, videoId);
				if (force || (audioLanguage && cached?.language && !sameLanguage(audioLanguage, cached.language))) cached = undefined;
				if (cached?.language) return { ...cached, source: 'cached' as const };
				const result = await fresh();
				if (result.segments.length) { void cache?.write(videoId, result.segments, result.language, result.source); return result; }
				return cached || result;
			});
			entry.done = request.then(result => {
				const segments = result.segments; entry.language = result.language; entry.source = result.source;
				// The endpoint can be refused; then read the lines from YouTube's own panel without waiting to be asked.
				if (!segments.length && enabled) void getSegments(true).catch(() => []);
				entry.segments = segments; entry.state = segments.length ? 'ready' : 'none'; updateBar(); return segments;
			});
			store.set(videoId, entry); return entry;
		};
		// Fast answer from the prefetch; the panel (opened if needed) is the fallback when the endpoint gave nothing.
		const getSegments = async (open = true): Promise<PanelSegment[]> => {
			const videoId = currentVideo();
			if (videoId) {
				const entry = prefetch(videoId);
				const early = await Promise.race([entry.done, new Promise<PanelSegment[]>(resolve => setTimeout(() => resolve([]), 9000))]);
				if (early.length) return early;
			}
			const fromPanel = await readYouTubeTranscriptFromDom(document, open, open ? 12000 : 0);
			const entry = videoId ? store.get(videoId) : undefined;
			if (entry && fromPanel.length) { entry.segments = fromPanel; entry.source = entry.source || 'manual'; entry.state = 'ready'; updateBar(); if (videoId) void cache?.write(videoId, fromPanel, entry.language, entry.source === 'automatic' ? 'automatic' : 'manual'); }
			return fromPanel;
		};

		// --- UI ------------------------------------------------------------------------------------------------
		const style = document.createElement('style'); style.textContent = BAR_STYLE;
		// A page opened before the extension was reloaded keeps a dead copy of this script; say so instead of doing nothing.
		const openStudy = (): boolean => {
			try {
				const playback = pauseVideoForStudy();
				if (!playback) return false;
				api.runtime.sendMessage({ action: 'qiaomuOpenStudy', ...playback })?.catch?.(() => {});
				return true;
			} catch { return false; }
		};
		const retry = () => {
			const id = currentVideo(); if (!id) return;
			store.delete(id); autoOpened.delete(id); refusals = 0; resetOpenAttempts(); prefetch(id, true); updateBar();
		};
		const openSettings = () => { try { api.runtime.sendMessage({ action: 'openSettings', section: 'general' })?.catch?.(() => {}); } catch { /* extension reloaded */ } };
		// The page's own player does the seeking (it keeps its controls, buffering and state in step); setting the element's
		// time is the fallback. The player object lives in the page, out of reach of a content script, so ask the worker to
		// call it there.
		const seek = (seconds: number) => {
			const fallback = () => { const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video'); if (video) { video.currentTime = seconds; void video.play?.().catch(() => {}); } };
			try { Promise.resolve(api.runtime.sendMessage({ action: 'qiaomuSeek', seconds })).then(done => { if (!(done as { ok?: boolean } | undefined)?.ok) fallback(); }, fallback); } catch { fallback(); }
		};
		const OPEN_KEY = 'qiaomuTranscriptBarOpen', FOLLOW_KEY = 'qiaomuTranscriptBarFollow';
		const stored = (key: string, fallback: boolean) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === '1'; } catch { return fallback; } };
		const remember = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ } };
		// The page's own video drives the highlight. An ad plays on the same element, so it is ignored.
		const mainVideo = () => document.querySelector('.html5-video-player.ad-showing') ? undefined : document.querySelector<HTMLVideoElement>('video.html5-main-video, video') ?? undefined;
		const wasOpen = stored(OPEN_KEY, false);
		let bar: TranscriptBar | undefined;
		const updateBar = () => {
			const videoId = currentVideo(); const entry = videoId ? store.get(videoId) : undefined;
			const live = videoId ? liveStudy.get(videoId) : undefined;
			bar?.setState(live?.length ? 'ready' : (entry?.state ?? 'loading'), live?.length ? live : entry?.segments);
			if (live?.length) {
				const playback = mainVideo()?.currentTime;
				const latest = live[live.length - 1]?.time;
				const seconds = typeof playback === 'number' && Number.isFinite(playback) ? playback : latest?.split(':').reduce((total, part) => total * 60 + Number(part), 0);
				if (Number.isFinite(seconds)) bar?.setTime(seconds, true);
			}
		};
		let frame = 0;
		const refresh = () => {
			frame = 0;
			if (!enabled) { document.querySelectorAll('.qiaomu-yt-bar').forEach(node => node.remove()); bar = undefined; return; }
			if (!style.isConnected) (document.head || document.documentElement).append(style);
			const videoId = currentVideo();
			if (videoId && autoOpen && !autoOpened.has(videoId)) {
				if (transcriptPanelOpen(document)) autoOpened.add(videoId);
				else if (openTranscriptPanel(document)) { autoOpened.add(videoId); weOpenedPanel = true; openedAt = Date.now(); }
			}
			// Hide the panel we opened (our bar shows the same lines); give it back if the viewer closes or reopens it.
			// Hide it only after its lines have rendered (or after a few seconds), so hiding can never starve the fallback.
			const lineCount = readPanelSegments(document).length;
			if (weOpenedPanel && transcriptPanelOpen(document) && (lineCount > 0 || Date.now() - openedAt > 6000)) { markAutoOpenedPanel(document, hideNative); weOpenedPanel = false; }
			else if (!hideNative) markAutoOpenedPanel(document, false);
			else releaseAutoPanel(document);
			// Whatever YouTube rendered in its own panel is also a ready transcript for the bar and for study mode.
			const entry = videoId ? store.get(videoId) : undefined;
			if (entry && entry.state !== 'ready') { const rendered = readPanelSegments(document); if (rendered.length) { entry.segments = rendered; entry.state = 'ready'; if (videoId) void cache?.write(videoId, rendered); } }
			if (!videoId) { document.querySelector('.qiaomu-yt-bar')?.remove(); bar = undefined; return; }
			syncTranscriptBar(document, () => {
				bar = buildTranscriptBar(document, {
					strings, title: () => document.title, openStudy, openSettings, retry, seek, getSegments: () => getSegments(true),
					getTranslations: segments => {
						const transcript = document.querySelector<HTMLElement>('.youtube.transcript');
						const cache = transcript?.__qiaomuTranslationCache;
						return cache && cache.size === segments.length ? cache : undefined;
					},
					sourceLabel: () => {
						const entry = currentVideo() ? store.get(currentVideo()!) : undefined;
						return entry?.source === 'automatic' ? 'YouTube 自动字幕' : entry?.source === 'cached' ? '缓存字幕' : entry?.source === 'manual' ? 'YouTube 字幕' : undefined;
					},
					getTime: () => mainVideo()?.currentTime,
					initialOpen: wasOpen, onToggle: open => remember(OPEN_KEY, open),
					initialFollow: stored(FOLLOW_KEY, true), onFollow: follow => remember(FOLLOW_KEY, follow),
				});
				return bar.element;
			});
			updateBar();
		};
		// YouTube is a single-page app and re-renders often; coalesce mutations per frame.
		const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
		// Our own list and status changes must not wake the page watcher, or every update would cause the next one.
		const ours = (node: Node | null) => Boolean((node instanceof Element ? node : node?.parentElement)?.closest('.qiaomu-yt-bar'));
		new MutationObserver(records => { if (!records.every(record => ours(record.target))) schedule(); }).observe(document.documentElement, { childList: true, subtree: true });

		// Media events do not bubble, but a capturing listener hears every video element, even a replaced one.
		const onTime = (event: Event) => { const video = event.target; if (video instanceof HTMLVideoElement && bar && video === mainVideo()) bar.setTime(video.currentTime, event.type === 'seeked'); };
		for (const type of ['timeupdate', 'seeked', 'playing']) document.addEventListener(type, onTime, true);

		// Prefetch once the page is idle, and again after each in-app navigation to another video.
		let lastPrefetched = '';
		const startPrefetch = () => {
			const videoId = currentVideo();
			if (!enabled || !videoId || videoId === lastPrefetched) return;
			lastPrefetched = videoId; resetOpenAttempts();
			const run = () => { if (currentVideo() === videoId) prefetch(videoId); };
			const idle = (window as any).requestIdleCallback as undefined | ((callback: () => void, options?: { timeout: number }) => void);
			if (idle) idle(run, { timeout: 4000 }); else setTimeout(run, 1500);
		};
		window.addEventListener('yt-navigate-finish', () => { startPrefetch(); schedule(); });

		// The background asks for the transcript when study mode opens.
		api.runtime.onMessage.addListener((request, _sender, respond) => {
			if (request?.action === 'qiaomuStudyLiveTranscript') {
				const videoId = currentVideo();
				if (videoId && Array.isArray(request.segments)) { if (request.segments.length) liveStudy.set(videoId, request.segments as PanelSegment[]); else liveStudy.delete(videoId); updateBar(); }
				respond({ ok: Boolean(videoId) }); return false;
			}
			if (request?.action !== 'qiaomuTranscript') return;
			getSegments(true).then(segments => { const entry = currentVideo() ? store.get(currentVideo()!) : undefined; respond({ html: segments.length ? transcriptHtml(segments, entry?.language) : '', count: segments.length }); }).catch(() => respond({ html: '', count: 0 }));
			return true;
		});

		const apply = (settings?: { youtubePanelActions?: boolean; youtubeAutoTranscript?: boolean; youtubeHideNativeTranscript?: boolean }) => { enabled = settings?.youtubePanelActions !== false; autoOpen = settings?.youtubeAutoTranscript === true; hideNative = settings?.youtubeHideNativeTranscript !== false; startPrefetch(); schedule(); };
		api.storage.sync?.get('general_settings').then(data => apply(data?.general_settings)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue); });
		startPrefetch(); schedule();
	}
} catch {
	// The extension may have been updated while this page was open.
}
