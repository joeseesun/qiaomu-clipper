import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: {} as Record<string, any>, removeFails: false }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: {
 get: async (keys: string | string[] | null) => structuredClone(keys === null ? state.values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in state.values).map(k => [k, state.values[k]]))),
 set: async (value: object) => Object.assign(state.values, value),
 remove: async (keys: string | string[]) => { if (state.removeFails) throw new Error('storage failure'); for (const key of Array.isArray(keys) ? keys : [keys]) delete state.values[key]; },
} } } }));
import { saveConversation, deleteConversation, clearChatHistory, retryHistoryCleanup, historyCleanupStatus, readConversation, listChatHistory, chatKey, type Conversation } from './chat-history';
import { idbRequest as request, idbDone as done } from './chat-history-media';
const A = 'https://a.test/', B = 'https://b.test/';
const image = (n: number) => `chat-image-00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const chat = (id: string, uploads: number[] = [], generated: string[] = []): Conversation => ({ id, title: id, updatedAt: 0, messages: [
 { role: 'user', content: `Private ${id}`, attachments: uploads.map(n => ({ id: image(n), name: 'upload.png' })) },
 { role: 'assistant', content: 'Answer', generatedImages: generated.map(imageId => ({ imageId, prompt: 'test', aspect: 'auto' })) },
] });
async function open(name: string, stores: string[]) {
 return new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(name); req.onupgradeneeded = () => stores.forEach(s => req.result.createObjectStore(s)); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function seed(name: string, values: Record<string, Record<string, any>>) {
 const db = await open(name, Object.keys(values));
 try { const tx = db.transaction(Object.keys(values), 'readwrite'), complete = done(tx); for (const [store, records] of Object.entries(values)) for (const [key, value] of Object.entries(records)) tx.objectStore(store).put(value, key); await complete; } finally { db.close(); }
}
async function keys(name: string, store: string) { const db = await open(name, []); try { return await request(db.transaction(store).objectStore(store).getAllKeys()); } finally { db.close(); } }
async function uploads(...ids: number[]) { await seed('qiaomu-chat-attachments', { images: Object.fromEntries(ids.map(n => [image(n), new Blob(['image bytes'])])), previews: Object.fromEntries(ids.map(n => [image(n), new Blob(['preview bytes'])])) }); }
beforeEach(() => { state.values = {}; state.removeFails = false; vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('deletes the selected body, summary, unused upload and preview, preserving other chats and shared images', async () => {
 await uploads(1, 2, 3); await saveConversation(A, 'A', chat('same', [1, 2])); await saveConversation(B, 'B', chat('same', [2]));
 state.values.settings = { model: 'private-setting' };
 await deleteConversation(A, 'same');
 expect(await readConversation(A, 'same')).toBeUndefined(); expect((await listChatHistory()).items.map(i => i.pageKey)).toEqual([B]);
 expect((await readConversation(B, 'same'))?.messages[0].content).toBe('Private same');
 expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([image(2), image(3)]);
 expect(await keys('qiaomu-chat-attachments', 'previews')).toEqual([image(2), image(3)]);
 expect(state.values.settings).toEqual({ model: 'private-setting' }); expect(await historyCleanupStatus()).toEqual({ pending: 0 });
});
it('preserves gallery ownership, jobs and folders, and other-chat references while removing only orphan generated blobs', async () => {
 await seed('qiaomu-chat-images', { images: { gallery: new Blob(['gallery']), job: new Blob(['job']), shared: new Blob(['shared']), orphan: new Blob(['orphan']), unrelated: new Blob(['unrelated']) },
 entries: { gallery: { id: 'gallery', source: 'generated' } }, jobs: { job1: { id: 'job1', imageId: 'job' } }, folders: { folder: { path: 'original-folder' } } });
 await saveConversation(A, 'A', chat('a', [], ['gallery', 'job', 'shared', 'orphan'])); await saveConversation(B, 'B', chat('b', [], ['shared']));
 await deleteConversation(A, 'a');
 expect(await keys('qiaomu-chat-images', 'images')).toEqual(['gallery', 'job', 'shared', 'unrelated']);
 expect(await keys('qiaomu-chat-images', 'entries')).toEqual(['gallery']); expect(await keys('qiaomu-chat-images', 'jobs')).toEqual(['job1']); expect(await keys('qiaomu-chat-images', 'folders')).toEqual(['folder']);
 await clearChatHistory(); expect(await keys('qiaomu-chat-images', 'images')).toEqual(['gallery', 'job', 'unrelated']);
});
it('records image cleanup failure durably and retries after reopening the module without touching a newly shared image', async () => {
 await uploads(1, 2); await saveConversation(A, 'A', chat('a', [1, 2]));
 const original = IDBObjectStore.prototype.delete;
 const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) { if (this.transaction.db.name === 'qiaomu-chat-attachments') throw new Error('disk unavailable'); return original.call(this, key); });
 await expect(deleteConversation(A, 'a')).rejects.toThrow('重试清理');
 expect(await readConversation(A, 'a')).toBeUndefined(); expect(await historyCleanupStatus()).toEqual({ pending: 1 });
 expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([image(1), image(2)]);
 fault.mockRestore(); await saveConversation(B, 'B', chat('new', [2]));
 vi.resetModules(); const reloaded = await import('./chat-history'); await reloaded.retryHistoryCleanup();
 expect(await reloaded.historyCleanupStatus()).toEqual({ pending: 0 }); expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([image(2)]);
 expect(await reloaded.readConversation(B, 'new')).toBeDefined();
});
it('never reports image cleanup success if the deletion transaction aborts', async () => {
 await uploads(1); await saveConversation(A, 'A', chat('a', [1]));
 const original = IDBObjectStore.prototype.delete;
 const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) { const result = original.call(this, key); if (this.transaction.db.name === 'qiaomu-chat-attachments') this.transaction.abort(); return result; });
 await expect(deleteConversation(A, 'a')).rejects.toThrow('重试清理');
 fault.mockRestore(); expect(await historyCleanupStatus()).toEqual({ pending: 1 }); await retryHistoryCleanup(); expect(await keys('qiaomu-chat-attachments', 'previews')).toEqual([]);
});
it('makes migration cleanup failures visible and retryable instead of retaining a silent legacy duplicate', async () => {
 const key = chatKey(A); state.values[key] = { url: A, conversations: [chat('a', [1])] }; state.values.qiaomuChatIndex = [{ key }]; state.values.settings = 'keep';
 state.removeFails = true; expect((await listChatHistory()).items).toHaveLength(1); expect(state.values[key]).toBeDefined(); expect(await historyCleanupStatus()).toEqual({ pending: 1 });
 state.removeFails = false; await retryHistoryCleanup(); expect(state.values).toEqual({ settings: 'keep' }); expect(await readConversation(A, 'a')).toBeDefined();
});
it('removes selected copies from partially malformed legacy pages while preserving unrelated legacy content and its images', async () => {
 const key = chatKey(A); const broken = { id: 'broken', messages: [null, { attachments: [{ id: image(2), name: 'shared.png' }] }] };
 state.values[key] = { url: A, title: 'mixed', conversations: [chat('a', [1, 2]), broken] }; state.values.qiaomuChatIndex = [{ key }];
 await uploads(1, 2); await listChatHistory(); await deleteConversation(A, 'a');
 expect(state.values[key].conversations).toEqual([broken]); expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([image(2)]);
 expect(await historyCleanupStatus()).toEqual({ pending: 0 });
});
it('clear-all retries only the captured selection and never deletes history created after a failure', async () => {
 await uploads(1, 2); const a = chat('old', [1]); await saveConversation(A, 'A', a); await saveConversation(B, 'B', chat('old-b', [2]));
 const key = chatKey(A); state.values[key] = { url: A, conversations: [chat('old', [1])] }; state.values.settings = 'keep'; state.removeFails = true;
 await expect(clearChatHistory()).rejects.toThrow('重试清理'); expect((await listChatHistory()).items).toEqual([]);
 const newer = chat('new', [2]); await saveConversation(B, 'B', newer); state.values[key].conversations.push(chat('new-legacy', [2]));
 state.removeFails = false; await retryHistoryCleanup();
 expect((await listChatHistory()).items.map(i => i.id)).toEqual(['new']); expect(state.values[key].conversations.map((c: Conversation) => c.id)).toEqual(['new-legacy']);
 expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([image(2)]); expect(state.values.settings).toBe('keep');
 await expect(saveConversation(A, 'A', a)).rejects.toThrow('删除');
});
it('clear-all removes all history and old-format copies, including malformed copies, but preserves settings and gallery', async () => {
 await saveConversation(A, 'A', chat('a')); await saveConversation(B, 'B', chat('b'));
 state.values['qiaomuChat:unknown'] = { invalid: 'OLD PRIVATE DATA' }; state.values.qiaomuChatIndex = ['legacy']; state.values.qiaomuChatModel = 'keep';
 await clearChatHistory(); expect((await listChatHistory()).items).toEqual([]); expect(state.values).toEqual({ qiaomuChatModel: 'keep' }); expect(await historyCleanupStatus()).toEqual({ pending: 0 });
});
it('cleans dropped attachment references during saves with the same durable retry path', async () => {
 await uploads(1); const c = chat('a', [1]); await saveConversation(A, 'A', c); c.messages[0].attachments = [];
 await saveConversation(A, 'A', c); expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([]); expect((await readConversation(A, 'a'))?.revision).toBe(2);
});
it('backfills reference indexes when upgrading v1, preserving another conversation sharing an upload', async () => {
 const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('qiaomu-chat-history', 1); req.onupgradeneeded = () => {
  const c = req.result.createObjectStore('conversations', { keyPath: ['pageKey', 'id'] }); c.createIndex('page', 'pageKey');
  const s = req.result.createObjectStore('summaries', { keyPath: ['pageKey', 'id'] }); s.createIndex('recent', ['updatedAt', 'pageKey', 'id']); s.createIndex('pageRecent', ['pageKey', 'updatedAt', 'id']); req.result.createObjectStore('meta');
 }; req.onsuccess = () => resolve(req.result); });
 const tx = db.transaction(['conversations', 'meta'], 'readwrite'), complete = done(tx); tx.objectStore('meta').put(true, 'legacy-imported');
 for (const url of [A, B]) tx.objectStore('conversations').put({ pageKey: url, id: 'same', conversation: { ...chat('same', [1]), source: { url, title: url }, revision: 1 } });
 await complete; db.close(); await uploads(1); await deleteConversation(A, 'same'); expect(await keys('qiaomu-chat-attachments', 'images')).toEqual([image(1)]);
});
