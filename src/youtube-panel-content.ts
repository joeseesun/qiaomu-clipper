import { buildPanelActions, buildStudyCard, PANEL_STYLE, syncPanelActions, syncStudyCard, type CardState, type StudyCard } from './utils/youtube-panel-actions';
import type { PanelSegment } from './utils/youtube-panel-actions';
import { fetchTranscriptSegments } from './utils/youtube-innertube-transcript';
import { openTranscriptPanel, readYouTubeTranscriptFromDom, transcriptHtml, transcriptPanelOpen } from './utils/youtube-dom-transcript';
import { readPanelSegments } from './utils/youtube-panel-actions';

// Runs on YouTube pages only. Adds an always-visible study card and copy / download / study chips to the transcript
// panel, and fetches the transcript in the background as soon as a video page is idle, so opening study mode,
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
			copy: text('youtubePanelCopy', '复制', 'Copy'),
			download: text('youtubePanelDownload', '下载', 'Download'),
			study: text('youtubePanelStudy', '沉浸学习', 'Study'),
			copied: text('youtubePanelCopied', '已复制', 'Copied'),
			empty: text('youtubePanelEmpty', '没有读到字幕，请先展开转写文稿', 'No transcript lines found. Open the transcript first.'),
		};
		const cardText = {
			heading: text('youtubePanelCardTitle', '乔木 · 沉浸学习', 'Qiaomu · Study'),
			loading: text('youtubePanelCardLoading', '正在准备字幕…', 'Preparing transcript…'),
			ready: text('youtubePanelCardReady', '字幕已就绪', 'Transcript ready'),
			none: text('youtubePanelCardNone', '点击后读取字幕', 'Click to read the transcript'),
		};
		let enabled = true, autoOpen = true;
		const autoOpened = new Set<string>(); // one automatic opening per video: if the viewer closes the panel, it stays closed

		// --- transcript prefetch -------------------------------------------------------------------------------
		interface Entry { state: CardState; segments: PanelSegment[]; done: Promise<PanelSegment[]> }
		const store = new Map<string, Entry>();
		const currentVideo = () => location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') : null;
		// YouTube answers get_transcript with "precondition failed" when it wants a player token (seen in signed-out
		// sessions). After two such refusals in a row stop asking on this page; the transcript panel still works.
		let refusals = 0;
		const prefetch = (videoId: string): Entry => {
			const known = store.get(videoId); if (known) return known;
			const entry: Entry = { state: 'loading', segments: [], done: Promise.resolve([]) };
			const request = refusals >= 2 ? Promise.resolve([] as PanelSegment[]) : fetchTranscriptSegments(videoId, document).then(segments => { refusals = 0; return segments; }, () => { refusals++; return [] as PanelSegment[]; });
			entry.done = request.then(segments => {
				entry.segments = segments; entry.state = segments.length ? 'ready' : 'none'; updateCard(); return segments;
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
			if (entry && fromPanel.length) { entry.segments = fromPanel; entry.state = 'ready'; updateCard(); }
			return fromPanel;
		};

		// --- UI ------------------------------------------------------------------------------------------------
		const style = document.createElement('style'); style.textContent = PANEL_STYLE;
		const openStudy = () => { try { api.runtime.sendMessage({ action: 'qiaomuTripleKey', command: 'read' })?.catch?.(() => {}); } catch { /* extension reloaded; refresh the page */ } };
		let card: StudyCard | undefined;
		const updateCard = () => {
			const videoId = currentVideo(); const entry = videoId ? store.get(videoId) : undefined;
			card?.setState(entry?.state ?? 'loading', entry?.segments.length ?? 0);
		};
		let frame = 0;
		const refresh = () => {
			frame = 0;
			if (!enabled) { document.querySelectorAll('.qiaomu-yt-actions, .qiaomu-yt-card').forEach(node => node.remove()); card = undefined; return; }
			if (!style.isConnected) (document.head || document.documentElement).append(style);
			const videoId = currentVideo();
			if (videoId && autoOpen && !autoOpened.has(videoId)) {
				if (transcriptPanelOpen(document)) autoOpened.add(videoId);
				else if (openTranscriptPanel(document)) autoOpened.add(videoId);
			}
			// Whatever YouTube rendered in the panel is also a ready transcript for copy, download and study mode.
			const entry = videoId ? store.get(videoId) : undefined;
			const panelEl = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
			if (entry && entry.state !== 'ready' && panelEl) { const rendered = readPanelSegments(panelEl); if (rendered.length) { entry.segments = rendered; entry.state = 'ready'; } }
			syncPanelActions(document, panel => buildPanelActions(document, panel, { strings, title: () => document.title, openStudy, getSegments: () => getSegments(false) }));
			if (!videoId) { document.querySelector('.qiaomu-yt-card')?.remove(); card = undefined; return; }
			syncStudyCard(document, () => {
				card = buildStudyCard(document, { strings, title: () => document.title, openStudy, getSegments: () => getSegments(true), heading: cardText.heading, statusText: state => cardText[state === 'loading' ? 'loading' : state === 'ready' ? 'ready' : 'none'] });
				return card.element;
			});
			updateCard();
		};
		// YouTube is a single-page app and re-renders often; coalesce mutations per frame.
		const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
		new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

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

		const apply = (settings?: { youtubePanelActions?: boolean; youtubeAutoTranscript?: boolean }) => { enabled = settings?.youtubePanelActions !== false; autoOpen = settings?.youtubeAutoTranscript !== false; startPrefetch(); schedule(); };
		api.storage.sync?.get('general_settings').then(data => apply(data?.general_settings)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue); });
		startPrefetch(); schedule();
	}
} catch {
	// The extension may have been updated while this page was open.
}
