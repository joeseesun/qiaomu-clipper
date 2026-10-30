import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

// Execute the actual background entry with API fixtures; no browser/profile access.
const source = readFileSync('src/background.ts', 'utf8');
const action = source.slice(source.indexOf('async function runTripleKeyAction('), source.indexOf('// With the toolbar button set'));
const compiled = ts.transpileModule(action, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function fixture(study = false) {
 const browser = { runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` }, tabs: { create: vi.fn().mockResolvedValue({ id: 99 }) }, storage: { local: { set: vi.fn() } } };
 const send = vi.fn().mockResolvedValue({ success: true }); // DOM insertion succeeds even when iframe loading is blocked.
 const openPopup = vi.fn().mockRejectedValue(new Error('No user gesture'));
 const openNoteCard = vi.fn(); const openStudyForTab = vi.fn().mockResolvedValue(study);
 const run = new Function('browser', 'openNoteCard', 'openStudyForTab', 'sendMessageToContentScript', 'openPopup', `${compiled}; return runTripleKeyAction;`)(browser, openNoteCard, openStudyForTab, send, openPopup);
 return { run, browser, send, openPopup, openStudyForTab, openNoteCard };
}
it.each(['read', 'edit', 'clip', 'writeSource'])('%s runs outside the host page, bound to its source even if frames and popups cannot open', async command => {
 const f = fixture(); await f.run(command, 42);
 expect(f.browser.tabs.create).toHaveBeenCalledTimes(1);
 const created = f.browser.tabs.create.mock.calls[0][0] as { url: string; openerTabId: number };
 const url = new URL(created.url);
 expect(url.pathname).toBe('/popup.html'); expect(url.searchParams.get('context')).toBe('shortcut');
 expect(url.searchParams.get('tabId')).toBe('42'); expect(url.searchParams.get('action')).toBe(command);
 expect(created.openerTabId).toBe(42); expect(f.send).not.toHaveBeenCalled(); expect(f.openPopup).not.toHaveBeenCalled();
 expect(f.browser.storage.local.set).not.toHaveBeenCalled();
});
it('preserves study, note and writing routes', async () => {
 const f = fixture(true); await f.run('read', 42); expect(f.openStudyForTab).toHaveBeenCalledWith(42); expect(f.browser.tabs.create).not.toHaveBeenCalled();
 await f.run('note', 42); expect(f.openNoteCard).toHaveBeenCalledWith(42);
 await f.run('write', 42); expect(f.browser.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://fixture/write.html?new=1', openerTabId: 42 });
});
