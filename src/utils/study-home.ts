import browser from './browser-polyfill';
import { audioStudyPath, bilibiliVideo, videoStudyPath, xiaoyuzhouEpisode } from './video-source';
import { youtubeVideoId } from './youtube-url';
import { AUDIO_FILE } from './asr-client';
import { CATALOG, type PodcastShow } from './podcast-catalog';
import { fetchFeed, type Feed } from './podcast-feed';
import { defaultStudySites, isSiteOn, loadStudySites, siteOf, type StudySites } from './study-sites';

// The front door of study mode: paste a link (YouTube, Bilibili, Xiaoyuzhou) or choose a file, and it is opened for study; what
// was studied before is listed to open again. A link that is none of those opens in the ordinary reader.
export type StudyKind = 'youtube' | 'bilibili' | 'podcast' | 'web' | 'page';
// `maybeMedia`: an ordinary page that might still be a video or audio yt-dlp can read (offered as a second way to open it).
export interface StudyLink { kind: StudyKind; url: string; path: string; site?: string; maybeMedia?: boolean }
// `path` is where to reopen it when the address alone is not enough (an episode of a feed).
export interface StudyRecent { url: string; title: string; kind: Exclude<StudyKind, 'page'>; at: number; path?: string }
const RECENT_KEY = 'qiaomuStudyRecent', RECENT_LIMIT = 20;
export const KIND_LABEL: Record<StudyKind, string> = { youtube: 'YouTube 视频', bilibili: '哔哩哔哩视频', podcast: '小宇宙播客', web: '音视频', page: '网页（普通阅读）' };
export const webPath = (href: string) => `reader.html?study=web&url=${encodeURIComponent(href)}`;

