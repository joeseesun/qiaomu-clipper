import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readShortcutContext } from './shortcut-context';

it('keeps independent source/action pairs and rejects malformed shortcut links', () => {
 expect(readShortcutContext('?context=shortcut&tabId=42&action=read')).toEqual({ tabId: 42, action: 'read' });
 expect(readShortcutContext('?context=shortcut&tabId=73&action=edit')).toEqual({ tabId: 73, action: 'edit' });
 expect(readShortcutContext('?context=shortcut&tabId=42&action=writeSource')).toEqual({ tabId: 42, action: 'writeSource' });
 for (const search of ['', '?tabId=42&action=read', '?context=shortcut&tabId=0&action=read', '?context=shortcut&tabId=-1&action=read', '?context=shortcut&tabId=42&action=write', '?context=shortcut&tabId=1.5&action=read']) expect(readShortcutContext(search)).toBeUndefined();
});

// Exercise the actual consumer after a slow extraction, without loading a user browser.
const popup = readFileSync('src/core/popup.ts', 'utf8');
const consumer = popup.slice(popup.indexOf('async function consumePendingAction()'), popup.indexOf('function setupEventListeners('));
const compiled = ts.transpileModule(consumer, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(action: string, handler = vi.fn().mockResolvedValue(undefined)) {
 const browser = { storage: { local: { get: vi.fn().mockResolvedValue({ qiaomuPendingAction: { action: 'edit', at: 0 } }), remove: vi.fn() } } };
 const close = vi.fn(), clip = vi.fn();
 const consume = new Function('shortcutContext', 'shortcutHandler', 'currentTemplate', 'browser', 'window', 'handleClipObsidian', 'getMessage', `let shortcutConsumed = false; ${compiled}; return consumePendingAction;`)({ action, tabId: 42 }, handler, {}, browser, { close }, clip, (key: string) => key);
 return { consume, close, clip, browser, handler };
}
it.each(['read', 'edit'])('executes %s exactly once after content is ready, without expiring or stealing another action', async action => {
 const f = fixture(action); await f.consume(); await f.consume();
 expect(f.handler).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1); expect(f.browser.storage.local.get).not.toHaveBeenCalled(); expect(f.browser.storage.local.remove).not.toHaveBeenCalled();
});
it('keeps the action page open on a failure so its error can be read', async () => {
 const f = fixture('read', vi.fn().mockRejectedValue(new Error('Extraction failed')));
 await expect(f.consume()).rejects.toThrow('Extraction failed'); expect(f.close).not.toHaveBeenCalled();
});
it('runs clipping once and leaves save/error handling to the existing clip pipeline', async () => {
 const f = fixture('clip'); await f.consume(); await f.consume(); expect(f.clip).toHaveBeenCalledTimes(1); expect(f.close).not.toHaveBeenCalled();
});

function previewHandler(kind: 'Reader' | 'Editor', action = kind === 'Reader' ? 'read' : 'edit') {
 const start = popup.indexOf(`    const open${kind} = async () => {`);
 const end = popup.indexOf(`    document.getElementById('${kind === 'Reader' ? 'preview-clip' : 'open-editor'}')?.addEventListener`, start);
 const code = ts.transpileModule(popup.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const fields: Record<string, any> = {
  'preview-clip': {}, 'open-editor': {}, 'note-content-field': { value: 'Article body' }, 'note-name-field': { value: 'Article title' },
  'path-name-field': { value: 'Notes' }, 'vault-select': { value: 'V' }, 'qiaomu-rss-enabled': { checked: false }, 'clip-action-status': {},
 };
 const send = vi.fn().mockResolvedValue({ opened: false }), preview = vi.fn().mockResolvedValue(undefined);
 const args = { browser: { runtime: { sendMessage: send } }, currentTabId: 42, window: { close: vi.fn() }, currentTemplate: { behavior: 'create' },
  document: { getElementById: (id: string) => fields[id] }, getCurrentTabInfo: async () => ({ url: 'https://mp.weixin.qq.com/s/source' }), getPropertiesFromDOM: () => [],
  generateFrontmatter: async () => '---\n---\n', openClipPreview: preview, sanitizeFileName: (name: string) => name, crypto: { randomUUID: () => 'draft' }, nativeLocalSave: false, shortcutContext: { tabId: 42, action },
 };
 const handler = new Function(...Object.keys(args), `${code}; return open${kind};`)(...Object.values(args));
 return { handler, send, preview, fields };
}
it.each(['Reader', 'Editor'] as const)('awaits the actual %s preview before closing and preserves the original article', async kind => {
 const p = previewHandler(kind); let finish!: () => void;
 p.preview.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
 const f = fixture(kind === 'Reader' ? 'read' : 'edit', p.handler); const done = f.consume();
 for (let i = 0; i < 15; i++) await Promise.resolve();
 expect(p.preview).toHaveBeenCalledWith(expect.objectContaining({ clip: expect.objectContaining({ url: 'https://mp.weixin.qq.com/s/source', markdown: 'Article body' }) }), ...(kind === 'Editor' ? ['editor.html?id='] : []));
 expect(f.close).not.toHaveBeenCalled(); finish(); await done; expect(f.close).toHaveBeenCalledTimes(1);
 if (kind === 'Reader') expect(p.send).toHaveBeenCalledWith({ action: 'qiaomuOpenStudy', tabId: 42 });
});
it('shows a preview failure and keeps the source action page available', async () => {
 const p = previewHandler('Reader'); p.preview.mockRejectedValue(new Error('Storage unavailable'));
 const f = fixture('read', p.handler); await expect(f.consume()).rejects.toThrow('Storage unavailable');
 expect(p.fields['clip-action-status'].textContent).toContain('Storage unavailable'); expect(f.close).not.toHaveBeenCalled(); expect(p.fields['preview-clip'].disabled).toBe(false);
});
it('YYY opens the normal reader with a writer handoff and the same source content, while UUU remains a blank article route', async () => {
 const p = previewHandler('Reader', 'writeSource'); const f = fixture('writeSource', p.handler); await f.consume();
 expect(p.preview).toHaveBeenCalledWith(expect.objectContaining({ clip: { url: 'https://mp.weixin.qq.com/s/source', title: 'Article title', markdown: 'Article body', image: undefined } }), 'reader.html?write=1&preview=');
 expect(p.send).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
});
