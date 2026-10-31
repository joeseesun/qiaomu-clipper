// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mountChatHistoryView } from './chat-history-view';
import { saveConversation, deleteConversation, clearChatHistory, historyCleanupStatus, listChatHistory } from './chat-history';
import { idbDone } from './chat-history-media';
let view: ReturnType<typeof mountChatHistoryView>, root: HTMLDivElement, trigger: HTMLButtonElement;
const imageId = 'chat-image-00000000-0000-0000-0000-000000000001';
const button = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text)!;
const remove = () => root.querySelector<HTMLButtonElement>('.clip-chat-history-item .clip-chat-icon')!;
async function mount() {
 root = document.createElement('div'); root.hidden = true; trigger = document.createElement('button'); document.body.append(trigger, root);
 view = mountChatHistoryView(root, trigger, { beforeOpen() {}, onOpen() {}, onDelete: i => deleteConversation(i.source.url, i.id), onClear: clearChatHistory, isCurrent: () => false });
 view.toggle(); await vi.waitFor(() => expect(root.querySelectorAll('.clip-chat-history-open')).toHaveLength(2));
}
beforeEach(async () => {
 vi.stubGlobal('indexedDB', new IDBFactory()); document.body.replaceChildren();
 for (const id of ['A', 'B']) await saveConversation(`https://${id.toLowerCase()}.test/`, id, { id, title: `Question ${id}`, updatedAt: 0, messages: [{ role: 'user', content: id, ...(id === 'A' ? { attachments: [{ id: imageId, name: 'image.png' }] } : {}) }] });
});
afterEach(() => { view?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('clear-all explicitly covers every page even when searched, and Cancel/Escape never delete', async () => {
 await mount(); const search = root.querySelector<HTMLInputElement>('input')!; search.value = 'Question A'; search.dispatchEvent(new Event('input'));
 await vi.waitFor(() => expect(root.querySelectorAll('.clip-chat-history-open')).toHaveLength(1));
 button('清空历史').click(); expect(root.textContent).toContain('所有网页的全部对话历史'); expect(root.textContent).toContain('图库素材和设置会保留');
 button('取消').click(); expect((await listChatHistory()).items).toHaveLength(2);
 button('清空历史').click(); root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(root.hidden).toBe(false); expect((await listChatHistory()).items).toHaveLength(2);
 await vi.waitFor(() => expect(root.querySelectorAll('.clip-chat-history-open')).toHaveLength(1));
 button('清空历史').click(); button('确认删除').click(); await vi.waitFor(async () => expect((await listChatHistory()).items).toEqual([]));
 await vi.waitFor(() => expect(root.querySelectorAll('.clip-chat-history-open')).toHaveLength(0));
});
it('shows durable cleanup failure and a working retry even after the history view is destroyed and reopened', async () => {
 const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('qiaomu-chat-attachments'); req.onupgradeneeded = () => { req.result.createObjectStore('images'); req.result.createObjectStore('previews'); }; req.onsuccess = () => resolve(req.result); });
 const tx = db.transaction(['images', 'previews'], 'readwrite'), finished = idbDone(tx); for (const name of ['images', 'previews']) tx.objectStore(name).put('bytes', imageId); await finished; db.close();
 await mount(); const search = root.querySelector<HTMLInputElement>('input')!; search.value = 'Question A'; search.dispatchEvent(new Event('input')); await vi.waitFor(() => expect(root.querySelectorAll('.clip-chat-history-open')).toHaveLength(1));
 const original = IDBObjectStore.prototype.delete;
 const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) { if (this.transaction.db.name === 'qiaomu-chat-attachments') throw new Error('unavailable'); return original.call(this, key); });
 remove().click(); button('确认删除').click();
 await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.clip-chat-history-cleanup')!.hidden).toBe(false));
 await vi.waitFor(() => expect(button('重试清理').hidden).toBe(false)); expect((await listChatHistory()).items.map(i => i.id)).toEqual(['B']);
 view.destroy(); root.remove(); trigger.remove();
 root = document.createElement('div'); root.hidden = true; trigger = document.createElement('button'); document.body.append(trigger, root);
 view = mountChatHistoryView(root, trigger, { beforeOpen() {}, onOpen() {}, onDelete: i => deleteConversation(i.source.url, i.id), onClear: clearChatHistory, isCurrent: () => false }); view.toggle();
 await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.clip-chat-history-cleanup')!.hidden).toBe(false));
 fault.mockRestore(); button('重试清理').click(); await vi.waitFor(async () => expect(await historyCleanupStatus()).toEqual({ pending: 0 }));
 await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.clip-chat-history-cleanup')!.hidden).toBe(true)); expect((await listChatHistory()).items.map(i => i.id)).toEqual(['B']);
});
