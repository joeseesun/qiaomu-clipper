// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ saved: undefined as unknown, set: vi.fn(), stream: vi.fn() }));
vi.mock('./storage-utils', () => ({ generalSettings: {}, getLocalStorage: async (key: string) => key === 'qiaomuChatPreferences' ? state.saved : undefined, setLocalStorage: (...args: unknown[]) => state.set(...args) }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { onChanged: { addListener: vi.fn() } }, runtime: { openOptionsPage: vi.fn() } } }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'test', name: 'Test' }], streamChat: (...args: unknown[]) => state.stream(...args) }));
vi.mock('./chat-history', () => ({ loadConversations: async () => [], saveConversation: vi.fn(), deleteConversation: vi.fn() }));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
import { normalizeChatPreferences, chatSystemPrompt, chatFontFamily, defaultQuickPrompts, visibleQuickPrompts, normalizeQuickPrompts } from './chat-preferences';
import { mountClipChat } from './clip-chat';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); state.saved = undefined; state.set.mockResolvedValue(undefined); state.stream.mockResolvedValue(undefined); });

it('normalizes invalid saved values and falls back safely for an unavailable custom font', () => {
	expect(normalizeChatPreferences({font: 'broken', fontSize: NaN, prompt: 123})).toMatchObject({font: 'reader', fontSize: 14, prompt: ''});
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

it('normalizes quick prompts and picks the chips for the current scope', () => {
	expect(normalizeChatPreferences({}).quickPrompts).toBeNull();
	expect(normalizeQuickPrompts([{title:' ', body:'x'}, {id:'a', title:'T', body:'B', scope:'selection'}, {id:'a', title:'T2', body:'B2', enabled:false}, 3]))
		.toEqual([{id:'a', title:'T', body:'B', scope:'selection', enabled:true}, {id:'a_', title:'T2', body:'B2', scope:'article', enabled:false}]);
	const t = (key: string) => key;
	expect(visibleQuickPrompts(normalizeChatPreferences({}), false, t).map(p => p.title)).toEqual(defaultQuickPrompts(t).filter(p => p.scope === 'article').map(p => p.title));
	const prefs = normalizeChatPreferences({quickPrompts: [{id:'1', title:'A', body:'a'}, {id:'2', title:'B', body:'b', enabled:false}, {id:'3', title:'C', body:'c', scope:'selection'}]});
	expect(visibleQuickPrompts(prefs, false, t).map(p => p.id)).toEqual(['1']);
	expect(visibleQuickPrompts(prefs, true, t).map(p => p.id)).toEqual(['3']);
});

it('creates, edits and deletes quick prompts, saves them, and shows them as chips', async () => {
	const form = await openSettings();
	const click = (node: Element | null) => (node as HTMLElement).click();
	const buttons = () => Array.from(form.querySelectorAll<HTMLButtonElement>('.clip-chat-quick button'));
	click(buttons().find(b => b.textContent === 'qiaomuQuickNew')!);
	const editor = form.querySelector('.clip-chat-quick-editor')!;
	click(Array.from(editor.querySelectorAll('button')).find(b => b.textContent === 'qiaomuQuickDone')!);
	expect(editor.querySelector('[role=alert]')!.textContent).toBe('qiaomuQuickRequired');
	editor.querySelector<HTMLInputElement>('input')!.value = 'Weekly';
	editor.querySelector<HTMLTextAreaElement>('textarea')!.value = 'Write a weekly report';
	click(Array.from(editor.querySelectorAll('button')).find(b => b.textContent === 'qiaomuQuickDone')!);
	expect(form.querySelectorAll('.clip-chat-quick-row')).toHaveLength(9);
	click(form.querySelector('[aria-label=qiaomuQuickDelete]') ?? form.querySelector('.clip-chat-quick-row .clip-chat-icon:last-of-type'));
	expect(form.querySelectorAll('.clip-chat-quick-row')).toHaveLength(8);
	form.requestSubmit(); await flush();
	const saved = state.set.mock.calls[0][1];
	expect(saved.quickPrompts.some((p: {title: string}) => p.title === 'Weekly')).toBe(true);
	const chips = Array.from(document.querySelectorAll('.clip-chat-chip')).map(c => c.textContent);
	expect(chips).toContain('Weekly');
	click(Array.from(document.querySelectorAll('.clip-chat-chip')).find(c => c.textContent === 'Weekly') ?? null); await flush();
	expect(state.stream.mock.calls[0][0].messages[0].content).toBe('Write a weekly report');
});

it('follows the reading font by default and reuses the reading presets', () => {
	expect(chatFontFamily(normalizeChatPreferences({}))).toMatch(/^var\(--font-text, /);
	expect(normalizeChatPreferences({font: '__kaiti__'}).font).toBe('__kaiti__');
	expect(chatFontFamily(normalizeChatPreferences({font: '__songti__'}))).toContain('Songti SC');
	expect(normalizeChatPreferences({font: 'system'}).font).toBe('system');
});
