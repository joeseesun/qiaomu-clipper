import { sharedStudyAddress, isProtectedStudy } from './protected-study';
import browser from './browser-polyfill';
import { audioStudyPath, bilibiliVideo, videoStudyPath, xiaoyuzhouEpisode } from './video-source';
import { youtubeVideoId } from './youtube-url';
import { AUDIO_FILE } from './asr-client';
import { CATALOG, type PodcastShow } from './podcast-catalog';
import { fetchFeed, type Feed } from './podcast-feed';
import { defaultStudySites, isSiteOn, loadStudySites, siteOf, type StudySites } from './study-sites';

import { t } from './ui-text';
// The front door of study mode: paste a link (YouTube, Bilibili, Xiaoyuzhou) or choose a file, and it is opened for study; what
// was studied before is listed to open again. A link that is none of those opens in the ordinary reader.
export type StudyKind = 'youtube' | 'bilibili' | 'podcast' | 'web' | 'page';
// `maybeMedia`: an ordinary page that might still be a video or audio yt-dlp can read (offered as a second way to open it).
export interface StudyLink { kind: StudyKind; url: string; path: string; site?: string; maybeMedia?: boolean }
// `path` is where to reopen it when the address alone is not enough (an episode of a feed).
export interface StudyRecent { url: string; title: string; kind: Exclude<StudyKind, 'page'>; at: number; path?: string }
const RECENT_KEY = 'qiaomuStudyRecent', RECENT_LIMIT = 20;
export const KIND_LABEL: Record<StudyKind, string> = { get youtube() { return t('YouTube 视频'); }, get bilibili() { return t('哔哩哔哩视频'); }, get podcast() { return t('小宇宙播客'); }, get web() { return t('音视频'); }, get page() { return t('网页（普通阅读）'); } };
export const webPath = (href: string) => `reader.html?study=web&url=${encodeURIComponent(href)}`;

// Where a pasted link should open, or undefined if it is not a link at all. Text without a scheme is taken as an address.
export function classifyLink(input: string, sites: StudySites = defaultStudySites()): StudyLink | undefined {
	const trimmed = sharedStudyAddress(input); if (!trimmed) return undefined;
	let url: URL;
	try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : 'https://' + trimmed); } catch { return undefined; }
	if (url.username || url.password || !/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return undefined;
	const site = siteOf(url.href);
	// Older official shares are HTTP links: use HTTPS before reading a shop.
	if (site?.id === 'xiaoe' && url.protocol === 'http:') url.protocol = 'https:';
	const href = url.href;
	if (youtubeVideoId(href) && isSiteOn(sites, 'youtube')) return { kind: 'youtube', url: href, path: `reader.html?study=youtube&url=${encodeURIComponent(href)}&sourceTab=0&title=` };
	if (bilibiliVideo(href) && isSiteOn(sites, 'bilibili')) { const path = videoStudyPath(href, 0, ''); if (path) return { kind: 'bilibili', url: href, path }; }
	if (xiaoyuzhouEpisode(href) && isSiteOn(sites, 'xiaoyuzhou')) { const path = audioStudyPath(href, ''); if (path) return { kind: 'podcast', url: href, path }; }
	// A site yt-dlp reads (and that is switched on): studied from its address. Its own sites' pages that are not a video stay ordinary pages.
	if (site && !site.builtin && isSiteOn(sites, site.id)) return { kind: 'web', url: href, path: webPath(href), site: site.name };
	return { kind: 'page', url: href, path: `reader.html?url=${encodeURIComponent(href)}`, maybeMedia: sites.other && !(site && !isSiteOn(sites, site.id)) };
}

