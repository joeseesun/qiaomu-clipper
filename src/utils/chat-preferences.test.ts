// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ saved: undefined as unknown, set: vi.fn(), stream: vi.fn() }));
vi.mock('./storage-utils', () => ({ generalSettings: {}, getLocalStorage: async (key: string) => key === 'qiaomuChatPreferences' ? state.saved : undefined, setLocalStorage: (...args: unknown[]) => state.set(...args) }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { onChanged: { addListener: vi.fn() } }, runtime: { openOptionsPage: vi.fn() } } }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'test', name: 'Test' }], streamChat: (...args: unknown[]) => state.stream(...args) }));
vi.mock('./chat-history', () => ({ loadConversations: async () => [], saveConversation: vi.fn(), deleteConversation: vi.fn() }));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
import { normalizeChatPreferences, chatSystemPrompt, chatFontFamily } from './chat-preferences';
import { mountClipChat } from './clip-chat';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); state.saved = undefined; state.set.mockResolvedValue(undefined); state.stream.mockResolvedValue(undefined); });

it('normalizes invalid saved values and falls back safely for an unavailable custom font', () => {
	expect(normalizeChatPreferences({font: 'broken', fontSize: NaN, prompt: 123})).toMatchObject({font: 'system', fontSize: 14, prompt: ''});
	expect(normalizeChatPreferences({fontSize: 400, prompt: 'x'.repeat(5000)})).toMatchObject({fontSize: 28, prompt: 'x'.repeat(4000)});
	expect(chatFontFamily(normalizeChatPreferences({font:'custom', customFont:'Foo";{}'}))).toContain('"Foo", system-ui');
});

it('keeps built-in instructions and source when custom instructions are disabled or enabled', () => {
	const prefs = normalizeChatPreferences({prompt: 'Answer in Chinese'});
	expect(chatSystemPrompt('BASE', prefs, '[03:23] Transcript')).toContain('Answer in Chinese');
	expect(chatSystemPrompt('BASE', {...prefs, promptEnabled:false}, '[03:23] Transcript')).toBe('BASE\n\n<reading_source>\n[03:23] Transcript\n</reading_source>');
});

async function openSettings() {
	mountClipChat({getContext: () => ({title:'Video', url:'https://youtube.com/watch?v=dbqweBCynuI', markdown:'[03:23] Actual transcript'}), onInsert: () => {}}).toggle();
	await flush(); document.querySelector<HTMLButtonElement>('[aria-label=qiaomuChatPreferences]')!.click(); await flush();
	return document.querySelector<HTMLFormElement>('.clip-chat-settings')!;
}

it('saves preferences and sends custom instructions with the actual transcript on the next question', async () => {
	const form = await openSettings();
	form.querySelector<HTMLTextAreaElement>('textarea')!.value = 'Answer in Chinese';
	form.querySelector<HTMLInputElement>('input[type=range]')!.value = '20';
	form.requestSubmit(); await flush();
	expect(state.set).toHaveBeenCalledWith('qiaomuChatPreferences', expect.objectContaining({fontSize:20, prompt:'Answer in Chinese'}));
	expect(form.hidden).toBe(true);
	expect(document.querySelector<HTMLElement>('.clip-chat')!.style.getPropertyValue('--clip-chat-size')).toBe('20px');
	const composer = document.querySelector<HTMLFormElement>('.clip-chat-composer')!;
	composer.querySelector('textarea')!.value = 'Explain'; composer.requestSubmit(); await flush();
	expect(state.stream).toHaveBeenCalledWith(expect.objectContaining({system: expect.stringContaining('Answer in Chinese')}));
	expect(state.stream.mock.calls[0][0].system).toContain('[03:23] Actual transcript');
});

it('cancels drafts with Escape and keeps persisted preferences when storage fails', async () => {
	state.saved = {fontSize:18, prompt:'Saved'};
	const form = await openSettings();
	form.querySelector('textarea')!.value = 'Unsaved';
	form.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
	expect(form.hidden).toBe(true); expect(state.set).not.toHaveBeenCalled();
	document.querySelector<HTMLButtonElement>('[aria-label=qiaomuChatPreferences]')!.click(); await flush();
	expect(form.querySelector('textarea')!.value).toBe('Saved');
	state.set.mockRejectedValueOnce(new Error('Full'));
	form.requestSubmit(); await flush();
	expect(form.hidden).toBe(false);
	expect(form.querySelector('[role=status]')!.textContent).toBe('qiaomuChatPreferencesSaveError');
});

it('pauses personalization without deleting it and resets only the unsaved draft', async () => {
	state.saved = {prompt:'Saved instruction', fontSize:22};
	const form = await openSettings();
	const enabled = form.querySelector<HTMLInputElement>('input[type=checkbox]')!;
	enabled.checked = false; enabled.dispatchEvent(new Event('input', {bubbles:true}));
	expect(form.querySelector('textarea')!.disabled).toBe(true);
	form.requestSubmit(); await flush();
	expect(state.set).toHaveBeenCalledWith('qiaomuChatPreferences', expect.objectContaining({prompt:'Saved instruction', promptEnabled:false}));
	document.querySelector<HTMLButtonElement>('[aria-label=qiaomuChatPreferences]')!.click(); await flush();
	Array.from(form.querySelectorAll('button')).find(button => button.textContent === 'qiaomuChatPreferencesReset')!.click();
	expect(form.querySelector('textarea')!.value).toBe('');
	form.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
	document.querySelector<HTMLButtonElement>('[aria-label=qiaomuChatPreferences]')!.click(); await flush();
	expect(form.querySelector('textarea')!.value).toBe('Saved instruction');
	expect(state.set).toHaveBeenCalledTimes(1);
});
