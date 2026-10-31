// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import OriginalDefuddle from 'defuddle';
import Defuddle from './defuddle';

const url = 'https://example.org/articles/list';
const list = '<ul><li><strong>粗体项目</strong></li><li><em>斜体项目</em></li><li><a href="/link">普通链接</a></li></ul>';
const doc = (body: string) => new DOMParser().parseFromString(`<html><head><title>Article list</title></head><body><article><h1>Article list</h1><p>This article explains preserving structured content in an ordinary web page.</p>${body}<p>${'文章正文包含足够的内容，从而验证正常提取流程，而不是短页面的宽松回退。'.repeat(10)}</p><p>The article ends here, with its original content complete.</p></article></body></html>`, 'text/html');
const body = '<h2>内容应该完整保留</h2><p>下面的项目属于正文，不能误判为博客元数据。</p>' + list;

describe('article list preservation', () => {
	it('reproduces short prose lists being mistaken for navigation or metadata', () => {
		expect(new OriginalDefuddle(doc(body), { url }).parse().content).not.toContain('粗体项目');
	});
	for (const tag of ['ul', 'ol']) it(`keeps ${tag} items, inline formatting and resolved links`, async () => {
		const source = doc(body.replace(/ul>/g, tag + '>'));
		const original = source.documentElement.outerHTML;
		const result = await new Defuddle(source, { url, separateMarkdown: true }).parseAsync();
		expect(result.content).toContain('<strong>粗体项目</strong>');
		expect(result.content).toContain('<em>斜体项目</em>');
		expect(result.content).toContain('https://example.org/link');
		expect(result.contentMarkdown).toContain('**粗体项目**');
		expect(result.contentMarkdown).not.toContain('QCList');
		expect(source.documentElement.outerHTML).toBe(original);
	});
	it('still removes navigation, hidden content and title metadata', () => {
		const source = doc('<ul><li>By a writer</li><li>Oct 28</li></ul>' + body + '<nav><h2>Navigation</h2><p>Navigation list</p><ul><li>NAVONE</li><li>NAVTWO</li></ul></nav><section hidden><h2>Hidden</h2><p>Hidden items</p><ul><li>HIDDENONE</li><li>HIDDENTWO</li></ul></section>');
		const result = new Defuddle(source, { url }).parse();
		expect(result.content).toContain('粗体项目');
		expect(result.content).not.toMatch(/By a writer|NAVONE|HIDDENONE|QCList/);
	});
});
