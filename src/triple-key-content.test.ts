// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
type Page = { window: Window & typeof globalThis };
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: Record<string, unknown>) => Page };

const script = buildSync({ entryPoints: ['src/triple-key-content.ts'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
const pages: Page[] = [];
afterEach(() => { pages.splice(0).forEach(page => page.window.close()); });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function page() {
 const dom = new JSDOM('<body><article>Article</article></body>', { url: 'https://mp.weixin.qq.com/s/fixture', runScripts: 'outside-only' });
 pages.push(dom);
 const press = (key: string, target = dom.window.document.body, init = {}) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init }));
 const triple = (key: string) => { press(key); press(key); press(key); };
 const inject = async (settings = {}, get?: Promise<unknown>) => {
  const changes = new Set<Function>();
  const api = { runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }, storage: {
   sync: { get: () => get ?? Promise.resolve({ general_settings: settings }) },
   onChanged: { addListener: (fn: Function) => changes.add(fn), removeListener: (fn: Function) => changes.delete(fn) },
  } };
  Object.assign(dom.window, { chrome: api }); dom.window.eval(script); await settle();
  return { api, changes };
 };
 return { dom, press, triple, inject };
}

it('replaces a dead runtime on reinjection without refreshing, once per command and across repeated reloads', async () => {
 const p = page(); let old = await p.inject(); p.triple('a'); expect(old.api.runtime.sendMessage).toHaveBeenCalledTimes(1);
 for (let reload = 0; reload < 3; reload++) {
  old.api.runtime.sendMessage.mockClear().mockImplementation(() => { throw new Error('Extension context invalidated'); });
  const fresh = await p.inject();
  for (const [key, command] of [['a','read'], ['e','edit'], ['q','clip'], ['i','note'], ['u','write'], ['y','writeSource']]) {
   p.triple(key); expect(fresh.api.runtime.sendMessage).toHaveBeenLastCalledWith({ action: 'qiaomuTripleKey', command });
  }
  expect(fresh.api.runtime.sendMessage).toHaveBeenCalledTimes(6);
  expect(old.api.runtime.sendMessage).not.toHaveBeenCalled(); expect(old.changes.size).toBe(0);
  old = fresh;
 }
});

it('does not carry a partial sequence or stale async settings into a replacement', async () => {
 const p = page(); let resolve!: (data: unknown) => void;
 const old = await p.inject({}, new Promise(done => { resolve = done; }));
 p.press('a'); p.press('a');
 const fresh = await p.inject({ tripleKeys: { read: 'r' } });
 resolve({ general_settings: { tripleKeyShortcuts: false } }); await settle();
 p.press('r'); expect(fresh.api.runtime.sendMessage).not.toHaveBeenCalled();
 p.press('r'); p.press('r'); expect(fresh.api.runtime.sendMessage).toHaveBeenCalledTimes(1);
 expect(old.api.runtime.sendMessage).not.toHaveBeenCalled();
});

it('keeps settings, site exclusions, text input and composition protections after reinjection', async () => {
 const p = page(); await p.inject(); const fresh = await p.inject({ tripleKeyShortcuts: false });
 p.triple('a'); expect(fresh.api.runtime.sendMessage).not.toHaveBeenCalled();
 const change = (value: unknown) => fresh.changes.forEach(fn => fn({ general_settings: { newValue: value } }, 'sync'));
 change({ tripleKeyBlockedSites: ['mp.weixin.qq.com'] }); p.triple('a'); expect(fresh.api.runtime.sendMessage).not.toHaveBeenCalled();
 change({});
 const input = p.dom.window.document.body.appendChild(p.dom.window.document.createElement('textarea'));
 for (let i = 0; i < 3; i++) { p.press('a', input); p.press('a', undefined, { isComposing: true }); p.press('a', undefined, { repeat: true }); }
 expect(fresh.api.runtime.sendMessage).not.toHaveBeenCalled();
 p.triple('a'); p.triple('a'); expect(fresh.api.runtime.sendMessage).toHaveBeenCalledTimes(2);
});
