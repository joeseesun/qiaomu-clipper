import { expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock('./native-helper-call', () => ({ callHelper: call }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { id: 'ours', getURL: () => 'chrome-extension://ours/' } } }));
import { handleXArticle } from './x-article-background';
const sender = { id: 'ours', url: 'chrome-extension://ours/ai-chat-page.html' };
const request = { action: 'xArticleStart', id: '01234567-1234-1234-1234-0123456789ab', url: 'https://x.com/a/status/12345?s=20' };
it('only accepts our extension pages, not X pages or arbitrary callers', async () => {
 for (const s of [{ ...sender, url: 'https://x.com/' }, { ...sender, id: 'other' }, { ...sender, tab: { incognito: true } }])
  expect(await handleXArticle(request, s as any)).toEqual({ ok: false, error: 'invalid-x-request' });
 expect(call).not.toHaveBeenCalled();
});
it('forwards only a validated URL and job fields, never commands or secrets', async () => {
 expect(await handleXArticle({ ...request, command: 'arbitrary', binary: '/tmp/evil', apiKey: 'secret' }, sender)).toEqual({ ok: true });
 expect(call).toHaveBeenCalledWith({ action: request.action, id: request.id, url: 'https://x.com/a/status/12345', offset: undefined }, false);
 expect(await handleXArticle({ ...request, url: 'http://127.0.0.1/' }, sender)).toEqual({ ok: false, error: 'invalid-x-url' });
});
it('allows only fixed setup operations from extension pages', async () => {
 const base = { action: 'xSetupStart', id: request.id, operation: 'login', command: 'evil', url: 'https://evil.test', apiKey: 'secret' };
 expect(await handleXArticle(base, sender)).toEqual({ ok: true });
 expect(call).toHaveBeenLastCalledWith({ action: 'xSetupStart', id: request.id, operation: 'login' }, false);
 expect(await handleXArticle({ ...base, operation: 'shell' }, sender)).toEqual({ ok: false, error: 'invalid-x-request' });
 expect(await handleXArticle(base, { ...sender, url: 'https://x.com/' })).toEqual({ ok: false, error: 'invalid-x-request' });
});