// Where a pasted link should open, or undefined if it is not a link at all. Text without a scheme is taken as an address.
export function classifyLink(input: string, sites: StudySites = defaultStudySites()): StudyLink | undefined {
	const trimmed = input.trim(); if (!trimmed || /\s/.test(trimmed)) return undefined;
	let url: URL;
	try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : 'https://' + trimmed); } catch { return undefined; }
	if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return undefined;
	const href = url.href;
	const site = siteOf(href);
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
const ago = (at: number): string => { const minutes = Math.round((Date.now() - at) / 60000); return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`; };

const STYLE = `
.qiaomu-home{max-width:680px;margin:0 auto;padding:72px 24px 96px;color:var(--text-normal,#222);font-family:inherit}
.qiaomu-home.is-embedded{max-width:none;padding:0 0 56px}
.qiaomu-home.is-embedded p.lead{margin-bottom:22px}
.qiaomu-home.is-embedded h2:first-child{margin-top:8px}
.qiaomu-home h1{margin:0 0 8px;font-size:30px;line-height:1.25;font-weight:700}
.qiaomu-home p.lead{margin:0 0 28px;color:var(--text-muted,#666);font-size:15px;line-height:1.7}
.qiaomu-home-form{display:flex;gap:8px}
.qiaomu-home-form input{flex:1;min-width:0;height:46px;padding:0 16px;border:1px solid var(--background-modifier-border,rgba(127,127,127,.35));border-radius:12px;background:var(--background-primary,#fff);color:inherit;font:inherit;font-size:15px}
.qiaomu-home-form input:focus{outline:2px solid var(--interactive-accent,#2f6fed);outline-offset:-1px}
.qiaomu-home-go{flex:none;width:auto;height:46px;padding:0 22px;border:0;border-radius:12px;background:var(--text-normal,#222);color:var(--background-primary,#fff);font:inherit;font-weight:600;cursor:pointer;box-shadow:none}
.qiaomu-home-form{flex-wrap:wrap}
html .qiaomu-home button.qiaomu-home-secondary{flex:none;width:auto;height:46px;padding:0 16px;border:0;border-radius:12px;background:rgba(127,127,127,.16);color:var(--text-normal,#222);font:inherit;font-size:14px;font-weight:550;box-shadow:none;cursor:pointer}
html .qiaomu-home button.qiaomu-home-secondary:hover{background:rgba(127,127,127,.28);box-shadow:none}
.qiaomu-home-secondary[hidden]{display:none}
.qiaomu-home-go:disabled{opacity:.4;cursor:default}
.qiaomu-home-hint{min-height:22px;margin:8px 4px 0;color:var(--text-muted,#666);font-size:13px}
.qiaomu-home-hint.is-error{color:var(--text-error,#d33)}
.qiaomu-home-or{display:flex;align-items:center;gap:12px;margin:26px 0 18px;color:var(--text-muted,#888);font-size:13px}
.qiaomu-home-or::before,.qiaomu-home-or::after{content:"";flex:1;height:1px;background:var(--background-modifier-border,rgba(127,127,127,.3))}
.qiaomu-home-drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 20px;border:1.5px dashed var(--background-modifier-border,rgba(127,127,127,.4));border-radius:14px;color:var(--text-muted,#666);font-size:14px;text-align:center;cursor:pointer}
.qiaomu-home-drop:hover,.qiaomu-home-drop.is-over{border-color:var(--text-normal,#222);color:var(--text-normal,#222)}
.qiaomu-home-drop b{color:var(--text-normal,#222);font-size:15px}
.qiaomu-home-drop small{font-size:12px}
.qiaomu-home h2{margin:44px 0 10px;font-size:15px;font-weight:600}
.qiaomu-home-list{display:flex;flex-direction:column}
.qiaomu-home-item{display:flex;align-items:center;gap:12px;padding:12px 4px;border-top:1px solid var(--background-modifier-border,rgba(127,127,127,.2));cursor:pointer}
.qiaomu-home-item:hover .qiaomu-home-title{text-decoration:underline}
.qiaomu-home-item .qiaomu-home-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.qiaomu-home-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
.qiaomu-home-meta{color:var(--text-muted,#777);font-size:12px}
.qiaomu-home-shows .qiaomu-shows-group{margin:6px 0 14px}
.qiaomu-shows-label{margin:0 0 8px;color:var(--text-muted,#777);font-size:12.5px}
.qiaomu-shows-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.qiaomu-show{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--background-modifier-border,rgba(127,127,127,.3));border-radius:14px;cursor:pointer;user-select:none;transition:background .12s,border-color .12s}
.qiaomu-show:hover{background:var(--background-modifier-hover,rgba(127,127,127,.1))}
.qiaomu-show:focus-visible{outline:2px solid var(--text-normal,#222);outline-offset:2px}
.qiaomu-show-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:11px;background:hsl(var(--h,220) 70% 93%);color:hsl(var(--h,220) 55% 32%);font-weight:700;font-size:17px}
.qiaomu-show-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.qiaomu-show-text b{font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qiaomu-show-text span{color:var(--text-muted,#777);font-size:12.5px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qiaomu-shows-note{margin:18px 4px;color:var(--text-muted,#777);font-size:13.5px}
.qiaomu-modal-wrap{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.qiaomu-modal-scrim{position:absolute;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(2px)}
.qiaomu-modal{position:relative;display:flex;flex-direction:column;width:min(600px,100%);max-height:min(720px,calc(100vh - 40px));border-radius:18px;background:var(--background-primary,#fff);color:var(--text-normal,#222);box-shadow:0 24px 64px rgba(0,0,0,.3),0 0 0 1px var(--background-modifier-border,rgba(127,127,127,.2));overflow:hidden}
.qiaomu-modal-head{display:flex;align-items:center;gap:14px;padding:18px 18px 14px 22px;border-bottom:1px solid var(--background-modifier-border,rgba(127,127,127,.2))}
.qiaomu-modal-head img{flex:none;width:48px;height:48px;border-radius:11px;object-fit:cover}
.qiaomu-modal-head .qiaomu-show-mark{width:48px;height:48px}
.qiaomu-modal-title{flex:1;min-width:0;display:flex;flex-direction:column}
.qiaomu-modal-title b{font-size:16px;font-weight:650;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qiaomu-modal-title span{color:var(--text-muted,#777);font-size:13px}
.qiaomu-modal-body{flex:1;min-height:80px;overflow:auto;padding:4px 22px 14px}
.qiaomu-modal-body .qiaomu-home-item:first-child{border-top:0}
.qiaomu-home .qiaomu-wrap{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
html .qiaomu-home button.qiaomu-home-study{flex:none;width:auto;height:32px;padding:0 16px;border:0;border-radius:8px;background:var(--text-normal,#222);color:var(--background-primary,#fff);font:inherit;font-size:13px;font-weight:600;box-shadow:none;cursor:pointer}
html .qiaomu-home button.qiaomu-home-study:hover{opacity:.86;background:var(--text-normal,#222);box-shadow:none}
.qiaomu-home-x{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--text-muted,#888);font-size:16px;line-height:1;cursor:pointer;box-shadow:none}
.qiaomu-home-x:hover{background:var(--background-modifier-hover,rgba(127,127,127,.18))}
`;

const minutesOf = (seconds?: number) => seconds ? (seconds >= 3600 ? `${Math.floor(seconds / 3600)} 小时 ${Math.round((seconds % 3600) / 60)} 分钟` : `${Math.max(1, Math.round(seconds / 60))} 分钟`) : '';
const dayOf = (iso?: string) => iso ? iso.slice(0, 10) : '';
export const episodePath = (feed: string, guid: string) => `reader.html?study=feed&feed=${encodeURIComponent(feed)}&guid=${encodeURIComponent(guid)}`;

// Shows worth following. A press on one opens a dialog with its newest episodes; one press on an episode starts study mode for it.
function paintShows(doc: Document, root: HTMLElement, actions: { open: (path: string) => void }): void {
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const item = doc.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; };
	root.append(make('h2', '', '推荐播客'));
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
		const closeButton = make('button', 'qiaomu-home-x', '×'); closeButton.type = 'button'; closeButton.title = '关闭'; closeButton.setAttribute('aria-label', '关闭'); closeButton.addEventListener('click', close);
		head.append(mark(show), text, closeButton);
		const body = make('div', 'qiaomu-modal-body'); body.setAttribute('aria-live', 'polite'); body.append(make('p', 'qiaomu-shows-note', '正在读取最新节目…'));
		card.append(head, body); wrap.append(scrim, card); doc.body.append(wrap); dialog = wrap; doc.addEventListener('keydown', onKey, true); closeButton.focus();
		const fill = (feed: Feed) => {
			if (feed.cover) { const cover = make('img'); cover.src = feed.cover; cover.alt = ''; cover.referrerPolicy = 'no-referrer'; head.replaceChild(cover, head.firstChild!); }
			text.firstChild!.textContent = feed.show || show.name;
			const list = make('div', 'qiaomu-home-list');
			for (const episode of feed.episodes.slice(0, 8)) {
				const row = make('div', 'qiaomu-home-item'); row.tabIndex = 0; row.setAttribute('role', 'link'); row.dataset.guid = episode.guid;
				const info = make('div', 'qiaomu-home-text'), meta = [dayOf(episode.date), minutesOf(episode.seconds)].filter(Boolean).join(' · ');
				info.append(make('span', 'qiaomu-home-title qiaomu-wrap', episode.title), make('span', 'qiaomu-home-meta', meta));
				const go = make('button', 'qiaomu-home-study', '学习'); go.type = 'button'; go.setAttribute('aria-label', `学习：${episode.title}`);
				const start = () => actions.open(episodePath(show.feed, episode.guid)); row.addEventListener('click', start); row.addEventListener('keydown', event => { if (event.key === 'Enter') start(); });
				row.append(info, go); list.append(row);
			}
			body.replaceChildren(list);
		};
		fetchFeed(show.feed).then(feed => { if (mine === serial) fill(feed); }, error => {
			if (mine !== serial) return;
			const retry = make('button', 'qiaomu-home-study', '重试'); retry.type = 'button'; retry.addEventListener('click', () => open(show, from));
			body.replaceChildren(make('p', 'qiaomu-shows-note', `读取失败：${error instanceof Error ? error.message : '网络不通'}`), retry);
		});
	};
	for (const [lang, label] of [['zh', '中文'], ['en', '海外 · AI']] as const) {
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
export async function showStudyHome(doc: Document, actions: { open: (path: string) => void; openFile: (file: File) => void }, root?: HTMLElement): Promise<() => Promise<void>> {
	const embedded = Boolean(root); const host = root ?? doc.body; host.replaceChildren();
	if (!doc.getElementById('qiaomu-home-style')) { const style = doc.createElement('style'); style.id = 'qiaomu-home-style'; style.textContent = STYLE; doc.head.append(style); }
	if (!embedded) doc.title = '转写学习';
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const item = doc.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; };
	const page = make('main', 'qiaomu-home' + (embedded ? ' is-embedded' : ''));
	let sites = await loadStudySites();
	const form = make('form', 'qiaomu-home-form'), input = make('input'), go = make('button', 'qiaomu-home-go', '开始'); go.type = 'submit'; go.disabled = true;
	input.type = 'text'; input.placeholder = '粘贴 YouTube、B 站、小宇宙或其他音视频网站的链接…'; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', '视频或播客链接');
	const hint = make('div', 'qiaomu-home-hint'); hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite');
	// An ordinary page might still hold a video: a second button opens it the other way, when that is allowed.
	const asMedia = make('button', 'qiaomu-home-secondary', '按音视频学习'); asMedia.type = 'button'; asMedia.hidden = true;
	form.append(input, go, asMedia);
	const react = () => {
		const link = classifyLink(input.value, sites); go.disabled = !link; hint.classList.remove('is-error'); asMedia.hidden = !(link?.kind === 'page' && link.maybeMedia);
		hint.textContent = !input.value.trim() ? '' : link ? `识别为：${link.site ?? KIND_LABEL[link.kind]}${link.kind === 'page' ? (link.maybeMedia ? '。如果是视频或音频，可以点「按音视频学习」' : '') : '。没有字幕会自动转写'}` : '这不像一个链接';
	};
	asMedia.addEventListener('click', () => { const link = classifyLink(input.value, sites); if (link?.kind === 'page') actions.open(webPath(link.url)); });
	input.addEventListener('input', react);
	form.addEventListener('submit', event => { event.preventDefault(); const link = classifyLink(input.value, sites); if (!link) { hint.textContent = '这不像一个链接'; hint.classList.add('is-error'); return; } actions.open(link.path); });
	const file = make('input'); file.type = 'file'; file.hidden = true; file.accept = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.webm,.mp4,.mkv,.mov,.m4v,.aiff,.amr';
	const drop = make('div', 'qiaomu-home-drop'); drop.tabIndex = 0; drop.setAttribute('role', 'button'); const dropTitle = make('b', '', '选择本地音频或视频文件'); drop.append(dropTitle, make('span', '', '或把文件拖到这里'), make('small', '', 'mp3、m4a、wav、flac、mp4 等。文件只交给本机助手处理，不会上传'), file);
	const take = (picked: File | undefined) => { if (!picked) return; if (!AUDIO_FILE.test(picked.name)) { hint.textContent = '这个文件类型不支持'; hint.classList.add('is-error'); return; } actions.openFile(picked); };
	drop.addEventListener('click', () => file.click()); drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); file.click(); } });
	file.addEventListener('change', () => take(file.files?.[0]));
	// Dropping works on the drop area only: a file dropped anywhere else on a settings page should not be taken.
	for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('is-over'); });
	drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
	drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('is-over'); take((event as DragEvent).dataTransfer?.files?.[0]); });
	const recent = make('section'); 
	const paintRecent = (items: StudyRecent[]) => {
		recent.replaceChildren(); if (!items.length) return;
		const list = make('div', 'qiaomu-home-list'); recent.append(make('h2', '', '最近学习'), list);
		for (const entry of items) {
			const row = make('div', 'qiaomu-home-item'); row.tabIndex = 0; row.setAttribute('role', 'link'); row.dataset.url = entry.url;
			const text = make('div', 'qiaomu-home-text'); text.append(make('span', 'qiaomu-home-title', entry.title), make('span', 'qiaomu-home-meta', `${KIND_LABEL[entry.kind]} · ${ago(entry.at)}`));
			const remove = make('button', 'qiaomu-home-x', '×'); remove.type = 'button'; remove.title = '从列表移除'; remove.setAttribute('aria-label', '从列表移除');
			remove.addEventListener('click', event => { event.stopPropagation(); void forget(entry.url).then(paintRecent); });
			const open = () => { if (entry.path) { actions.open(entry.path); return; } const link = classifyLink(entry.url, sites); if (link) actions.open(link.path); };
			row.addEventListener('click', open); row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
			row.append(text, remove); list.append(row);
		}
	};
	const shows = make('section', 'qiaomu-home-shows');
	paintShows(doc, shows, actions);
	page.append(...(embedded ? [] : [make('h1', '', '转写学习')]), make('p', 'lead', '粘贴视频或播客的链接，或选一个本地文件。没有字幕就自动转写成带时间的字幕，再进入沉浸学习：字幕跟着播放滚动，可以划线、提问、记笔记。'), form, hint, make('div', 'qiaomu-home-or', '或'), drop, recent, shows);
	host.append(page); if (!embedded) input.focus();
	paintRecent(await loadRecents());
	return async () => { sites = await loadStudySites(); react(); paintRecent(await loadRecents()); };
}
