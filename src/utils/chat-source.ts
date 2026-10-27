export interface ChatSource {
	url: string;
	title: string;
	preserveUrlHash?: boolean;
}

// An explicit allowlist: a caller may pass live page context, but history must
// never retain its Markdown, DOM, selection or a second copy of page images.
export function chatSource(source: ChatSource, preserveUrlHash = source.preserveUrlHash ?? false): ChatSource {
	return { url: source.url, title: source.title, preserveUrlHash };
}

export function chatPageKey(url: string, preserveUrlHash = false): string {
	try { const parsed = new URL(url); if (!preserveUrlHash) parsed.hash = ''; return parsed.href; } catch { return url; }
}

// Source links are rendered as text first; only ordinary web links are actionable.
export function chatSourceLink(url: string): string | undefined {
	try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}
