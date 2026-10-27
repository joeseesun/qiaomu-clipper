import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } } }));
import { saveConversation, loadConversations, deleteConversation } from './chat-history';
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const conversation = () => ({ id: 'one', title: 'Question', updatedAt: 0, messages: [{ role: 'user' as const, content: 'first' }] });
it('snapshots overlapping saves at invocation and preserves order', async () => {
 const chat = conversation();
 const first = saveConversation('https://example.com/', 'Example', chat);
 chat.messages[0].content = 'second';
 const second = saveConversation('https://example.com/', 'Example', chat);
 chat.messages[0].content = 'unsaved edit';
 await Promise.all([first, second]);
 expect((await loadConversations('https://example.com/'))[0].messages[0].content).toBe('second');
});
it('does not resurrect history when deletion follows a pending save', async () => {
 await Promise.all([saveConversation('https://example.com/', 'Example', conversation()), deleteConversation('https://example.com/', 'one')]);
 expect(await loadConversations('https://example.com/')).toEqual([]);
});
it('allows a fresh save after an aborted write transaction without partial records', async () => {
 const original = IDBObjectStore.prototype.put;
 let fail = true;
 vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
  const result = original.apply(this, args);
  if (this.name === 'conversations' && fail) { fail = false; this.transaction.abort(); }
  return result;
 });
 await expect(saveConversation('https://example.com/', 'Example', conversation())).rejects.toThrow();
 expect(await loadConversations('https://example.com/')).toEqual([]);
 await saveConversation('https://example.com/', 'Example', conversation());
 expect(await loadConversations('https://example.com/')).toHaveLength(1);
});
