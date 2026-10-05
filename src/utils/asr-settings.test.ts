import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { local: { get: async (key: string) => ({ [key]: state.store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(state.store, JSON.parse(JSON.stringify(value))); } } } } }));
import { MAX_PROFILES, PROVIDERS, activeProfile, cloudConfig, defaultAsrSettings, isConfigured, isHttpsOrLocal, isLocalService, loadAsrSettings, newProfile, profileLabel, providerOf, removeProfile, saveAsrSettings, saveProfile, timestampsFor, withProvider, type AsrProfile } from './asr-settings';
beforeEach(() => { state.store = {}; });
const profile = (patch: Partial<AsrProfile> = {}): AsrProfile => ({ ...newProfile('siliconflow'), apiKey: 'sk-k', ...patch });

it('defaults to the local engine with no cloud service saved', async () => {
	const settings = await loadAsrSettings(); expect(settings).toEqual(defaultAsrSettings()); expect(settings).toMatchObject({ mode: 'local', engine: 'auto', profiles: [], active: '' }); expect(activeProfile(settings)).toBeUndefined();
});

it('keeps several cloud services, one of them active, and repairs anything malformed instead of trusting it', async () => {
	const a = profile({ id: 'a1', apiKey: ' sk-a ' }), b = withProvider(profile({ id: 'b2', apiKey: 'sk-b' }), 'glm');
	await saveAsrSettings({ mode: 'cloud', profiles: [a, b], active: 'b2' });
	const loaded = await loadAsrSettings(); expect(loaded.profiles.map(p => [p.id, p.provider, p.apiKey])).toEqual([['a1', 'siliconflow', 'sk-a'], ['b2', 'glm', 'sk-b']]); expect(activeProfile(loaded)?.id).toBe('b2');
	await saveAsrSettings({ active: 'gone' }); expect((await loadAsrSettings()).active).toBe('a1'); // an unknown active one falls back to the first
	state.store.qiaomuAsrSettings = { mode: 'evil', engine: 'rm -rf', profiles: [{ id: '../x', provider: 'nope', baseUrl: 5, model: {}, apiKey: ['x'] }, 'junk', null, { id: 'a', provider: 'glm' }, { id: 'a', provider: 'glm' }] };
	const bad = await loadAsrSettings(); expect(bad.mode).toBe('local'); expect(bad.engine).toBe('auto'); expect(bad.profiles).toHaveLength(3); expect(new Set(bad.profiles.map(p => p.id)).size).toBe(3); expect(bad.profiles[0]).toMatchObject({ provider: 'custom', baseUrl: '', apiKey: '' });
	state.store.qiaomuAsrSettings = 'garbage'; expect(await loadAsrSettings()).toEqual(defaultAsrSettings());
	state.store.qiaomuAsrSettings = { profiles: Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, provider: 'glm' })) }; expect((await loadAsrSettings()).profiles).toHaveLength(MAX_PROFILES);
});

