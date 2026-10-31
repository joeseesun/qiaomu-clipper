// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import OriginalDefuddle from 'defuddle';
import { createMarkdownContent as originalMarkdown } from 'defuddle/full';
import Defuddle, { createMarkdownContent } from './defuddle';
import { escapeCode } from './code-preservation';
import { parseHTML } from 'linkedom';
import DOMPurify from 'dompurify';

const url = 'https://example.org/code-blocks';
const diagram = '┌──────────────┐\n│  Client      │\n└──────┬───────┘\n       ↓\n    Server';
const python = '    if ready:\n\tprint(`value`)  \n\n\n    finish()\n';
const html = (text: string, language = '') => `<pre><code data-language="${language}">${escapeCode(text)}</code></pre>`;
const doc = (body: string) => new DOMParser().parseFromString(`<html><head><title>Code preservation</title></head><body><article><h1>Code preservation</h1><p>These examples describe a program and must keep their original whitespace.</p>${body}<p>The end of this article.</p></article></body></html>`, 'text/html');
const renderedCodes = (markdown: string) => Array.from(new DOMParser().parseFromString(marked.parse(markdown) as string, 'text/html').querySelectorAll('pre > code')).map(code => code.textContent);
const withFinalNewline = (text: string) => text.endsWith('\n') ? text : text + '\n';

