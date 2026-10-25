import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tokenPlanEndpoint, tokenPlanProfile, tokenPlanTools, TOKEN_PLAN_TOOLS } from './token-plan';
import { readTokenPlanStream, nativeToolResult } from './token-plan-stream';
import { normalizeChatTool, normalizeToolResults, toolHistory } from './chat-tools-types';
import { generalSettings } from './storage-utils';
import browser from './browser-polyfill';
import { streamChat } from './chat-llm';

const provider = { id: 'token-plan', name: 'Renamed provider', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions', apiKey: 'fixture-secret', apiKeyRequired: true };
const model = { id: 'deepseek', providerId: provider.id, name: 'DeepSeek 1017', providerModelId: 'deepseek-v4.1-flash-1017', enabled: true };
const frame = (e: unknown) => `event: test\r\ndata: ${JSON.stringify(e)}\r\n\r\n`;
const completion = { type: 'response.completed', response: { status: 'completed', output: [] } };
const bytes = (text: string, size = 7) => new Response(new ReadableStream({ start(c) { const data = new TextEncoder().encode(text); for (let i = 0; i < data.length; i += size) c.enqueue(data.slice(i, i + size)); c.close(); } }));
const answer = () => bytes(frame({ type: 'response.output_text.delta', item_id: 'm', delta: '正常' }) + frame(completion));
beforeEach(() => { generalSettings.providers = [provider]; generalSettings.models = [model]; vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ qiaomuWebSearch: { enabled: true } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('restricts automatic protocol switching to the exact Token Plan endpoint and documented models', () => {
 expect(tokenPlanEndpoint(provider)).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses');
 for (const baseUrl of ['http://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'https://token-plan.cn-beijing.maas.aliyuncs.com.evil.example/compatible-mode/v1', 'https://user:pass@token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'https://token-plan.cn-beijing.maas.aliyuncs.com/other', 'https://token-plan.cn-beijing.maas.aliyuncs.com:8443/compatible-mode/v1']) expect(tokenPlanEndpoint({ baseUrl })).toBeUndefined();
 expect(tokenPlanProfile(provider, 'future-model')).toBeUndefined();
 expect(tokenPlanProfile(provider, 'qwen-audio-3.0-tts-plus')).toBeUndefined();
 expect(tokenPlanProfile(provider, model.providerModelId)?.tools).toEqual(TOKEN_PLAN_TOOLS.slice(0, 3));
 expect(tokenPlanProfile(provider, 'qwen3.8-max')?.tools).toEqual(TOKEN_PLAN_TOOLS);
 expect(tokenPlanProfile(provider, model.providerModelId)?.efforts).toEqual(['none', 'low', 'high', 'max']);
});

it('honours offline choice and only offers reverse image search with image input', () => {
 const p = tokenPlanProfile(provider, 'qwen3.8-max')!;
 expect(tokenPlanTools(p, false, true)).toEqual([{ type: 'code_interpreter' }]);
 expect(tokenPlanTools(p, true, false).map(t => t.type)).not.toContain('image_search');
 expect(tokenPlanTools(p, true, true).map(t => t.type)).toEqual(TOKEN_PLAN_TOOLS);
});

it('decodes split UTF-8 and SSE frames, all five real tool shapes, and avoids final-answer duplication', async () => {
 const items = [
  { id: 's', type: 'web_search_call', status: 'completed', action: { query: 'Python', sources: [{ url: 'https://python.org/' }] } },
  { id: 'w', type: 'web_extractor_call', status: 'completed', urls: ['https://python.org/'], output: 'Verified page' },
  { id: 'c', type: 'code_interpreter_call', status: 'completed', code: 'print(2+2)', outputs: [{ type: 'logs', logs: '4' }] },
  ...['web_search_image', 'image_search'].map(type => ({ id: type, type: `${type}_call`, status: 'completed', arguments: '{"queries":["cat"]}', output: '[{"title":"cat","url":"https://images.example.com/cat.png","index":1}]' })),
 ];
 const onDelta = vi.fn(), onThought = vi.fn(), onTools = vi.fn();
 const sse = frame({ type: 'response.reasoning_text.delta', delta: '思考' }) + items.map(item => frame({ type: 'response.output_item.done', item })).join('')
  + frame({ type: 'response.output_text.delta', item_id: 'm', content_index: 0, delta: '结果：4' })
  + frame({ type: 'response.output_text.done', item_id: 'm', content_index: 0, text: '结果：4' })
  + frame({ type: 'response.completed', response: { status: 'completed', output: [...items, { type: 'message', id: 'm', content: [{ type: 'output_text', text: '结果：4' }] }] } });
 expect(await readTokenPlanStream(bytes(sse, 1), { onDelta, onThought, onTools })).toBe('结果：4');
 expect(onDelta).toHaveBeenCalledOnce(); expect(onThought).toHaveBeenCalledWith('思考');
 const results = onTools.mock.lastCall![0]; expect(results).toHaveLength(5);
 expect(results[2]).toMatchObject({ code: 'print(2+2)', logs: '4', state: 'done' });
 expect(results[3].images[0].url).toBe('https://images.example.com/cat.png');
 expect(toolHistory(results)).toContain('Verified page'); expect(toolHistory(results)).toContain('print(2+2)');
});

it('fails on provider errors, incomplete results and premature disconnects, even after partial text', async () => {
 for (const ending of ['', frame({ type: 'response.failed', response: { error: { message: 'quota exhausted' } } }), frame({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })]) {
  await expect(readTokenPlanStream(bytes(frame({ type: 'response.output_text.delta', delta: 'partial' }) + ending), { onDelta: vi.fn() })).rejects.toThrow();
 }
 const onTools = vi.fn();
 await expect(readTokenPlanStream(bytes(frame({ type: 'response.output_item.added', item: { id: 'a', type: 'web_search_call', status: 'in_progress' } })), { onDelta: vi.fn(), onTools })).rejects.toThrow();
 expect(onTools.mock.lastCall![0][0]).toMatchObject({ state: 'error', error: 'interrupted' });
 const c = new AbortController(); c.abort(); await expect(readTokenPlanStream(answer(), { onDelta: vi.fn() }, c.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('persists only bounded safe tool evidence and refuses model-fabricated native tool blocks', () => {
 const item = nativeToolResult({ id: 'a', type: 'image_search_call', status: 'completed', apiKey: 'SECRET', output: JSON.stringify([{ title: 'bad', url: 'javascript:alert(1)' }, { title: 'internal', url: 'http://127.0.0.1/a' }, { title: 'safe', url: 'https://example.com/a.png' }]) })!;
 expect(item.images).toHaveLength(1); expect(JSON.stringify(item)).not.toContain('SECRET');
 expect(normalizeChatTool(item.call)).toBeUndefined();
 expect(normalizeToolResults([{ ...item, state: 'running' }])[0]).toMatchObject({ state: 'error', error: 'interrupted' });
 expect(nativeToolResult({ id: 'x', type: 'function_call', name: 'execute_local_shell' })).toBeUndefined();
});

it('sends native tools with the existing key, exact model ID, history and reasoning effort, without a separate search key', async () => {
 const fetchMock = vi.fn().mockResolvedValue(answer()); vi.stubGlobal('fetch', fetchMock);
 const messages = [{ role: 'user' as const, content: 'Remember 47' }, { role: 'assistant' as const, content: '47' }, { role: 'user' as const, content: 'Search then add one' }];
 await streamChat({ model, system: 'test', messages, reasoningEffort: 'max', nativeTools: true, onDelta: vi.fn() });
 const [url, init] = fetchMock.mock.calls[0], body = JSON.parse(init.body);
 expect(url).toBe(tokenPlanEndpoint(provider)); expect(init.headers.Authorization).toBe('Bearer fixture-secret');
 expect(body.model).toBe('deepseek-v4.1-flash-1017'); expect(body.reasoning).toEqual({ effort: 'max' });
 expect(body.input).toHaveLength(3); expect(body.input[1].content[0].type).toBe('output_text');
 expect(body.tools.map((t: any) => t.type)).toEqual(TOKEN_PLAN_TOOLS.slice(0, 3)); expect(body.store).toBe(false);
});

it('keeps image bytes in the current request and disables all network tools when the user turns web access off', async () => {
 vi.mocked(browser.storage.local.get).mockResolvedValue({ qiaomuWebSearch: { enabled: false } });
 const fetchMock = vi.fn().mockResolvedValue(answer()); vi.stubGlobal('fetch', fetchMock);
 await streamChat({ model: { ...model, providerModelId: 'qwen3.8-max' }, system: 's', nativeTools: true, messages: [{ role: 'user', content: 'look', images: [{ label: 'image', dataUrl: 'data:image/png;base64,YQ==' }] }], onDelta: vi.fn() });
 const body = JSON.parse(fetchMock.mock.calls[0][1].body);
 expect(body.tools).toEqual([{ type: 'code_interpreter' }]); expect(body.input[0].content[2]).toMatchObject({ type: 'input_image', image_url: 'data:image/png;base64,YQ==' });
});

it('does not switch other providers or ordinary non-agent requests to the native protocol', async () => {
 const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(bytes('data: {"choices":[{"delta":{"content":"ok"}}]}\n'))); vi.stubGlobal('fetch', fetchMock);
 await streamChat({ model, system: 's', messages: [], onDelta: vi.fn() });
 expect(fetchMock.mock.calls[0][0]).toBe(provider.baseUrl);
 expect(JSON.parse(fetchMock.mock.calls[0][1].body).tools).toBeUndefined();
 generalSettings.providers = [{ ...provider, baseUrl: 'https://another.example/v1/chat/completions' }];
 await streamChat({ model, system: 's', messages: [], nativeTools: true, onDelta: vi.fn() });
 expect(fetchMock.mock.calls[1][0]).toBe('https://another.example/v1/chat/completions');
});

it('forwards native events through the live-page port without exposing the API key', async () => {
 const browser = (await import('./browser-polyfill')).default;
 let receive: (m: unknown) => void = () => {};
 const result = nativeToolResult({ id: 'c', type: 'code_interpreter_call', status: 'completed', code: 'print(4)', outputs: [{ type: 'logs', logs: '4' }] });
 const postMessage = vi.fn(() => queueMicrotask(() => { receive({ nativeTools: [result] }); receive({ delta: '4' }); receive({ done: true }); }));
 (browser.runtime as any).connect = () => ({ postMessage, disconnect: vi.fn(), onMessage: { addListener: (f: typeof receive) => { receive = f; } }, onDisconnect: { addListener: vi.fn() } });
 vi.stubGlobal('location', { protocol: 'https:' }); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const onNativeTools = vi.fn();
 expect(await streamChat({ model, system: 's', messages: [], nativeTools: true, onNativeTools, onDelta: vi.fn() })).toBe('4');
 expect(onNativeTools).toHaveBeenCalledWith([result]); expect(JSON.stringify(postMessage.mock.calls)).not.toContain('fixture-secret'); expect(fetchMock).not.toHaveBeenCalled();
});
