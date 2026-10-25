import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ store: {} as Record<string, unknown>, set: vi.fn() }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: {
	get: async (keys: string | string[]) => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in state.store).map(k => [k, state.store[k]]))),
	set: (...args: unknown[]) => state.set(...args),
	remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state.store[key]; }
} } } }));
import { saveConversation, loadConversations, deleteConversation } from './chat-history';

beforeEach(() => {
	state.store = {}; state.set.mockReset();
	state.set.mockImplementation(async (items: Record<string, unknown>) => { Object.assign(state.store, structuredClone(items)); });
});
const conversation = () => ({ id: 'one', title: 'Question', updatedAt: 0, messages: [{ role: 'user' as const, content: 'first' }] });

it('snapshots overlapping saves at invocation and preserves their order', async () => {
	const chat = conversation();
	let release!: () => void;
	state.set.mockImplementationOnce(async (items: Record<string, unknown>) => {
		await new Promise<void>(resolve => { release = resolve; });
		Object.assign(state.store, structuredClone(items));
	});
	const first = saveConversation('https://example.com/', 'Example', chat);
	chat.messages[0].content = 'second';
	const second = saveConversation('https://example.com/', 'Example', chat);
	chat.messages[0].content = 'unsaved edit';
	await vi.waitFor(() => expect(state.set).toHaveBeenCalledTimes(1));
	expect(JSON.stringify(state.set.mock.calls[0][0])).toContain('first');
	release(); await Promise.all([first, second]);
	expect((await loadConversations('https://example.com/'))[0].messages[0].content).toBe('second');
});

it('does not resurrect history when deletion follows a pending save', async () => {
	await Promise.all([saveConversation('https://example.com/', 'Example', conversation()), deleteConversation('https://example.com/', 'one')]);
	expect(await loadConversations('https://example.com/')).toEqual([]);
});

it('allows subsequent saves after a storage failure', async () => {
	state.set.mockRejectedValueOnce(new Error('storage unavailable'));
	await expect(saveConversation('https://example.com/', 'Example', conversation())).rejects.toThrow('storage unavailable');
	await saveConversation('https://example.com/', 'Example', conversation());
	expect(await loadConversations('https://example.com/')).toHaveLength(1);
});
