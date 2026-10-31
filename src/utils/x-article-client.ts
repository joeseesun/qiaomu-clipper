import browser from './browser-polyfill';
import { validateXArticle, xArticleUrl, MAX_X_ARTICLE_CHARS, type XArticle } from './x-article';
import { t } from './ui-text';

export function xArticleError(error: unknown): string {
	const code = error instanceof Error ? error.message : String(error);
	if (/grok-missing/.test(code)) return t('X 阅读组件尚未安装，可按需下载后继续。');
	if (/grok-login-required/.test(code)) return t('Grok 需要登录。请在 X 完整阅读设置中继续。');
	if (/native messaging|native host|helper-upgrade-required|x-helper-missing|未知操作|unknown action|not found|does not exist/i.test(code)) return t('X 完整阅读尚未设置，可先查看条件并按需启用。');
	if (/x-source-unverified|x-body-missing|x-source-truncated|x-media-unsupported/.test(code)) return t('未取得可核对的完整 X 原文，已停止翻译。请检查原链接或稍后重试。');
	if (/timeout|interrupted|disconnected|x-job-missing/.test(code)) return t('X 原文读取已中断，请重新发送链接。');
	if (/x-rate-limited/.test(code)) return t('X 或 Grok 请求达到限制，请稍后重试。');
	if (/x-too-large/.test(code)) return t('文章超过本次读取上限，已停止，未截断正文。');
	if (/x-busy/.test(code)) return t('另一篇 X 文章正在读取，请完成或停止后重试。');
	return t('X 原文读取失败，请检查链接与网络后重试。');
}

async function call(action: string, fields: Record<string, unknown> = {}): Promise<any> {
	const reply: any = await browser.runtime.sendMessage({ action, ...fields });
	if (!reply?.ok) throw new Error(reply?.error || 'x-helper-missing');
	return reply;
}
function delay(signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
		const timer = setTimeout(done, 1000);
		const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort();
	});
}
export async function readXArticle(id: string, url: string, signal?: AbortSignal): Promise<XArticle> {
	signal?.throwIfAborted();
	let content = '', offset = 0, meta: any;
	for (;;) {
		const part = await call('xArticleRead', { id, offset });
		signal?.throwIfAborted();
		if (typeof part.content !== 'string' || part.next !== offset + part.content.length || part.next <= offset) throw new Error('x-source-unverified');
		content += part.content; offset = part.next; meta = part.article;
		if (content.length > MAX_X_ARTICLE_CHARS) throw new Error('x-too-large');
		if (part.done === true) break;
	}
	const result = validateXArticle({ ...meta, content }, url);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
	if ([...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') !== result.sha256) throw new Error('x-source-unverified');
	return result;
}
export async function fetchXArticle(id: string, address: string, signal?: AbortSignal): Promise<XArticle> {
	const url = xArticleUrl(address);
	if (!url) throw new Error('invalid-x-url');
	signal?.throwIfAborted();
	// Register cancellation before start; if it races the start response, cancel again below.
	const cancel = () => { void call('xArticleCancel', { id }).catch(() => {}); };
	signal?.addEventListener('abort', cancel, { once: true });
	try {
		const status = await call('xArticleStatus');
		if (status.xArticles !== 1) throw new Error('helper-upgrade-required');
		signal?.throwIfAborted();
		await call('xArticleStart', { id, url });
		if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
		const deadline = Date.now() + 390_000;
		while (Date.now() < deadline) {
			signal?.throwIfAborted();
			const job = await call('xArticlePoll', { id });
			signal?.throwIfAborted();
			if (job.state === 'ready') return await readXArticle(id, url, signal);
			if (['failed', 'cancelled', 'interrupted'].includes(job.state)) throw new Error(job.error || 'x-interrupted');
			await delay(signal);
		}
		cancel(); throw new Error('x-timeout');
	} finally { signal?.removeEventListener('abort', cancel); }
}
