import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown>, get: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: {
 get: (...args: unknown[]) => state.get(...args),
 remove: async (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]).forEach(k => delete state.store[k]),
 set: async (values: Record<string, unknown>) => Object.assign(state.store, values),
} } } }));
import { chatKey, loadConversations, saveConversation, deleteConversation, listChatHistory, readConversation, type Conversation } from './chat-history';
const chat = (id: string, title = 'Question'): Conversation => ({ id, title, updatedAt: 0, messages: [{ role: 'user', content: title, quote: 'selected passage' }, { role: 'assistant', content: 'Answer' }] });
beforeEach(() => { state.store = {}; state.get.mockReset().mockImplementation(async () => structuredClone(state.store)); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());

it('lists across pages without loading messages or saving original page content', async () => {
 const a = chat('a'); a.source = { url: 'https://a.test/#section', title: 'A', markdown: 'DO NOT SAVE ORIGINAL PAGE' } as any;
 await saveConversation('https://a.test/', 'A', a); await saveConversation('https://b.test/', 'B', chat('b'));
 const list = await listChatHistory(); expect(list.items).toHaveLength(2);
 expect(list.items.every(item => !('messages' in item))).toBe(true); expect(JSON.stringify(list)).not.toContain('DO NOT SAVE');
 const restored = await readConversation('https://a.test/', 'a');
 expect(restored?.source).toEqual({ url: 'https://a.test/#section', title: 'A', preserveUrlHash: false });
 expect(restored?.messages[0].quote).toBe('selected passage');
 expect((await loadConversations('https://a.test/#other')).map(c => c.id)).toEqual(['a']);
});
it('migrates legacy pages once, retaining links and messages and removing duplicate metadata', async () => {
 const old = chat('old');
 const key = chatKey('https://old.test/#/route', true);
 state.store[key] = { url: 'https://old.test/#/route', title: 'Old page', conversations: [old] };
 state.store.qiaomuChatIndex = [{ key }]; state.store.qiaomuChatModel = 'model-not-history';
 const first = await listChatHistory(); expect(first.items).toHaveLength(1);
 expect((await loadConversations('https://old.test/#/route', true))[0].messages).toEqual(old.messages);
 expect(await loadConversations('https://old.test/#/different', true)).toEqual([]);
 expect(state.store).toEqual({ qiaomuChatModel: 'model-not-history' });
 await deleteConversation('https://old.test/#/route', 'old', true);
 state.store[key] = { url: 'https://old.test/#/route', conversations: [old] };
 const reads = state.get.mock.calls.length;
 expect((await listChatHistory()).items).toEqual([]); expect(state.get).toHaveBeenCalledTimes(reads);
});
it('pages tied timestamps without duplicates and searches titles, pages and URLs', async () => {
 vi.spyOn(Date, 'now').mockReturnValue(1234);
 try {
  for (let i = 0; i < 85; i++) await saveConversation(`https://page${i}.test/`, `Page ${i}`, chat(String(i), `Question ${i}`));
  let before: any, found: string[] = [];
  do { const result = await listChatHistory('', before); expect(result.items.length).toBeLessThanOrEqual(40); found.push(...result.items.map(i => i.id)); before = result.next; } while (before);
  expect(new Set(found).size).toBe(85);
  expect((await listChatHistory('page42.test')).items.map(i => i.id)).toEqual(['42']);
  expect((await listChatHistory('Question 84')).items.map(i => i.id)).toEqual(['84']);
 } finally { vi.restoreAllMocks(); }
});
it('retains older messages, conversations and pages without automatic eviction', async () => {
 const first = chat('first'); first.messages.push(...Array.from({ length: 100 }, (_, i) => ({ role: 'user' as const, content: `turn ${i}` })));
 await saveConversation('https://first.test/', 'First', first);
 for (let i = 0; i < 18; i++) await saveConversation('https://first.test/', 'First', chat(`more-${i}`));
 for (let i = 0; i < 42; i++) await saveConversation(`https://new${i}.test/`, 'New', chat('one'));
 expect((await readConversation('https://first.test/', 'first'))?.messages).toHaveLength(102);
 expect(await loadConversations('https://first.test/')).toHaveLength(19);
 expect(await loadConversations('https://first.test/', false, true)).toHaveLength(1);
});
it('orders snapshots, rejects stale writers and cannot resurrect deleted chats', async () => {
 const one = chat('one'); const first = saveConversation('https://a.test/', 'A', one);
 one.messages[0].content = 'second'; const second = saveConversation('https://a.test/', 'A', one); one.messages[0].content = 'unsaved';
 await Promise.all([first, second]);
 const a = (await readConversation('https://a.test/', 'one'))!, b = structuredClone(a);
 expect(a.messages[0].content).toBe('second');
 a.messages.push({ role: 'assistant', content: 'New reply' }); await saveConversation('https://a.test/', 'A', a);
 await expect(saveConversation('https://a.test/', 'A', b)).rejects.toThrow('其他窗口');
 await deleteConversation('https://a.test/', 'one');
 await expect(saveConversation('https://a.test/', 'A', a)).rejects.toThrow('删除');
 expect(await loadConversations('https://a.test/')).toEqual([]);
});
it('isolates original-page hash routes', async () => {
 await saveConversation('https://spa.test/#a', 'A', chat('same'), true);
 await saveConversation('https://spa.test/#b', 'B', chat('same'), true);
 expect((await loadConversations('https://spa.test/#a', true))[0].source?.title).toBe('A');
 expect((await loadConversations('https://spa.test/#b', true))[0].source?.title).toBe('B');
});
it('recovers from storage failure and keeps independent concurrent writes', async () => {
 state.get.mockRejectedValueOnce(new Error('storage unavailable'));
 await expect(listChatHistory()).rejects.toThrow('storage unavailable');
 await Promise.all(Array.from({ length: 12 }, (_, i) => saveConversation('https://same.test/', 'Same', chat(String(i)))));
 expect((await listChatHistory()).items).toHaveLength(12);
});

it('normalizes migrated tools and drops request bytes and page snapshots', async () => {
 const old = chat('legacy');
 Object.assign(old, { markdown: 'PRIVATE PAGE', html: '<p>PRIVATE PAGE</p>' });
 Object.assign(old.messages[0], { images: [{ dataUrl: 'data:image/png;base64,PRIVATE_BYTES' }], imageNumbers: [1, 2] });
 old.messages[1].tools = [{ id: 'interrupted', call: { type: 'search_web', query: 'test' }, state: 'running' }];
 state.store[chatKey('https://legacy.test/')] = { url: 'https://legacy.test/', title: 'Legacy', conversations: [old], markdown: 'PRIVATE PAGE' };
 await listChatHistory(); const restored = await readConversation('https://legacy.test/', 'legacy');
 expect(restored?.messages[0].imageNumbers).toEqual([1, 2]);
 expect(restored?.messages[1].tools?.[0].state).toBe('error');
 expect(JSON.stringify(restored)).not.toContain('PRIVATE');
});
it('keeps snapshots separate from mutable request objects and does not load conversation bodies for the list', async () => {
 const one = chat('snapshot'); Object.assign(one.messages[0], { imageNumbers: [3], images: [{ dataUrl: 'data:image/png;base64,PRIVATE_BYTES' }] });
 const save = saveConversation('https://snap.test/', 'Snapshot', one); one.messages[0].imageNumbers!.push(4); await save;
 expect((await readConversation('https://snap.test/', 'snapshot'))?.messages[0].imageNumbers).toEqual([3]);
 const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('qiaomu-chat-history'); req.onsuccess = () => resolve(req.result); });
 const spy = vi.spyOn(Object.getPrototypeOf(db), 'transaction');
 try {
  await listChatHistory('Snapshot');
  expect(spy.mock.calls.every(([stores]) => !String(stores).includes('conversations'))).toBe(true);
 } finally { spy.mockRestore(); db.close(); }
});
it('does not delete legacy records if the migration transaction cannot commit', async () => {
 const old = chat('old'); state.store[chatKey('https://old.test/')] = { url: 'https://old.test/', title: 'Old', conversations: [old] };
 // A transaction failure must leave the old copy available for the next attempt.
 const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('qiaomu-chat-history', 1); req.onupgradeneeded = () => { req.result.createObjectStore('meta'); }; req.onsuccess = () => resolve(req.result); });
 db.close();
 await expect(listChatHistory()).rejects.toThrow();
 expect(state.store[chatKey('https://old.test/')]).toBeDefined();
});
it('preserves malformed legacy records for recovery while importing valid conversations', async () => {
 const mixedKey = chatKey('https://mixed.test/'), goodKey = chatKey('https://good.test/');
 state.store[mixedKey] = { url: 'https://mixed.test/', title: 'Mixed', conversations: [chat('valid'), { ...chat('broken'), messages: [null] }] };
 state.store[goodKey] = { url: 'https://good.test/', title: 'Good', conversations: [chat('good')] };
 state.store['qiaomuChat:unknown'] = 'unrecognized data'; state.store.qiaomuChatIndex = [{ key: mixedKey }, { key: goodKey }];
 expect((await listChatHistory()).items.map(item => item.id).sort()).toEqual(['good', 'valid']);
 expect(state.store[mixedKey]).toBeDefined(); expect(state.store['qiaomuChat:unknown']).toBe('unrecognized data');
 expect(state.store.qiaomuChatIndex).toBeDefined(); expect(state.store[goodKey]).toBeUndefined();
 await deleteConversation('https://mixed.test/', 'valid');
 expect((await listChatHistory()).items.map(item => item.id)).toEqual(['good']);
});
