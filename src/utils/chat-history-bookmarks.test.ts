import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: {
 get: async (keys: string | string[] | null) => structuredClone(keys === null ? state.store : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in state.store).map(k => [k, state.store[k]]))),
 set: async (values: Record<string, unknown>) => Object.assign(state.store, values),
 remove: async (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]).forEach(k => delete state.store[k])
} } } }));
import { chatKey, loadConversations, saveConversation, deleteConversation, type Conversation } from './chat-history';
const chat = (id: string): Conversation => ({ id, title: id, updatedAt: 0, messages: [{ role: 'user', content: id }] });
beforeEach(() => { state.store = {}; vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());

it('retains bookmarked questions, complete answers and older unbookmarked messages without eviction', async () => {
 const pinned = chat('pinned');
 pinned.messages = [{ role: 'user', content: 'Keep this', bookmarked: true }, { role: 'assistant', content: 'Complete answer' }, ...Array.from({ length: 44 }, (_, i) => ({ role: 'user' as const, content: `next ${i}` }))];
 await saveConversation('https://pinned.test/', 'Pinned', pinned);
 for (let i = 0; i < 17; i++) await saveConversation('https://pinned.test/', 'Pinned', chat(String(i)));
 for (let i = 0; i < 42; i++) await saveConversation(`https://recent${i}.test/`, 'Recent', chat('new'));
 const restored = (await loadConversations('https://pinned.test/')).find(c => c.id === 'pinned')!;
 expect(restored.messages).toEqual(pinned.messages);
 await deleteConversation('https://pinned.test/', 'pinned');
 expect((await loadConversations('https://pinned.test/')).some(c => c.id === 'pinned')).toBe(false);
 expect(await loadConversations('https://pinned.test/')).toHaveLength(17);
});
it('orders overlapping bookmark changes without evicting history after unbookmarking', async () => {
 const pinned = chat('one'); pinned.messages[0].bookmarked = true;
 const first = saveConversation('https://pinned.test/', 'Pinned', pinned);
 pinned.messages[0].bookmarked = false;
 const second = saveConversation('https://pinned.test/', 'Pinned', pinned);
 await Promise.all([first, second]);
 expect((await loadConversations('https://pinned.test/'))[0].messages[0].bookmarked).toBeUndefined();
 expect(pinned.revision).toBe(2);
});
it('migrates legacy bookmarks with attachments and does not turn assistant metadata into bookmarks', async () => {
 const old = chat('legacy');
 const ref = { id: 'chat-image-00000000-0000-4000-8000-000000000001', name: 'image.png' };
 old.messages = [{ role: 'user', content: 'Keep', bookmarked: true, attachments: [ref] }, { role: 'assistant', content: 'Answer', bookmarked: true }];
 const key = chatKey('https://old.test/'); state.store[key] = { url: 'https://old.test/', title: 'Old', conversations: [old] };
 const restored = (await loadConversations('https://old.test/'))[0];
 expect(restored.messages[0]).toMatchObject({ bookmarked: true, attachments: [ref] });
 expect(restored.messages[1].bookmarked).toBeUndefined();
 expect(state.store[key]).toBeUndefined();
});
