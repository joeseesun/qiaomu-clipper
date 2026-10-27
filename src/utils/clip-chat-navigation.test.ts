// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { streamChatAgent } from './chat-agent';
import type { Conversation } from './chat-history';

const state = vi.hoisted(() => ({ stream: vi.fn(), saved: [] as Conversation[] }));
vi.mock('./storage-utils', () => ({ generalSettings: { providers: [] }, getLocalStorage: async () => undefined, setLocalStorage: vi.fn() }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'test', name: 'Test' }] }));
vi.mock('./chat-agent', () => ({ streamChatAgent: (...args: unknown[]) => state.stream(...args) }));
vi.mock('./chat-history', () => ({
	loadConversations: async () => structuredClone(state.saved),
	saveConversation: async (_url: string, _title: string, value: Conversation) => { state.saved = [structuredClone(value)]; },
	deleteConversation: async () => { state.saved = []; }
}));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
import { mountClipChat } from './clip-chat';

let request: Parameters<typeof streamChatAgent>[0], finish: () => void;
beforeEach(() => {
	document.body.replaceChildren(); vi.clearAllMocks();
	state.saved = [{ id: 'saved', title: 'Earlier questions', updatedAt: 1, messages: [
		{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'First answer' },
		{ role: 'user', content: 'Second question' }, { role: 'assistant', content: 'Second answer' }
	] }];
	state.stream.mockImplementation((options: typeof request) => { request = options; return new Promise<void>(resolve => { finish = resolve; }); });
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); });

async function mount() {
	const chat = mountClipChat({ getContext: () => ({ title: 'Public example', url: 'https://example.com/', markdown: 'A public example.' }) });
	const area = document.querySelector<HTMLElement>('.clip-chat-nav-area')!;
	area.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 500, width: 400, height: 500, toJSON() {} });
	Object.defineProperties(document.querySelector('.clip-chat-messages')!, { clientHeight: { value: 500 }, scrollHeight: { value: 2000 } });
	chat.toggle(true);
	await vi.waitFor(() => expect(area.querySelectorAll('.clip-chat-turn-marker')).toHaveLength(state.saved[0].messages.filter(m => m.role === 'user').length));
	return { chat, area };
}

it('wires real chat turns to stable previews, persists bookmarks and restores them after remounting', async () => {
	const { chat, area } = await mount();
	const first = area.querySelector<HTMLButtonElement>('.clip-chat-turn-marker')!;
	const originalTarget = first.getAttribute('aria-controls');
	first.dispatchEvent(new Event('pointerenter'));
	await vi.waitFor(() => expect(area.querySelector('.clip-chat-turn-preview-excerpt')!.textContent).toBe('First answer'));
	area.querySelector<HTMLButtonElement>('.clip-chat-turn-bookmark')!.click();
	await vi.waitFor(() => expect(state.saved[0].messages[0].bookmarked).toBe(true));
	const input = document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;
	input.value = 'Third question'; document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();
	await vi.waitFor(() => expect(state.stream).toHaveBeenCalledOnce());
	expect(area.querySelectorAll('.clip-chat-turn-marker')).toHaveLength(3);
	expect(first.getAttribute('aria-controls')).toBe(originalTarget);
	expect(area.querySelector('.clip-chat-turn-preview-excerpt')!.textContent).toBe('First answer');
	request.onText('Third answer streamed');
	const third = area.querySelectorAll<HTMLButtonElement>('.clip-chat-turn-marker')[2];
	third.dispatchEvent(new Event('pointerenter'));
	await vi.waitFor(() => expect(area.querySelector('.clip-chat-turn-preview-excerpt')!.textContent).toBe('Third answer streamed'));
	finish(); await vi.waitFor(() => expect(state.saved[0].messages).toHaveLength(6));
	chat.destroy();
	const reopened = await mount();
	expect(reopened.area.querySelector('.clip-chat-turn-marker')!.classList.contains('is-bookmarked')).toBe(true);
	expect(Array.from(reopened.area.querySelectorAll('.clip-chat-turn-marker')).map(marker => document.getElementById(marker.getAttribute('aria-controls')!)?.textContent)).toEqual(['First question', 'Second question', 'Third question']);
	reopened.chat.destroy();
});
