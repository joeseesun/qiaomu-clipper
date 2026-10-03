import type { PanelSegment } from './utils/youtube-panel-actions';
import { BAR_STYLE, buildTranscriptBar, syncTranscriptBar, type BarState, type TranscriptBar } from './utils/youtube-transcript-bar';
import { fetchCaptionSegments } from './utils/youtube-captions';
import { markAutoOpenedPanel, openTranscriptPanel, readYouTubeTranscriptFromDom, releaseAutoPanel, resetOpenAttempts, transcriptHtml, transcriptPanelOpen } from './utils/youtube-dom-transcript';
import { readPanelSegments } from './utils/youtube-panel-actions';

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
				sync?: { get(key: string): Promise<Record<string, any>> };
				onChanged: { addListener(listener: (changes: Record<string, { newValue?: any }>, area: string) => void): void };
			};
		};
		const api = (typeof browser !== 'undefined' ? browser : chrome) as unknown as Api;
		const zh = /^zh/i.test(navigator.language);
		const text = (key: string, zhText: string, enText: string) => api.i18n.getMessage(key) || (zh ? zhText : enText);
		const strings = {
			heading: text('youtubePanelCardTitle', '乔木 · 沉浸学习', 'Qiaomu · Study'),
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

		// --- transcript prefetch -------------------------------------------------------------------------------
		interface Entry { state: BarState; segments: PanelSegment[]; done: Promise<PanelSegment[]> }
		const store = new Map<string, Entry>();
		const currentVideo = () => location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') : null;
		// YouTube answers get_transcript with "precondition failed" when it wants a player token (seen in signed-out
		// sessions). After two such refusals in a row stop asking on this page; the transcript panel still works.
		let refusals = 0;
		const prefetch = (videoId: string): Entry => {
			const known = store.get(videoId); if (known) return known;
			const entry: Entry = { state: 'loading', segments: [], done: Promise.resolve([]) };
			const request = refusals >= 2 ? Promise.resolve([] as PanelSegment[]) : fetchCaptionSegments(videoId, document).then(segments => { refusals = 0; return segments; }, () => { refusals++; return [] as PanelSegment[]; });
			entry.done = request.then(segments => {
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
			if (entry && fromPanel.length) { entry.segments = fromPanel; entry.state = 'ready'; updateBar(); }
			return fromPanel;
		};

		// --- UI ------------------------------------------------------------------------------------------------
		const style = document.createElement('style'); style.textContent = BAR_STYLE;
		// A page opened before the extension was reloaded keeps a dead copy of this script; say so instead of doing nothing.
		const openStudy = (): boolean => { try { api.runtime.sendMessage({ action: 'qiaomuTripleKey', command: 'read' })?.catch?.(() => {}); return true; } catch { return false; } };
		const retry = () => {
			const id = currentVideo(); if (!id) return;
			store.delete(id); autoOpened.delete(id); resetOpenAttempts(); prefetch(id); updateBar();
		};
		const openSettings = () => { try { api.runtime.sendMessage({ action: 'openSettings', section: 'general' })?.catch?.(() => {}); } catch { /* extension reloaded */ } };
		const seek = (seconds: number) => { const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video'); if (video) { video.currentTime = seconds; void video.play?.().catch(() => {}); } };
		const OPEN_KEY = 'qiaomuTranscriptBarOpen', FOLLOW_KEY = 'qiaomuTranscriptBarFollow';
		const stored = (key: string, fallback: boolean) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === '1'; } catch { return fallback; } };
		const remember = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ } };
		// The page's own video drives the highlight. An ad plays on the same element, so it is ignored.
		const mainVideo = () => document.querySelector('.html5-video-player.ad-showing') ? undefined : document.querySelector<HTMLVideoElement>('video.html5-main-video, video') ?? undefined;
		const wasOpen = stored(OPEN_KEY, false);
		let bar: TranscriptBar | undefined;
		const updateBar = () => {
			const videoId = currentVideo(); const entry = videoId ? store.get(videoId) : undefined;
			bar?.setState(entry?.state ?? 'loading', entry?.segments);
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
			if (entry && entry.state !== 'ready') { const rendered = readPanelSegments(document); if (rendered.length) { entry.segments = rendered; entry.state = 'ready'; } }
			if (!videoId) { document.querySelector('.qiaomu-yt-bar')?.remove(); bar = undefined; return; }
			syncTranscriptBar(document, () => {
				bar = buildTranscriptBar(document, {
					strings, title: () => document.title, openStudy, openSettings, retry, seek, getSegments: () => getSegments(true),
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
		new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

		// Media events do not bubble, but a capturing listener hears every video element, even a replaced one.
		const onTime = (event: Event) => { const video = event.target; if (video instanceof HTMLVideoElement && bar && video === mainVideo()) bar.setTime(video.currentTime, event.type === 'seeked'); };
		for (const type of ['timeupdate', 'seeked', 'playing']) document.addEventListener(type, onTime, true);

		// Prefetch once the page is idle, and again after each in-app navigation to another video.
		let lastPrefetched = '';
		const startPrefetch = () => {
			const videoId = currentVideo();
			if (!enabled || !videoId || videoId === lastPrefetched) return;
			lastPrefetched = videoId;
			const run = () => { if (currentVideo() === videoId) prefetch(videoId); };
			const idle = (window as any).requestIdleCallback as undefined | ((callback: () => void, options?: { timeout: number }) => void);
			if (idle) idle(run, { timeout: 4000 }); else setTimeout(run, 1500);
		};
		window.addEventListener('yt-navigate-finish', () => { startPrefetch(); schedule(); });

		// The background asks for the transcript when study mode opens.
		api.runtime.onMessage.addListener((request, _sender, respond) => {
			if (request?.action !== 'qiaomuTranscript') return;
			getSegments(true).then(segments => respond({ html: segments.length ? transcriptHtml(segments) : '', count: segments.length })).catch(() => respond({ html: '', count: 0 }));
			return true;
		});

		const apply = (settings?: { youtubePanelActions?: boolean; youtubeAutoTranscript?: boolean; youtubeHideNativeTranscript?: boolean }) => { enabled = settings?.youtubePanelActions !== false; autoOpen = settings?.youtubeAutoTranscript !== false; hideNative = settings?.youtubeHideNativeTranscript !== false; startPrefetch(); schedule(); };
		api.storage.sync?.get('general_settings').then(data => apply(data?.general_settings)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue); });
		startPrefetch(); schedule();
	}
} catch {
	// The extension may have been updated while this page was open.
}