export async function loadRecents(): Promise<StudyRecent[]> {
	try {
		const value = (await browser.storage.local.get(RECENT_KEY))[RECENT_KEY];
		return Array.isArray(value) ? value.filter((item): item is StudyRecent => Boolean(item) && typeof item.url === 'string' && typeof item.title === 'string' && ['youtube', 'bilibili', 'podcast', 'web'].includes(item.kind) && Number.isFinite(item.at)).slice(0, RECENT_LIMIT) : [];
	} catch { return []; }
}
export async function recordStudy(entry: { url: string; title: string; path?: string; kind?: StudyRecent['kind'] }): Promise<void> {
	const link = entry.path && entry.kind ? { kind: entry.kind, url: entry.url } : classifyLink(entry.url); if (!link || link.kind === 'page') return;
	try {
		const others = (await loadRecents()).filter(item => item.url !== link.url);
		await browser.storage.local.set({ [RECENT_KEY]: [{ url: link.url, title: entry.title.trim().slice(0, 200) || link.url, kind: link.kind, at: Date.now(), ...(entry.path && /^reader\.html\?study=(?:feed|web)&/.test(entry.path) ? { path: entry.path } : {}) }, ...others].slice(0, RECENT_LIMIT) });
	} catch { /* storage unavailable */ }
}
async function forget(url: string): Promise<StudyRecent[]> {
	const rest = (await loadRecents()).filter(item => item.url !== url);
	try { await browser.storage.local.set({ [RECENT_KEY]: rest }); } catch { /* storage unavailable */ }
	return rest;
}
const ago = (at: number): string => { const minutes = Math.round((Date.now() - at) / 60000); return minutes < 1 ? t('刚刚') : minutes < 60 ? t('{0} 分钟前', [minutes]) : minutes < 1440 ? t('{0} 小时前', [Math.round(minutes / 60)]) : t('{0} 天前', [Math.round(minutes / 1440)]); };

