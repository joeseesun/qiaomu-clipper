// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import UpstreamDefuddle from 'defuddle';
import { marked } from 'marked';
import Defuddle, { createMarkdownContent } from './defuddle';

const url = 'https://example.org/image-descriptions';
const description = '图片展示的是 Personal Agent 应用空间界面，上方有分类标签，下方有笔记、定时任务和文件管理等应用图标。';
const fixture = (body: string) => new DOMParser().parseFromString(`<html><head><title>Application review</title></head><body><article><h1>Application review</h1><p>${'This review explains the application and its useful features. '.repeat(10)}</p>${body}<p>${'The article continues with practical examples and conclusions. '.repeat(10)}</p></article></body></html>`, 'text/html');
const parsed = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const image = (alt = description) => `<img src="https://example.org/screenshot.png" alt="${alt}">`;

describe('image descriptions remain attributes', () => {
	it('independently reproduces upstream promoting alt into a visible caption', () => {
		const result = new UpstreamDefuddle(fixture(`<figure>${image()}</figure>`), { url }).parse();
		expect(parsed(result.content).querySelector('figcaption')?.textContent).toBe(description);
	});

	for (const wrapper of ['figure', 'span', 'div']) {
		it(`keeps alt hidden through ${wrapper} extraction and Markdown rendering`, () => {
			const source = fixture(`<${wrapper}>${image()}</${wrapper}>`);
			const before = source.documentElement.outerHTML;
			const result = new Defuddle(source, { url, separateMarkdown: true }).parse();
			const content = parsed(result.content);
			expect(content.querySelector('img')?.getAttribute('alt')).toBe(description);
			expect(content.body.textContent).not.toContain(description);
			const rendered = parsed(marked.parse(result.contentMarkdown!) as string);
			expect(rendered.querySelector('img')?.getAttribute('alt')).toBe(description);
			expect(rendered.body.textContent).not.toContain(description);
			expect(result.content + result.contentMarkdown).not.toContain('QCImage');
			expect(source.documentElement.outerHTML).toBe(before);
		});
	}

	for (const caption of ['A visible caption and photo credit', description]) {
		it(`preserves an explicit visible caption even when it matches alt: ${caption.slice(0, 15)}`, () => {
			const result = new Defuddle(fixture(`<figure>${image()}<figcaption>${caption}</figcaption></figure>`), { url }).parse();
			expect(parsed(result.content).querySelector('figcaption')?.textContent).toBe(caption);
			expect(createMarkdownContent(result.content, url)).toContain(`\n\n${caption}`);
		});
	}

	it('restores distinct alt values for repeated image URLs and leaves decorative images empty', () => {
		const result = new Defuddle(fixture(`<figure>${image()}</figure><figure>${image('Another screenshot description')}</figure><figure>${image('')}</figure>`), { url }).parse();
		expect(Array.from(parsed(result.content).querySelectorAll('img')).map(img => img.getAttribute('alt'))).toEqual([description, 'Another screenshot description', '']);
		expect(parsed(result.content).body.textContent).not.toContain('Another screenshot description');
	});

	it('preserves escaped characters without turning alt into markup', async () => {
		const alt = 'A & B <screen> "quoted" caption';
		const result = await new Defuddle(fixture(`<figure>${image('A &amp; B &lt;screen&gt; &quot;quoted&quot; caption')}</figure>`), { url, markdown: true }).parseAsync();
		const rendered = parsed(marked.parse(result.content) as string);
		expect(rendered.querySelector('img')?.getAttribute('alt')).toBe(alt);
		expect(rendered.querySelector('screen')).toBeNull();
		expect(rendered.body.textContent).not.toContain('A & B');
	});

	it('restores image titles and distinguishes two identical images with different caption provenance', () => {
		const result = new Defuddle(fixture(`<figure>${image().replace('<img ', '<img title="Original tooltip" ')}<figcaption>${description}</figcaption></figure><figure>${image()}</figure>`), { url }).parse();
		const content = parsed(result.content);
		expect(content.querySelectorAll('figcaption')).toHaveLength(1);
		expect(Array.from(content.querySelectorAll('img')).map(img => img.getAttribute('title'))).toEqual(['Original tooltip', null]);
		expect(result.content).not.toContain('QCImage');
	});

	it('keeps a visible sibling caption when the parser moves it into a figure', () => {
		const result = new Defuddle(fixture(`<div><span>${image()}</span><div class="image-caption">${description}</div></div>`), { url }).parse();
		expect(parsed(result.content).body.textContent).toContain(description);
	});

	it('does not treat explicitly hidden description text as a visible source caption', () => {
		const result = new Defuddle(fixture(`<figure>${image()}<span hidden>${description}</span></figure>`), { url }).parse();
		expect(parsed(result.content).body.textContent).not.toContain(description);
	});

	it('keeps formula image alt available to the equation extractor', () => {
		const result = new Defuddle(fixture('<p><img src="https://example.org/formula.png" alt="\\frac{a}{b}"></p>'), { url }).parse();
		expect(createMarkdownContent(result.content, url)).toContain('\\frac{a}{b}');
		expect(result.content).not.toContain('QCImage');
	});

	it('keeps emoji image alt available to the X extractor', () => {
		const source = parsed('<article data-testid="tweet"><div data-testid="User-Name"><a href="/alice">Alice</a><a href="/alice">@alice</a></div><a href="https://x.com/alice/status/123"><time datetime="2026-10-21T00:00:00Z">Today</time></a><div data-testid="tweetText">Hello <img src="https://abs.twimg.com/emoji/v2/1f600.svg" alt="😀"></div></article>');
		const result = new Defuddle(source, { url: 'https://x.com/alice/status/123' }).parse();
		expect(result.content).toContain('😀');
		expect(result.content).not.toContain('QCImage');
	});

	it('keeps responsive-image deduplication and hidden-alt word counts unchanged', () => {
		const source = fixture(`<figure>${image()}${image().replace('screenshot.png', 'screenshot-large.png')}</figure>`);
		const baseline = new UpstreamDefuddle(source.cloneNode(true) as Document, { url }).parse();
		const result = new Defuddle(source, { url }).parse();
		expect(parsed(result.content).querySelectorAll('img')).toHaveLength(parsed(baseline.content).querySelectorAll('img').length);
		const withoutAlt = new Defuddle(fixture(`<figure>${image('')}</figure>`), { url }).parse();
		expect(result.wordCount).toBe(withoutAlt.wordCount);
	});
});
