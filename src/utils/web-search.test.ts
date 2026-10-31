import { afterEach, expect, it, vi } from 'vitest';
import { searchWeb, fetchSearchPage, type WebSearchSettings } from './web-search';
const settings: WebSearchSettings = { enabled: true, provider: 'deepseek', keys: { deepseek: 'test-ds', brave: 'test-brave' } };
afterEach(() => vi.unstubAllGlobals());
it('uses DeepSeek Search with the official contract, normalizes sources and sends no model field', async () => {
 const fetcher = vi.fn(async (..._args: any[]) => new Response(JSON.stringify({ results: [{ title: 'A', url: 'https://example.com/a', summary: 'S' }, { title: 'dup', url: 'https://example.com/a' }, { url: 'http://127.0.0.1/' }] }))); vi.stubGlobal('fetch', fetcher);
 const rows = await searchWeb('some query', settings);
 expect(rows).toEqual([{ title: 'A', url: 'https://example.com/a', snippet: 'S' }]);
 expect(fetcher.mock.calls[0]).toEqual(['https://api.deepseek.com/v1/tools/search', expect.objectContaining({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer test-ds', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'some query', count: 6, need_content: false }) })]);
 await expect(searchWeb('x'.repeat(129), settings)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('uses Brave as chosen default with only its own key', async () => {
 const f = vi.fn(async (..._args: any[]) => new Response(JSON.stringify({ web: { results: [{ title: 'B', url: 'https://example.org/', description: '<b>Text</b>' }] } }))); vi.stubGlobal('fetch', f);
 expect(await searchWeb('some query', { ...settings, provider: 'brave' })).toEqual([{ title: 'B', url: 'https://example.org/', snippet: 'Text' }]);
 expect(f.mock.calls[0][0]).toBe('https://api.search.brave.com/res/v1/web/search?q=some%20query&count=6');
 expect(JSON.stringify(f.mock.calls)).not.toContain('test-ds');
});
it('fetches DeepSeek content and never leaks an upstream response body on auth failure', async () => {
 const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Page', content: 'Actual content' }))).mockResolvedValueOnce(new Response('private upstream data', { status: 401 })); vi.stubGlobal('fetch', f);
 expect(await fetchSearchPage('https://example.com/', settings)).toMatchObject({ content: 'Actual content' });
 expect(f.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/tools/fetch');
 await expect(searchWeb('news', settings)).rejects.toThrow('HTTP 401');
});
it('reads public HTML for Brave-only accounts and omits cookies, credentials and redirects', async () => {
 const f = vi.fn(async (..._args: any[]) => new Response('<html><head><title>Page</title></head><body><nav>Menu</nav><article>Hello evidence<script>bad()</script></article></body></html>', { headers: { 'Content-Type': 'text/html' } })); vi.stubGlobal('fetch', f);
 const page = await fetchSearchPage('https://example.com/story', { ...settings, keys: { deepseek: '', brave: 'test-brave' } });
 expect(page.content).toBe('Hello evidence'); expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
 expect(JSON.stringify(f.mock.calls)).not.toContain('test-brave');
 await expect(fetchSearchPage('http://localhost/', settings)).rejects.toThrow('invalid-public-url');
});
it('stops before network access when disabled, unconfigured or already aborted', async () => {
 const f = vi.fn(); vi.stubGlobal('fetch', f);
 await expect(searchWeb('news', { ...settings, enabled: false })).rejects.toThrow('search-disabled');
 await expect(searchWeb('news', { ...settings, keys: { deepseek: '', brave: '' } })).rejects.toThrow('search-unconfigured');
 await expect(searchWeb('news', settings, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' }); expect(f).not.toHaveBeenCalled();
});
it('deduplicates tracking parameters and fragments without dropping meaningful query parameters', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [
 {title:'A',url:'https://example.com/a?utm_source=test'}, {title:'A again',url:'https://example.com/a#part'}, {title:'B',url:'https://example.com/a?page=2'}
 ] }))));
 expect((await searchWeb('evidence', settings)).map(r => r.title)).toEqual(['A','B']);
});
