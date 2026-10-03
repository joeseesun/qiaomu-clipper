import Defuddle from 'defuddle';
import DOMPurify from 'dompurify';
import browser from './browser-polyfill';
import { Reader } from './reader';
import { transcriptText, mountYouTubeStudy } from './youtube-study';
import { youtubeVideoId } from './youtube-url';
import { setPageTitle, setPageUrl } from './highlighter';

export async function withTranscriptDeadline<T>(extract: (signal: AbortSignal) => Promise<T>, timeoutMs = 20000): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => { controller.abort(); reject(new Error('字幕加载超时，播放器可继续使用，请重试')); }, timeoutMs);
	});
	try { return await Promise.race([extract(controller.signal), timeout]); }
	finally { clearTimeout(timer!); controller.abort(); }
}

// Render the learning page before doing any page fetch or subtitle extraction.
export async function startYouTubeStudy(url: string, sourceTabId: number, initialTitle: string, onReady: (result: any) => Promise<void>, mountShell?: () => {chat: {toggle: () => boolean}; ready: () => void}): Promise<void> {
	if (!youtubeVideoId(url)) throw new Error('无效的 YouTube 视频链接');
	const title = initialTitle.replace(/\s*- YouTube$/, '') || 'YouTube 视频学习';
	Object.defineProperty(document, 'URL', { value: url, configurable: true });
	Reader.isReaderPage = true;
	Reader.preExtractedContent = { content: '<p></p>', title, domain: 'youtube.com' };
	setPageUrl(url); setPageTitle(title);
	document.title = title;
	await Reader.apply(document);
	const article = document.querySelector('article')!;
	const shell = mountShell?.();
	await mountYouTubeStudy(document, article, title, url, shell?.chat);
	const status = article.querySelector<HTMLElement>('.youtube-study-status')!;
	const clip = document.getElementById('qiaomu-reader-clip') as HTMLButtonElement | null;
	if (clip) clip.disabled = true;
	const retry = document.createElement('button');
	retry.type = 'button'; retry.textContent = '重试'; retry.hidden = true;
	retry.setAttribute('aria-label', '重新加载字幕');
	status.after(retry);
	let loading = false;
	let loaded = false;

	async function load() {
		if (loading || loaded) return;
		loading = true; retry.hidden = true; status.textContent = '正在加载字幕… 视频可以先播放';
		try {
			const result = await withTranscriptDeadline(async signal => {
				const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
					if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
					const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
					const headers: Record<string, string> = {};
					new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
					const response = await browser.runtime.sendMessage({ action: 'fetchProxy', url: target, options: { method: init?.method, body: init?.body, headers } }) as { status: number; text: string; error?: string };
					if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
					if (response.error) throw new Error(response.error);
					return new Response(response.text, { status: response.status });
				};
				const source = await browser.runtime.sendMessage({ action: 'qiaomuYouTubeStudySource', sourceTabId, url }) as { html?: string; error?: string };
				const html = source.html || await (await proxyFetch(url)).text();
				if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
				const doc = new DOMParser().parseFromString(html, 'text/html');
				Object.defineProperty(doc, 'URL', { value: url, configurable: true });
				return await new Defuddle(doc, { url, fetch: proxyFetch }).parseAsync();
			});
			if (!article.isConnected) return;
			const content = document.createElement('div');
			content.innerHTML = DOMPurify.sanitize(result.content);
			const transcript = content.querySelector<HTMLElement>('.youtube.transcript');
			const nextTitle = result.title || title;
			document.title = nextTitle; setPageTitle(nextTitle);
			const heading = document.querySelector('main h1'); if (heading) heading.textContent = nextTitle;
			await onReady(result);
			if (!transcript || !transcriptText(content)) {
				shell?.ready();
				if (clip) clip.disabled = false;
				throw new Error('暂未获取到字幕，视频可能没有字幕或尚未加载完成，请重试');
			}
			await Reader.attachYouTubeTranscript(document, transcript, nextTitle, shell?.chat);
			loaded = true;
			shell?.ready();
			if (clip) clip.disabled = false;
		} catch (error) {
			if (article.isConnected) { status.textContent = error instanceof Error ? error.message : '字幕加载失败，请重试'; retry.hidden = false; }
		} finally { loading = false; }
	}
	retry.addEventListener('click', () => { void load(); });
	// Do not await subtitles: the caller and player remain usable immediately.
	void load();
}
