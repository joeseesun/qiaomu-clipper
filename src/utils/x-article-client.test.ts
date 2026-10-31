import { beforeEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
const send = vi.hoisted(() => vi.fn());
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: send } } }));
import { readXArticle, fetchXArticle } from './x-article-client';
const url = 'https://x.com/a/status/12345', id = '01234567-1234-1234-1234-0123456789ab';
const meta = (text: string) => ({ url, title: 'title', author: 'author', kind: 'article', complete: true, provenance: 'x-original-page', sha256: createHash('sha256').update(text).digest('hex') });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); });
it('reassembles Unicode pages and checks source hash before using any text', async () => {
 const text = 'First 😀\n\nLast'; const info = meta(text);
 send.mockResolvedValueOnce({ ok: true, article: info, content: 'First 😀', next: 8, done: false })
 .mockResolvedValueOnce({ ok: true, article: info, content: '\n\nLast', next: 14, done: true });
 expect((await readXArticle(id, url)).content).toBe(text);
 expect(send.mock.calls[1][0].offset).toBe(8);
 send.mockResolvedValueOnce({ ok: true, article: info, content: 'WRONG', next: 5, done: true });
 await expect(readXArticle(id, url)).rejects.toThrow('x-source-unverified');
});
it('rejects repeated offsets and a different requested post', async () => {
 send.mockResolvedValue({ ok: true, article: meta('a'), content: 'a', next: 0, done: false });
 await expect(readXArticle(id, url)).rejects.toThrow('x-source-unverified');
 send.mockResolvedValue({ ok: true, article: { ...meta('a'), url: 'https://x.com/a/status/54321' }, content: 'a', next: 1, done: true });
 await expect(readXArticle(id, url)).rejects.toThrow('x-source-unverified');
});
it('cancels again when stop races the asynchronous start response', async () => {
 const controller = new AbortController();
 send.mockImplementation(async (m: any) => {
  if (m.action === 'xArticleStatus') return { ok: true, xArticles: 1 };
  if (m.action === 'xArticleStart') { controller.abort(); return { ok: true }; }
  return { ok: true };
 });
 await expect(fetchXArticle(id, url, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
 expect(send.mock.calls.filter(([m]) => m.action === 'xArticleCancel')).toHaveLength(2);
 expect(send.mock.calls.some(([m]) => m.action === 'xArticleRead')).toBe(false);
});
it('fails explicitly with an old helper without starting a job', async () => {
 send.mockResolvedValue({ ok: true }); await expect(fetchXArticle(id, url)).rejects.toThrow('helper-upgrade-required');
 expect(send).toHaveBeenCalledTimes(1);
});
