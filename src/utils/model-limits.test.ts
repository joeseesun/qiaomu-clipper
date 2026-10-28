import { afterEach, expect, it, vi } from 'vitest';
import { outputLimitMetadata, resolveOutputLimit } from './model-limits';
import { buildRequest } from './chat-llm';
import type { ModelConfig, Provider } from '../types/types';

const provider = (extra: Partial<Provider> = {}): Provider => ({ id: crypto.randomUUID(), name: 'Gateway', baseUrl: 'https://gateway.example/v1/chat/completions', apiKey: 'fixture', ...extra });
const model: ModelConfig = { id: 'm', providerId: 'p', providerModelId: 'large', name: 'Large', enabled: true };
afterEach(() => vi.unstubAllGlobals());

it('discovers native output metadata from the configured service, caches it, and never treats context as output', async () => {
	const p = provider();
	const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'large', context_length: 1000000, top_provider: { max_completion_tokens: 128000 } }] })));
	vi.stubGlobal('fetch', fetch);
	expect(await resolveOutputLimit(p, model)).toBe(128000);
	expect(await resolveOutputLimit(p, model)).toBe(128000);
	expect(fetch).toHaveBeenCalledOnce();
	expect(fetch.mock.calls[0][0]).toBe('https://gateway.example/v1/models');
	expect(outputLimitMetadata({ context_length: 1000000, max_input_tokens: 900000 }, 'openai')).toEqual({});
	expect(outputLimitMetadata({ max_tokens: 64000 }, 'anthropic')).toEqual({ maxOutputTokens: 64000 });
	expect(outputLimitMetadata({ outputTokenLimit: 65536 }, 'gemini')).toEqual({ maxOutputTokens: 65536 });
});

it('uses an explicit service limit without discovery and leaves unavailable metadata to service defaults', async () => {
	const fetch = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetch);
	expect(await resolveOutputLimit(provider(), { ...model, outputTokenLimit: 200000 })).toBe(200000);
	expect(fetch).not.toHaveBeenCalled();
	expect(await resolveOutputLimit(provider(), model)).toBeUndefined();
	const controller = new AbortController(); controller.abort();
	await expect(resolveOutputLimit(provider(), model, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('sends complete long input and protocol-correct output limits without forcing local Ollama context', () => {
	const text = 'a'.repeat(180000) + 'THE END';
	const build = (p: Provider, limit?: number) => JSON.parse(String(buildRequest(p, model, text, [{ role: 'user', content: text }], undefined, undefined, limit).init.body));
	const normal = build(provider(), 128000);
	expect(normal.max_tokens).toBe(128000); expect(normal.messages[1].content).toBe(text);
	expect(build(provider()).max_tokens).toBeUndefined();
	expect(build(provider({ baseUrl: 'https://x.openai.azure.com/v1' })).max_completion_tokens).toBeUndefined();
	expect(build(provider({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })).generationConfig.maxOutputTokens).toBeUndefined();
	expect(build(provider({ name: 'Ollama' })).options).toEqual({});
	expect(build(provider({ name: 'Anthropic' }), 128000).max_tokens).toBe(128000);
	expect(() => build(provider({ name: 'Anthropic' }))).toThrow(/token/);
});
