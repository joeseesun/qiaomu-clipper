import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ storage: {} as Record<string, any> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: {
	get: async (keys: string | string[]) => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in state.storage).map(k => [k, state.storage[k]]))),
	set: async (items: any) => Object.assign(state.storage, structuredClone(items)),
	remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state.storage[key]; },
} } } }));
import { saveChatImage, getChatImage } from './chat-generated-images';
import { deleteConversation, loadConversations, saveConversation, type Conversation } from './chat-history';
beforeEach(() => { state.storage = {}; });

it('roundtrips binary pictures separately and retains them in the gallery when history is deleted', async () => {
	const id = await saveChatImage(new Blob(['png bytes'], { type: 'image/png' }));
	const chat: Conversation = { id: 'chat', title: 'Pictures', updatedAt: 0, messages: [{ role: 'assistant', content: '', generatedImages: [{ prompt: 'Cat', aspect: '1:1', imageId: id }] }] };
	await saveConversation('https://test/a', 'A', chat);
	expect((await loadConversations('https://test/a'))[0].messages[0].generatedImages![0].imageId).toBe(id);
	expect(await (await getChatImage(id))!.text()).toBe('png bytes');
	expect(JSON.stringify(state.storage)).not.toContain('png bytes');
	await deleteConversation('https://test/a', 'chat');
	expect(await getChatImage(id)).toBeDefined();
});

it('retains both old and current images in long chat history', async () => {
	const old = await saveChatImage(new Blob(['old'])), keep = await saveChatImage(new Blob(['keep']));
	const chat: Conversation = { id: 'chat', title: '', updatedAt: 0, messages: [{ role: 'assistant', content: '', generatedImages: [{ prompt: 'Old', aspect: '1:1', imageId: old }] }] };
	await saveConversation('https://test/b', '', chat);
	chat.messages.push(...Array.from({ length: 48 }, () => ({ role: 'user' as const, content: 'next' })));
	chat.messages.push({ role: 'assistant', content: '', generatedImages: [{ prompt: 'Keep', aspect: '1:1', imageId: keep }] });
	await saveConversation('https://test/b', '', chat);
	expect(await getChatImage(old)).toBeDefined(); expect(await getChatImage(keep)).toBeDefined();
});
