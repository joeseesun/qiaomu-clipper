// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { streamChatAgent } from './chat-agent';

const state = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('./storage-utils', () => ({ generalSettings: { providers: [] }, getLocalStorage: async () => undefined, setLocalStorage: vi.fn() }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{ id: 'test', name: 'Test' }] }));
vi.mock('./chat-agent', () => ({ streamChatAgent: (...args: unknown[]) => state.stream(...args) }));
vi.mock('./chat-history', () => ({
	loadConversations: async () => [{ id: 'saved', title: 'Saved chat', updatedAt: 1, messages: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer to keep reading' }] }],
	saveConversation: async () => {}, deleteConversation: vi.fn()
}));
vi.mock('./clip-bar', () => ({ showClipStatus: vi.fn() }));
import { mountClipChat } from './clip-chat';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let request: Parameters<typeof streamChatAgent>[0];
let finish: () => void, fail: (error: Error) => void;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
let frames: Map<number, FrameRequestCallback>;
const paint = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };

beforeEach(() => {
	document.body.replaceChildren();
	vi.clearAllMocks();
	frames = new Map(); let frameId = 0;
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
	vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
	disconnect = vi.fn();
	vi.stubGlobal('ResizeObserver', class {
		constructor(callback: () => void) { resize = callback; }
		observe = vi.fn();
		disconnect = disconnect;
	});
	state.stream.mockImplementation((options: typeof request) => {
		request = options;
		return new Promise<void>((resolve, reject) => {
			finish = resolve; fail = reject;
			options.signal!.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
		});
	});
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

async function openChat() {
	const chat = mountClipChat({ getContext: () => ({ title: 'Scroll test', url: 'https://example.com/scroll-test', markdown: 'Public test page' }) });
	chat.toggle(true); await flush();
	const viewport = document.querySelector<HTMLElement>('.clip-chat-messages')!;
	const button = document.querySelector<HTMLButtonElement>('.clip-chat-jump-bottom')!;
	const input = document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;
	const form = document.querySelector<HTMLFormElement>('.clip-chat-composer')!;
	// jsdom has no layout. Model native scroll clamping and record programmatic
	// scroll writes; user scrolls and content/viewport resizes are separate inputs.
	let top = 700, height = 2400, viewportHeight = 600;
	const writes = vi.fn();
	Object.defineProperties(viewport, {
		scrollTop: { configurable: true, get: () => top, set: (value: number) => { writes(value); top = Math.max(0, Math.min(value, height - viewportHeight)); } },
		scrollHeight: { configurable: true, get: () => height },
		clientHeight: { configurable: true, get: () => viewportHeight }
	});
	resize();
	return {
		chat, viewport, button, input, writes,
		send: async () => { input.value = 'A new question while reading'; form.requestSubmit(); await flush(); },
		userScroll: (value: number) => { top = value; viewport.dispatchEvent(new Event('scroll')); },
		grow: (value: number) => { height = value; resize(); },
		resizeViewport: (value: number) => { viewportHeight = value; top = Math.min(top, Math.max(0, height - value)); resize(); }
	};
}

it('keeps the reading position on send, streamed text/tools, completion and panel reopening', async () => {
	const ui = await openChat();
	await ui.send();
	expect(document.querySelectorAll('.clip-chat-message')).toHaveLength(4);
	expect(ui.viewport.scrollTop).toBe(700);
	request.onText('First part'); paint(); ui.grow(2800);
	ui.userScroll(250);
	request.onTools?.([]);
	request.onText('First part\n\nMore text'); paint(); ui.grow(3200);
	expect(ui.viewport.scrollTop).toBe(250);
	const reading = document.querySelector<HTMLElement>('.clip-chat-body')!;
	reading.tabIndex = 0; reading.focus();
	finish(); await flush();
	expect(document.querySelector('.is-assistant:last-child')!.textContent).toContain('More text');
	expect(ui.viewport.scrollTop).toBe(250);
	expect(document.activeElement).toBe(reading);
	ui.chat.toggle(false); ui.chat.toggle(true);
	expect(ui.viewport.scrollTop).toBe(250);
	expect(ui.writes).not.toHaveBeenCalled();
});

it('jumps only on demand; later output never enables automatic following', async () => {
	const ui = await openChat(); await ui.send();
	expect(ui.button.hidden).toBe(false);
	ui.button.click();
	expect(ui.viewport.scrollTop).toBe(1800);
	expect(ui.button.hidden).toBe(true);
	request.onText('More output after the click'); paint(); ui.grow(2800);
	expect(ui.viewport.scrollTop).toBe(1800);
	expect(ui.button.hidden).toBe(false);
	ui.userScroll(100);
	request.onText('More output again'); paint(); ui.grow(3200);
	expect(ui.viewport.scrollTop).toBe(100);
	expect(ui.writes).toHaveBeenCalledTimes(1);
	ui.userScroll(2600);
	expect(ui.button.hidden).toBe(true);
	finish(); await flush();
});

it.each(['stop', 'error'] as const)('does not scroll when a reply ends with %s', async outcome => {
	const ui = await openChat(); await ui.send();
	request.onText('Partial reply'); paint(); ui.userScroll(150);
	if (outcome === 'stop') document.querySelector<HTMLButtonElement>('.clip-chat-send')!.click();
	else fail(new Error('Test network failure'));
	await flush();
	expect(ui.viewport.scrollTop).toBe(150);
	expect(ui.writes).not.toHaveBeenCalled();
});

it('updates the button for asynchronously growing content and viewport resizing, and disconnects on destroy', async () => {
	const ui = await openChat();
	ui.resizeViewport(3000); expect(ui.button.hidden).toBe(true);
	ui.grow(4000); expect(ui.button.hidden).toBe(false);
	expect(ui.viewport.scrollTop).toBe(0);
	ui.resizeViewport(5000); expect(ui.button.hidden).toBe(true);
	expect(ui.writes).not.toHaveBeenCalled();
	ui.chat.destroy(); expect(disconnect).toHaveBeenCalledTimes(1);
	expect(document.querySelector('.clip-chat-jump-bottom')).toBeNull();
});
