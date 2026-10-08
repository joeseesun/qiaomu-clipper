import { mountStudyCaptionLanguage } from './study-caption-language';
import { readTedMedia } from './ted-media';
import { probeDouyinPage, probeWebStudy } from './web-study-probe';
import DOMPurify from 'dompurify';
import browser from './browser-polyfill';
import { Reader } from './reader';
import { setPageTitle, setPageUrl } from './highlighter';
import { AUDIO_FILE, asrUpload, registerFeedEpisode, registerWebSource, useWebCookies } from './asr-client';
import { createBarGeneration } from './bar-generation';
import { buildGenerationPanel, GENERATION_STYLE, type GenUi } from './subtitle-generation-panel';
import { generationStrings } from './subtitle-generation-strings';
import { toLines } from './subtitle-generation';
import { transcriptHtml } from './youtube-dom-transcript';
import { createTranscriptCache } from './youtube-transcript-cache';
import { TRANSCRIPT_SELECTOR } from './video-source';
import { createReaderSourceDraft } from './reader-source-draft';
import { mountReaderPreviewShell } from './reader-preview-shell';
import type { PanelSegment } from './youtube-panel-actions';
import { durationText, parsePodcastPage, plainToHtml, type PodcastEpisode } from './podcast-page';
import { siteOf, xStatus } from './study-sites';
import { measureMediaDuration, pickTikTokMedia } from './web-page-media';
// Used only behind __LOCAL_EDITION__: the store build never reaches them, so its bundler drops them (checked by scripts/check-editions.mjs).
import { mountDownloadButton } from './download-button';
import { guessChoice } from './media-download';
import { mountAudioControls } from './audio-controls';
import { recordStudy } from './study-home';
import { reloadPage } from './page-reload';
import { fetchFeed, rssKey, webKey } from './podcast-feed';
import { isVideoFile, mountMediaStudyPlayer } from './media-study-player';

import { t } from './ui-text';
// Study mode for audio: a podcast episode, or a file the viewer chose. The same page as for a video: the player on top, the
// transcript following it, notes and questions beside it. The transcript is made by the same subtitle generation as for videos
// (local engine or a saved cloud service), asked for when there is none yet, and kept for the next visit.
export interface AudioStudyOptions {
	// `file` studies a file the viewer picks on this page; `podcast` an episode page (its audio address is read from the page).
	kind: 'file' | 'podcast' | 'feed' | 'web';
	url?: string;
	title?: string;
	key?: string;
	// A file already chosen (on the study home page): hand it over straight away instead of asking again.
	file?: File;
	// An episode of a podcast feed: the feed's address and the episode's id in it.
	feed?: string;
	guid?: string;
	// Any other site yt-dlp can read: its address.
	webUrl?: string;
	sourceTabId?: number;
}
const text = (id: string, zh: string, en: string) => { try { return browser.i18n.getMessage(id) || (/^zh/i.test(navigator.language) ? zh : en); } catch { return /^zh/i.test(navigator.language) ? zh : en; } };
const FILE_PAGE_URL = 'https://qiaomu.local/audio';

// The episode page, read through the extension (which may fetch any site) rather than from a page on that site.
export async function fetchEpisode(pageUrl: string): Promise<PodcastEpisode> {
	const reply = await browser.runtime.sendMessage({ action: 'fetchProxy', url: pageUrl, options: {} }) as { ok?: boolean; text?: string; error?: string } | undefined;
	if (!reply?.text) throw new Error(reply?.error || t('读取节目页面失败'));
	return parsePodcastPage(reply.text);
}

