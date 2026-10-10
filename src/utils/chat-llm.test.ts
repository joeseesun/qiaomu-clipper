import { afterEach, expect, it, vi } from 'vitest';
import { generalSettings } from './storage-utils';
import { normalizeOpenAIChatEndpoint, opencodeHeaders, streamChat } from './chat-llm';

const stream = (chunks: string[]) => new Response(new ReadableStream({ start(controller) { chunks.forEach(c => controller.enqueue(new TextEncoder().encode(c))); controller.close(); } }));
const model = (providerId: string) => ({ id: 'm', providerId, providerModelId: 'x', name: 'X', enabled: true });
afterEach(() => vi.unstubAllGlobals());

it('normalizes OpenAI-compatible gateway endpoints without duplicating complete paths', () => {
	expect(normalizeOpenAIChatEndpoint('https://magpie.example')).toBe('https://magpie.example/v1/chat/completions');
	expect(normalizeOpenAIChatEndpoint('https://magpie.example/v1')).toBe('https://magpie.example/v1/chat/completions');
	expect(normalizeOpenAIChatEndpoint('https://magpie.example/v1/chat/completions')).toBe('https://magpie.example/v1/chat/completions');
	expect(normalizeOpenAIChatEndpoint('https://magpie.example/v1/responses')).toBe('https://magpie.example/v1/responses');
	expect(normalizeOpenAIChatEndpoint('https://magpie.example/v1/messages')).toBe('https://magpie.example/v1/messages');
});

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

