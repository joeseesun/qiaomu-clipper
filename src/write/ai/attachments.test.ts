// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { resetDbConnection } from '../db';
import { blankArticle, saveArticle } from '../articles';
import { articleAttachment, checkedWebUrl, extractWebText, referenceContext, webAttachment, imagesOf } from './attachments';

beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); vi.unstubAllGlobals(); });

it('only reads public web pages', () => {
	expect(checkedWebUrl('https://example.com/a?b=1').hostname).toBe('example.com');
	for (const bad of ['http://localhost:3000', 'http://192.168.1.2/x', 'http://127.0.0.1', 'https://user:pw@example.com', 'ftp://example.com', 'file:///etc/passwd', 'http://intranet.local', 'not a url']) expect(() => checkedWebUrl(bad), bad).toThrow();
	expect(checkedWebUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
});

it('takes the readable text of a page and drops scripts and chrome', () => {
	const { title, text } = extractWebText('<html><head><title>标题</title></head><body><nav>菜单</nav><article><p>第一段</p><script>alert(1)</script><p>第二段</p></article><footer>页脚</footer></body></html>');
	expect(title).toBe('标题');
	expect(text).toBe('第一段第二段');
	expect(() => extractWebText('<html><body><script>x</script></body></html>')).toThrow();
});

it('fetches a page as an attachment and refuses redirects into private networks', async () => {
	const page = (url: string) => { const res = new Response('<title>T</title><main>正文很长</main>', { headers: { 'content-type': 'text/html' } }); Object.defineProperty(res, 'url', { value: url }); return res; };
	vi.stubGlobal('fetch', vi.fn(async () => page('https://example.com/final')));
	const attachment = await webAttachment('https://example.com/x');
	expect(attachment).toMatchObject({ kind: 'web', label: 'T', url: 'https://example.com/final', text: '正文很长' });
	vi.stubGlobal('fetch', vi.fn(async () => page('http://10.0.0.5/secret')));
	await expect(webAttachment('https://example.com/x')).rejects.toThrow();
	vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-type': 'application/pdf' } })));
	await expect(webAttachment('https://example.com/x.pdf')).rejects.toThrow();
});

it('references another article and fences everything the model reads', async () => {
	const saved = await saveArticle({ ...blankArticle(), title: '旧稿', markdown: '旧稿正文' });
	const article = await articleAttachment(saved.id);
	expect(article).toMatchObject({ kind: 'article', label: '旧稿', text: '旧稿正文' });
	const context = referenceContext([article, { kind: 'web', id: 'w', label: '网页', url: 'https://e.com', text: '网页文字' }, { kind: 'image', id: 'i', label: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' }]);
	expect(context).toContain('<文章 标题="旧稿">\n旧稿正文\n</文章>');
	expect(context).toContain('<网页 标题="网页" 地址="https://e.com">');
	expect(context).not.toContain('AAAA');
	expect(imagesOf([article, { kind: 'image', id: 'i', label: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' }])).toEqual([{ dataUrl: 'data:image/jpeg;base64,AAAA', label: 'a.jpg' }]);
	await expect(articleAttachment('nope')).rejects.toThrow();
});
