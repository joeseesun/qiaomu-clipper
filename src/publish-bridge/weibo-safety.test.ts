// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let connect: (port: any) => void;
function port(name: string) {
 const messages: any[] = []; let listener: (message: any) => void;
 connect({ name, postMessage: (m: any) => messages.push(m), onMessage: { addListener: (fn: any) => { listener = fn; } }, onDisconnect: { addListener() {} } });
 return { messages, send: (m: any) => listener(m) };
}
beforeEach(() => {
 vi.resetModules(); vi.useFakeTimers(); document.body.innerHTML = '';
 (window as any).ERR_UID = '123';
 document.documentElement.setAttribute('data-qm-uid', '123');
 delete window.__qiaomuPublishWeibo; delete window.__qiaomuPublishWeiboArticle;
 vi.stubGlobal('chrome', { runtime: { onConnect: { addListener: (fn: any) => { connect = fn; } } } });
 vi.stubGlobal('location', { hostname: 'weibo.com', href: 'https://weibo.com/', hash: '' });
 vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body);
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 30 } as DOMRect);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const post = { type: 'run', text: 'New post', topics: [], images: [] };
it('never writes a post into a comment textarea', async () => {
 document.body.innerHTML = '<textarea placeholder="评论"></textarea>';
 await import('./weibo-content'); const p = port('qiaomu-publish-weibo'); p.send(post);
 await vi.advanceTimersByTimeAsync(21000);
 expect(document.querySelector('textarea')!.value).toBe('');
 expect(p.messages.some(m => m.type === 'done')).toBe(false);
});
it('preserves an existing composer draft', async () => {
 document.body.innerHTML = '<div class="compose"><textarea placeholder="有什么新鲜事">My draft</textarea></div>';
 await import('./weibo-content'); const p = port('qiaomu-publish-weibo'); p.send(post);
 await vi.advanceTimersByTimeAsync(500);
 expect(document.querySelector('textarea')!.value).toBe('My draft');
 expect(p.messages.some(m => m.type === 'error')).toBe(true);
});
it('does not use an avatar upload input outside the composer', async () => {
 document.body.innerHTML = '<input type="file" accept="image/*"><div class="compose"><textarea placeholder="有什么新鲜事"></textarea></div>';
 const upload = vi.fn(); const input = document.querySelector('input')!;
 Object.defineProperty(input, 'files', { set: upload });
 vi.stubGlobal('DataTransfer', class { files: any[] = []; items = { add: (file: any) => this.files.push(file) }; });
 await import('./weibo-content'); const p = port('qiaomu-publish-weibo');
 p.send({ type: 'image', source: 'qp-asset://one', base64: btoa('png'), mime: 'image/png', fileName: 'one.png' });
 p.send({ ...post, images: ['qp-asset://one'] }); await vi.advanceTimersByTimeAsync(21500);
 expect(upload).not.toHaveBeenCalled();
});
async function article() {
 vi.stubGlobal('location', { hostname: 'card.weibo.com', href: 'https://card.weibo.com/article/v5/editor', hash: '' });
 await import('./weibo-article-content'); return port('qiaomu-publish-weibo-article');
}
const articleRun = { type: 'run', title: 'Title', html: '<p>Body</p>', cover: '', summary: '' };
it('does not save or report success after cancellation during draft creation', async () => {
 const p = await article();
 const fetcher = vi.fn(async (url: any) => {
  if (String(url).endsWith('/editor')) return { ok: true, text: async () => 'ERR_UID = 123' };
  if (String(url).includes('/draft/create')) { p.send({ type: 'cancel' }); return { ok: true, json: async () => ({ data: { id: 'draft' } }) }; }
  return { ok: true, json: async () => ({ code: 100000 }) };
 }); vi.stubGlobal('fetch', fetcher);
 p.send(articleRun); await vi.advanceTimersByTimeAsync(100);
 expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/draft/save'))).toHaveLength(0);
 expect(p.messages.some(m => m.type === 'done')).toBe(false);
 expect(p.messages.some(m => m.type === 'cancelled')).toBe(true);
});
it('does not silently require following the author to read a draft', async () => {
 const p = await article(); let saved: FormData | undefined;
 vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
  if (String(url).endsWith('/editor')) return { ok: true, text: async () => 'ERR_UID = 123' };
  if (String(url).includes('/draft/create')) return { ok: true, json: async () => ({ data: { id: 'draft' } }) };
  saved = init.body; return { ok: true, json: async () => ({ code: 100000 }) };
 }));
 p.send(articleRun); await vi.advanceTimersByTimeAsync(100);
 expect(p.messages.filter(m => m.type === 'error')).toEqual([]);
 expect(saved!.get('follow_to_read')).toBe('0');
 expect(p.messages.some(m => m.type === 'done')).toBe(true);
});
