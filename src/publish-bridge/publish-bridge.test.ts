// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { md5Hex } from './md5';
import { parseHandoff } from './protocol';
import { assetSources, toZhihuHtml } from './zhihu-html';

describe('md5', () => {
	it('matches the reference digests', () => {
		expect(md5Hex(new Uint8Array())).toBe('d41d8cd98f00b204e9800998ecf8427e');
		expect(md5Hex(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
		expect(md5Hex(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe('9e107d9d372bb6826bd81d3542a419d6');
		expect(md5Hex(new TextEncoder().encode('a'.repeat(1000)))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
	});
});

describe('hand-off address', () => {
	const token = 'a'.repeat(32);
	it('is recognised only on the platform pages', () => {
		expect(parseHandoff(`https://x.com/compose/articles#qp=51234.${token}`)).toEqual({ handoff: { port: 51234, token }, target: 'x' });
		expect(parseHandoff(`https://zhuanlan.zhihu.com/write#qp=51234.${token}`)?.target).toBe('zhihu');
		expect(parseHandoff(`https://creator.xiaohongshu.com/publish/publish?x=1#qp=51234.${token}`)?.target).toBe('xhs');
	});
	it('rejects other hosts, plain http, bad ports and bad tokens', () => {
		expect(parseHandoff(`https://evil.example/#qp=51234.${token}`)).toBeNull();
		expect(parseHandoff(`http://x.com/compose/articles#qp=51234.${token}`)).toBeNull();
		expect(parseHandoff(`https://x.com/#qp=80.${token}`)).toBeNull();
		expect(parseHandoff('https://x.com/#qp=51234.short')).toBeNull();
		expect(parseHandoff(undefined)).toBeNull();
	});
});

describe('Zhihu html', () => {
	const html = '<h1>大</h1><p>文</p><img src="qp-asset://img0" style="width:3px"><img src="qp-asset://gone"><pre><code class="language-ts">x</code></pre><table><thead><tr><td>a</td></tr></thead><tbody><tr><td>1</td></tr></tbody></table><h4>小</h4>';
	it('lists the pictures it needs', () => { expect(assetSources(html)).toEqual(['qp-asset://img0', 'qp-asset://gone']); });
	it('keeps one Markdown paragraph as one Zhihu paragraph', () => {
		const spaced = '<p>第一段</p>\n\n<p>第二段</p>\n<p><br></p><p>&nbsp;</p><ul>\n<li><p>条目一</p></li>\n<li><p>条目二</p><p>续行</p></li>\n</ul>\n<div>\n<p>引用内</p>\n</div>\n<pre><code>a\n\nb</code></pre>';
		const out = toZhihuHtml(spaced, new Map());
		expect(out).toBe('<p>第一段</p><p>第二段</p><ul><li>条目一</li><li>条目二<br>续行</li></ul><p>引用内</p><pre><code>a\n\nb</code></pre>');
	});
	it('rewrites pictures, headings, code and tables the way Zhihu expects', () => {
		const out = toZhihuHtml(html, new Map([['qp-asset://img0', 'https://pic4.zhimg.com/a.png']]));
		expect(out).toContain('<figure><img src="https://pic4.zhimg.com/a.png"></figure>');
		expect(out).not.toContain('gone');
		expect(out).toContain('<h2>大</h2>');
		expect(out).toContain('<h3>小</h3>');
		expect(out).toContain('<pre lang="ts"><code>x</code></pre>');
		expect(out).toContain('data-draft-type="table"');
		expect(out).toContain('<th>a</th>');
		expect(out).not.toContain('style=');
	});
});
