import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProviderModels, modelListRequest } from './provider-models';
import { Provider } from '../types/types';

const provider: Provider = { id: 'one', name: 'Renamed gateway', baseUrl: 'https://gateway.example/proxy/v1/chat/completions', apiKey: 'test-key', apiKeyRequired: true };
const reply = (body: unknown) => new Response(JSON.stringify(body));
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('provider model discovery', () => {
	it('uses the configured gateway and key, independent of the provider display name', async () => {
		vi.mocked(fetch).mockResolvedValue(reply({ data: [{ id: 'new-model' }, { id: 'other-model', name: 'Other' }, { id: 'new-model' }, {}] }));
		expect(await fetchProviderModels(provider)).toEqual([{ id: 'new-model', name: 'new-model' }, { id: 'other-model', name: 'Other' }]);
		expect(fetch).toHaveBeenCalledWith('https://gateway.example/proxy/v1/models', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer test-key' }, credentials: 'omit' }));
	});
	it('keeps only chat-capable models from mixed gateway catalogues', async () => {
		vi.mocked(fetch).mockResolvedValue(reply({ data: [{ id: 'chat', supported_protocols: ['openai:chat-completions'] }, { id: 'video', supported_protocols: ['seedance:generations'] }, { id: 'plain' }] }));
		expect((await fetchProviderModels(provider)).map(m => m.id)).toEqual(['chat', 'plain']);
	});
	it('uses the actual DeepSeek list endpoint', () => {
		expect(modelListRequest({ ...provider, baseUrl: 'https://api.deepseek.com/v1/chat/completions' }).url.href).toBe('https://api.deepseek.com/v1/models');
	});
	it('supports root and responses endpoints without changing the gateway prefix', () => {
		for (const path of ['/v1', '/v1/', '/v1/responses', '/v1/chat/completions']) expect(modelListRequest({ ...provider, baseUrl: `https://gateway.example${path}` }).url.pathname).toBe('/v1/models');
	});
	it('returns only installed Ollama models without requiring a key', async () => {
		vi.mocked(fetch).mockResolvedValue(reply({ models: [{ name: 'local:latest', model: 'local:latest' }] }));
		expect(await fetchProviderModels({ ...provider, baseUrl: 'http://127.0.0.1:11434/api/chat', apiKey: '', apiKeyRequired: false })).toEqual([{ id: 'local:latest', name: 'local:latest' }]);
		expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.objectContaining({ headers: { Accept: 'application/json' } }));
	});
	it('paginates Gemini and excludes models that cannot generate content', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(reply({ models: [{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }, { name: 'models/chat-a', displayName: 'Chat A', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' })).mockResolvedValueOnce(reply({ models: [{ name: 'models/chat-b', supportedGenerationMethods: ['generateContent'] }] }));
		expect(await fetchProviderModels({ ...provider, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model-id}:generateContent' })).toEqual([{ id: 'chat-a', name: 'Chat A' }, { id: 'chat-b', name: 'chat-b' }]);
		expect(fetch).toHaveBeenLastCalledWith('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=next', expect.objectContaining({ headers: { Accept: 'application/json', 'x-goog-api-key': 'test-key' } }));
	});
	it('paginates Anthropic using native authentication', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(reply({ data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: true, last_id: 'claude-a' })).mockResolvedValueOnce(reply({ data: [{ id: 'claude-b' }], has_more: false }));
		expect(await fetchProviderModels({ ...provider, baseUrl: 'https://api.anthropic.com/v1/messages' })).toHaveLength(2);
		expect(fetch).toHaveBeenLastCalledWith('https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a', expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' }) }));
	});
	it('rejects missing required keys without sending a request', async () => {
		await expect(fetchProviderModels({ ...provider, apiKey: '' })).rejects.toThrow('missing-api-key');
		expect(fetch).not.toHaveBeenCalled();
	});
	it('keeps Azure deployment selection manual rather than suggesting unusable catalog IDs', async () => {
		await expect(fetchProviderModels({ ...provider, baseUrl: 'https://sample.openai.azure.com/openai/deployments/{deployment-id}/chat/completions?api-version=2024-10-21' })).rejects.toThrow('deployment-models');
		expect(fetch).not.toHaveBeenCalled();
	});
	it('reports permission errors, unsupported responses and empty catalogs', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(reply({ error: 'unsupported' })).mockResolvedValueOnce(reply({ data: [] }));
		await expect(fetchProviderModels(provider)).rejects.toThrow('http-401');
		await expect(fetchProviderModels(provider)).rejects.toThrow('invalid-model-list');
		expect(await fetchProviderModels(provider)).toEqual([]);
	});
	it('allows cancelling a request when the selected provider changes', async () => {
		vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
		const controller = new AbortController();
		const pending = fetchProviderModels(provider, controller.signal);
		controller.abort();
		await expect(pending).rejects.toThrow('Aborted');
	});
	it('times out instead of leaving the modal permanently loading', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
		const assertion = expect(fetchProviderModels(provider)).rejects.toThrow('Aborted');
		await vi.advanceTimersByTimeAsync(15000);
		await assertion;
	});
	it('carries the OpenCode session header, and finds models next to the chat endpoint', () => {
		const request = modelListRequest({ ...provider, baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions' });
		expect(request.url.href).toBe('https://opencode.ai/zen/go/v1/models');
		expect(request.headers['x-opencode-session']).toBeTruthy();
		expect(request.headers['x-opencode-client']).toBe('qiaomu-clipper');
		expect(request.headers.Authorization).toBe('Bearer test-key');
	});
});
