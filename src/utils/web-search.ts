import { getLocalStorage, setLocalStorage } from './storage-utils';
import { publicWebUrl, type SearchSource } from './chat-tools-types';
import { t } from './ui-text';
import { parseHTML } from 'linkedom';

export type SearchProvider = 'deepseek' | 'brave';
export interface WebSearchSettings { enabled: boolean; provider: SearchProvider; keys: Record<SearchProvider, string> }
export const WEB_SEARCH_KEY = 'qiaomuWebSearch';
export async function loadWebSearch(): Promise<WebSearchSettings> {
	const s = await getLocalStorage(WEB_SEARCH_KEY);
	return { enabled: s?.enabled !== false, provider: s?.provider === 'brave' ? 'brave' : 'deepseek',
		keys: { deepseek: typeof s?.keys?.deepseek === 'string' ? s.keys.deepseek : '', brave: typeof s?.keys?.brave === 'string' ? s.keys.brave : '' } };
}
export const saveWebSearch = (s: WebSearchSettings) => setLocalStorage(WEB_SEARCH_KEY, s);
export const selectedSearchProvider = (s: WebSearchSettings): SearchProvider | undefined => s.keys[s.provider] ? s.provider : s.keys.deepseek ? 'deepseek' : s.keys.brave ? 'brave' : undefined;
export function searchFailure(error: unknown): string {
	const code = error instanceof Error ? error.message : String(error);
	if (code === 'search-unconfigured') return t('先连接搜索服务，即可继续查找。');
	if (code === 'search-disabled') return t('联网搜索已关闭');
	if (/401|403/.test(code)) return t('搜索密钥无效或无权限，请检查设置。');
	if (/402/.test(code)) return t('搜索服务余额不足，请到服务商账户检查。');
	if (/429/.test(code)) return t('搜索请求过于频繁，请稍后重试。');
	if (/abort|timeout/i.test(code)) return t('搜索已停止或超时，请重试。');
	return t('搜索失败：{0}', [code.slice(0, 160)]);
}
async function jsonRequest(url: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
	const controller = new AbortController(), abort = () => controller.abort();
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	signal?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(abort, 25000);
	try {
		const r = await fetch(url, { ...init, credentials: 'omit', redirect: 'error', signal: controller.signal });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const body = await r.text();
		if (body.length > 4 * 1024 * 1024) throw new Error('response-too-large');
		return JSON.parse(body);
	} finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function searchWeb(query: string, settings: WebSearchSettings, signal?: AbortSignal): Promise<SearchSource[]> {
	if (!settings.enabled) throw new Error('search-disabled');
	const provider = selectedSearchProvider(settings);
	if (!provider) throw new Error('search-unconfigured');
	const q = query.trim();
	if (!q || [...q].length > (provider === 'deepseek' ? 128 : 400)) throw new Error(t('搜索词过长，请拆成更短的问题。'));
	const raw = provider === 'deepseek'
		? await jsonRequest('https://api.deepseek.com/v1/tools/search', { method: 'POST', headers: { Authorization: `Bearer ${settings.keys.deepseek}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, count: 6, need_content: false }) }, signal)
		: await jsonRequest(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=6`, { headers: { 'X-Subscription-Token': settings.keys.brave, Accept: 'application/json' } }, signal);
	const rows = provider === 'deepseek' ? raw.results : raw.web?.results;
	if (!Array.isArray(rows)) throw new Error('invalid-search-response');
	const seen = new Set<string>();
	return rows.flatMap((r: any): SearchSource[] => {
		const url = publicWebUrl(r?.url); if (!url) return [];
		const canonical = new URL(url); canonical.hash = '';
		for (const key of [...canonical.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) canonical.searchParams.delete(key);
		canonical.searchParams.sort();
		const identity = canonical.href.replace(/\/$/, '');
		if (seen.has(identity)) return []; seen.add(identity);
		return [{ url, title: String(r.title || url).slice(0, 300), snippet: String(r.summary || r.snippet || r.description || '').replace(/<[^>]*>/g, '').slice(0, 2000), ...(typeof r.date === 'string' ? { date: r.date } : {}) }];
	}).slice(0, 6);
}
export async function fetchSearchPage(url: string, settings: WebSearchSettings, signal?: AbortSignal): Promise<SearchSource> {
	if (!settings.enabled) throw new Error('search-disabled');
	if (!publicWebUrl(url)) throw new Error('invalid-public-url');
	if (!settings.keys.deepseek) return readPublicPage(url, signal);
	const raw = await jsonRequest('https://api.deepseek.com/v1/tools/fetch', { method: 'POST', headers: { Authorization: `Bearer ${settings.keys.deepseek}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }, signal);
	if (typeof raw.content !== 'string' || !raw.content.trim()) throw new Error(t('没有读到网页正文，请尝试其他来源。'));
	return { url, title: String(raw.title || url).slice(0, 300), snippet: raw.content.slice(0, 500), content: raw.content.slice(0, 18000) };
}

// Brave supplies search results; read the chosen public page directly without cookies.
// Refuse redirects rather than letting a public URL redirect a background fetch into a local service.
async function readPublicPage(url: string, signal?: AbortSignal): Promise<SearchSource> {
	const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'text/html,text/plain' } });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const type = response.headers.get('content-type') || '';
	if (!/text\/(?:html|plain)|application\/xhtml\+xml/i.test(type)) throw new Error('unsupported-page-type');
	const reader = response.body?.getReader();
	if (!reader) throw new Error('empty-page');
	const decoder = new TextDecoder(); let html = '', size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read(); if (done) break;
			size += value.byteLength;
			if (size > 2 * 1024 * 1024) throw new Error('response-too-large');
			html += decoder.decode(value, { stream: true });
		}
		html += decoder.decode();
	} finally { await reader.cancel().catch(() => {}); }
	let content = html, title = url;
	if (!/text\/plain/i.test(type)) {
		const { document } = parseHTML(html);
		title = document.querySelector('title')?.textContent || url;
		document.querySelectorAll('script,style,nav,header,footer,aside,form,iframe,noscript,svg').forEach(node => node.remove());
		content = (document.querySelector('article,main,[role="main"]') || document.body).textContent || '';
	}
	content = content.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 18000);
	if (!content) throw new Error(t('没有读到网页正文，请尝试其他来源。'));
	return { url, title: title.slice(0, 300), snippet: content.slice(0, 500), content };
}
