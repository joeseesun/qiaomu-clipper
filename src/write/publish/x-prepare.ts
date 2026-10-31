import { IMAGE_SCHEME } from '../types';
import type { Article } from '../types';

// The host name stands in for pictures that live in the local store; the page that publishes resolves them (the X tab never sees the store).
export const LOCAL_IMAGE_HOST = 'https://qm-image.local/';

export interface GeneratedImage { source: string; name: string; kind: 'mermaid' | 'math'; code: string; display: boolean }
export interface PreparedForX { markdown: string; generated: GeneratedImage[] }

const MONEY_SAFE_INLINE = /(?<![\\$])\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/g;

// Turns an article into the plain Markdown the X engine reads: pictures get stable addresses, diagrams and formulas become pictures,
// inline formulas become code, checklist boxes become symbols (X articles have no task lists).
export function prepareForX(article: Pick<Article, 'title' | 'markdown' | 'coverImageId'>): PreparedForX {
	const generated: GeneratedImage[] = [];
	const lines = article.markdown.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let fence: { marker: string; lang: string; body: string[] } | null = null;
	let math: string[] | null = null;
	const addImage = (kind: 'mermaid' | 'math', code: string, display: boolean) => {
		const name = `${kind}-${generated.length + 1}.png`;
		const source = `${LOCAL_IMAGE_HOST}${name}`;
		generated.push({ source, name, kind, code, display });
		return `![${kind === 'mermaid' ? '图' : '公式'}](${source})`;
	};

	for (const line of lines) {
		if (fence) {
			if (line.trimEnd().startsWith(fence.marker)) {
				if (fence.lang === 'mermaid') out.push(addImage('mermaid', fence.body.join('\n'), true));
				else out.push(`${fence.marker}${fence.lang}`, ...fence.body, fence.marker);
				fence = null;
			} else fence.body.push(line);
			continue;
		}
		const open = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/);
		if (open && !math) { fence = { marker: open[2], lang: open[3].toLowerCase(), body: [] }; continue; }
		if (math) {
			if (line.trim().endsWith('$$')) { math.push(line.trim().slice(0, -2)); out.push(addImage('math', math.join('\n').trim(), true)); math = null; } else math.push(line);
			continue;
		}
		const single = line.trim().match(/^\$\$([\s\S]+)\$\$$/);
		if (single) { out.push(addImage('math', single[1], true)); continue; }
		if (/^\s*\$\$\s*$/.test(line) || /^\s*\$\$[^$]*$/.test(line)) { math = [line.trim().slice(2)]; continue; }
		let text = line
			.replace(/<img\b[^>]*>/gi, tag => {
				const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '';
				return `![${attr('alt')}](${attr('src')})`;
			})
			.replace(MONEY_SAFE_INLINE, (_whole, latex: string) => `\`${latex}\``)
			.replace(/^(\s*[-*+]\s+)\[x\]\s+/i, '$1☑ ')
			.replace(/^(\s*[-*+]\s+)\[ \]\s+/, '$1☐ ');
		text = text.split(IMAGE_SCHEME).join(LOCAL_IMAGE_HOST);
		out.push(text);
	}
	// An unterminated fence or formula is kept as the writer typed it.
	if (fence) out.push(`${fence.marker}${fence.lang}`, ...fence.body);
	if (math) out.push('$$', ...math);

	const front = ['---', `title: ${JSON.stringify(article.title.trim())}`];
	if (article.coverImageId) front.push(`cover: ${JSON.stringify(`${LOCAL_IMAGE_HOST}${article.coverImageId}`)}`);
	front.push('---', '');
	return { markdown: `${front.join('\n')}\n${out.join('\n')}`, generated };
}

export function localImageId(source: string): string | undefined {
	return source.startsWith(LOCAL_IMAGE_HOST) ? source.slice(LOCAL_IMAGE_HOST.length).replace(/\.\w+$/, '') : undefined;
}
