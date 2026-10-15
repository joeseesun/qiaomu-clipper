// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { articleImages, ChatImageSession, imageTiles, MAX_SELECTED_IMAGES } from './chat-images';
import { readPageChatImage, handleChatImageSource } from './chat-image-source';
import browser from './browser-polyfill';

const PNG = 'data:image/png;base64,aGVsbG8=';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('extracts only markdown body images, in order, including reference images and HTML, without loading them', () => {
 document.body.innerHTML = '<img src="https://site.test/avatar.png">';
 const images = articleImages('![A](/a.png?sig=keep)\n![again](/a.png?sig=keep)\n![B][b]\n\n[b]: https://cdn.test/b.webp\n\n<img src="/c.avif" alt="C">\n\n```html\n<img src="/code.png">\n```\n![bad](file:///tmp/private.png)', 'https://site.test/note');
 expect(images.map(i => [i.index, i.url, i.alt])).toEqual([[1, 'https://site.test/a.png?sig=keep', 'A'], [2, 'https://cdn.test/b.webp', 'B'], [3, 'https://site.test/c.avif', 'C']]);
 expect(document.images).toHaveLength(1);
});

it('keeps inline raster images, removes SVG, script URLs and credential-bearing links', () => {
 expect(articleImages(`![ok](${PNG})\n![bad](data:image/svg+xml;base64,YQ==)\n![bad](https://u:p@site.test/a.png)\n<img src="javascript:alert(1)">`, 'https://site.test').map(i => i.url)).toEqual([PNG]);
});

it('tiles a long screenshot without gaps, keeps width legible and covers the bottom', () => {
 const tiles = imageTiles(1000, 8500);
 expect(tiles.length).toBeGreaterThan(4);
 expect(tiles[0]).toMatchObject({ y: 0, width: 1000, scale: 1 });
 for (let i = 1; i < tiles.length; i++) expect(tiles[i].y).toBeLessThan(tiles[i - 1].y + tiles[i - 1].height);
 expect(tiles[tiles.length - 1].y + tiles[tiles.length - 1].height).toBe(8500);
 expect(imageTiles(4000, 3000)).toHaveLength(1);
 expect(() => imageTiles(10000, 10000)).toThrow();
});

function imaging() {
 vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 600, close: vi.fn() }));
 vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as any);
 vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
}

it('reuses successfully read bytes in one session and retries a failed image without saving files', async () => {
 imaging();
 const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })).mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(new Response(new Uint8Array([2]), { headers: { 'content-type': 'image/png' } }));
 vi.stubGlobal('fetch', fetch); vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ dataUrl: null });
 const store = vi.spyOn(browser.storage.local, 'set');
 const session = new ChatImageSession(), images = articleImages('![1](https://site.test/1.png)\n![2](https://site.test/2.png)', 'https://site.test');
 const signal = new AbortController().signal;
 const first = await session.read(images, 'https://site.test/note', signal);
 expect(first.ready).toEqual([1]); expect(first.failed).toEqual([2]);
 const retry = await session.read(images, 'https://site.test/note', signal);
 expect(retry.ready).toEqual([1, 2]); expect(retry.images.map(i => i.label)).toEqual(['图 1', '图 2']);
 expect(fetch).toHaveBeenCalledTimes(3); expect(store).not.toHaveBeenCalled();
 session.clear();
});

it('does not fetch a silently truncated subset and respects cancellation', async () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 const session = new ChatImageSession();
 await expect(session.read(Array.from({ length: MAX_SELECTED_IMAGES + 1 }, (_, i) => ({ url: `https://s.test/${i}`, index: i + 1, alt: '' })), 'https://s.test', new AbortController().signal)).rejects.toThrow();
 const stop = new AbortController(); stop.abort();
 await expect(session.read([{url:'https://s.test/i',index:1,alt:''}], 'https://s.test', stop.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(fetch).not.toHaveBeenCalled();
});

it('rejects non-image responses before decoding', async () => {
 const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })));
 vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({dataUrl:null});
 const result = await new ChatImageSession().read([{url:'https://s.test/i',index:1,alt:''}], 'https://s.test', new AbortController().signal);
 expect(result.failed).toEqual([1]); expect(decode).not.toHaveBeenCalled();
});

it('serializes the real page reader without imported helpers and refuses URLs not present on the page', async () => {
 const injected = new Function(`return (${readPageChatImage.toString()})`)();
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 expect(await injected(location.href, 'https://site.test/private')).toBeNull();
 expect(fetch).not.toHaveBeenCalled();
});

it('does not allow a content script or an unrelated extension page to use the source-page bridge', async () => {
 const query = vi.spyOn(browser.tabs, 'query');
 for (const url of ['https://site.test/note', browser.runtime.getURL('side-panel.html')]) {
  expect(await handleChatImageSource({ action:'qiaomuChatImageSource', sourceUrl:'https://site.test/note',imageUrl:'https://site.test/i.png'}, {id:browser.runtime.id,url})).toEqual({dataUrl:null});
 }
 expect(query).not.toHaveBeenCalled();
});

it('keeps the production ES2015-injected function self-contained on the fetch path', async () => {
 const ts = await import('typescript');
 const compiled = ts.transpile(`const readImage = ${readPageChatImage.toString()};`, { target: ts.ScriptTarget.ES2015 });
 const fn = new Function(`${compiled}; return readImage;`)();
 const injected = new Function(`return (${fn.toString()});`)();
 document.body.innerHTML = '<img src="https://site.test/i.png">';
 const fetch = vi.fn().mockRejectedValue(new Error('fixture CORS'));vi.stubGlobal('fetch', fetch);
 expect(await injected(location.href, 'https://site.test/i.png')).toBeNull();expect(fetch).toHaveBeenCalledOnce();
});

it('keeps image positions but never includes inline image bytes in the text prompt', async () => {
 const { imageAwareArticle } = await import('./chat-images');
 const markdown = `Before\n\n![a](${PNG})\n\nAfter\n\n<img src="https://site.test/image?secret=signature">`;
 const context = imageAwareArticle(markdown, 'https://site.test', articleImages(markdown, 'https://site.test'));
 expect(context).toContain('[图 1]');expect(context).toContain('[图 2]');
 expect(context).not.toContain('base64');expect(context).not.toContain('secret=');
 expect(context.indexOf('Before')).toBeLessThan(context.indexOf('[图 1]'));expect(context.indexOf('After')).toBeGreaterThan(context.indexOf('[图 1]'));
});