const STYLE = `
.qiaomu-home{max-width:760px;margin:0 auto;padding:72px 24px 96px;color:var(--text-normal,#222);font-family:inherit}
.qiaomu-home.is-embedded{max-width:none;padding:0 0 64px}
.qiaomu-home h1{margin:0 0 8px;font-size:30px;line-height:1.25;font-weight:700}
.qiaomu-home svg{mix-blend-mode:normal!important;filter:none!important}
/* The one thing to do: a card with the address field, and the file as its second way in. The whole card takes a dropped file. */
.qiaomu-home-hero{position:relative;padding:26px 28px 22px;border:1px solid var(--background-modifier-border,rgba(127,127,127,.3));border-radius:20px;background:var(--background-secondary,rgba(127,127,127,.06))}
.qh-title{margin:0 0 6px;font-size:20px;line-height:28px;font-weight:650;letter-spacing:-.01em}
.qiaomu-home p.lead{margin:0 0 20px;color:var(--text-muted,#666);font-size:14px;line-height:22px}
.qiaomu-home-form{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 16px;border:1px solid var(--background-modifier-border,rgba(127,127,127,.35));border-radius:14px;background:var(--background-primary,#fff);transition:border-color .12s,box-shadow .12s}
.qiaomu-home-form:focus-within{border-color:var(--text-normal,#222);box-shadow:0 0 0 3px rgba(127,127,127,.18)}
.qiaomu-home-form>svg{flex:none;width:18px;height:18px;color:var(--text-muted,#888)}
.qiaomu-home-form input{flex:1;min-width:0;height:40px;padding:0 6px;border:0;border-radius:0;background:transparent;box-shadow:none;color:inherit;font:inherit;font-size:15px;outline:none}
.qiaomu-home-form input:focus{outline:none;box-shadow:none}
html .qiaomu-home button.qiaomu-home-go:not(.qh-x){flex:none;display:inline-flex;align-items:center;justify-content:center;width:auto;height:40px;padding:0 22px;border:0;border-radius:10px;background:var(--text-normal,#222);color:var(--background-primary,#fff);font:inherit;font-size:14px;font-weight:600;box-shadow:none;cursor:pointer;transition:opacity .12s}
html .qiaomu-home button.qiaomu-home-go:not(.qh-x):hover{background:var(--text-normal,#222);color:var(--background-primary,#fff);box-shadow:none;opacity:.86}
html .qiaomu-home button.qiaomu-home-go:not(.qh-x):disabled{opacity:.35;cursor:default}
.qh-sites{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0}
.qh-sites span{padding:2px 10px;border-radius:999px;background:var(--background-primary,#fff);box-shadow:inset 0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.3));color:var(--text-muted,#666);font-size:12px;line-height:20px}
.qiaomu-home-hint{display:flex;align-items:center;gap:10px;min-height:24px;margin:10px 2px 0;color:var(--text-muted,#666);font-size:13px}
.qiaomu-home-hint.is-error{color:var(--text-error,#d33)}
html .qiaomu-home button.qiaomu-home-secondary:not(.qh-x){flex:none;display:inline-flex;align-items:center;width:auto;height:28px;padding:0 12px;border:0;border-radius:8px;background:rgba(127,127,127,.18);color:var(--text-normal,#222);font:inherit;font-size:13px;font-weight:550;box-shadow:none;cursor:pointer}
html .qiaomu-home button.qiaomu-home-secondary:not(.qh-x):hover{background:rgba(127,127,127,.3);box-shadow:none}
.qiaomu-home-secondary[hidden]{display:none}
.qh-file{display:flex;align-items:center;gap:12px;margin-top:18px;padding-top:18px;border-top:1px solid var(--background-modifier-border,rgba(127,127,127,.25));color:var(--text-muted,#666);font-size:13px}
html .qiaomu-home button.qiaomu-home-pick:not(.qh-x){flex:none;display:inline-flex;align-items:center;gap:8px;width:auto;height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--background-primary,#fff);box-shadow:inset 0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.35));color:var(--text-normal,#222);font:inherit;font-size:14px;font-weight:550;cursor:pointer}
html .qiaomu-home button.qiaomu-home-pick:not(.qh-x):hover{background:var(--background-primary,#fff);box-shadow:inset 0 0 0 1px var(--text-normal,#222)}
.qiaomu-home-pick svg{width:16px;height:16px}
.qh-drop{position:absolute;inset:0;display:none;align-items:center;justify-content:center;border:2px dashed var(--text-normal,#222);border-radius:20px;background:var(--background-primary,#fff);font-size:16px;font-weight:600;pointer-events:none}
.qiaomu-home-hero.is-over .qh-drop{display:flex}
/* Sections */
.qh-section{margin-top:44px}
.qh-heading{display:flex;align-items:baseline;gap:10px;margin:0 0 14px}
.qh-heading h2{margin:0;font-size:16px;line-height:24px;font-weight:650}
.qh-heading span{color:var(--text-muted,#777);font-size:13px}
.qiaomu-home-list{display:flex;flex-direction:column;border:1px solid var(--background-modifier-border,rgba(127,127,127,.3));border-radius:16px;overflow:hidden}
.qiaomu-home-item{display:flex;align-items:center;gap:14px;padding:12px 16px;border-top:1px solid var(--background-modifier-border,rgba(127,127,127,.2));cursor:pointer;transition:background .12s}
.qiaomu-home-item:first-child{border-top:0}
.qiaomu-home-item:hover{background:var(--background-modifier-hover,rgba(127,127,127,.08))}
.qiaomu-home-item:focus-visible{outline:2px solid var(--text-normal,#222);outline-offset:-2px}
.qiaomu-home-item .qiaomu-home-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.qiaomu-home-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14.5px;line-height:22px;font-weight:550}
.qiaomu-home-meta{color:var(--text-muted,#777);font-size:12.5px;line-height:18px}
.qh-kind{flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:hsl(var(--h,220) 70% 93%);color:hsl(var(--h,220) 55% 32%);font-size:13px;font-weight:700}
html .qiaomu-home-item button.qiaomu-home-x:not(.qh-x),html .qiaomu-modal button.qiaomu-home-x:not(.qh-x){flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:0;padding:0;border:0;border-radius:50%;background:transparent;color:var(--text-muted,#888);font-size:16px;line-height:1;box-shadow:none;cursor:pointer;opacity:0;transition:opacity .12s,background .12s}
html .qiaomu-modal button.qiaomu-home-x:not(.qh-x){opacity:1}
.qiaomu-home-item:hover button.qiaomu-home-x,.qiaomu-home-item:focus-within button.qiaomu-home-x{opacity:1}
html .qiaomu-home-item button.qiaomu-home-x:not(.qh-x):hover,html .qiaomu-modal button.qiaomu-home-x:not(.qh-x):hover{background:var(--background-modifier-hover,rgba(127,127,127,.2));color:var(--text-normal,#222);box-shadow:none}
.qiaomu-shows-group{margin:0 0 18px}
.qiaomu-shows-label{margin:0 0 10px 2px;color:var(--text-muted,#777);font-size:12.5px}
.qiaomu-shows-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.qiaomu-show{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--background-modifier-border,rgba(127,127,127,.3));border-radius:14px;cursor:pointer;user-select:none;transition:background .12s,border-color .12s}
.qiaomu-show:hover{background:var(--background-modifier-hover,rgba(127,127,127,.08));border-color:var(--background-modifier-border-hover,rgba(127,127,127,.5))}
.qiaomu-show:focus-visible{outline:2px solid var(--text-normal,#222);outline-offset:2px}
.qiaomu-show-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;background:hsl(var(--h,220) 70% 93%);color:hsl(var(--h,220) 55% 32%);font-weight:700;font-size:17px}
.qiaomu-show-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.qiaomu-show-text b{font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qiaomu-show-text span{color:var(--text-muted,#777);font-size:12.5px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qiaomu-shows-note{margin:18px 4px;color:var(--text-muted,#777);font-size:13.5px}
/* The dialog with a show's newest episodes */
.qiaomu-modal-wrap{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.qiaomu-modal-scrim{position:absolute;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(2px)}
.qiaomu-modal{position:relative;display:flex;flex-direction:column;width:min(620px,100%);max-height:min(720px,calc(100vh - 40px));border-radius:20px;background:var(--background-primary,#fff);color:var(--text-normal,#222);box-shadow:0 24px 64px rgba(0,0,0,.3),0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.2));overflow:hidden}
.qiaomu-modal-head{display:flex;align-items:center;gap:14px;padding:18px 18px 16px 24px;border-bottom:1px solid var(--background-modifier-border,rgba(127,127,127,.2))}
.qiaomu-modal-head img{flex:none;width:52px;height:52px;border-radius:12px;object-fit:cover}
.qiaomu-modal-head .qiaomu-show-mark{width:52px;height:52px}
.qiaomu-modal-title{flex:1;min-width:0;display:flex;flex-direction:column}
.qiaomu-modal-title b{font-size:16px;font-weight:650;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qiaomu-modal-title span{color:var(--text-muted,#777);font-size:13px}
.qiaomu-modal-body{flex:1;min-height:80px;overflow:auto;padding:0 24px 12px}
.qiaomu-modal-body .qiaomu-home-item{padding:14px 0;border-radius:0}
.qiaomu-modal-body .qiaomu-home-item:hover{background:transparent}
.qiaomu-modal-body .qiaomu-home-item:hover .qiaomu-home-title{text-decoration:underline}
.qiaomu-modal .qiaomu-wrap,.qiaomu-home .qiaomu-wrap{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
html .qiaomu-modal button.qiaomu-home-study:not(.qh-x),html .qiaomu-home button.qiaomu-home-study:not(.qh-x){flex:none;display:inline-flex;align-items:center;justify-content:center;width:auto;height:32px;min-width:64px;padding:0 16px;border:0;border-radius:8px;background:var(--text-normal,#222);color:var(--background-primary,#fff);font:inherit;font-size:13px;font-weight:600;box-shadow:none;cursor:pointer}
html .qiaomu-modal button.qiaomu-home-study:not(.qh-x):hover,html .qiaomu-home button.qiaomu-home-study:not(.qh-x):hover{opacity:.86;background:var(--text-normal,#222);color:var(--background-primary,#fff);box-shadow:none}
@media (max-width:560px){.qiaomu-home-hero{padding:20px 16px 18px}.qh-file{flex-wrap:wrap}.qiaomu-home-form{padding-left:12px}}
`;