const STYLE = `
html .qiaomu-web-retry:has(.qiaomu-web-retry-actions){display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:8px 0 16px;padding:18px 20px;border-radius:16px;background:linear-gradient(var(--background-secondary,rgba(127,127,127,.1)),var(--background-secondary,rgba(127,127,127,.1))),var(--background-primary,#fff);box-shadow:0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.16))}
html .qiaomu-web-retry b{font-size:16px;font-weight:600;line-height:24px;color:var(--text-normal,#222)}
html .qiaomu-web-retry p{margin:0;color:var(--text-muted,#666);font-size:14px;line-height:22px}
html .qiaomu-web-retry-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
html .qiaomu-web-retry-actions button.qw-primary,html .qiaomu-web-retry-actions a.qw-secondary{display:inline-flex;align-items:center;justify-content:center;width:auto;min-height:36px;padding:0 16px;border:0;border-radius:10px;font-size:14px;font-weight:600;line-height:1;text-decoration:none;cursor:pointer;box-shadow:none}
html .qiaomu-web-retry-actions button.qw-primary{background:var(--text-normal,#111);color:var(--background-primary,#fff)}
html .qiaomu-web-retry-actions button.qw-primary:hover:not(:disabled){background:var(--text-normal,#111);opacity:.86}
html .qiaomu-web-retry-actions button.qw-primary:disabled{opacity:.5;cursor:default}
html .qiaomu-web-retry-actions a.qw-secondary{background:var(--background-modifier-hover,rgba(127,127,127,.16));color:var(--text-normal,#222)}
html .qiaomu-web-retry-actions a.qw-secondary:hover{background:var(--background-modifier-border,rgba(127,127,127,.26))}
html .qiaomu-web-retry-actions :is(button,a):focus-visible{outline:2px solid var(--text-accent,#666);outline-offset:2px}
html .qiaomu-web-retry select{appearance:none;width:auto;max-width:100%;padding:8px 12px;border:1px solid var(--background-modifier-border,#bbb);border-radius:8px;background:var(--background-primary,#fff);color:var(--text-normal,#222);margin:0 8px 8px 0}
html .qiaomu-web-retry select:focus-visible{outline:2px solid var(--text-accent,#666);outline-offset:2px}

html.qiaomu-audio-page article{--qa-top:72px}
.qiaomu-audio-hero{display:flex;gap:16px;align-items:center;margin:0 0 20px}
.qiaomu-audio-hero img{flex:none;width:84px;height:84px;border-radius:18px;object-fit:cover;background:var(--background-secondary,rgba(127,127,127,.15));box-shadow:0 0 0 1px rgba(127,127,127,.18)}
.qiaomu-audio-hero div{display:flex;flex-direction:column;gap:3px;min-width:0}
.qiaomu-audio-hero b{font-size:16px;font-weight:600;line-height:24px}
.qiaomu-audio-hero span{color:var(--text-muted,#666);font-size:13.5px;line-height:20px}
/* The player is one card: the controls, and under them the switches the transcript brings (follow playback, translate). */
html.qiaomu-audio-page article > .reader-video-wrapper.is-audio,html.qiaomu-audio-page .player-container{margin:0 0 6px;padding:20px 22px 16px;border-radius:20px;background:linear-gradient(var(--background-secondary,rgba(127,127,127,.12)),var(--background-secondary,rgba(127,127,127,.12))),var(--background-primary,#fff);box-shadow:0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.14))}
/* Stuck to the top while the text scrolls: solid (the tint alone is see-through), and a strip of page colour above it so no line shows between it and the bar. */
html.qiaomu-audio-page .player-container{box-shadow:0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.14)),0 -14px 0 0 var(--background-primary,#fff)}
html.qiaomu-audio-page .player-container{position:sticky;top:var(--qa-top);z-index:20;border-top:0}
html.qiaomu-audio-page .player-container .reader-video-wrapper.is-audio{padding:0;background:none;box-shadow:none;border-radius:0;margin:0}
html.qiaomu-audio-page .reader-video-wrapper.is-audio{aspect-ratio:auto;height:auto;overflow:visible}
html.qiaomu-audio-page .reader-video-wrapper.is-audio:not(.has-picture) video{display:none!important}
html.qiaomu-audio-page .reader-video-wrapper.has-picture video.reader-video-player{display:block!important;width:100%!important;height:auto!important;max-height:min(56vh,520px);aspect-ratio:16/9;object-fit:contain;margin:0 0 16px;border-radius:14px;background:#000;cursor:pointer}
.qiaomu-post-text{margin:0 0 20px;font-size:16px;line-height:1.7}.qiaomu-post-text p{margin:0 0 10px}.qiaomu-post-text a{overflow-wrap:anywhere}
html.qiaomu-audio-page .player-container .player-toggles{background:transparent}
html.qiaomu-audio-page .player-container .player-toggles[hidden]{display:none}
html.qiaomu-audio-page .qa-tools .player-toggle-group{display:flex;align-items:center;gap:6px 18px;margin-inline-start:14px;background:transparent}
html.qiaomu-audio-page .qa-tools .player-toggle{background:transparent;font-size:13px;color:var(--text-muted,#6e6e73)}
/* The reader multiplies every svg into its theme; on the dark play button that turns the white icon invisible. */
html.qiaomu-audio-page .qa-player svg{mix-blend-mode:normal!important;filter:none!important}
html.qiaomu-audio-page .player-container .youtube-mode-bar,html.qiaomu-audio-page .player-container .youtube-player-resize{display:none}
html.qiaomu-audio-page .transcript>h2{display:none}
html.qiaomu-audio-page .qa-player{display:flex;flex-direction:column;gap:18px}
html.qiaomu-audio-page .qa-main{display:flex;align-items:center;gap:16px}
html.qiaomu-audio-page .qa-player .qa-play{flex:none;width:48px;height:48px;padding:0;border:0;border-radius:50%;background:var(--text-normal,#1d1d1f);color:var(--background-primary,#fff);box-shadow:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .12s,opacity .12s}
html.qiaomu-audio-page .qa-player .qa-play:hover{opacity:.88;transform:scale(1.04);background:var(--text-normal,#1d1d1f);box-shadow:none}
html.qiaomu-audio-page .qa-player .qa-play svg{width:20px;height:20px}
html.qiaomu-audio-page .qa-player .qa-play[data-state=false] svg{margin-inline-start:2px}
html.qiaomu-audio-page .qa-line{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
html.qiaomu-audio-page .qa-time{flex:none;min-width:44px;color:var(--text-muted,#6e6e73);font-size:12.5px;font-variant-numeric:tabular-nums}
html.qiaomu-audio-page .qa-total{text-align:end}
html.qiaomu-audio-page .qa-seek{--p:0%;flex:1;min-width:0;height:20px;margin:0;padding:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer;box-shadow:none}
html.qiaomu-audio-page .qa-seek::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--text-normal,#1d1d1f) var(--p),var(--background-modifier-border,rgba(127,127,127,.3)) var(--p))}
html.qiaomu-audio-page .qa-seek::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;border:0;background:var(--text-normal,#1d1d1f);box-shadow:0 0 0 3px var(--background-secondary,#f2f2f2);transition:transform .12s}
html.qiaomu-audio-page .qa-seek:hover::-webkit-slider-thumb,html.qiaomu-audio-page .qa-seek:active::-webkit-slider-thumb{transform:scale(1.25)}
html.qiaomu-audio-page .qa-seek::-moz-range-track{height:4px;border-radius:2px;background:var(--background-modifier-border,rgba(127,127,127,.3))}
html.qiaomu-audio-page .qa-seek::-moz-range-progress{height:4px;border-radius:2px;background:var(--text-normal,#1d1d1f)}
html.qiaomu-audio-page .qa-seek::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:var(--text-normal,#1d1d1f)}
html.qiaomu-audio-page .qa-seek:focus-visible{outline:2px solid var(--text-normal,#1d1d1f);outline-offset:4px;border-radius:4px}
html.qiaomu-audio-page .qa-tools{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding-inline-start:64px}
html.qiaomu-audio-page .qa-player .qa-skip{flex:none;width:38px;height:38px;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;color:var(--text-muted,#6e6e73);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .12s,color .12s}
html.qiaomu-audio-page .qa-player .qa-skip:hover{background:var(--background-modifier-hover,rgba(127,127,127,.16));color:var(--text-normal,#1d1d1f);box-shadow:none}
html.qiaomu-audio-page .qa-player .qa-skip svg{width:26px;height:26px}
html.qiaomu-audio-page .qa-speed{display:inline-flex;align-items:center;gap:2px;margin-inline-start:auto;padding:3px;border-radius:17px;background:var(--background-modifier-hover,rgba(127,127,127,.16))}
html.qiaomu-audio-page .qa-player .qa-rate{width:auto;min-width:0;height:28px;padding:0 10px;border:0;border-radius:14px;background:transparent;box-shadow:none;color:var(--text-muted,#6e6e73);font:inherit;font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer}
html.qiaomu-audio-page .qa-player .qa-rate:hover{background:var(--background-modifier-border,rgba(127,127,127,.2));color:var(--text-normal,#1d1d1f);box-shadow:none}
html.qiaomu-audio-page .qa-player .qa-rate[aria-checked=true]{background:var(--background-primary,#fff);color:var(--text-normal,#1d1d1f);font-weight:650;box-shadow:0 1px 2px rgba(0,0,0,.12)}
html.qiaomu-audio-page .qa-player .qa-rate:focus-visible{outline:1px solid var(--text-muted,#6e6e73);outline-offset:2px}
.qiaomu-audio-tabs{display:flex;gap:22px;margin:22px 0 14px;border-bottom:1px solid var(--background-modifier-border,rgba(127,127,127,.25))}
.qiaomu-audio-tab{width:auto;height:auto;margin:0 0 -1px;padding:9px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;box-shadow:none;color:var(--text-muted,#666);font:inherit;font-size:14.5px;font-weight:500;cursor:pointer}
html.qiaomu-audio-page .qiaomu-audio-tab:hover{background:transparent;box-shadow:none;color:var(--text-normal,#222)}
html.qiaomu-audio-page .qiaomu-audio-tab[aria-selected=true]{border-bottom-color:var(--text-normal,#222);color:var(--text-normal,#222)}
.qiaomu-shownotes{font-size:15px;line-height:1.75}
.qiaomu-shownotes img{max-width:100%;height:auto;border-radius:12px}
.qiaomu-shownotes a.qiaomu-seek{font-variant-numeric:tabular-nums;text-decoration:none;border-bottom:1px dotted currentColor}
.qiaomu-shownotes blockquote{margin:14px 0}
article[data-audio-tab=notes] .transcript,article[data-audio-tab=notes] .qiaomu-audio-study .qiaomu-yt-gen,article[data-audio-tab=notes] .youtube-study-feedback,article[data-audio-tab=notes] .qiaomu-audio-status{display:none}
article[data-audio-tab=transcript] .qiaomu-shownotes{display:none}
@media (max-width:560px){html.qiaomu-audio-page .qa-tools{padding-inline-start:0}.qiaomu-audio-hero img{width:64px;height:64px}}
`;