it('uses the normalized endpoint for a Magpie-style provider', async () => {
	generalSettings.providers = [{ id: 'p', name: 'Magpie', baseUrl: 'https://magpie.example/v1', apiKeyRequired: false, apiKey: '' }] as any;
	const fetchMock = vi.fn().mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n', 'data: [DONE]\n']));
	vi.stubGlobal('fetch', fetchMock);
	await streamChat({ model: model('p'), system: 's', messages: [], onDelta: () => {} });
	expect(fetchMock.mock.calls[0][0]).toBe('https://magpie.example/v1/chat/completions');
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

// OpenCode Go answers 400 "MissingSessionID" without this header.
it('identifies OpenCode requests with a stable session header', () => {
	const first = opencodeHeaders('https://opencode.ai/zen/go/v1/chat/completions', 'conversation');
	expect(first?.['x-opencode-session']).toBeTruthy();
	expect(first?.['x-opencode-client']).toBe('qiaomu-clipper');
	expect(opencodeHeaders('https://opencode.ai/zen/go/v1/chat/completions', 'conversation')).toEqual(first);
	expect(opencodeHeaders('https://api.deepseek.com/v1/chat/completions')).toBeUndefined();
	expect(opencodeHeaders('https://notopencode.ai/v1/chat/completions')).toBeUndefined();
	expect(opencodeHeaders('not a url')).toBeUndefined();
});

it('sends the OpenCode session header with a Go chat request', async () => {
	generalSettings.providers = [{ id: 'p', name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions', apiKeyRequired: true, apiKey: 'k' }] as any;
	const fetchMock = vi.fn().mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n', 'data: [DONE]\n']));
	vi.stubGlobal('fetch', fetchMock);
	await streamChat({ model: { ...model('p'), providerModelId: 'kimi-k3' }, sessionId: 'persisted-chat', system: 's', messages: [], onDelta: () => {} });
	const headers = fetchMock.mock.calls[0][1].headers;
	expect(headers['x-opencode-session']).toBe('persisted-chat');
	expect(headers['x-opencode-client']).toBe('qiaomu-clipper');
	expect(headers.Authorization).toBe('Bearer k');
});

it('leaves other gateways without an OpenCode session header', async () => {
	generalSettings.providers = [{ id: 'p', name: 'OpenAI', baseUrl: 'https://api.test/v1/chat/completions', apiKeyRequired: true, apiKey: 'k' }] as any;
	const fetchMock = vi.fn().mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n', 'data: [DONE]\n']));
	vi.stubGlobal('fetch', fetchMock);
	await streamChat({ model: model('p'), system: 's', messages: [], onDelta: () => {} });
	expect(fetchMock.mock.calls[0][1].headers['x-opencode-session']).toBeUndefined();
});



it('rejects manually selected incompatible OpenCode Go models before a billed request', async () => {
 generalSettings.providers = [{ id: 'p', name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions', apiKeyRequired: true, apiKey: 'fixture' }] as any;
 const fetchMock = vi.fn().mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n']));
 vi.stubGlobal('fetch', fetchMock);
 for (const id of ['gpt-6-luna', 'minimax-m3', 'unknown-future-model']) {
  await expect(streamChat({ model: { ...model('p'), providerModelId: id }, system: 's', messages: [], onDelta: () => {} })).rejects.toThrow();
 }
 expect(fetchMock).not.toHaveBeenCalled();
});


it('does not send OpenCode identity to insecure or credential-bearing URLs', () => {
 for (const url of ['http://opencode.ai/zen/go/v1/chat/completions', 'https://opencode.ai.evil.example/v1', 'https://user:pass@opencode.ai/zen/go/v1', 'https://opencode.ai:8443/v1']) expect(opencodeHeaders(url, 'conversation')).toBeUndefined();
 expect(() => opencodeHeaders('https://opencode.ai/zen/go/v1', 'bad\r\nHeader')).toThrow();
});

it('forwards the persisted session via background without forwarding credentials', async () => {
 const browser = (await import('./browser-polyfill')).default;
 let receive: (message: unknown) => void = () => {};
 const postMessage = vi.fn(() => queueMicrotask(() => { receive({ delta: 'ok' }); receive({ done: true }); }));
 const port = { postMessage, disconnect: vi.fn(), onMessage: { addListener: (fn: typeof receive) => { receive = fn; } }, onDisconnect: { addListener: vi.fn() } };
 (browser.runtime as any).connect = vi.fn(() => port);
 vi.stubGlobal('location', { protocol: 'https:' });
 const directFetch = vi.fn(); vi.stubGlobal('fetch', directFetch);
 await streamChat({ model: model('p'), sessionId: 'restored-conversation', system: 's', messages: [], onDelta: () => {} });
 expect(postMessage).toHaveBeenCalledWith({ modelId: 'm', sessionId: 'restored-conversation', system: 's', messages: [] });
 expect(directFetch).not.toHaveBeenCalled();
});

it('isolates simultaneous OpenCode conversations and retains their IDs on retry', async () => {
 generalSettings.providers = [{ id: 'p', name: 'Renamed provider', baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions', apiKeyRequired: true, apiKey: 'fixture' }] as any;
 const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(stream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n'])));
 vi.stubGlobal('fetch', fetchMock);
 const call = (sessionId: string) => streamChat({ model: { ...model('p'), providerModelId: 'kimi-k3' }, sessionId, system: 's', messages: [], onDelta: () => {} });
 await Promise.all([call('a'), call('b')]); await call('a');
 expect(fetchMock.mock.calls.map(call => call[1].headers['x-opencode-session'])).toEqual(['a', 'b', 'a']);
});

it('keeps persisted conversation sessions distinct across requests and module reloads', async () => {
 const first = opencodeHeaders('https://opencode.ai/zen/go/v1/chat/completions', 'conversation-a');
 expect(first?.['x-opencode-session']).toBe('conversation-a');
 expect(opencodeHeaders('https://opencode.ai/zen/go/v1/chat/completions', 'conversation-b')?.['x-opencode-session']).toBe('conversation-b');
 vi.resetModules();
 const reloaded = await import('./chat-llm');
 expect(reloaded.opencodeHeaders('https://opencode.ai/zen/go/v1/chat/completions', 'conversation-a')).toEqual(first);
});