const minutesOf = (seconds?: number) => seconds ? (seconds >= 3600 ? t('{0} 小时 {1} 分钟', [Math.floor(seconds / 3600), Math.round((seconds % 3600) / 60)]) : t('{0} 分钟', [Math.max(1, Math.round(seconds / 60))])) : '';
const dayOf = (iso?: string) => iso ? iso.slice(0, 10) : '';
export const episodePath = (feed: string, guid: string) => `reader.html?study=feed&feed=${encodeURIComponent(feed)}&guid=${encodeURIComponent(guid)}`;

// Shows worth following. A press on one opens a dialog with its newest episodes; one press on an episode starts study mode for it.
function paintShows(doc: Document, root: HTMLElement, actions: { open: (path: string) => void }): void {
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const item = doc.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; };
	const heading = make('div', 'qh-heading'); heading.append(make('h2', '', t('推荐播客')), make('span', '', t('点一个节目，挑一集开始学'))); root.append(heading);
	let dialog: HTMLElement | undefined, opener: HTMLElement | undefined, serial = 0;
	const close = () => { serial++; dialog?.remove(); dialog = undefined; doc.removeEventListener('keydown', onKey, true); opener?.focus(); opener = undefined; };
	const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
	// A letter on a tint, the tint chosen by the name, so the shows are told apart at a glance without any image to load.
	const mark = (show: PodcastShow) => { const hue = (Array.from(show.name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) * 37) % 360; const item = make('span', 'qiaomu-show-mark', Array.from(show.name.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '·'); item.style.setProperty('--h', String(hue)); item.setAttribute('aria-hidden', 'true'); return item; };
	const open = (show: PodcastShow, from: HTMLElement) => {
		close(); opener = from; const mine = ++serial;
		const wrap = make('div', 'qiaomu-modal-wrap'); wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', show.name);
		const scrim = make('div', 'qiaomu-modal-scrim'), card = make('div', 'qiaomu-modal'); scrim.addEventListener('click', close);
		const head = make('div', 'qiaomu-modal-head'), text = make('div', 'qiaomu-modal-title'); text.append(make('b', '', show.name), make('span', '', show.by));
		const closeButton = make('button', 'qiaomu-home-x', '×'); closeButton.type = 'button'; closeButton.title = t('关闭'); closeButton.setAttribute('aria-label', t('关闭')); closeButton.addEventListener('click', close);
		head.append(mark(show), text, closeButton);
		const body = make('div', 'qiaomu-modal-body'); body.setAttribute('aria-live', 'polite'); body.append(make('p', 'qiaomu-shows-note', t('正在读取最新节目…')));
		card.append(head, body); wrap.append(scrim, card); doc.body.append(wrap); dialog = wrap; doc.addEventListener('keydown', onKey, true); closeButton.focus();
		const fill = (feed: Feed) => {
			if (feed.cover) { const cover = make('img'); cover.src = feed.cover; cover.alt = ''; cover.referrerPolicy = 'no-referrer'; head.replaceChild(cover, head.firstChild!); }
			text.firstChild!.textContent = feed.show || show.name;
			const list = make('div', 'qiaomu-home-list');
			for (const episode of feed.episodes.slice(0, 8)) {
				const row = make('div', 'qiaomu-home-item'); row.tabIndex = 0; row.setAttribute('role', 'link'); row.dataset.guid = episode.guid;
				const info = make('div', 'qiaomu-home-text'), meta = [dayOf(episode.date), minutesOf(episode.seconds)].filter(Boolean).join(' · ');
				info.append(make('span', 'qiaomu-home-title qiaomu-wrap', episode.title), make('span', 'qiaomu-home-meta', meta));
				const go = make('button', 'qiaomu-home-study', t('学习')); go.type = 'button'; go.setAttribute('aria-label', t('学习：{0}', [episode.title]));
				const start = () => actions.open(episodePath(show.feed, episode.guid)); row.addEventListener('click', start); row.addEventListener('keydown', event => { if (event.key === 'Enter') start(); });
				row.append(info, go); list.append(row);
			}
			body.replaceChildren(list);
		};
		fetchFeed(show.feed).then(feed => { if (mine === serial) fill(feed); }, error => {
			if (mine !== serial) return;
			const retry = make('button', 'qiaomu-home-study', t('重试')); retry.type = 'button'; retry.addEventListener('click', () => open(show, from));
			body.replaceChildren(make('p', 'qiaomu-shows-note', t('读取失败：{0}', [error instanceof Error ? error.message : t('网络不通')])), retry);
		});
	};
	for (const [lang, label] of [['zh', t('中文')], ['en', t('海外 · AI')]] as const) {
		const group = make('div', 'qiaomu-shows-group'); group.append(make('div', 'qiaomu-shows-label', label));
		const grid = make('div', 'qiaomu-shows-grid');
		for (const show of CATALOG.filter(item => item.lang === lang)) {
			const card = make('div', 'qiaomu-show'); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-haspopup', 'dialog'); card.dataset.id = show.id;
			const name = make('span', 'qiaomu-show-text'); name.append(make('b', '', show.name), make('span', '', show.by)); card.append(mark(show), name);
			card.addEventListener('click', () => open(show, card)); card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(show, card); } });
			grid.append(card);
		}
		group.append(grid); root.append(group);
	}
}

