import { afterEach, expect, it, vi } from 'vitest';
import { generalSettings } from './storage-utils';
import { streamChat } from './chat-llm';

const stream = (chunks: string[]) => new Response(new ReadableStream({ start(controller) { chunks.forEach(c => controller.enqueue(new TextEncoder().encode(c))); controller.close(); } }));
const model = (providerId: string) => ({ id: 'm', providerId, providerModelId: 'x', name: 'X', enabled: true });
afterEach(() => vi.unstubAllGlobals());

it('streams OpenAI-style deltas, even when a line is split between chunks', async () => {
	generalSettings.providers = [{ id: 'p', name: 'OpenAI', baseUrl: 'https://api.test/v1/chat/completions', apiKeyRequired: true, apiKey: 'k' }] as any;
	const fetchMock = vi.fn().mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n', 'data: {"choices":[{"delta":{"con', 'tent":"lo"}}]}\ndata: [DONE]\n']));
	vi.stubGlobal('fetch', fetchMock);
	const deltas: string[] = [];
	const full = await streamChat({ model: model('p'), system: 's', messages: [{ role: 'user', content: 'hi' }], onDelta: d => deltas.push(d) });
	expect(full).toBe('Hello');
	expect(deltas).toEqual(['Hel', 'lo']);
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body.stream).toBe(true);
	expect(body.messages[0]).toEqual({ role: 'system', content: 's' });
	expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
});

it('streams Anthropic text deltas', async () => {
	generalSettings.providers = [{ id: 'a', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1/messages', apiKeyRequired: true, apiKey: 'k' }] as any;
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stream(['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'])));
	expect(await streamChat({ model: model('a'), system: 's', messages: [], onDelta: () => {} })).toBe('Hi');
});

it('reports provider errors with the status', async () => {
	generalSettings.providers = [{ id: 'p', name: 'OpenAI', baseUrl: 'https://api.test', apiKeyRequired: false, apiKey: '' }] as any;
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
	await expect(streamChat({ model: model('p'), system: 's', messages: [], onDelta: () => {} })).rejects.toThrow('401');
});

it('routes live-page requests through a background port without exposing provider credentials', async () => {
	const browser = (await import('./browser-polyfill')).default;
	let receive: (message: unknown) => void = () => {};
	const postMessage = vi.fn(() => { queueMicrotask(() => { receive({ delta: '字幕回答' }); receive({ done: true }); }); });
	const port = { postMessage, disconnect: vi.fn(), onMessage: { addListener: (fn: typeof receive) => { receive = fn; } }, onDisconnect: { addListener: vi.fn() } };
	vi.stubGlobal('location', { protocol: 'https:' });
	const directFetch = vi.fn(); vi.stubGlobal('fetch', directFetch);
	(browser.runtime as any).connect = vi.fn(() => port);
	const deltas: string[] = [];
	expect(await streamChat({ model: model('p'), system: '视频字幕', messages: [], onDelta: delta => deltas.push(delta) })).toBe('字幕回答');
	expect(deltas).toEqual(['字幕回答']);
	expect(postMessage).toHaveBeenCalledWith({ modelId: 'm', system: '视频字幕', messages: [] });
	expect(directFetch).not.toHaveBeenCalled();
	expect(port.disconnect).toHaveBeenCalledOnce();
});

it('disconnects the background request when a live-page conversation is stopped', async () => {
	const browser = (await import('./browser-polyfill')).default;
	const port = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() } };
	(browser.runtime as any).connect = vi.fn(() => port);
	vi.stubGlobal('location', { protocol: 'https:' });
	const controller = new AbortController();
	const promise = streamChat({ model: model('p'), system: 's', messages: [], signal: controller.signal, onDelta: () => {} });
	controller.abort();
	await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
	expect(port.disconnect).toHaveBeenCalledOnce();
});
