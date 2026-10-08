import type { PanelSegment } from './utils/youtube-panel-actions';
import { BAR_STYLE, buildTranscriptBar, syncTranscriptBar, type BarState, type TranscriptBar } from './utils/youtube-transcript-bar';
import { createTranscriptCache } from './utils/youtube-transcript-cache';
import { fetchBilibiliTrack, listBilibiliTracks, type BilibiliTrack } from './utils/bilibili-captions';
import { cacheKeyFor, chooseTrack, optionsOf, saveLanguage, savedLanguage } from './utils/subtitle-language';
import { bilibiliVideo } from './utils/video-source';
import { pageSettled, SETTLE_MS } from './utils/bilibili-page';
import { createBarGeneration } from './utils/bar-generation';
import { generationStrings } from './utils/subtitle-generation-strings';
import { transcriptHtml } from './utils/youtube-dom-transcript';

// Runs on Bilibili video pages only. Adds the same transcript bar as on YouTube (subtitles, copy, download, study mode)
// at the top of the right column. Subtitles are read from the viewer's own page, so they are there only for a signed-in
// viewer, which is also how Bilibili itself behaves.
declare global { interface Window { qiaomuBilibiliPanelLoaded?: boolean } }

try {
	if (!window.qiaomuBilibiliPanelLoaded) {
		window.qiaomuBilibiliPanelLoaded = true;
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
			empty: text('bilibiliBarNone', '这个视频没有字幕', 'This video has no subtitles'),
			reload: text('youtubePanelReload', '扩展刚更新过，请刷新此页面后再试', 'The extension was updated — reload this page and try again'),
			loading: text('youtubePanelCardLoading', '正在读取字幕…', 'Reading the transcript…'),
			ready: text('youtubePanelCardReady', '字幕已就绪，点击时间可跳转', 'Transcript ready — click a time to jump'),
			none: text('bilibiliBarNone', '这个视频没有字幕', 'This video has no subtitles'),
			retry: text('youtubeBarRetry', '重试', 'Retry'),
			more: text('youtubeBarMore', '更多内容请在沉浸学习里查看', 'Open study mode to read the rest'),
			search: text('youtubeBarSearch', '搜索字幕', 'Search transcript'),
			clear: text('youtubeBarClear', '清除搜索', 'Clear search'),
			noMatch: text('youtubeBarNoMatch', '无结果', 'No results'),
			follow: text('youtubeBarFollow', '字幕跟随播放：开（点击关闭）', 'Following playback — click to turn off'),
			followOff: text('youtubeBarFollowOff', '字幕跟随播放：关（点击开启）', 'Not following — click to follow playback'),
			here: text('youtubeBarHere', '回到当前位置', 'Back to current line'),
			language: text('subtitleLanguage', '字幕语言', 'Subtitle language'),
		};
		const needLoginMessage = text('bilibiliBarLogin', 'B 站只给已登录的账号提供字幕，请登录后点“重试”', 'Bilibili only provides subtitles to signed-in accounts. Sign in, then press Retry');
		const noneMessage = strings.none;
		let enabled = true;
		const cache = api.storage.local ? createTranscriptCache(api.storage.local) : undefined;

		// --- transcript prefetch -------------------------------------------------------------------------------
		const GENERATE_OPTION = '__generate__';
		interface Entry { state: BarState; segments: PanelSegment[]; needLogin: boolean; generated?: boolean; backup?: PanelSegment[]; tracks: BilibiliTrack[]; selected?: string; done: Promise<PanelSegment[]> }
		const store = new Map<string, Entry>();
		const currentKey = (): { key: string; bvid: string; page: number } | null => { const video = bilibiliVideo(location.href); return video ? { key: `bilibili:${video.bvid}:${video.page}`, ...video } : null; };
		const getJson = async (url: string, withCookies: boolean) => (await fetch(url, { credentials: withCookies ? 'include' : 'omit', headers: { Accept: 'application/json' } })).json();
		const prefetch = (video: { key: string; bvid: string; page: number }): Entry => {
			const known = store.get(video.key); if (known) return known;
			const entry: Entry = { state: 'loading', segments: [], needLogin: false, tracks: [], done: Promise.resolve([]) };
			// The language this viewer picked for this video, else the one spoken in it (never "Chinese" by default).
			const preferred = savedLanguage(video.key), cacheKey = cacheKeyFor(video.key, preferred);
			// The list of tracks is also what the language menu shows, so it is read even when the lines come from the cache.
			const listing = listBilibiliTracks(video.bvid, video.page, getJson).then(({ tracks, needLogin }) => { entry.tracks = tracks; entry.needLogin = needLogin; entry.selected = entry.selected ?? chooseTrack(tracks, preferred)?.id; return tracks; });
			entry.done = (cache ? cache.read(cacheKey) : Promise.resolve(undefined)).then(async cached => {
				if (cached) { await listing.then(updateBar, () => {}); return cached; }
				const chosen = chooseTrack(await listing, preferred);
				if (!chosen) return [];
				entry.selected = chosen.id;
				const segments = await fetchBilibiliTrack(chosen, getJson);
				if (segments.length) void cache?.write(cacheKey, segments);
				return segments;
			}).catch(() => [] as PanelSegment[]).then(async segments => {
				// Nothing from Bilibili: a transcript generated on this computer earlier is used instead.
				const shown = entry.tracks.find(item => item.id === entry.selected);
				// Bilibili's own machine subtitle is often a Chinese translation of foreign speech: a transcript the viewer already made from the audio wins over it.
				if (segments.length && shown?.auto && cache && !entry.generated) { const made = await cache.read(`generated:${video.key}`); if (made?.length) { segments = made; entry.generated = true; generation.markGenerated(video.key); } }
				if (!segments.length && cache) { const made = await cache.read(`generated:${video.key}`); if (made && !entry.generated) { segments = made; entry.generated = true; generation.markGenerated(video.key); } }
				if (entry.generated && entry.segments.length > segments.length) return entry.segments; // generation already filled it while we were looking
				entry.segments = segments; entry.state = segments.length ? 'ready' : 'none'; updateBar(); return segments;
			});
			store.set(video.key, entry); return entry;
		};
		// The viewer picked another subtitle language: read that track and remember the choice for this video.
		const chooseLanguage = async (id: string) => {
			if (id === GENERATE_OPTION) { generation.actions.request(); updateBar(); return; }
			const video = currentKey(), entry = video ? store.get(video.key) : undefined, track = entry?.tracks.find(item => item.id === id);
			if (!video || !entry || !track || entry.generated) return;
			const previous = entry.selected; entry.selected = id; entry.state = 'loading'; updateBar();
			try {
				const segments = await fetchBilibiliTrack(track, getJson); if (!segments.length) throw new Error('empty');
				entry.segments = segments; entry.done = Promise.resolve(segments); entry.state = 'ready'; saveLanguage(video.key, track.language); void cache?.write(cacheKeyFor(video.key, track.language), segments);
			} catch { entry.selected = previous; entry.state = entry.segments.length ? 'ready' : 'none'; }
			updateBar();
		};
		const getSegments = async (): Promise<PanelSegment[]> => { const video = currentKey(); if (!video) return []; const entry = prefetch(video); return entry.generated && entry.segments.length ? entry.segments : entry.done; };
		// "Generate subtitles" for a video that has none: runs in the local helper; the lines land in the same entry the bar reads.
		const generation = createBarGeneration({
			openSettings: () => { try { void api.runtime.sendMessage({ action: 'openSettings', section: 'asr-models' }); } catch { /* extension reloaded */ } },
			videoKey: () => currentKey()?.key ?? null, bar: () => bar,
			apply: (key, lines, done) => { const entry = store.get(key); if (entry) { if (!entry.generated && !entry.backup && entry.segments.length) entry.backup = entry.segments; entry.segments = lines; entry.generated = true; entry.state = done ? 'ready' : 'generating'; updateBar(); } },
			revert: key => { const entry = store.get(key); if (entry) { entry.segments = entry.backup ?? []; entry.generated = false; entry.state = entry.segments.length ? 'ready' : 'none'; updateBar(); } },
			save: (key, lines) => { void cache?.write(`generated:${key}`, lines); },
		});

		// --- UI ------------------------------------------------------------------------------------------------
		const style = document.createElement('style');
		style.textContent = BAR_STYLE;
		const openStudy = (): boolean => { try { api.runtime.sendMessage({ action: 'qiaomuTripleKey', command: 'read' })?.catch?.(() => {}); return true; } catch { return false; } };
		const openSettings = () => { try { api.runtime.sendMessage({ action: 'openSettings', section: 'video' })?.catch?.(() => {}); } catch { /* extension reloaded */ } };
		const retry = () => { const video = currentKey(); if (!video) return; store.delete(video.key); prefetch(video); updateBar(); };
		const mainVideo = () => document.querySelector<HTMLVideoElement>('.bpx-player-video-wrap video, video') ?? undefined;
		// Bilibili's player is an ordinary <video>; setting its time is what its own progress bar does.
		const seek = (seconds: number) => { const video = mainVideo(); if (video) { video.currentTime = seconds; void video.play?.().catch(() => {}); } };
		const OPEN_KEY = 'qiaomuTranscriptBarOpen', FOLLOW_KEY = 'qiaomuTranscriptBarFollow';
		const stored = (key: string, fallback: boolean) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === '1'; } catch { return fallback; } };
		const remember = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ } };
		const title = () => (document.querySelector('h1.video-title')?.textContent || document.title).replace(/[_\s-]*哔哩哔哩.*$/, '').trim() || document.title;
		let bar: TranscriptBar | undefined, barKey = '', settledAt = 0;
		const updateBar = () => {
			const video = currentKey(), entry = video ? store.get(video.key) : undefined;
			strings.none = entry?.needLogin ? needLoginMessage : noneMessage;
			bar?.setState(entry?.state ?? 'loading', entry?.segments); bar?.setLanguages(entry && !entry.generated ? [...optionsOf(entry.tracks), ...(entry.tracks.find(item => item.id === entry.selected)?.auto ? [{ id: GENERATE_OPTION, label: text('subtitleGenFromAudio', '识别原声…', 'Recognise the audio…') }] : [])] : [], entry?.selected); generation.sync();
		};
		let frame = 0;
		const refresh = () => {
			frame = 0;
			if (!enabled) { document.querySelectorAll('.qiaomu-yt-bar').forEach(node => node.remove()); bar = undefined; return; }
			if (!style.isConnected) (document.head || document.documentElement).append(style);
			const video = currentKey();
			if (!video) { document.querySelector('.qiaomu-yt-bar')?.remove(); bar = undefined; return; }
			prefetch(video);
			// Wait for the page to finish its own start-up before touching it, then a moment longer.
			if (!pageSettled(document)) { settledAt = 0; setTimeout(schedule, 500); return; }
			if (!settledAt) settledAt = Date.now();
			if (!bar && Date.now() - settledAt < SETTLE_MS) { setTimeout(schedule, SETTLE_MS - (Date.now() - settledAt) + 50); return; }
			// Switching to another part or video without a page load needs its own bar state.
			if (barKey !== video.key) { document.querySelector('.qiaomu-yt-bar')?.remove(); bar = undefined; barKey = video.key; generation.reset(); }
			syncTranscriptBar(document, () => {
				bar = buildTranscriptBar(document, {
					strings, title, openStudy, openSettings, retry, seek, getSegments,
					getTime: () => mainVideo()?.currentTime,
					initialOpen: stored(OPEN_KEY, false), onToggle: open => remember(OPEN_KEY, open),
					initialFollow: stored(FOLLOW_KEY, true), onFollow: follow => remember(FOLLOW_KEY, follow), theme: 'bilibili',
					onLanguage: id => { void chooseLanguage(id); },
					generation: { strings: generationStrings(text), actions: generation.actions },
				});
				return bar.element;
			}, '.right-container-inner, .playlist-container--right', '.up-panel-container');
			updateBar();
		};
		// Bilibili re-renders its right column as parts and recommendations change; coalesce mutations per frame.
		const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
		const ours = (node: Node | null) => Boolean((node instanceof Element ? node : node?.parentElement)?.closest('.qiaomu-yt-bar'));
		new MutationObserver(records => { if (!records.every(record => ours(record.target))) schedule(); }).observe(document.documentElement, { childList: true, subtree: true });
		window.addEventListener('popstate', schedule);
		const onTime = (event: Event) => { const video = event.target; if (video instanceof HTMLVideoElement && bar && video === mainVideo()) bar.setTime(video.currentTime, event.type === 'seeked'); };
		for (const type of ['timeupdate', 'seeked', 'playing']) document.addEventListener(type, onTime, true);

		// Study mode asks the video's own tab for the transcript the bar already has (Bilibili's, or one generated here).
		api.runtime.onMessage.addListener((request, _sender, respond) => {
			if (request?.action !== 'qiaomuTranscript') return;
			void (async () => {
				await getSegments();
				if (typeof request.language === 'string') await chooseLanguage(request.language);
				const segments = await getSegments(), entry = store.get(currentKey()?.key || '');
				respond({ html: segments.length ? transcriptHtml(segments) : '', count: segments.length, languages: entry && !entry.generated ? optionsOf(entry.tracks) : [], selected: entry?.selected });
			})().catch(() => respond({ html: '', count: 0 }));
			return true;
		});

		// The viewer can switch a site off in the settings ("supported sites"); everything is on until then.
		let panelOn = true, siteOn = true;
		const applySites = (value?: { off?: unknown }) => { siteOn = !(Array.isArray(value?.off) && (value!.off as unknown[]).includes('bilibili')); enabled = panelOn && siteOn; schedule(); };
		api.storage.local?.get('qiaomuStudySites').then(data => applySites(data?.qiaomuStudySites)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.qiaomuStudySites) applySites(changes.qiaomuStudySites.newValue); });
		const apply = (settings?: { youtubePanelActions?: boolean }) => { panelOn = settings?.youtubePanelActions !== false; enabled = panelOn && siteOn; schedule(); };
		api.storage.sync?.get('general_settings').then(data => apply(data?.general_settings)).catch(() => {});
		api.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.general_settings) apply(changes.general_settings.newValue); });
		schedule();
	}
} catch {
	// The extension may have been updated while this page was open.
}
