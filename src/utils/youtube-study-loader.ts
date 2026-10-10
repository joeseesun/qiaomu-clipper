import { marked } from 'marked';
import type { ClipPreview } from './clip-preview';
import { prepareLocalPreviewTranscript } from './local-preview-media';
import { mountStudyCaptionLanguage } from './study-caption-language';
import Defuddle from 'defuddle';
import DOMPurify from 'dompurify';
import browser from './browser-polyfill';
import { Reader } from './reader';
import { transcriptText, mountYouTubeStudy } from './youtube-study';
import { bilibiliVideo, videoKey } from './video-source';
import { youtubeVideoId } from './youtube-url';
import { TRANSCRIPT_SELECTOR } from './video-source';
import { setPageTitle, setPageUrl } from './highlighter';
import { withReliableBilibili } from './bilibili-captions';
import { transcriptHtml } from './youtube-dom-transcript';
import { createTranscriptCache } from './youtube-transcript-cache';
import { toLines } from './subtitle-generation';
import { reloadPage } from './page-reload';
import { createBarGeneration } from './bar-generation';
import { buildGenerationPanel, GENERATION_STYLE, type GenUi } from './subtitle-generation-panel';
import { generationStrings } from './subtitle-generation-strings';

import { t } from './ui-text';
export async function withTranscriptDeadline<T>(extract: (signal: AbortSignal) => Promise<T>, timeoutMs = 35000): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => { controller.abort(); reject(new Error(t('字幕加载超时，播放器可继续使用，请重试'))); }, timeoutMs);
	});
	try { return await Promise.race([extract(controller.signal), timeout]); }
	finally { clearTimeout(timer!); controller.abort(); }
}

const hasTranscript = (result: { content?: string } | undefined): boolean => {
	if (!result?.content) return false;
	const holder = document.createElement('div'); holder.innerHTML = DOMPurify.sanitize(result.content);
	return Boolean(holder.querySelector(TRANSCRIPT_SELECTOR)?.querySelector('.transcript-segment'));
};

// Resolve with the first route that actually has subtitles; if none does, keep the best answer so the page
// can still show the title and description, or reject with the last error when every route failed.
export function firstWithTranscript<T extends { content?: string }>(jobs: Promise<T>[]): Promise<T> {
	return new Promise((resolve, reject) => {
		let pending = jobs.length, fallback: T | undefined, lastError: unknown;
		const settle = () => { if (--pending === 0) fallback ? resolve(fallback) : reject(lastError); };
		for (const job of jobs) job.then(result => { if (hasTranscript(result)) resolve(result); else { fallback ??= result; settle(); } }, error => { lastError = error; settle(); });
	});
}

