import UpstreamDefuddle, { type DefuddleOptions, type DefuddleResponse } from 'defuddle';
import { createMarkdownContent as upstreamMarkdown } from 'defuddle/full';
import { protectCodeBlocks, restoreCodeHtml, restoreCodeMarkdown, countHtmlWords, type CodeBlock } from './code-preservation';
import { protectArticleLists, restoreArticleLists } from './list-preservation';

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
	private listMarkers: string[];
	private url: string;
	constructor(doc: Document, private options: DefuddleOptions = {}) {
		const clone = doc.cloneNode(true) as Document;
		this.url = options.url || doc.URL;
		this.blocks = protectCodeBlocks(clone, doc);
		this.listMarkers = protectArticleLists(clone);
		this.parser = new UpstreamDefuddle(clone, { ...options, url: this.url, markdown: false, separateMarkdown: false });
	}
	private restore(result: DefuddleResponse): DefuddleResponse {
		const before = result.content;
		result.content = restoreArticleLists(restoreCodeHtml(result.content, this.blocks), this.listMarkers);
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
