import { beforeEach, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('./browser-polyfill', () => ({
	default: { storage: { local: {
		get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, store[k]])),
		set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
		remove: async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]); },
	} } },
}));

import { chatKey, loadConversations, saveConversation, deleteConversation, MAX_ARTICLES, MAX_CONVERSATIONS } from './chat-history';

const conversation = (id: string, text = 'hi') => ({ id, title: text, updatedAt: 0, messages: [{ role: 'user' as const, content: text, quote: 'passage' }] });
beforeEach(() => { for (const key of Object.keys(store)) delete store[key]; });

it('restores conversations per article, newest first, ignoring the URL fragment', async () => {
	await saveConversation('https://a.com/post#top', 'A', conversation('1'));
	await new Promise(r => setTimeout(r, 2));
	await saveConversation('https://a.com/post', 'A', conversation('2'));
	const list = await loadConversations('https://a.com/post#other');
	expect(list.map(c => c.id)).toEqual(['2', '1']);
	expect(list[0].messages[0].quote).toBe('passage');
	expect(await loadConversations('https://b.com/')).toEqual([]);
	expect(chatKey('https://a.com/x#1')).toBe(chatKey('https://a.com/x#2'));
});

it('updates a conversation in place and caps how many are kept', async () => {
	for (let i = 0; i < MAX_CONVERSATIONS + 3; i++) await saveConversation('https://a.com/', 'A', conversation(String(i)));
	expect((await loadConversations('https://a.com/')).length).toBe(MAX_CONVERSATIONS);
	await saveConversation('https://a.com/', 'A', conversation('5', 'changed'));
	expect((await loadConversations('https://a.com/')).filter(c => c.id === '5')).toHaveLength(1);
});

it('drops the oldest articles beyond the limit and removes empty articles on delete', async () => {
	for (let i = 0; i < MAX_ARTICLES + 2; i++) await saveConversation(`https://site${i}.com/`, 'T', conversation('x'));
	expect(await loadConversations('https://site0.com/')).toEqual([]);
	expect((await loadConversations(`https://site${MAX_ARTICLES + 1}.com/`)).length).toBe(1);
	await deleteConversation(`https://site${MAX_ARTICLES + 1}.com/`, 'x');
	expect(store[chatKey(`https://site${MAX_ARTICLES + 1}.com/`)]).toBeUndefined();
});