export async function startAudioStudy(options: AudioStudyOptions): Promise<void> {
	const initialTitle = options.title || (options.kind === 'file' ? t('本地音频学习') : options.kind === 'web' ? t('视频学习') : t('播客学习'));
	const url = options.webUrl || options.url || FILE_PAGE_URL;
	const session = await createReaderSourceDraft(url, initialTitle);
	Reader.onEdit = () => {};
	Object.defineProperty(document, 'URL', { value: url, configurable: true });
	Reader.isReaderPage = true;
	Reader.preExtractedContent = { content: '<p></p>', title: initialTitle, domain: options.kind === 'podcast' ? 'xiaoyuzhoufm.com' : 'local' };
	setPageUrl(url); setPageTitle(initialTitle); document.title = initialTitle;
	await Reader.apply(document);
	const article = document.querySelector('article')!;
	article.dataset.audioStudy = 'true'; document.documentElement.classList.add('qiaomu-audio-page');
	// The player card sticks just under the reader's top bar, whatever its height.
	const place = () => article.style.setProperty('--qa-top', `${Math.max(56, document.querySelector('.clip-bar')?.getBoundingClientRect().height || 0) + 10}px`); place(); window.addEventListener('resize', place);
	const shell = mountReaderPreviewShell(session.draft, true);
	if (!document.getElementById('qiaomu-gen-style')) { const style = document.createElement('style'); style.id = 'qiaomu-gen-style'; style.textContent = GENERATION_STYLE; document.head.append(style); }
	const cache = createTranscriptCache(browser.storage.local as Parameters<typeof createTranscriptCache>[0]);
	if (!document.getElementById('qiaomu-audio-style')) { const style = document.createElement('style'); style.id = 'qiaomu-audio-style'; style.textContent = STYLE; document.head.append(style); }
	const holder = document.createElement('div'); holder.className = 'qiaomu-audio-study';
	const status = document.createElement('p'); status.className = 'youtube-study-status qiaomu-audio-status'; status.setAttribute('role', 'status');
	article.prepend(holder); holder.append(status);
	const setupFromStatus = (reason: 'helper-offline' | 'helper-outdated' | 'missing') => {
		const words = generationStrings(text), helper = reason !== 'missing';
		status.textContent = reason === 'helper-outdated' ? words.setupOutdated : helper ? words.setupOffline : words.setupMissing;
		const setup = document.createElement('button'); setup.type = 'button'; setup.className = 'qiaomu-yt-gen-button'; setup.textContent = helper ? words.setupHelper : words.setupRecognition;
		setup.addEventListener('click', () => { void browser.runtime.sendMessage({ action: 'openSettings', section: helper ? 'clip' : 'asr-models' }); });
		status.append(document.createTextNode(' '), setup);
	};
	let sourceHtml = '';
	let key = options.key || '', title = initialTitle, attached = false, remade = false; // `remade`: this transcript replaces one already on the page

	// The player: an <audio> would do, but the transcript wiring follows a <video class="reader-video-player">, which plays audio too.
	const showPlayer = (src: string, picture?: { poster?: string; audioUrl?: string }): HTMLVideoElement => {
		const player = mountMediaStudyPlayer(article, holder, src, Boolean(picture), picture?.poster, picture?.audioUrl);
		if (!picture) player.parentElement!.append(mountAudioControls(document, player, { play: text('audioPlay', '播放', 'Play'), pause: text('audioPause', '暂停', 'Pause'), back: text('audioBack', '后退 15 秒', 'Back 15 s'), forward: text('audioForward', '前进 30 秒', 'Forward 30 s'), speed: text('audioSpeed', '播放速度', 'Playback speed'), seek: text('audioSeek', '播放进度', 'Position') }));
		return player;
	};
	const attach = async (lines: PanelSegment[], replace = false) => {
		if ((attached && !replace) || !lines.length) return;
		const content = document.createElement('div'); content.innerHTML = DOMPurify.sanitize(transcriptHtml(lines, !lines.some(s => s.start !== undefined)));
		const transcript = content.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR); if (!transcript) return;
		if (replace) { article.dispatchEvent(new CustomEvent('qiaomu-transcript-replaced')); article.querySelector(TRANSCRIPT_SELECTOR)?.remove(); }
		attached = true; status.textContent = '';
		await Reader.attachYouTubeTranscript(document, transcript, title, shell.chat);
		// The reader puts its switches (follow playback, translate) in a bar of their own under the player; here they belong in the one row of controls.
		const group = article.querySelector<HTMLElement>('.player-container .player-toggle-group'), tools = article.querySelector<HTMLElement>('.player-container .qa-tools');
		if (article.dataset.audioStudy === 'true' && group && tools) { tools.insertBefore(group, tools.querySelector('.qa-speed')); article.querySelector('.player-container .player-toggles')?.setAttribute('hidden', ''); }
		await session.populate({ content: sourceHtml + transcriptHtml(lines, !lines.some(s => s.start !== undefined)), title }).catch(() => {});
		shell.refresh(); shell.setPending(false);
	};
	const generation = createBarGeneration({
		videoKey: () => key || null,
		bar: () => ({ setGeneration: (ui: GenUi | null) => panel.show(ui ?? { kind: 'offer' }) }) as never,
		apply: (_key, lines, done) => { if (done) { remade = attached; void attach(lines); } },
		revert: () => { panel.show({ kind: 'offer' }); },
		// A transcript made again (another model) replaces the one on the page. The page's transcript is wired once, so it is read again from the
		// saved copy by loading the page again, once the copy is written.
		save: (k, lines) => { void cache.write(`generated:${k}`, lines).then(() => { if (remade) { status.textContent = text('audioRefreshing', '新的文字稿已生成，正在刷新…', 'The new transcript is ready — refreshing…'); reloadPage(); } }); },
		openSettings: () => { window.open(browser.runtime.getURL('settings.html?section=asr-models'), '_blank'); },
	});
	const panel = buildGenerationPanel(document, generationStrings(text), generation.actions);
	holder.append(panel.element);
	// With a key, use what was made before, else ask to make it now.
	const begin = async () => {
		const made = await cache.read(`generated:${key}`);
		if (made?.length) { await attach(made); panel.show({ kind: 'generated' }); return; }
		status.textContent = text('audioStudyNone', '这段内容还没有字幕。生成后，字幕会跟着播放滚动。', 'There are no subtitles for this media yet. Once made, the lines follow playback.');
		generation.actions.request();
	};

	// An episode with a cover, a show, a date and show notes: from a Xiaoyuzhou page or from an RSS feed.
	// `post`: a short text that belongs with the media (a post's words), shown under the heading rather than behind a tab.
	const present = async (episode: { title: string; show: string; cover?: string; date?: string; seconds?: number; audio: string; audioUrl?: string; picture?: boolean; notesHtml: string; notesLabel?: string; post?: string }) => {
		title = episode.title || initialTitle; document.title = title; setPageTitle(title);
		const heading = document.querySelector('main h1'); if (heading) heading.textContent = title;
		// The show, the date and the length, with the cover: what the listener knows the episode by.
		const hero = document.createElement('div'); hero.className = 'qiaomu-audio-hero';
		// A picture that does not load leaves no empty square behind.
		if (episode.cover && !episode.picture) { const cover = document.createElement('img'); cover.src = episode.cover; cover.alt = ''; cover.referrerPolicy = 'no-referrer'; cover.addEventListener('error', () => cover.remove()); hero.append(cover); }
		const about = document.createElement('div'); const show = document.createElement('b'); show.textContent = episode.show || t('播客'); about.append(show);
		const facts = [episode.date?.slice(0, 10), durationText(episode.seconds)].filter(Boolean).join(' · '); if (facts) { const line = document.createElement('span'); line.textContent = facts; about.append(line); }
		hero.append(about); holder.before(hero);
		if (episode.post) { const post = document.createElement('div'); post.className = 'qiaomu-post-text'; post.innerHTML = DOMPurify.sanitize(episode.post); sourceHtml = post.outerHTML; holder.before(post); }
		const player = episode.audio ? showPlayer(episode.audio, episode.picture ? { poster: episode.cover, audioUrl: episode.audioUrl } : undefined) : undefined;
		// Local edition: save the file being played. A video whose picture and sound are two files would need merging; that is not offered.
		if (__LOCAL_EDITION__ && player && episode.audio && /^https:\/\//.test(episode.audio) && !(episode.picture && episode.audioUrl)) {
			const url = episode.audio, video = Boolean(episode.picture), name = title;
			void (async () => {
				const CHOICE_KEY = 'qiaomuDownloadChoice';
				const kind = guessChoice(url, video);
				const remembered = ((await browser.storage.local.get(CHOICE_KEY)) as Record<string, string | undefined>)[CHOICE_KEY];
				// An audio page keeps its controls in the player card; a video page has a row under the player: layout icons on the left,
				// the switches on the right (that row appears once the transcript is attached, and may be rebuilt), so follow it.
				const host = document.createElement('div'); host.className = 'qiaomu-dl-host';
				const place = () => {
					const card = article.querySelector<HTMLElement>('.player-container'), tools = article.querySelector<HTMLElement>('.qa-tools');
					const row = card?.querySelector<HTMLElement>(':scope > .player-toggles');
					const target = !video && tools ? tools : (row || card); if (!target) return;
					if (host.parentElement !== target) {
						host.style.cssText = target === card ? 'grid-column:2;grid-row:3;justify-self:end;padding:8px 0 0;line-height:normal' : target === tools ? 'margin-inline-start:auto' : 'display:inline-flex;margin-inline-start:16px;line-height:normal';
						target.append(host);
					}
				};
				place(); if (!host.parentElement) return;
				new MutationObserver(place).observe(article, { childList: true, subtree: true });
				mountDownloadButton(host, {
					title: name, remembered,
					choices: [{ id: kind.kind, label: video ? t('视频') : t('音频'), url, kind: kind.kind, ext: kind.ext }],
					onRemember: id => { void browser.storage.local.set({ [CHOICE_KEY]: id }); },
					save: async (blob, filename) => {
						const objectUrl = URL.createObjectURL(blob);
						const id = await browser.downloads.download({ url: objectUrl, filename: t('乔木剪藏/{0}', [filename]), saveAs: false, conflictAction: 'uniquify' });
						const finished = (delta: { id: number; state?: { current?: string } }) => { if (delta.id === id && delta.state?.current && delta.state.current !== 'in_progress') { browser.downloads.onChanged.removeListener(finished); URL.revokeObjectURL(objectUrl); } };
						browser.downloads.onChanged.addListener(finished);
						return { reveal: () => { void browser.downloads.show(id); } };
					},
				});
			})().catch(error => { console.warn('[qiaomu] download control not shown:', error); /* a missing control must never stop the study page */ });
		}
		// The show notes next to the transcript: tabs, so neither pushes the other off the screen.
		if (episode.notesHtml) {
			const tabs = document.createElement('div'); tabs.className = 'qiaomu-audio-tabs'; tabs.setAttribute('role', 'tablist');
			const notes = document.createElement('section'); notes.className = 'qiaomu-shownotes'; notes.innerHTML = episode.notesHtml;
			notes.addEventListener('click', event => { const mark = (event.target as HTMLElement).closest<HTMLElement>('a.qiaomu-seek'); if (!mark) return; event.preventDefault(); if (!player) return; player.currentTime = Number(mark.dataset.time); void player.play().catch(() => {}); });
			const choose = (tab: 'transcript' | 'notes') => { article.dataset.audioTab = tab; tabs.querySelectorAll<HTMLElement>('button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tab))); };
			for (const [tab, label] of [['transcript', text('audioTabTranscript', '文字稿', 'Transcript')], ['notes', episode.notesLabel ?? text('audioTabNotes', '节目简介', 'Show notes')]] as const) {
				const button = document.createElement('button'); button.type = 'button'; button.className = 'qiaomu-audio-tab'; button.dataset.tab = tab; button.setAttribute('role', 'tab'); button.textContent = label; button.addEventListener('click', () => choose(tab)); tabs.append(button);
			}
			holder.before(tabs); holder.after(notes); choose('transcript');
		}
	};
	if (options.kind === 'podcast') {
		let episode: PodcastEpisode;
		try { episode = await fetchEpisode(url); } catch (error) { status.textContent = error instanceof Error ? error.message : t('读取节目失败'); return; }
		if (!key) { status.textContent = t('无效的节目链接'); return; }
		void recordStudy({ url, title: episode.title });
		await present({ ...episode, seconds: episode.minutes ? episode.minutes * 60 : undefined }); await begin(); return;
	}
	if (options.kind === 'web') {
		const address = options.webUrl ?? '';
		if (!/^https:\/\//.test(address)) { status.textContent = t('只支持 https 网址'); return; }
		status.textContent = text('webReading', '正在读取这个网址…', 'Reading this address…');
		const official = await readTedMedia(address, async url => { const reply = await browser.runtime.sendMessage({ action: 'fetchProxy', url, options: {} }) as { text?: string }; return reply?.text || ''; });
		const isDouyin = siteOf(address)?.id === 'douyin';
		// The video host of Douyin may refuse a stranger's page as referrer; sending none works (checked on a live item).
		if (isDouyin) { const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta); }
		const source = () => browser.runtime.sendMessage({ action: 'qiaomuWebStudySource', url: address, sourceTabId: options.sourceTabId }).catch(() => null) as Promise<import('./asr-client').WebInfo | null>;
		const { info, cookies } = official ? { info: official, cookies: undefined }
			: isDouyin ? { ...await probeDouyinPage(address, status, holder, source), cookies: undefined }
			: await probeWebStudy(address, status, holder);
		if (!info.ok) {
			status.textContent = info.error === 'unsupported' ? t('这个网址读不了：下载工具不支持这个网站，或这个页面里没有音视频。') : info.error === 'needs-cookies' ? t('这个网站需要有效的浏览器状态才能读取。') : info.error === 'helper-offline' || info.error === 'helper-outdated' ? text('subtitleGenOffline', '没有连上本地助手，需要先安装或更新本地助手。', 'The local helper is not connected or is out of date.') : info.error === 'missing' ? t('还没有安装下载工具（yt-dlp），请先在「ASR 语音识别」里安装，或运行 brew install yt-dlp。') : info.error === 'timeout' ? t('读取超时，请稍后重试。') : t('读取失败') + ((info as { message?: string }).message ? '：' + (info as { message?: string }).message : '');
			if (info.error === 'helper-offline' || info.error === 'helper-outdated' || info.error === 'missing') setupFromStatus(info.error);
			return;
		}
		// TikTok: the file address the download tool reports does not play outside its own session. Play the file TikTok's page loaded
		// (the one as long as this item), which plays here once the media rule has set the site as its referrer.
		if (siteOf(address)?.id === 'tiktok') {
			const live = await browser.runtime.sendMessage({ action: 'qiaomuTikTokMedia', url: address, sourceTabId: options.sourceTabId }).catch(() => null) as { seconds: number | null; candidates: string[] } | null;
			const playable = live?.candidates?.length ? await pickTikTokMedia(live.candidates, info.seconds ?? live.seconds, src => measureMediaDuration(document, src)) : undefined;
			// No file that plays: say so below the player area instead of showing a player that cannot start.
			if (playable) { info.mediaUrl = playable; info.video = true; } else info.mediaUrl = null;
		}
		key = await webKey(address); registerWebSource(key, address, isDouyin ? info.audioUrl || info.mediaUrl || undefined : undefined);
		if (cookies) useWebCookies(key, cookies);
		void recordStudy({ url: address, title: info.title, path: `reader.html?study=web&url=${encodeURIComponent(address)}`, kind: 'web' });
		// A post on X says something of its own: its words stay with the media. A long description of another site waits behind a tab.
		const words = (info.description ?? '').trim(), isPost = Boolean(xStatus(address)), short = isPost || words.length <= 400;
		await present({ title: info.title, show: info.author || info.site, cover: info.thumbnail ?? undefined, date: info.date ?? undefined, seconds: info.seconds ?? undefined, audio: info.mediaUrl ?? '', audioUrl: info.audioUrl, picture: info.video && Boolean(info.mediaUrl), ...(words && short ? { post: plainToHtml(words) } : {}), ...(words && !short ? { notesHtml: plainToHtml(words), notesLabel: text('audioTabAbout', '简介', 'Description') } : { notesHtml: '' }) });
		if (!info.mediaUrl) { const note = document.createElement('p'); note.className = 'qiaomu-shows-note'; note.append(document.createTextNode(siteOf(address)?.id === 'tiktok' ? t('没能取到这条视频的播放地址（它在原页面里正常播放，需要原来的 TikTok 页面保持打开）。字幕照常生成，对照时请在原页面播放：') : t('这个网站没有给出可以直接播放的声音，所以这里不提供播放器；字幕照常生成，对照时请在原页面播放：'))); const link = document.createElement('a'); link.href = address; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('打开原页面'); note.append(link); holder.before(note); }
		if (official?.segments.length) {
			await attach(official.segments); panel.element.hidden = true;
			if (!official.timelineAligned) status.textContent = t('官方字幕已读取，播放时间轴暂未校准。');
			mountStudyCaptionLanguage(article, official.languages, official.language, async language => {
				const found = await readTedMedia(address, async url => { const r = await browser.runtime.sendMessage({ action: 'fetchProxy', url, options: {} }) as { text?: string }; return r?.text || ''; }, undefined, language);
				if (!found?.segments.length) throw new Error(t('字幕不可用'));
				await attach(found.segments, true);
			});
		} else await begin(); return;
	}
	if (options.kind === 'feed') {
		if (!options.feed || !options.guid) { status.textContent = t('无效的节目链接'); return; }
		try {
			const feed = await fetchFeed(options.feed, { fresh: true }), found = feed.episodes.find(item => item.guid === options.guid);
			if (!found) { status.textContent = t('订阅源里没有找到这一集（可能已经太旧）。可以在小宇宙或播客 App 里打开它的链接。'); return; }
			key = await rssKey(options.feed, options.guid); registerFeedEpisode(key, options.feed, options.guid);
			void recordStudy({ path: `reader.html?study=feed&feed=${encodeURIComponent(options.feed)}&guid=${encodeURIComponent(options.guid)}`, title: found.title, kind: 'podcast', url: options.feed + '#' + options.guid });
			await present({ title: found.title, show: feed.show, cover: feed.cover, date: found.date, seconds: found.seconds, audio: found.audio, notesHtml: found.notesHtml });
		} catch (error) { status.textContent = error instanceof Error ? error.message : t('读取节目失败'); return; }
		await begin(); return;
	}

	// A file: pick it (or drop it here), send it to the helper, then it is handled like any other source.
	const chooser = document.createElement('div'); chooser.className = 'qiaomu-audio-chooser';
	const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.webm,.mp4,.mkv,.mov,.m4v,.aiff,.amr'; input.hidden = true;
	const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'qiaomu-yt-gen-button is-primary'; pick.textContent = text('audioChooseFile', '选择音频或视频文件…', 'Choose an audio or video file…');
	const hint = document.createElement('p'); hint.className = 'qiaomu-yt-gen-text'; hint.textContent = text('audioChooseHint', '也可以把文件拖到这里。文件只交给本机助手处理，不会上传；mp3、m4a、wav、flac、mp4 等常见格式都可以。', 'You can also drop a file here. It is only handed to the local helper, never uploaded; mp3, m4a, wav, flac, mp4 and similar formats work.');
	chooser.append(pick, hint, input); holder.append(chooser);
	const take = async (file: File | undefined) => {
		if (!file) return;
		if (!AUDIO_FILE.test(file.name)) { hint.textContent = text('audioBadType', '这个文件类型不支持。', 'This file type is not supported.'); return; }
		chooser.hidden = true; title = file.name.replace(/\.[^.]+$/, '') || initialTitle; document.title = title; setPageTitle(title);
		const heading = document.querySelector('main h1'); if (heading) heading.textContent = title;
		showPlayer(URL.createObjectURL(file), isVideoFile(file) ? {} : undefined);
		status.textContent = text('audioSending', '正在把文件交给本机助手…', 'Handing the file to the local helper…');
		const sent = await asrUpload(file, fraction => { status.textContent = t('{0} {1}%', [text('audioSending', '正在把文件交给本机助手…', 'Handing the file to the local helper…'), Math.round(fraction * 100)]); });
		if (!sent.ok) {
			status.textContent = sent.error === 'helper-offline' || sent.error === 'helper-outdated' ? text('subtitleGenOffline', '没有连上本地助手，需要先安装或更新本地助手。', 'The local helper is not connected or is out of date.') : sent.error === 'no-space' ? t('磁盘空间不足') : t('{0}：{1}', [text('audioSendFailed', '交给本机助手失败', 'Could not hand the file over'), sent.error]);
			if (sent.error === 'helper-offline' || sent.error === 'helper-outdated') setupFromStatus(sent.error);
			chooser.hidden = false; return;
		}
		key = sent.key; await begin();
	};
	if (options.file) void take(options.file);
	pick.addEventListener('click', () => input.click());
	input.addEventListener('change', () => { void take(input.files?.[0]); });
	for (const type of ['dragover', 'drop']) document.addEventListener(type, event => { event.preventDefault(); if (type === 'drop' && !chooser.hidden && !key) void take((event as DragEvent).dataTransfer?.files?.[0]); });
}
