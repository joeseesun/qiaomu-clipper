import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { saveChatAttachments, readChatAttachmentPreview, type ChatAttachment } from './chat-attachments';

const store: Record<string, unknown> = {};
vi.mock('./browser-polyfill', () => ({
	default: { storage: { local: {
		get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, store[k]])),
		set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
		remove: async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]); },
	} } },
}));

import { chatKey, loadConversations, saveConversation, deleteConversation, MAX_ARTICLES, MAX_CONVERSATIONS, MAX_MESSAGES } from './chat-history';

const conversation = (id: string, text = 'hi') => ({ id, title: text, updatedAt: 0, messages: [{ role: 'user' as const, content: text, quote: 'passage' }] });
beforeEach(() => { for (const key of Object.keys(store)) delete store[key]; vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());

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

it('stores image numbers but never image bytes even if a caller passes a request object', async () => {
 const chat = conversation('images');
 Object.assign(chat.messages[0], {imageNumbers:[2],images:[{dataUrl:'data:image/png;base64,c2VjcmV0',label:'图 2'}]});
 await saveConversation('https://a.com/image-note','Images',chat);
 const stored = await loadConversations('https://a.com/image-note');
 expect(stored[0].messages[0].imageNumbers).toEqual([2]);
 expect(JSON.stringify(store)).not.toContain('base64');
});

it('isolates original-page sidebar history across hash routes, including deletion', async () => {
 await saveConversation('https://example.com/#/a', 'A', conversation('a'), true);
 await saveConversation('https://example.com/#/b', 'B', conversation('b'), true);
 expect((await loadConversations('https://example.com/#/a', true)).map(c => c.id)).toEqual(['a']);
 expect((await loadConversations('https://example.com/#/b', true)).map(c => c.id)).toEqual(['b']);
 expect(await loadConversations('https://example.com/')).toEqual([]);
 await deleteConversation('https://example.com/#/a', 'a', true);
 expect(await loadConversations('https://example.com/#/a', true)).toEqual([]);
 expect((await loadConversations('https://example.com/#/b', true)).map(c => c.id)).toEqual(['b']);
});

const attachment = (): ChatAttachment => ({ id: `chat-image-${crypto.randomUUID()}`, name: 'screen.png', images: [{ label: 'Image', dataUrl: 'data:image/png;base64,YQ==' }], thumbnail: 'data:image/png;base64,YQ==' });
const withAttachment = (id: string, image: ChatAttachment) => ({ ...conversation(id), messages: [{ role: 'user' as const, content: 'Read this', attachments: [image] }] });

it('stores only attachment references and deletes image data only after its last retained reference is deleted', async () => {
	const image = attachment(); await saveChatAttachments([image]);
	await saveConversation('https://a.com/', 'A', withAttachment('one', image));
	await saveConversation('https://a.com/', 'A', withAttachment('two', image));
	expect(JSON.stringify(store)).not.toContain('base64');
	expect((await loadConversations('https://a.com/'))[0].messages[0].attachments).toEqual([{ id: image.id, name: image.name }]);
	await deleteConversation('https://a.com/', 'one'); expect(await readChatAttachmentPreview(image.id)).toBe(image.thumbnail);
	await deleteConversation('https://a.com/', 'two'); expect(await readChatAttachmentPreview(image.id)).toBeUndefined();
});

it('cleans attachments removed by message, conversation and article retention limits', async () => {
	const a = attachment(), b = attachment(), c = attachment(); await saveChatAttachments([a, b, c]);
	const chat = withAttachment('messages', a); await saveConversation('https://messages.test/', 'M', chat);
	await saveConversation('https://messages.test/', 'M', { ...chat, messages: [...chat.messages, ...Array.from({ length: MAX_MESSAGES }, () => ({ role: 'user' as const, content: 'next' }))] });
	expect(await readChatAttachmentPreview(a.id)).toBeUndefined();
	await saveConversation('https://conversations.test/', 'C', withAttachment('first', b));
	for (let i = 0; i < MAX_CONVERSATIONS; i++) await saveConversation('https://conversations.test/', 'C', conversation(String(i)));
	expect(await readChatAttachmentPreview(b.id)).toBeUndefined();
	await saveConversation('https://old-article.test/', 'Old', withAttachment('first', c));
	for (let i = 0; i < MAX_ARTICLES; i++) await saveConversation(`https://new${i}.test/`, 'New', conversation('one'));
	expect(await readChatAttachmentPreview(c.id)).toBeUndefined();
});
