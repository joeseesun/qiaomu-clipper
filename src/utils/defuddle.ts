import UpstreamDefuddle, { type DefuddleOptions, type DefuddleResponse } from 'defuddle';
import { createMarkdownContent as upstreamMarkdown } from 'defuddle/full';
import { protectCodeBlocks, restoreCodeHtml, restoreCodeMarkdown, countHtmlWords, type CodeBlock } from './code-preservation';

const normalizedText = (text: string) => text.replace(/\s+/g, ' ').trim();
interface ImageDescription { alt: string; title: string | null; sourceText: string }
function captionSourceText(element: Element): string {
	const copy = element.cloneNode(true) as Element;
	const hidden = 'script,style,[hidden],[aria-hidden="true"],.hidden,.invisible';
	if (copy.matches(hidden)) return '';
	copy.querySelectorAll(hidden).forEach(node => node.remove());
	for (const node of [copy, ...Array.from(copy.querySelectorAll('[style]'))]) {
		if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) {
			if (node === copy) return '';
			node.remove();
		}
	}
	return copy.textContent || '';
}

// The extension and CLI already supply DOMParser for Defuddle/Turndown.
export function createMarkdownContent(content: string, url: string, parser: Pick<DOMParser, 'parseFromString'> = new DOMParser()): string {
	const doc = parser.parseFromString(`<!doctype html><html><head></head><body>${content}</body></html>`, 'text/html');
	const blocks = protectCodeBlocks(doc);
	if (!blocks.length) return upstreamMarkdown(content, url);
	const codes = Array.from(doc.querySelectorAll('pre > code'));
	for (const block of blocks) {
		const code = codes.find(node => node.textContent?.startsWith(block.token + 'START'));
		if (code) code.textContent = block.token;
	}
	const markdown = restoreCodeMarkdown(upstreamMarkdown(doc.body.innerHTML, url), blocks);
	if (blocks.some(block => markdown.includes(block.token))) throw new Error('Unable to preserve code block during Markdown conversion');
	return markdown;
}

/** One boundary shared by clipping, reading, exports and the programmatic API. */
export default class Defuddle {
	private parser: UpstreamDefuddle;
	private blocks: CodeBlock[];
	private url: string;
	private imageDescriptions = new Map<string, ImageDescription>();
	private imageDoc: Document;
	constructor(doc: Document, private options: DefuddleOptions = {}) {
		const clone = doc.cloneNode(true) as Document;
		this.imageDoc = clone;
		this.url = options.url || doc.URL;
		this.blocks = protectCodeBlocks(clone, doc);
		// Track image provenance without changing alt: extractors also use it for
		// emoji, equations and lazy-image deduplication. A temporary title survives
		// normalization and is restored before the result leaves this boundary.
		let prefix: string;
		do { prefix = `QCImage${Math.random().toString(36).slice(2)}X`; } while (clone.documentElement.outerHTML.includes(prefix));
		for (const image of Array.from(clone.querySelectorAll('img[alt]'))) {
			const alt = image.getAttribute('alt')!;
			if (!alt.trim()) continue;
			const scope = image.closest('figure') || image.parentElement;
			// Caption siblings may be moved into the figure by the upstream parser.
			const captions = Array.from(scope?.parentElement?.children || []).filter(el => el !== scope && /caption|credit|text|description/i.test(el.className));
			const sourceText = normalizedText([scope ? captionSourceText(scope) : '', ...captions.map(captionSourceText)].join(' '));
			const token = `${prefix}${this.imageDescriptions.size}Z`;
			this.imageDescriptions.set(token, { alt, title: image.getAttribute('title'), sourceText });
			image.setAttribute('title', token);
		}
		this.parser = new UpstreamDefuddle(clone, { ...options, url: this.url, markdown: false, separateMarkdown: false });
	}
	private restore(result: DefuddleResponse): DefuddleResponse {
		const before = result.content;
		result.content = restoreCodeHtml(result.content, this.blocks);
		if (this.imageDescriptions.size) {
			const container = this.imageDoc.createElement('div');
			container.innerHTML = result.content;
			for (const image of Array.from(container.querySelectorAll('img[title]'))) {
				const original = this.imageDescriptions.get(image.getAttribute('title')!);
				if (!original) continue;
				if (original.title === null) image.removeAttribute('title');
				else image.setAttribute('title', original.title);
				const caption = image.closest('figure')?.querySelector('figcaption');
				const text = normalizedText(caption?.textContent || '');
				// Only drop a caption synthesized from alt, never a source caption
				// (including a legitimate caption whose text happens to equal alt).
				if (caption && text && (!original.sourceText || (text === normalizedText(original.alt) && !original.sourceText.includes(text)))) caption.remove();
			}
			result.content = container.innerHTML;
		}
		if (before !== result.content) {
			const oldCount = result.wordCount;
			result.wordCount += countHtmlWords(result.content) - countHtmlWords(before);
			if (result.variables?.wordCount === String(oldCount)) result.variables.wordCount = String(result.wordCount);
		}
		if (this.blocks.some(block => result.content.includes(block.token))) throw new Error('Code block extraction was incomplete');
		if (this.options.markdown) result.content = createMarkdownContent(result.content, this.url);
		else if (this.options.separateMarkdown) result.contentMarkdown = createMarkdownContent(result.content, this.url);
		return result;
	}
	parse(): DefuddleResponse { return this.restore(this.parser.parse()); }
	async parseAsync(): Promise<DefuddleResponse> { return this.restore(await this.parser.parseAsync()); }
}