// Render the learning page before doing any page fetch or subtitle extraction.
export async function startYouTubeStudy(url: string, sourceTabId: number, initialTitle: string, onReady: (result: any) => Promise<void>, mountShell?: () => {chat: {toggle: () => boolean}; ready: () => void}, restoredDraft?: ClipPreview): Promise<void> {
	if (!videoKey(url)) throw new Error(t('无效的视频链接'));
	const title = initialTitle.replace(/\s*- YouTube$/, '') || t('YouTube 视频学习');
	Object.defineProperty(document, 'URL', { value: url, configurable: true });
	Reader.isReaderPage = true;
	Reader.preExtractedContent = { content: '<p></p>', title, domain: bilibiliVideo(url) ? 'bilibili.com' : 'youtube.com' };
	setPageUrl(url); setPageTitle(title);
	document.title = title;
	await Reader.apply(document);
	const article = document.querySelector('article')!;
	const shell = mountShell?.();
	await mountYouTubeStudy(document, article, title, url, shell?.chat);
	const status = article.querySelector<HTMLElement>('.youtube-study-status')!;
    if (restoredDraft) {
        const content = document.createElement('div'); content.className = 'qiaomu-restored-study';
        content.innerHTML = DOMPurify.sanitize(await marked.parse(restoredDraft.clip.markdown)); article.append(content);
        const transcript = prepareLocalPreviewTranscript(content);
        if (transcript) await Reader.attachYouTubeTranscript(document, transcript, restoredDraft.clip.title, shell?.chat);
        status.textContent = ''; shell?.ready(); return;
    }
	const clip = document.getElementById('qiaomu-reader-clip') as HTMLButtonElement | null;
	if (clip) clip.disabled = true;
	const retry = document.createElement('button');
	retry.type = 'button'; retry.textContent = t('重试'); retry.hidden = true;
	retry.setAttribute('aria-label', t('重新加载字幕'));
	status.after(retry);
	let loading = false;
	let captionLanguages: Array<{id:string;label:string}> = [], captionSelected = '';
	let studyResult: any = { content: '', title };
	let loaded = false, remade = false; // `remade`: the generated transcript replaces one already on the page

	// Videos without subtitles: offer to generate them on this computer (the helper does the work; see subtitle-generation.ts).
	const key = videoKey(url)!;
	const store = (browser as { storage?: { local?: Parameters<typeof createTranscriptCache>[0] } }).storage?.local;
	const genCache = store ? createTranscriptCache(store) : undefined;
	const text = (id: string, zh: string, en: string) => { try { return browser.i18n.getMessage(id) || (/^zh/i.test(navigator.language) ? zh : en); } catch { return /^zh/i.test(navigator.language) ? zh : en; } };
	if (!document.getElementById('qiaomu-gen-style')) { const style = document.createElement('style'); style.id = 'qiaomu-gen-style'; style.textContent = GENERATION_STYLE; document.head.append(style); }
	let attachGenerated: (lines: ReturnType<typeof toLines>) => Promise<void> = async () => {};
	// The same flow as the transcript bar on the video page: one press starts it once an engine or service is chosen.
	const generation = createBarGeneration({
		videoKey: () => key, bar: () => ({ setGeneration: (ui: GenUi | null) => panel.show(ui ?? { kind: 'offer' }) }) as never,
		apply: (_key, lines, done) => { if (done) { remade = loaded; void attachGenerated(lines); } },
		revert: () => { panel.show({ kind: 'offer' }); },
		// Made again with another model: the page's transcript is wired once, so it is read again from the saved copy by loading the page again.
		save: (k, lines) => { void Promise.resolve(genCache?.write(`generated:${k}`, lines)).then(() => { if (remade) { status.textContent = t('新的文字稿已生成，正在刷新…'); reloadPage(); } }); },
		openSettings: () => { window.open(browser.runtime.getURL('settings.html?section=asr-models'), '_blank'); },
	});
	const panel = buildGenerationPanel(document, generationStrings(text), generation.actions);
	retry.after(panel.element);

	async function load() {
		if (loading || loaded) return;
		loading = true; retry.hidden = true; status.textContent = t('正在加载字幕… 视频可以先播放');
		if (!generation.active) panel.show(null);
		// The first attempt often only warms the page up (YouTube builds its transcript lazily), so one quiet
		// second attempt happens before the user is asked to press retry.
		const once = async () => {
			const result = await withTranscriptDeadline(async signal => {
				// Two routes, first one that returns subtitles wins. The page itself is the reliable one: it
				// has YouTube's cookies and origin, and Defuddle can read or open the transcript panel there.
				// The copy route (static HTML + background proxy) keeps working when the tab is gone.
				// Fastest: the video tab prefetched the transcript when the page went idle. Only the title, description and
				// the like are still read from the page copy, without any network, so nothing here waits on a timeout.
				const fromPrefetch = async (): Promise<any> => {
					const answer = await browser.runtime.sendMessage({ action: 'qiaomuStudyTranscript', sourceTabId, url }).catch(() => undefined) as { html?: string; error?: string; languages?: Array<{id:string;label:string}>; selected?: string } | undefined;
					if (signal.aborted || !answer?.html) throw new Error(answer?.error || t('原页面还没有字幕'));
					captionLanguages = answer.languages || []; captionSelected = answer.selected || '';
					const source = await browser.runtime.sendMessage({ action: 'qiaomuYouTubeStudySource', sourceTabId, url }) as { html?: string };
					let meta: any = { content: '', title };
					if (source?.html) {
						const doc = new DOMParser().parseFromString(source.html, 'text/html');
						Object.defineProperty(doc, 'URL', { value: url, configurable: true });
						meta = await new Defuddle(doc, { url, fetch: async () => { throw new Error('offline'); } }).parseAsync().catch(() => meta);
					}
					// Defuddle may already have read the same lines from an open panel, with chapters; keep those if so.
					return { ...meta, content: hasTranscript(meta) ? meta.content : (meta.content || '') + answer.html };
				};
				const fromTab = async (): Promise<any> => {
					const live = await browser.runtime.sendMessage({ action: 'qiaomuStudyLiveExtract', sourceTabId, url }).catch(() => undefined) as Record<string, any> | undefined;
					if (signal.aborted || !live || live.error || typeof live.content !== 'string') throw new Error(live?.error || t('原页面没有返回内容'));
					return { ...live, variables: live.extractedContent || {} };
				};
				const fromCopy = async (): Promise<any> => {
				const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
					if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
					const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
					// Subtitles need the viewer's Bilibili session: ask their own tab first, then the plain proxy.
					if (bilibiliVideo(url) && /^https:\/\/[^/]*(bilibili\.com|hdslb\.com)\//.test(target)) {
						const viaTab = await browser.runtime.sendMessage({ action: 'qiaomuBilibiliTabFetch', sourceTabId, sourceUrl: url, url: target }).catch(() => undefined) as { ok?: boolean; status?: number; text?: string; error?: string } | undefined;
						if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
						if (viaTab && !viaTab.error && typeof viaTab.text === 'string') return new Response(viaTab.text, { status: viaTab.status || 200 });
					}
					const headers: Record<string, string> = {};
					const credentials = init?.credentials === 'include' ? 'include' : undefined;
					new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
					const response = await browser.runtime.sendMessage({ action: 'fetchProxy', url: target, options: { method: init?.method, body: init?.body, headers, credentials } }) as { status: number; text: string; error?: string };
					if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
					if (response.error) throw new Error(response.error);
					return new Response(response.text, { status: response.status });
				};
				const source = await browser.runtime.sendMessage({ action: 'qiaomuYouTubeStudySource', sourceTabId, url }) as { html?: string; error?: string };
				const html = source.html || await (await proxyFetch(url)).text();
				if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
				const doc = new DOMParser().parseFromString(html, 'text/html');
				Object.defineProperty(doc, 'URL', { value: url, configurable: true });
				return await new Defuddle(doc, { url, fetch: withReliableBilibili(proxyFetch) }).parseAsync();
				};
				if (youtubeVideoId(url) || bilibiliVideo(url)) {
					const fast = await fromPrefetch().catch(() => undefined);
					if (fast && hasTranscript(fast)) return fast;
				}
				return await firstWithTranscript([fromTab(), fromCopy()]);
			});
			if (!article.isConnected) return;
			const content = document.createElement('div');
			content.innerHTML = DOMPurify.sanitize(result.content);
			const transcript = content.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
			const nextTitle = result.title || title;
			document.title = nextTitle; setPageTitle(nextTitle);
			const heading = document.querySelector('main h1'); if (heading) heading.textContent = nextTitle;
			studyResult = result;
			await onReady(result);
			if (!transcript || !transcriptText(content)) {
				// Nothing from the platform: a transcript generated on this computer earlier is used instead.
				const made = await genCache?.read(`generated:${key}`);
				if (made) { await attachGenerated(made); panel.show({ kind: 'generated' }); return; }
				shell?.ready();
				if (clip) clip.disabled = false;
				throw new Error(t('暂未获取到字幕，视频可能没有字幕或尚未加载完成，请重试'));
			}
			await Reader.attachYouTubeTranscript(document, transcript, nextTitle, shell?.chat);
			loaded = true; panel.show(null);
			let currentContent = result.content;
			mountStudyCaptionLanguage(article, captionLanguages, captionSelected, async language => {
				const answer = await browser.runtime.sendMessage({ action: 'qiaomuStudyTranscript', sourceTabId, url, language }) as { html?: string; selected?: string };
				if (!answer?.html || answer.selected !== language) throw new Error(t('字幕不可用'));
				const holder = document.createElement('div'); holder.innerHTML = DOMPurify.sanitize(answer.html);
				const next = holder.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR); if (!next?.querySelector('.transcript-segment')) throw new Error(t('字幕不可用'));
				const source = document.createElement('div'); source.innerHTML = DOMPurify.sanitize(currentContent);
				const previous = source.querySelector(TRANSCRIPT_SELECTOR); if (!previous) throw new Error(t('字幕不可用'));
				previous.replaceWith(next.cloneNode(true));
				await onReady({ ...result, content: source.innerHTML }); currentContent = source.innerHTML;
				article.dispatchEvent(new CustomEvent('qiaomu-transcript-replaced')); article.querySelector(TRANSCRIPT_SELECTOR)?.remove();
				await Reader.attachYouTubeTranscript(document, next, nextTitle, shell?.chat);
			});
			shell?.ready();
			if (clip) clip.disabled = false;
		};
		try {
			try { await once(); }
			catch (first) {
				if (!article.isConnected) return;
				status.textContent = t('正在重试字幕…'); await new Promise(done => setTimeout(done, 1500));
				if (!article.isConnected) return;
				try { await once(); } catch (second) { throw second ?? first; }
			}
		} catch (error) {
			if (article.isConnected) { status.textContent = error instanceof Error ? error.message : t('字幕加载失败，请重试'); retry.hidden = false; if (!generation.active && panel.kind() === null) panel.show({ kind: 'offer' }); }
		} finally { loading = false; }
	}
	// A generated transcript goes into the page the same way as one from the platform.
	attachGenerated = async lines => {
		const raw = transcriptHtml(lines);
		const holder = document.createElement('div'); holder.innerHTML = DOMPurify.sanitize(raw);
		const transcript = holder.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR); if (!transcript || loaded) return;
		await onReady({ ...studyResult, content: (studyResult.content || '') + raw });
		await Reader.attachYouTubeTranscript(document, transcript, document.title, shell?.chat);
		loaded = true; status.textContent = ''; retry.hidden = true; shell?.ready(); if (clip) clip.disabled = false;
	};
	retry.addEventListener('click', () => { void load(); });
	// Do not await subtitles: the caller and player remain usable immediately.
	void load();
}
