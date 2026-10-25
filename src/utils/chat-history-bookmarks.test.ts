import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: {
	get: async (keys: string | string[]) => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in state.store).map(k => [k, state.store[k]]))),
	set: async (items: Record<string, unknown>) => { Object.assign(state.store, structuredClone(items)); },
	remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state.store[key]; }
} } } }));
import { loadConversations, saveConversation, deleteConversation, MAX_ARTICLES, MAX_CONVERSATIONS, MAX_MESSAGES, type Conversation } from './chat-history';
beforeEach(() => { state.store = {}; });
const chat = (id: string): Conversation => ({ id, title: id, updatedAt: 0, messages: [{ role: 'user', content: id }] });

it('retains the full bookmarked question and answer across message, conversation and article limits', async () => {
	const pinned = chat('pinned');
	pinned.messages = [
		{ role: 'user', content: 'Keep this', bookmarked: true },
		{ role: 'assistant', content: 'Keep the complete answer too' },
		...Array.from({ length: MAX_MESSAGES + 4 }, (_, i) => ({ role: 'user' as const, content: `next ${i}` }))
	];
	await saveConversation('https://pinned.test/', 'Pinned', pinned);
	const restored = (await loadConversations('https://pinned.test/'))[0];
	expect(restored.messages).toHaveLength(MAX_MESSAGES + 2);
	expect(restored.messages.slice(0, 2)).toEqual(pinned.messages.slice(0, 2));
	for (let i = 0; i < MAX_CONVERSATIONS; i++) await saveConversation('https://pinned.test/', 'Pinned', chat(String(i)));
	for (let i = 0; i < MAX_ARTICLES + 2; i++) await saveConversation(`https://recent${i}.test/`, 'Recent', chat('new'));
	expect((await loadConversations('https://pinned.test/')).some(c => c.id === 'pinned')).toBe(true);
	await deleteConversation('https://pinned.test/', 'pinned');
	expect((await loadConversations('https://pinned.test/')).some(c => c.id === 'pinned')).toBe(false);
});

it('saves overlapping bookmark changes in order and restores ordinary eviction after unbookmarking', async () => {
	const pinned = chat('one'); pinned.messages[0].bookmarked = true;
	const first = saveConversation('https://pinned.test/', 'Pinned', pinned);
	pinned.messages[0].bookmarked = false;
	const second = saveConversation('https://pinned.test/', 'Pinned', pinned);
	await Promise.all([first, second]);
	expect((await loadConversations('https://pinned.test/'))[0].messages[0].bookmarked).toBeUndefined();
	for (let i = 0; i < MAX_ARTICLES; i++) await saveConversation(`https://recent${i}.test/`, 'Recent', chat('new'));
	expect(await loadConversations('https://pinned.test/')).toEqual([]);
});

it('clears the article bookmark flag when its last bookmarked conversation is deleted', async () => {
	const pinned = chat('pinned'); pinned.messages[0].bookmarked = true;
	await saveConversation('https://pinned.test/', 'Pinned', pinned);
	await saveConversation('https://pinned.test/', 'Pinned', chat('ordinary'));
	await deleteConversation('https://pinned.test/', 'pinned');
	for (let i = 0; i < MAX_ARTICLES; i++) await saveConversation(`https://recent${i}.test/`, 'Recent', chat('new'));
	expect(await loadConversations('https://pinned.test/')).toEqual([]);
});
