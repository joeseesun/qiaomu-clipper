// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://creator.xiaohongshu.com/publish/publish"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Listener = (message: any) => void;
let connect: (port: any) => void;
function port(name: string) {
 const messages: any[] = [], listeners: Listener[] = [];
 connect({ name, postMessage: (m: any) => messages.push(m), onMessage: { addListener: (fn: Listener) => listeners.push(fn) }, onDisconnect: { addListener: () => {} } });
 return { messages, send: (m: any) => listeners.forEach(fn => fn(m)) };
}
beforeEach(() => {
 vi.useFakeTimers(); vi.resetModules(); document.body.innerHTML = '';
 delete window.__qiaomuPublishXhs; delete window.__qiaomuPublishZhihu;
 vi.stubGlobal('chrome', { runtime: { onConnect: { addListener: (fn: any) => { connect = fn; } } } });
 vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body);
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 30 } as DOMRect);
 vi.stubGlobal('DataTransfer', class { files: any[] = []; items = { add: (file: any) => this.files.push(file) }; });
 vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function imageInput() {
 const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png';
 Object.defineProperty(input, 'files', { configurable: true, set: () => {} }); document.body.append(input); return input;
}
async function xhs() {
 document.body.innerHTML = '<div class="creator-tab">上传图文</div>';
 await import('./xhs-content');
 const p = port('qiaomu-publish-xhs');
 for (const source of ['one', 'two']) p.send({ type: 'image', source, base64: btoa('png'), mime: 'image/png', fileName: source + '.png' });
 return p;
}
const run = { type: 'run', title: 'Title', text: 'Body', topics: [], cards: ['one', 'two'] };
it('does not report success when only some requested Xiaohongshu images appear', async () => {
 const p = await xhs(); const input = imageInput();
 input.addEventListener('change', () => { document.body.insertAdjacentHTML('beforeend', '<input placeholder="标题"><div class="img-preview-area"><div class="pr"></div></div><div class="ProseMirror" contenteditable="true"></div>'); });
 Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });
 p.send(run); await vi.advanceTimersByTimeAsync(123000);
 expect(p.messages.some(m => m.type === 'done')).toBe(false);
 expect(p.messages.find(m => m.type === 'error')?.error).toMatch(/图片/);
});
it('does not upload after cancellation while waiting for the Xiaohongshu input', async () => {
 const p = await xhs(); p.send(run); await vi.advanceTimersByTimeAsync(10);
 p.send({ type: 'cancel' }); const uploaded = vi.fn(); imageInput().addEventListener('change', uploaded);
 await vi.advanceTimersByTimeAsync(1000);
 expect(uploaded).not.toHaveBeenCalled();
 expect(p.messages.some(m => m.type === 'cancelled')).toBe(true);
});
it('does not patch a Zhihu draft after cancellation during the final image request', async () => {
 await import('./zhihu-content'); const p = port('qiaomu-publish-zhihu');
 p.send({ type: 'image', source: 'qp-asset://one', base64: btoa('png'), mime: 'image/png', fileName: 'one.png' });
 const fetcher = vi.mocked(fetch).mockImplementation(async (url, init) => {
  const href = String(url);
  if (href.endsWith('/api/v4/me')) return new Response(JSON.stringify({ id: 'me' }));
  if (href.endsWith('/articles/drafts')) return new Response(JSON.stringify({ id: 'draft' }));
  if (href.endsWith('/images')) return new Response(JSON.stringify({ upload_file: { state: 1, image_id: 'one' } }));
  if (href.endsWith('/images/one')) { p.send({ type: 'cancel' }); return new Response(JSON.stringify({ original_hash: 'uploaded.png' })); }
  return new Response('{}');
 });
 p.send({ type: 'run', title: 'Title', html: '<p>Body</p><img src="qp-asset://one">', cover: '', summary: '' });
 await vi.advanceTimersByTimeAsync(100);
 expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
 expect(p.messages.some(m => m.type === 'cancelled')).toBe(true);
});

it('fills a complete Xiaohongshu draft without clicking publish', async () => {
 const p = await xhs(); const input = imageInput(); const publish = vi.fn();
 const button = document.createElement('button'); button.textContent = '发布'; button.addEventListener('click', publish); document.body.append(button);
 input.addEventListener('change', () => { document.body.insertAdjacentHTML('beforeend', '<input placeholder="标题"><div class="img-preview-area"><div class="pr"></div><div class="pr"></div></div><div class="ProseMirror" contenteditable="true"></div>'); });
 Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });
 p.send(run); await vi.advanceTimersByTimeAsync(1000);
 expect(p.messages.some(m => m.type === 'done')).toBe(true);
 expect((document.querySelector('[placeholder="标题"]') as HTMLInputElement).value).toBe('Title');
 expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'Body');
 expect(publish).not.toHaveBeenCalled();
});
