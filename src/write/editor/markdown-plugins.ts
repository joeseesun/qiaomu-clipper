// markdown-it pieces the editor needs beyond CommonMark: $math$, $$math$$ and a bare tweet / video link on its own line.
// They emit HTML the matching editor nodes read (see math.ts and embed.ts).
type MarkdownIt = any;

export const MATH_INLINE_TAG = 'span[data-type="math-inline"]';
export const MATH_BLOCK_TAG = 'div[data-type="math-block"]';

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inlineMath(state: any, silent: boolean): boolean {
	const src: string = state.src;
	const start = state.pos;
	if (src.charCodeAt(start) !== 0x24) return false;
	if (src.charCodeAt(start + 1) === 0x24) return false;
	const next = src[start + 1];
	// "$5 and $10" is money: an opening $ must touch the formula and the closing $ must not be followed by a digit.
	if (!next || /\s/.test(next)) return false;
	let end = start + 1;
	while (true) {
		end = src.indexOf('$', end);
		if (end === -1) return false;
		let slashes = 0;
		for (let i = end - 1; i > start && src[i] === '\\'; i--) slashes++;
		if (slashes % 2 === 0) break;
		end++;
	}
	const body = src.slice(start + 1, end);
	if (!body || /\s$/.test(body) || /\d/.test(src[end + 1] ?? '') || body.includes('\n\n')) return false;
	if (!silent) {
		const token = state.push('math_inline', 'span', 0);
		token.content = body.trim();
	}
	state.pos = end + 1;
	return true;
}

function blockMath(state: any, startLine: number, endLine: number, silent: boolean): boolean {
	let pos = state.bMarks[startLine] + state.tShift[startLine];
	let max = state.eMarks[startLine];
	if (state.sCount[startLine] - state.blkIndent >= 4) return false;
	if (state.src.slice(pos, pos + 2) !== '$$') return false;
	const first = state.src.slice(pos + 2, max);
	let body = '';
	let line = startLine;
	if (first.trim().endsWith('$$') && first.trim().length >= 2) {
		body = first.trim().slice(0, -2);
	} else {
		body = first;
		let closed = false;
		for (line = startLine + 1; line < endLine; line++) {
			pos = state.bMarks[line] + state.tShift[line];
			max = state.eMarks[line];
			const text = state.src.slice(pos, max);
			if (text.trim().endsWith('$$')) { body += '\n' + text.trim().slice(0, -2); closed = true; break; }
			body += '\n' + text;
		}
		if (!closed) return false;
	}
	if (silent) return true;
	state.line = line + 1;
	const token = state.push('math_block', 'div', 0);
	token.block = true;
	token.content = body.trim();
	token.map = [startLine, state.line];
	return true;
}

export function mathPlugin(md: MarkdownIt): void {
	if (md.__qmMath) return;
	md.__qmMath = true;
	md.inline.ruler.after('escape', 'math_inline', inlineMath);
	md.block.ruler.before('fence', 'math_block', blockMath, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
	md.renderer.rules.math_inline = (tokens: any[], idx: number) => `<span data-type="math-inline" data-latex="${escapeAttr(tokens[idx].content)}"></span>`;
	md.renderer.rules.math_block = (tokens: any[], idx: number) => `<div data-type="math-block" data-latex="${escapeAttr(tokens[idx].content)}"></div>\n`;
}

export type EmbedKind = 'tweet' | 'youtube' | 'bilibili' | 'vimeo';
export interface EmbedInfo { kind: EmbedKind; id: string; url: string }

// A link that should stand as its own embedded block when it is alone on a line.
export function parseEmbedUrl(raw: string): EmbedInfo | undefined {
	let url: URL;
	try { url = new URL(raw.trim()); } catch { return undefined; }
	if (!/^https?:$/.test(url.protocol)) return undefined;
	const host = url.hostname.replace(/^www\.|^m\.|^mobile\./, '');
	if (host === 'x.com' || host === 'twitter.com') {
		const match = url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d+)/);
		return match ? { kind: 'tweet', id: match[1], url: `https://x.com${url.pathname.replace(/\/(photo|video)\/\d+$/, '')}` } : undefined;
	}
	if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
		const id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1];
		return id && /^[\w-]{6,}$/.test(id) ? { kind: 'youtube', id, url: url.href } : undefined;
	}
	if (host === 'youtu.be') {
		const id = url.pathname.slice(1).split('/')[0];
		return /^[\w-]{6,}$/.test(id) ? { kind: 'youtube', id, url: url.href } : undefined;
	}
	if (host === 'bilibili.com') {
		const id = url.pathname.match(/^\/video\/(BV[\w]+)/i)?.[1];
		return id ? { kind: 'bilibili', id, url: `https://www.bilibili.com/video/${id}/` } : undefined;
	}
	if (host === 'vimeo.com') {
		const id = url.pathname.match(/^\/(\d+)/)?.[1];
		return id ? { kind: 'vimeo', id, url: url.href } : undefined;
	}
	return undefined;
}

export function embedPlugin(md: MarkdownIt): void {
	if (md.__qmEmbed) return;
	md.__qmEmbed = true;
	md.core.ruler.push('qm_embed', (state: any) => {
		const tokens: any[] = state.tokens;
		for (let i = 0; i + 2 < tokens.length; i++) {
			if (tokens[i].type !== 'paragraph_open' || tokens[i + 1].type !== 'inline' || tokens[i + 2].type !== 'paragraph_close') continue;
			const children: any[] = tokens[i + 1].children ?? [];
			let candidate: string | undefined;
			if (children.length === 1 && children[0].type === 'text') candidate = children[0].content;
			else if (children.length === 3 && children[0].type === 'link_open' && children[1].type === 'text' && children[2].type === 'link_close') {
				const href = children[0].attrGet('href');
				if (href === children[1].content) candidate = href;
			}
			const info = candidate && !/\s/.test(candidate.trim()) ? parseEmbedUrl(candidate) : undefined;
			if (!info) continue;
			const html = new state.Token('html_block', '', 0);
			html.content = `<div data-type="embed" data-kind="${info.kind}" data-src="${escapeAttr(info.url)}"></div>\n`;
			html.block = true;
			tokens.splice(i, 3, html);
		}
	});
}