describe('lossless code blocks', () => {
	it('reproduces the upstream conversion defects independently', () => {
		expect(originalMarkdown(html(python), url)).not.toContain(python);
		expect(originalMarkdown('<div data-code-block="true"><div data-code-block-source="true"><code>' + diagram + '</code></div></div>', url)).not.toContain('```');
	});
	for (const [name, text] of Object.entries({ diagram, python, tabs: '\tfirst\n\t\tsecond', blanks: '\n\n  first\n\n\nlast\n\n', fences: '```md\n~~~~\n`literal`\n```', entities: '<tag>&value;\n[](example.org)\n!![literal](url)', empty: '' })) {
		it(`preserves ${name} through extraction, conversion and rendering`, () => {
			const source = doc(html(text, 'text'));
			const before = source.documentElement.outerHTML;
			const result = new Defuddle(source, { url }).parse();
			expect(source.documentElement.outerHTML).toBe(before);
			const extracted = new DOMParser().parseFromString(result.content, 'text/html').querySelector('pre code');
			expect(extracted?.textContent).toBe(text);
			const markdown = createMarkdownContent(result.content, url);
			expect(markdown).not.toContain('QCCode');
			expect(markdown).toContain(text);
			// Marked removes one terminal blank line in its code renderer. The
			// exported Markdown above must still retain the original payload.
			expect(renderedCodes(markdown)).toEqual([withFinalNewline(text).replace(/\n\n$/, '\n')]);
		});
	}
	it('retains nested list and blockquote context', () => {
		const nested = python.replace(/\t/g, '    ');
		for (const wrapper of [(block: string) => `<blockquote>${block}</blockquote>`, (block: string) => `<ul><li><p>Example</p>${block}</li></ul>`, (block: string) => `<ol><li>${block}</li></ol>`]) {
			const markdown = createMarkdownContent(wrapper(html(nested, 'python')), url);
			expect(markdown).not.toContain('QCCode');
			expect(renderedCodes(markdown)).toEqual([nested]);
		}
	});
	it('preserves recipe tabs through nested Markdown and the sanitized preview renderer', () => {
		const text = 'build:\n\techo "<done>"  \n\n\tprintf "|`value`"\n';
		for (const wrapper of [
			(block: string) => `<ul><li><p>Build</p>${block}</li></ul>`,
			(block: string) => `<ol start="10"><li>${block}</li></ol>`,
			(block: string) => `<ul><li>Outer<ul><li><p>Inner</p>${block}</li></ul></li></ul>`,
			(block: string) => `<blockquote><ul><li>${block}</li></ul></blockquote>`,
			(block: string) => `<ul><li><blockquote>${block}</blockquote></li></ul>`,
		]) {
			const input = wrapper(html(text, 'makefile'));
			// The upstream renderer expands a recipe tab into spaces inside lists.
			expect(renderedCodes(originalMarkdown(input, url))).not.toEqual([text]);
			const markdown = createMarkdownContent(input, url);
			const preview = DOMPurify.sanitize(marked.parse(markdown) as string);
			const code = new DOMParser().parseFromString(preview, 'text/html').querySelector('pre > code');
			expect(code?.textContent).toBe(text);
			expect(code?.classList.contains('language-makefile')).toBe(true);
			expect(markdown).not.toContain('QCCode');
		}
	});
	it('keeps inline code inline and leaves non-code prose conversion unchanged', () => {
		const input = '<p>Use <code>frame()</code> in this paragraph.</p><p>Next paragraph.</p>';
		expect(createMarkdownContent(input, url)).toBe(originalMarkdown(input, url));
	});
	it('supports br and syntax-highlighted line spans without including gutters', () => {
		const input = '<pre><span class="line-numbers-rows">1\n2</span><code><span class="line"><span>first</span></span><span class="line">  second<br>third</span></code></pre>';
		expect(renderedCodes(createMarkdownContent(input, url))).toEqual(['first\n  second\nthird\n']);
	});
	it('retains language, blank editor lines and indentation in the current ChatGPT DOM', async () => {
		const content = `<div data-code-block="true"><div>Python<button>Copy</button></div><div class="cm-editor"><div class="cm-gutters">1 2 3</div><div class="cm-content" data-language="python"><div class="cm-line">if ready:</div><div class="cm-line">    run()</div><div class="cm-line"><br></div><div class="cm-line">done()</div></div></div></div>`;
		const source = doc(`<section data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown">${content}<div data-code-block="true"><div>Plain text<button>Copy</button></div><div data-code-block-source="true"><code class="whitespace-pre! block">${diagram}</code></div></div></div></div></section>`);
		const chatUrl = 'https://chatgpt.com/c/public-test-fixture';
		const old = new OriginalDefuddle(source.cloneNode(true) as Document, { url: chatUrl }).parse();
		expect(renderedCodes(originalMarkdown(old.content, chatUrl))).not.toEqual(['if ready:\n    run()\n\ndone()\n', withFinalNewline(diagram)]);
		const result = await new Defuddle(source, { url: chatUrl }).parseAsync();
		const markdown = createMarkdownContent(result.content, chatUrl);
		expect(markdown).toContain('```python');
		expect(markdown).not.toContain('Copy');
		expect(renderedCodes(markdown)).toEqual(['if ready:\n    run()\n\ndone()\n', withFinalNewline(diagram)]);
	});
	it('recognizes live block code styles without turning inline code into blocks', () => {
		document.body.innerHTML = '<article><code style="display:block;white-space:pre">first\n  second</code><p>Inline <code>value</code>.</p></article>';
		const result = new Defuddle(document, { url }).parse();
		expect(renderedCodes(createMarkdownContent(result.content, url))).toEqual(['first\n  second\n']);
	});
	it('does not restore code removed with navigation', () => {
		const result = new Defuddle(doc('<pre hidden><code>HIDDEN</code></pre><nav>' + html('NAVIGATION') + '</nav>' + html(diagram)), { url }).parse();
		expect(result.content).not.toMatch(/NAVIGATION|QCCode/);
		const old = new OriginalDefuddle(doc('<pre hidden><code>HIDDEN</code></pre>' + html(diagram)), { url }).parse();
		expect(result.content.includes('HIDDEN')).toBe(old.content.includes('HIDDEN'));
	});
	it('works with linkedom documents used by the CLI', () => {
		const source = parseHTML(doc(html(python)).documentElement.outerHTML).document as unknown as Document;
		const result = new Defuddle(source, { url }).parse();
		expect(renderedCodes(createMarkdownContent(result.content, url))).toEqual([python]);
	});
	it('does not leak temporary identifiers in table cells or details', () => {
		for (const input of ['<table><tr><th>Example</th></tr><tr><td>' + html(diagram) + '</td></tr></table>', '<details><summary>Example</summary>' + html(python) + '</details>']) {
			expect(createMarkdownContent(input, url)).not.toContain('QCCode');
		}
	});
	it('preserves table cell text with pipes, literal Markdown and multiple lines', () => {
		const text = '| a | b |\n`literal` & <tag>\n    next';
		const markdown = createMarkdownContent('<table><tr><th>Example</th></tr><tr><td>' + html(text) + '</td></tr></table>', url);
		expect(renderedCodes(markdown)).toEqual([text]);
		const complex = createMarkdownContent('<table><tr><th colspan="2">Example</th></tr><tr><td>' + html(text) + '</td><td>Other</td></tr></table>', url);
		expect(renderedCodes(complex)).toEqual([text]);
	});
	it('keeps markers out of word counts and supports Markdown options', () => {
		const source = doc(html('  first\nsecond  '));
		const baseline = new OriginalDefuddle(source.cloneNode(true) as Document, { url }).parse();
		const result = new Defuddle(source, { url, separateMarkdown: true }).parse();
		expect(result.wordCount).toBe(baseline.wordCount);
		expect(renderedCodes(result.contentMarkdown!)).toEqual(['  first\nsecond  \n']);
		expect(new Defuddle(source, { url, markdown: true }).parse().content).toBe(result.contentMarkdown);
	});
});