it('turns settings saved with the single-service layout into the first saved service', async () => {
	state.store.qiaomuAsrSettings = { mode: 'cloud', provider: 'stepfun', baseUrl: 'https://api.stepfun.com/v1', model: 'step-asr', apiKey: 'sk-old', protocol: 'openai-transcriptions' };
	const settings = await loadAsrSettings(); expect(settings.mode).toBe('cloud'); expect(settings.profiles).toHaveLength(1); expect(settings.profiles[0]).toMatchObject({ id: 'p1', provider: 'stepfun', model: 'step-asr', apiKey: 'sk-old' }); expect(settings.active).toBe('p1');
	state.store.qiaomuAsrSettings = { mode: 'local', provider: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B', apiKey: '', protocol: 'openai-transcriptions' };
	expect((await loadAsrSettings()).profiles).toHaveLength(1); // an old untouched default still migrates harmlessly
});

it('saves, replaces and removes one service without touching the others', async () => {
	await saveProfile(profile({ id: 'one' })); await saveProfile(profile({ id: 'two', model: 'FunAudioLLM/SenseVoiceSmall' }));
	await saveProfile({ ...profile({ id: 'one' }), apiKey: 'sk-new' }); const settings = await loadAsrSettings(); expect(settings.profiles.map(p => [p.id, p.apiKey, p.model])).toEqual([['one', 'sk-new', 'Qwen/Qwen3-ASR-1.7B'], ['two', 'sk-k', 'FunAudioLLM/SenseVoiceSmall']]);
	expect((await removeProfile('one')).profiles.map(p => p.id)).toEqual(['two']); expect((await loadAsrSettings()).active).toBe('two');
});

it('names saved services for lists, adding the model only when two share a service', () => {
	const a = profile({ id: 'a' }), b = profile({ id: 'b', model: 'FunAudioLLM/SenseVoiceSmall' }), c = withProvider(profile({ id: 'c' }), 'glm');
	expect(profileLabel(c, [a, c])).toBe('智谱'); expect(profileLabel(a, [a, b, c])).toBe('硅基流动 · Qwen3-ASR-1.7B'); expect(profileLabel(b, [a, b, c])).toBe('硅基流动 · SenseVoiceSmall');
	expect(profileLabel({ ...profile(), provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1' }, [])).toBe('本机服务');
});

it('fills in the address and recommended model of a chosen service, and keeps the key', () => {
	const mimo = withProvider(profile({ apiKey: 'sk-1' }), 'mimo');
	expect(mimo).toMatchObject({ provider: 'mimo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-asr', protocol: 'chat-audio', apiKey: 'sk-1' });
	expect(withProvider(mimo, 'custom')).toMatchObject({ baseUrl: '', model: '', protocol: 'openai-transcriptions' });
	expect(providerOf('siliconflow').defaultModel).toBe('Qwen/Qwen3-ASR-1.7B'); expect(providerOf('unknown').id).toBe('custom'); expect(new Set(PROVIDERS.map(p => p.id)).size).toBe(PROVIDERS.length);
});

it('lets a custom service choose its request style, and only a custom one', async () => {
	await saveProfile({ ...profile({ id: 'c' }), provider: 'custom', baseUrl: 'https://asr.example.com/v1', model: 'm', protocol: 'chat-audio' }); expect((await loadAsrSettings()).profiles[0].protocol).toBe('chat-audio');
	await saveProfile({ ...profile({ id: 'c' }), protocol: 'chat-audio' }); expect((await loadAsrSettings()).profiles[0].protocol).toBe('openai-transcriptions');
});

it('builds the helper\'s view of the service only when it is complete, without the key in it', () => {
	const base = profile({ apiKey: 'sk-secret' });
	const config = cloudConfig(base)!; expect(config).toEqual({ protocol: 'openai-transcriptions', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B', timestamps: 'none', languageParam: false, label: '硅基流动' }); expect(JSON.stringify(config)).not.toContain('sk-secret');
	expect(cloudConfig({ ...base, apiKey: '' })).toBeUndefined(); expect(cloudConfig({ ...base, apiKey: 'has space' })).toBeUndefined(); expect(cloudConfig({ ...base, baseUrl: 'http://evil.example.com' })).toBeUndefined(); expect(cloudConfig({ ...base, model: '' })).toBeUndefined();
	expect(cloudConfig({ ...withProvider(base, 'custom'), baseUrl: 'https://asr.example.com/v1/', model: 'm' })).toMatchObject({ baseUrl: 'https://asr.example.com/v1', label: 'asr.example.com' });
	expect(cloudConfig(withProvider(base, 'groq'))).toMatchObject({ timestamps: 'segments', languageParam: true, label: 'Groq' });
});

it('asks for sentence timing only from models known to return it', () => {
	expect([timestampsFor('groq', 'whisper-large-v3'), timestampsFor('openai', 'whisper-1'), timestampsFor('openai', 'gpt-4o-transcribe'), timestampsFor('siliconflow', 'XingChenAGI/XingChenASR-Diarize-V3.0'), timestampsFor('mimo', 'mimo-v2.5-asr'), timestampsFor('custom', 'x')]).toEqual(['segments', 'segments', 'none', 'none', 'none', 'none']);
});

it('accepts https, or http only on this computer, and never credentials or a query in the address', () => {
	expect(['https://a.example.com/v1', 'http://localhost:8000/v1', 'http://127.0.0.1:9/v1'].map(isHttpsOrLocal)).toEqual([true, true, true]);
	expect(['http://a.example.com', 'https://u:p@a.example.com', 'https://a.example.com/?key=1', 'ftp://a.example.com', 'nope', ''].map(isHttpsOrLocal)).toEqual([false, false, false, false, false, false]);
});

it('knows the services tried with real keys, each with its own address, request style and piece length', () => {
	const config = (id: Parameters<typeof withProvider>[1]) => cloudConfig(withProvider(profile(), id))!;
	expect(config('doubao')).toMatchObject({ protocol: 'doubao-flash', baseUrl: 'https://openspeech.bytedance.com/api/v3', model: 'bigmodel', label: '豆包语音', chunkSeconds: 300, maxChunkSeconds: 540 });
	expect(config('glm')).toMatchObject({ protocol: 'openai-transcriptions', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-asr-2512', label: '智谱', maxChunkSeconds: 28 });
	expect(config('stepfun')).toMatchObject({ baseUrl: 'https://api.stepfun.com/v1', model: 'stepaudio-2.5-asr', label: '阶跃星辰' }); expect(config('stepfun').maxChunkSeconds).toBeUndefined();
	expect(config('mimo')).toMatchObject({ protocol: 'chat-audio', label: '小米' });
	expect(providerOf('doubao').keyHelp).toContain('volcengine'); expect(PROVIDERS[0].id).toBe('siliconflow'); expect(PROVIDERS[PROVIDERS.length - 1].id).toBe('custom');
	for (const provider of PROVIDERS) { if (provider.id !== 'custom' && provider.id !== 'local') { expect(provider.models).toContain(provider.defaultModel); expect(provider.baseUrl.startsWith('https://')).toBe(true); } }
});

it('recognises a service on this computer, so the audio is not said to leave it', () => {
	expect(['http://127.0.0.1:8000/v1', 'http://localhost:9000/v1', 'http://[::1]:1/v1'].map(isLocalService)).toEqual([true, true, true]);
	expect(['https://api.example.com/v1', 'https://localhost.evil.com/v1', 'nope'].map(isLocalService)).toEqual([false, false, false]);
	expect(cloudConfig(profile({ apiKey: 'none', provider: 'custom', baseUrl: 'http://127.0.0.1:8000/v1', model: 'whisper-1' }))).toMatchObject({ label: '本机服务', baseUrl: 'http://127.0.0.1:8000/v1' });
});

it('lets a service on this computer work without a key, and still requires one for any other', () => {
	const local = withProvider(profile({ apiKey: '' }), 'local');
	expect(local).toMatchObject({ baseUrl: 'http://127.0.0.1:8765/v1', model: 'Qwen/Qwen3-ASR-0.6B' }); expect(isConfigured(local)).toBe(true); expect(cloudConfig(local)).toMatchObject({ label: '本机服务' });
	expect(isConfigured({ ...local, baseUrl: 'https://api.example.com/v1' })).toBe(false); expect(isConfigured({ ...local, model: '' })).toBe(false); expect(isConfigured(profile({ apiKey: '' }))).toBe(false);
});

it('lets each site have its own way of recognising, falling back to the default, and drops choices that no longer exist', async () => {
	const { PLATFORMS, choosePatch, defaultRecognizer, effectiveFor, platformOf, recognizerFor } = await import('./asr-settings');
	expect(PLATFORMS).toEqual(['youtube', 'bilibili', 'xiaoyuzhou', 'file', 'web']); expect(['youtube:abcdefghijk', 'bilibili:BV1hM4m1U7rA:2', 'xiaoyuzhou:' + 'a'.repeat(24), 'file:' + 'b'.repeat(32), 'web:' + 'c'.repeat(12), 'rss:' + 'a'.repeat(12) + ':' + 'b'.repeat(16), 'nope', 5].map(platformOf)).toEqual(['youtube', 'bilibili', 'xiaoyuzhou', 'file', 'web', 'xiaoyuzhou', undefined, undefined]);
	await saveAsrSettings({ profiles: [profile({ id: 'a1' }), profile({ id: 'b2', provider: 'glm' })], mode: 'cloud', active: 'a1', routes: { bilibili: 'cloud:b2', youtube: 'local:mlx-qwen3', file: 'cloud:gone', xiaoyuzhou: 'local:evil' } });
	const settings = await loadAsrSettings(); expect(settings.routes).toEqual({ bilibili: 'cloud:b2', youtube: 'local:mlx-qwen3' });
	expect(defaultRecognizer(settings)).toBe('cloud:a1'); expect(recognizerFor(settings, 'bilibili')).toBe('cloud:b2'); expect(recognizerFor(settings, 'xiaoyuzhou')).toBe('cloud:a1'); expect(recognizerFor(settings)).toBe('cloud:a1');
	expect(effectiveFor(settings, 'youtube')).toMatchObject({ mode: 'local', engine: 'mlx-qwen3' }); expect(effectiveFor(settings, 'bilibili')).toMatchObject({ mode: 'cloud', active: 'b2' }); expect(effectiveFor(settings, 'file')).toMatchObject({ mode: 'cloud', active: 'a1' });
	expect(choosePatch(settings, 'local:mlx', 'file')).toEqual({ routes: { bilibili: 'cloud:b2', youtube: 'local:mlx-qwen3', file: 'local:mlx' } }); expect(choosePatch(settings, 'cloud:b2')).toEqual({ mode: 'cloud', active: 'b2' }); expect(choosePatch(settings, 'local:auto')).toEqual({ mode: 'local', engine: 'auto' });
	expect((await removeProfile('b2')).routes).toEqual({ youtube: 'local:mlx-qwen3' }); // a route to a deleted service goes too
});

it('names a saved service by the name the viewer gave it, and keeps icons for every way of recognising', async () => {
	const { iconOf, LOCAL_ENGINES } = await import('./asr-settings');
	expect(profileLabel(profile({ name: '  便宜的  ' }))).toBe('便宜的'); await saveProfile(profile({ id: 'n1', name: 'x'.repeat(80) })); expect((await loadAsrSettings()).profiles[0].name).toHaveLength(40);
	for (const id of [...PROVIDERS.map(p => p.id), ...LOCAL_ENGINES.map(e => e.id)]) expect(iconOf(id).text.length).toBeGreaterThan(0); expect(iconOf('unknown').text).toBe('＋');
});
