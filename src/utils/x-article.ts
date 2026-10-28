// Shared, deterministic boundary for links pasted by the user and helper results.
export const MAX_X_ARTICLE_CHARS = 500_000;
const hosts = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
export function xArticleUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\\]/.test(value)) return;
	try {
		const u = new URL(value);
		if (u.protocol !== 'https:' || !hosts.has(u.hostname.toLowerCase()) || u.username || u.password || u.port) return;
		const post = /^\/([A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d{5,25})(?:\/(?:photo|video)\/\d+)?\/?$/.exec(u.pathname);
		if (post) return `https://x.com/${post[1]}/status/${post[2]}`;
		const article = /^\/(?:i|[A-Za-z0-9_]{1,15})\/article\/(\d{5,25})\/?$/.exec(u.pathname);
		if (article) return `https://x.com/i/article/${article[1]}`;
	} catch { /* Not a supported public post/article link. */ }
}
export function xLinksInText(text: string): string[] {
	const links = new Set<string>();
	for (const match of text.matchAll(/https:\/\/[^\s<>"'\u3000()[\]]+/gi)) {
		const url = xArticleUrl(match[0].replace(/[)\]}.,!?，。！？；：、”’]+$/u, ''));
		if (url) links.add(url);
	}
	return [...links];
}
export function wantsXTranslation(question: string): boolean {
	const instruction = question.replace(/https:\/\/[^\s<>]+/gi, '').replace(/[\s()[\]<>，。:：]+/g, '');
	if (!instruction) return true;
	if (/(?:不要|不用|无需|别).{0,6}翻译|(?:do not|don't|no)\s+translat/i.test(question)) return false;
	return /翻译|译成|译为|全文中文|translat/i.test(question);
}
export interface XArticle {
	url: string; title: string; author: string; content: string;
	sha256: string; kind: 'post' | 'article'; provenance: 'x-original-page';
	structure?: { blocks: number; codeBlocks: number; images: number; embeddedPosts: number };
	viaGrok?: boolean;
	// All original body blocks were decoded; images and embedded posts remain references.
	complete: true;
}
export function validateXArticle(value: any, url: string): XArticle {
	if (!value || !xArticleUrl(url) || xArticleUrl(value.url) !== xArticleUrl(url) || value.provenance !== 'x-original-page'
		|| value.complete !== true || !['post', 'article'].includes(value.kind)
		|| typeof value.content !== 'string' || !value.content.trim() || value.content.length > MAX_X_ARTICLE_CHARS
		|| !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.title !== 'string' || typeof value.author !== 'string') throw new Error('x-source-unverified');
	return value as XArticle;
}
