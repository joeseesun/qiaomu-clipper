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