// Draws the page into `root` (the study page of the settings, which has the menu beside it), or into the whole document when none is given.
// Returns what to call to look again at what was studied and which sites are on.
const ICON_LINK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const ICON_FILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>';
const KIND_MARK: Record<StudyRecent['kind'], string> = { youtube: 'YT', bilibili: 'B', podcast: '播', web: '网' };
const KIND_HUE: Record<StudyRecent['kind'], number> = { youtube: 5, bilibili: 200, podcast: 275, web: 150 };
const SITE_CHIPS = ['YouTube', '哔哩哔哩', '小宇宙', 'X', 'Vimeo', 'SoundCloud', '更多网站…'];

// Draws the page into `root` (the study page of the settings, which has the menu beside it), or into the whole document when none is given.
// Returns what to call to look again at what was studied and which sites are on.
export async function showStudyHome(doc: Document, actions: { open: (path: string) => void; openFile: (file: File) => void }, root?: HTMLElement): Promise<() => Promise<void>> {
	const embedded = Boolean(root); const host = root ?? doc.body; host.replaceChildren();
	if (!doc.getElementById('qiaomu-home-style')) { const style = doc.createElement('style'); style.id = 'qiaomu-home-style'; style.textContent = STYLE; doc.head.append(style); }
	if (!embedded) doc.title = t('转写学习');
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const item = doc.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; };
	const page = make('main', 'qiaomu-home' + (embedded ? ' is-embedded' : ''));
	let sites = await loadStudySites();

	// ---- the card: paste a link, or choose a file ----
	const hero = make('section', 'qiaomu-home-hero');
	const form = make('form', 'qiaomu-home-form'), input = make('input'), go = make('button', 'qiaomu-home-go', t('开始')); go.type = 'submit'; go.disabled = true;
	form.insertAdjacentHTML('afterbegin', ICON_LINK);
	input.type = 'text'; input.placeholder = t('粘贴视频或播客的链接'); input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', t('视频或播客链接'));
	form.append(input, go);
	const hint = make('div', 'qiaomu-home-hint'); hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite');
	// An ordinary page might still hold a video: a second button opens it the other way, when that is allowed.
	const asMedia = make('button', 'qiaomu-home-secondary', t('按音视频学习')); asMedia.type = 'button'; asMedia.hidden = true;
	const hintText = make('span'); hint.append(hintText, asMedia);
	const chips = make('div', 'qh-sites'); for (const name of SITE_CHIPS) chips.append(make('span', '', t(name)));
	const react = () => {
		const link = classifyLink(input.value, sites); go.disabled = !link; hint.classList.remove('is-error'); asMedia.hidden = !(link?.kind === 'page' && link.maybeMedia);
		hintText.textContent = !input.value.trim() ? '' : link ? t('识别为：{0}{1}', [link.site ?? KIND_LABEL[link.kind], link.kind === 'page' ? (link.maybeMedia ? t('。如果是视频或音频，可以点「按音视频学习」') : '') : isProtectedStudy(link.url) ? t('。先打开原网页完成验证') : t('。没有字幕会自动转写')]) : t('这不像一个链接');
	};
	asMedia.addEventListener('click', () => { const link = classifyLink(input.value, sites); if (link?.kind === 'page') actions.open(webPath(link.url)); });
	input.addEventListener('input', react);
	form.addEventListener('submit', event => { event.preventDefault(); const link = classifyLink(input.value, sites); if (!link) { hintText.textContent = t('这不像一个链接'); hint.classList.add('is-error'); return; } actions.open(link.path); });
	const file = make('input'); file.type = 'file'; file.hidden = true; file.accept = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.webm,.mp4,.mkv,.mov,.m4v,.aiff,.amr';
	const pick = make('button', 'qiaomu-home-pick'); pick.type = 'button'; pick.insertAdjacentHTML('afterbegin', ICON_FILE); pick.append(make('span', '', t('选择本地文件')));
	const take = (picked: File | undefined) => { if (!picked) return; if (!AUDIO_FILE.test(picked.name)) { hintText.textContent = t('这个文件类型不支持'); hint.classList.add('is-error'); return; } actions.openFile(picked); };
	pick.addEventListener('click', () => file.click()); file.addEventListener('change', () => take(file.files?.[0]));
	const fileRow = make('div', 'qh-file'); fileRow.append(pick, make('span', '', t('或把音频、视频文件拖到这张卡片上；文件只交给本机助手处理，不会上传')), file);
	// The whole card takes a dropped file, and says so while one is over it. Nothing else on the page does.
	const overlay = make('div', 'qh-drop', t('松开以转写这个文件')); overlay.setAttribute('aria-hidden', 'true');
	for (const type of ['dragenter', 'dragover']) hero.addEventListener(type, event => { event.preventDefault(); hero.classList.add('is-over'); });
	hero.addEventListener('dragleave', event => { if (!hero.contains((event as DragEvent).relatedTarget as Node | null)) hero.classList.remove('is-over'); });
	hero.addEventListener('drop', event => { event.preventDefault(); hero.classList.remove('is-over'); take((event as DragEvent).dataTransfer?.files?.[0]); });
	hero.append(make('div', 'qh-title', t('粘贴链接，开始学习')), make('p', 'lead', t('没有字幕就自动转写成带时间的字幕，再进入沉浸学习：字幕跟着播放滚动，可以划线、提问、记笔记。')), form, chips, hint, fileRow, overlay);

	// ---- what was studied before ----
	const recent = make('section', 'qh-section');
	const paintRecent = (items: StudyRecent[]) => {
		recent.replaceChildren(); recent.hidden = !items.length; if (!items.length) return;
		const list = make('div', 'qiaomu-home-list'), heading = make('div', 'qh-heading'); heading.append(make('h2', '', t('最近学习')), make('span', '', t('{0} 个', [items.length]))); recent.append(heading, list);
		for (const entry of items) {
			const row = make('div', 'qiaomu-home-item'); row.tabIndex = 0; row.setAttribute('role', 'link'); row.dataset.url = entry.url;
			const mark = make('span', 'qh-kind', KIND_MARK[entry.kind]); mark.style.setProperty('--h', String(KIND_HUE[entry.kind])); mark.setAttribute('aria-hidden', 'true');
			const text = make('div', 'qiaomu-home-text'); text.append(make('span', 'qiaomu-home-title', entry.title), make('span', 'qiaomu-home-meta', `${KIND_LABEL[entry.kind]} · ${ago(entry.at)}`));
			const remove = make('button', 'qiaomu-home-x', '×'); remove.type = 'button'; remove.title = t('从列表移除'); remove.setAttribute('aria-label', t('从列表移除'));
			remove.addEventListener('click', event => { event.stopPropagation(); void forget(entry.url).then(paintRecent); });
			const open = () => { if (entry.path) { actions.open(entry.path); return; } const link = classifyLink(entry.url, sites); if (link) actions.open(link.path); };
			row.addEventListener('click', open); row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
			row.append(mark, text, remove); list.append(row);
		}
	};

	// ---- suggested podcasts ----
	const shows = make('section', 'qh-section qiaomu-home-shows');
	paintShows(doc, shows, actions);
	page.append(...(embedded ? [] : [make('h1', '', t('转写学习'))]), hero, recent, shows);
	host.append(page); if (!embedded) input.focus();
	paintRecent(await loadRecents());
	return async () => { sites = await loadStudySites(); react(); paintRecent(await loadRecents()); };
}
