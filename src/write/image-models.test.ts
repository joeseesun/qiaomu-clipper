import { beforeEach, expect, it, vi } from 'vitest';

const { store, settings } = vi.hoisted(() => ({ store: {} as Record<string, unknown>, settings: { providers: [] as any[] } }));
vi.mock('../utils/storage-utils', () => ({ getLocalStorage: async (k: string) => store[k], setLocalStorage: async (k: string, v: unknown) => { store[k] = v; }, generalSettings: settings, oauthStore: {} }));
vi.mock('../utils/oauth/accounts', () => ({
	CHATGPT_BASE: 'https://api.openai.com/v1', CODEX_BASE: 'https://chatgpt.com/backend-api/codex',
	freshOAuth: async (provider: any) => provider.oauth,
	oauthModelsRequest: (oauth: any) => oauth.kind === 'codex' ? { url: 'https://chatgpt.com/backend-api/codex/models?client_version=1', headers: { Authorization: `Bearer ${oauth.access}` } } : { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${oauth.access}` } },
}));
import { IMAGE_SOURCES, accountSources, arkBody, arkSize, fetchImageModels, generateImage, imageFromResponsesEvents, isReady, labelOf, loadImageModels, modelsOf, normalizeStore, openAiSize, saveImageModels, serviceName, type ImageModelConfig } from './image-models';

const model = (over: Partial<ImageModelConfig> = {}): ImageModelConfig => ({ id: 'a', sourceId: 'openai', engine: 'api', name: '', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-image-1', models: ['gpt-image-1'], ...over });
const PNG_B64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
const calls: { url: string; init: any }[] = [];
const respond = (payload: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(payload), { status }); }));
beforeEach(() => { settings.providers = []; calls.length = 0; for (const k of Object.keys(store)) delete store[k]; vi.unstubAllGlobals(); });

it('keeps only usable saved models and falls back to the first as the default', async () => {
	await saveImageModels({ models: [model(), { ...model({ id: 'b' }), engine: 'bogus' as never }, { id: 'c' } as never], defaultId: 'zzz' });
	const loaded = await loadImageModels();
	expect(loaded.models.map(m => m.id)).toEqual(['a']);
	expect(loaded.defaultId).toBe('a');
	expect(normalizeStore(undefined)).toEqual({ models: [], defaultId: '' });
});

it('knows when a model can be called', () => {
	expect(isReady(model())).toBe(true);
	expect(isReady(model({ apiKey: '' }))).toBe(false);
	expect(isReady(model({ apiKey: '', baseUrl: 'http://localhost:8080/v1' }))).toBe(true);
	expect(isReady(model({ engine: 'ark', baseUrl: '', apiKey: 'k' }))).toBe(true);
	expect(isReady(model({ model: ' ' }))).toBe(false);
	expect(labelOf(model())).toBe('OpenAI · gpt-image-1');
	expect(serviceName(model({ name: '我的' }))).toBe('我的');
	expect(IMAGE_SOURCES.map(s => s.id)).toContain('siliconflow');
});

it('maps an aspect ratio to the sizes each service accepts', () => {
	expect(openAiSize('16:9')).toBe('1536x1024');
	expect(openAiSize('9:16')).toBe('1024x1536');
	expect(openAiSize('1:1')).toBe('1024x1024');
	expect(arkSize('doubao-seedream-5-0-pro-260628', '16:9')).toBe('2728x1536');
	expect(arkSize('doubao-seedream-3-0-t2i-250415', '1:1')).toBe('1024x1024');
	expect(arkBody('doubao-seedream-4-0-250828', '一只猫', '1:1')).toMatchObject({ size: '2048x2048', response_format: 'b64_json', watermark: false });
});

it('calls an OpenAI-compatible endpoint and returns the picture', async () => {
	respond({ data: [{ b64_json: PNG_B64 }] });
	const blob = await generateImage(model(), '山水', '16:9');
	expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
	expect(calls[0].init.headers.Authorization).toBe('Bearer sk-1');
	expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'gpt-image-1', prompt: '山水', size: '1536x1024', n: 1 });
	expect(blob.type).toBe('image/png');
	expect(blob.size).toBe(7);
});

it('talks to Seedream, Gemini and OpenRouter in their own ways', async () => {
	respond({ data: [{ b64_json: PNG_B64 }] });
	await generateImage(model({ engine: 'ark', sourceId: 'ark', baseUrl: '', model: 'doubao-seedream-5-0-pro-260628' }), 'x', '1:1');
	expect(calls[0].url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
	respond({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }] });
	await generateImage(model({ engine: 'gemini', sourceId: 'gemini', baseUrl: '', model: 'gemini-2.5-flash-image' }), 'x', '3:4');
	expect(calls[1].url).toContain('/models/gemini-2.5-flash-image:generateContent');
	expect(calls[1].init.headers['x-goog-api-key']).toBe('sk-1');
	expect(JSON.parse(calls[1].init.body).generationConfig.imageConfig.aspectRatio).toBe('3:4');
	respond({ data: [{ b64_json: PNG_B64 }] });
	await generateImage(model({ engine: 'openrouter', sourceId: 'openrouter', baseUrl: '', model: 'google/gemini-2.5-flash-image' }), 'x', '1:1');
	expect(calls[2].url).toBe('https://openrouter.ai/api/v1/images');
});

it('reports the service error instead of an empty picture', async () => {
	respond({ error: { message: 'content policy' } }, 400);
	await expect(generateImage(model(), 'x')).rejects.toThrow(/HTTP 400: content policy/);
	respond({ data: [] });
	await expect(generateImage(model(), 'x')).rejects.toThrow('empty-image');
	await expect(generateImage(model({ apiKey: '' }), 'x')).rejects.toThrow('not-ready');
	await expect(generateImage(model(), '  ')).rejects.toThrow('empty-prompt');
});


it('keeps every model a service offers, with the default first', async () => {
	await saveImageModels({ models: [model({ model: 'b', models: ['a', 'b', 'a', ''] }), model({ id: 'c', model: 'x', models: undefined as never })], defaultId: 'a' });
	const loaded = await loadImageModels();
	expect(loaded.models[0].models).toEqual(['b', 'a']);
	expect(modelsOf(loaded.models[0])).toEqual(['b', 'a']);
	expect(loaded.models[1].models).toEqual(['x']);
});

it('can draw with any of the service\'s models, chosen per picture', async () => {
	respond({ data: [{ b64_json: PNG_B64 }] });
	await generateImage(model({ models: ['gpt-image-1', 'gpt-image-2'] }), '山', '1:1', undefined, 'gpt-image-2');
	expect(JSON.parse(calls[0].init.body).model).toBe('gpt-image-2');
});

const chatgpt = { id: 'prov', name: 'ChatGPT', baseUrl: '', apiKey: '', oauth: { kind: 'chatgpt', access: 'tok', refresh: 'r', expires: Date.now() + 3_600_000, clientId: 'c' } };
const codex = { id: 'cdx', name: 'Codex', baseUrl: '', apiKey: '', oauth: { kind: 'codex', access: 'ctok', refresh: 'r', expires: Date.now() + 3_600_000, clientId: 'c', accountId: 'acct' } };
const account = (provider: any, over: Partial<ImageModelConfig> = {}): ImageModelConfig => model({ sourceId: `account:${provider.id}`, engine: 'oauth', providerId: provider.id, apiKey: '', baseUrl: '', model: 'gpt-image-1', models: ['gpt-image-1'], ...over });

it('offers signed-in ChatGPT and Codex accounts as keyless services and needs the sign-in to be there', () => {
	settings.providers = [chatgpt, codex, { id: 'plain', name: 'Plain', baseUrl: 'x', apiKey: 'k' }];
	expect(accountSources().map(s => [s.id, s.engine, s.providerId])).toEqual([['account:prov', 'oauth', 'prov'], ['account:cdx', 'oauth', 'cdx']]);
	expect(isReady(account(chatgpt))).toBe(true);
	expect(serviceName(account(chatgpt))).toBe('ChatGPT');
	settings.providers = [];
	expect(isReady(account(chatgpt))).toBe(false);
});

it('draws through a ChatGPT sign-in with the Images API and its token', async () => {
	settings.providers = [chatgpt];
	respond({ data: [{ b64_json: PNG_B64 }] });
	const blob = await generateImage(account(chatgpt), '山水', '16:9');
	expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
	expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
	expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'gpt-image-1', size: '1536x1024' });
	expect(blob.size).toBe(7);
});

it('draws through a Codex sign-in with the image tool and reads the picture from the event stream', async () => {
	settings.providers = [codex];
	const events = [`data: ${JSON.stringify({ type: 'response.image_generation_call.partial_image', partial_image_b64: btoa('partial') })}`, `data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: PNG_B64 } })}`, 'data: [DONE]'].join('\n');
	vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(events, { status: 200 }); }));
	const blob = await generateImage(account(codex, { model: 'gpt-5.5', models: ['gpt-5.5'] }), '山水', '1:1');
	expect(calls[0].url).toBe('https://chatgpt.com/backend-api/codex/responses');
	expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer ctok', 'chatgpt-account-id': 'acct' });
	const body = JSON.parse(calls[0].init.body);
	expect(body).toMatchObject({ model: 'gpt-5.5', stream: true, store: false, tool_choice: { type: 'image_generation' } });
	expect(body.tools[0]).toMatchObject({ type: 'image_generation', size: '1024x1024' });
	expect(blob.size).toBe(7);
});

it('falls back to the last preview, and reports a failed or empty stream', () => {
	const partial = `data: ${JSON.stringify({ type: 'response.image_generation_call.partial_image', partial_image_b64: 'AAA' })}`;
	expect(imageFromResponsesEvents([partial])).toEqual({ b64: undefined, partial: 'AAA' });
	expect(imageFromResponsesEvents(['data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZZZ"}]}}']).b64).toBe('ZZZ');
	expect(() => imageFromResponsesEvents(['data: {"type":"response.failed","response":{"error":{"message":"policy"}}}'])).toThrow('policy');
	expect(imageFromResponsesEvents(['', ': keep-alive', 'data: [DONE]'])).toEqual({ b64: undefined, partial: undefined });
});

it('loads the models a service offers, narrowed to picture models', async () => {
	const openai = IMAGE_SOURCES.find(s => s.id === 'openai')!;
	respond({ data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'dall-e-3' }, { id: 'text-embedding-3' }] });
	expect((await fetchImageModels(openai, '', 'sk-1')).map(m => m.id)).toEqual(['gpt-image-1', 'dall-e-3']);
	expect(calls[0].url).toBe('https://api.openai.com/v1/models');
	respond({ data: [{ id: 'only-chat-a' }, { id: 'only-chat-b' }] });
	expect((await fetchImageModels(IMAGE_SOURCES.find(s => s.id === 'custom')!, 'https://relay.example/v1', 'k')).length).toBe(2);
	respond({ data: [{ id: 'google/gemini-2.5-flash-image', name: 'Gemini Image' }] });
	expect((await fetchImageModels(IMAGE_SOURCES.find(s => s.id === 'openrouter')!, '', ''))[0]).toEqual({ id: 'google/gemini-2.5-flash-image', name: 'Gemini Image' });
	expect(calls[calls.length - 1].url).toContain('output_modalities=image');
	respond({ models: [{ name: 'models/gemini-2.5-flash-image', displayName: 'Nano Banana' }, { name: 'models/gemini-2.5-pro' }] });
	expect((await fetchImageModels(IMAGE_SOURCES.find(s => s.id === 'gemini')!, '', 'g')).map(m => m.id)).toEqual(['gemini-2.5-flash-image']);
	settings.providers = [chatgpt];
	respond({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-image-1' }] });
	expect((await fetchImageModels(accountSources()[0], '', '')).map(m => m.id)).toEqual(['gpt-image-1']);
	settings.providers = [codex];
	respond({ models: [{ slug: 'gpt-5.5' }, { slug: 'codex-mini' }, { slug: 'o3' }] });
	expect(await fetchImageModels(accountSources()[0], '', '')).toEqual([{ id: 'imagegen', name: '内置 ImageGen' }]);
	expect(fetch).not.toHaveBeenCalled();
	expect(await fetchImageModels(IMAGE_SOURCES.find(s => s.id === 'codex-local')!, '', '')).toEqual([{ id: 'imagegen', name: '内置 ImageGen' }]);
	expect(fetch).not.toHaveBeenCalled();
});

it('migrates Codex chat-model selections into internal orchestration and exposes only ImageGen', async () => {
	settings.providers = [codex];
	const legacy = account(codex, { name: '我的 Codex', model: 'gpt-5.6-sol', models: ['gpt-5.6-sol', 'codex-auto-review'], catalog: { baseUrl: '', models: [{ id: 'codex-auto-review' }] } });
	const local = model({ id: 'local', engine: 'codex', sourceId: 'codex-local', apiKey: '', baseUrl: '', model: 'default', models: ['default', 'gpt-6-sol'] });
	const normalized = normalizeStore({ models: [legacy, local], defaultId: legacy.id });
	expect(normalized.models[0]).toMatchObject({ name: '我的 Codex', providerId: codex.id, model: 'imagegen', models: ['imagegen'], agentModel: 'gpt-5.6-sol' });
	expect(normalized.models[0].catalog).toBeUndefined();
	expect(normalized.models[1]).toMatchObject({ model: 'imagegen', models: ['imagegen'] });
	expect(normalized.models[1].agentModel).toBeUndefined();
	expect(normalizeStore(normalized)).toEqual(normalized);
	expect(modelsOf(legacy)).toEqual(['imagegen']);
	expect(labelOf(legacy)).toBe('我的 Codex · 内置 ImageGen');
	vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(`data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: PNG_B64 } })}`); }));
	await generateImage(normalized.models[0], '山水', '1:1', undefined, 'imagegen', codex as any);
	expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'gpt-5.6-sol', tool_choice: { type: 'image_generation' } });
	expect(normalized.defaultId).toBe(legacy.id);
});

it('migrates only the known Jimeng deployment without losing its key, address or default service', async () => {
	const legacy = model({ sourceId: 'custom', baseUrl: 'https://www.t5t6.com/jimeng-api/v1/', name: '我的即梦', model: 'jimeng', models: ['jimeng', 'jimeng-5.0', 'jimeng-video-3.0'] });
	const result = normalizeStore({ models: [legacy], defaultId: 'a' });
	expect(result.models[0]).toMatchObject({ engine: 'jimeng', sourceId: 'jimeng', baseUrl: legacy.baseUrl, apiKey: 'sk-1', name: '我的即梦', model: 'jimeng-4.5', models: ['jimeng-4.5', 'jimeng-5.0'] });
	expect(result.defaultId).toBe('a');
	expect(normalizeStore(result)).toEqual(result);
	for (const baseUrl of ['https://other.example/v1', 'https://www.t5t6.com.evil.example/jimeng-api/v1', 'https://www.t5t6.com/other/v1']) {
		expect(normalizeStore({ models: [{ ...legacy, baseUrl }] }).models[0].engine).toBe('api');
	}
});

it('uses the Jimeng protocol at any deployment address and keeps standard OpenAI requests unchanged', async () => {
	respond({ data: [{ b64_json: PNG_B64 }] });
	const config = model({ sourceId: 'jimeng', engine: 'jimeng' as never, baseUrl: 'https://my-jimeng.example/api/v1/', model: 'jimeng-5.0' });
	await generateImage(config, '山水', '9:16');
	expect(calls[0].url).toBe('https://my-jimeng.example/api/v1/images/generations');
	expect(JSON.parse(calls[0].init.body)).toEqual({ model: 'jimeng-5.0', prompt: '山水', ratio: '9:16', resolution: '2k', response_format: 'url' });
	expect(isReady({ ...config, baseUrl: '' })).toBe(false);
	await generateImage(model(), '山水', '9:16');
	expect(JSON.parse(calls[1].init.body).size).toBe('1024x1536');
});

it('preserves business errors returned with HTTP 200 instead of claiming the image was empty', async () => {
	respond({ code: -1000, message: '不支持的参数: size。请使用 ratio 和 resolution 参数控制图像尺寸。', data: null });
	await expect(generateImage(model(), 'x')).rejects.toThrow('不支持的参数: size');
});

it('discovers future image models by output capabilities and never offers video models', async () => {
	const source = IMAGE_SOURCES.find(s => s.id === 'custom')!;
	respond({ data: [
		{ id: 'jimeng-5.1', type: 'image', display_name: '即梦 5.1' },
		{ id: 'future-model', capabilities: { output_modalities: ['image'] } },
		{ id: 'sees-images', architecture: { input_modalities: ['image'], output_modalities: ['text'] } },
		{ id: 'jimeng-video-3.0' }, { id: 'image-to-video', type: 'video' },
	] });
	expect((await fetchImageModels(source, 'https://example.com/v1', 'k')).map(m => m.id)).toEqual(['jimeng-5.1', 'future-model']);
	respond({ data: [{ id: 'jimeng' }, { id: 'jimeng-video-3.0' }] });
	expect((await fetchImageModels(source, 'https://example.com/v1', 'k')).map(m => m.id)).toEqual(['jimeng']);
	respond({ data: [{ id: 'jimeng-video-3.0' }] });
	expect(await fetchImageModels(source, 'https://example.com/v1', 'k')).toEqual([]);
});
