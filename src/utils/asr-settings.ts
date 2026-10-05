import browser from './browser-polyfill';

// How subtitles are generated for a video that has none: on this computer with Whisper (default, nothing uploaded), or by
// a cloud recognition service the viewer chose and pays for. The service's key is kept in this browser only (storage.local,
// never synced) and is read by the background worker, so no page ever sees it.
export type AsrMode = 'local' | 'cloud';
export type AsrProtocol = 'openai-transcriptions' | 'chat-audio' | 'doubao-flash';
export type AsrProviderId = 'siliconflow' | 'doubao' | 'glm' | 'stepfun' | 'mimo' | 'groq' | 'openai' | 'local' | 'custom';
export interface AsrProvider { contextMode?: 'doubao' | 'prompt'; id: AsrProviderId; label: string; protocol: AsrProtocol; baseUrl: string; models: string[]; defaultModel: string; keyHelp?: string; note?: string; chunkSeconds?: number; maxChunkSeconds?: number }
// One saved cloud service (address, model, key). Several can be kept; one is the active one.
export interface AsrProfile { id: string; provider: AsrProviderId; baseUrl: string; model: string; apiKey: string; protocol: AsrProtocol; name?: string }
// `mode` and `engine` say how subtitles are made by default: 'local' with the engine `engine` ('auto' = the best one installed), or 'cloud' with the active profile.
export type LocalEngineId = 'auto' | 'mlx' | 'mlx-qwen3' | 'faster-whisper' | 'whispercpp';
// `autoStart`: pressing "generate subtitles" starts at once with the chosen engine or service instead of asking first (set by the viewer, in the settings or by ticking "remember" in the confirm step).
// Where the video or audio comes from: each can use its own way of recognising (`routes`), otherwise the default one applies.
export type AsrPlatform = 'youtube' | 'bilibili' | 'xiaoyuzhou' | 'file' | 'web';
export const PLATFORMS: AsrPlatform[] = ['youtube', 'bilibili', 'xiaoyuzhou', 'file', 'web'];
// A way of recognising, written 'local:<engine>' (a local engine; 'local:auto' = the best one installed) or 'cloud:<saved service id>'.
export type Recognizer = string;
export interface AsrSettings { useContext: boolean; mode: AsrMode; engine: LocalEngineId; profiles: AsrProfile[]; active: string; autoStart: boolean; routes: Partial<Record<AsrPlatform, Recognizer>> }
export interface CloudConfig { contextMode?: 'doubao' | 'prompt'; protocol: AsrProtocol; baseUrl: string; model: string; timestamps: 'none' | 'segments'; languageParam: boolean; label: string; chunkSeconds?: number; maxChunkSeconds?: number }

// Tried with real keys on a 5-minute Chinese lecture (all within 0.3 points of each other against a local Whisper reference): SiliconFlow
// (Qwen3-ASR is fast and steady; SenseVoice queues), Doubao, GLM, StepFun and Xiaomi MiMo. Groq and OpenAI follow the same published
// OpenAI-style API but were not tried here.
export const PROVIDERS: AsrProvider[] = [
	{ id: 'siliconflow', label: '硅基流动 SiliconFlow', protocol: 'openai-transcriptions', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen3-ASR-1.7B', models: ['Qwen/Qwen3-ASR-1.7B', 'FunAudioLLM/SenseVoiceSmall', 'XingChenAGI/XingChenASR-V3.2', 'XingChenAGI/XingChenASR-Diarize-V3.0'], keyHelp: 'https://cloud.siliconflow.cn/account/ak', note: '推荐 Qwen3-ASR：5 分钟音频约 5 秒，术语识别准确。SenseVoice 排队时很慢。' },
	{ id: 'doubao', contextMode: 'doubao', label: '豆包语音（火山引擎）', protocol: 'doubao-flash', baseUrl: 'https://openspeech.bytedance.com/api/v3', defaultModel: 'bigmodel', models: ['bigmodel'], chunkSeconds: 300, maxChunkSeconds: 540, keyHelp: 'https://console.volcengine.com/speech/new/experience/asr', note: '录音文件识别极速版：服务端直接返回逐句时间，时间轴最准；API Key 是控制台里的 UUID，需先开通「极速版」。' },
	{ id: 'glm', label: '智谱 GLM', protocol: 'openai-transcriptions', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-asr-2512', models: ['glm-asr-2512'], chunkSeconds: 18, maxChunkSeconds: 28, keyHelp: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', note: '单次最长 30 秒，扩展会自动按 28 秒内切块；速度很快。' },
	{ id: 'stepfun', label: '阶跃星辰 StepFun', protocol: 'openai-transcriptions', baseUrl: 'https://api.stepfun.com/v1', defaultModel: 'stepaudio-2.5-asr', models: ['stepaudio-2.5-asr', 'step-asr'], keyHelp: 'https://platform.stepfun.com/interface-key', note: '5 分钟音频约 15–20 秒。' },
	{ id: 'mimo', label: '小米 MiMo', protocol: 'chat-audio', baseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5-asr', models: ['mimo-v2.5-asr'], note: '支持粤语、吴语、闽南语、四川话；语言只分 中文 / 英文 / 自动。' },
	{ id: 'groq', contextMode: 'prompt', label: 'Groq（Whisper）', protocol: 'openai-transcriptions', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'whisper-large-v3-turbo', models: ['whisper-large-v3-turbo', 'whisper-large-v3'], keyHelp: 'https://console.groq.com/keys', note: '返回句子级时间戳。未在本机实测。' },
	{ id: 'openai', contextMode: 'prompt', label: 'OpenAI', protocol: 'openai-transcriptions', baseUrl: 'https://api.openai.com/v1', defaultModel: 'whisper-1', models: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'], keyHelp: 'https://platform.openai.com/api-keys', note: 'whisper-1 返回句子级时间戳。未在本机实测。' },
	{ id: 'local', label: '本机服务（OpenAI 兼容）', protocol: 'openai-transcriptions', baseUrl: 'http://127.0.0.1:8765/v1', defaultModel: 'Qwen/Qwen3-ASR-0.6B', models: ['Qwen/Qwen3-ASR-0.6B', 'whisper-1'], note: '你自己在本机运行的识别服务，音频不离开这台电脑，不需要 API Key。已用 mlx-qwen3-asr 试过：uvx --from "mlx-qwen3-asr[serve]" mlx-qwen3-asr serve --host 127.0.0.1（5 分钟音频约 10 秒）。whisper.cpp server、faster-whisper-server 等同样适用。' },
	{ id: 'custom', label: '自定义（OpenAI 兼容接口）', protocol: 'openai-transcriptions', baseUrl: '', defaultModel: '', models: [], note: '任何兼容 /audio/transcriptions 的服务都行。地址填 http://127.0.0.1:端口/v1 就是本机上的识别服务（如 whisper.cpp server、faster-whisper-server），音频不会离开这台电脑。' },
];
export const providerOf = (id: string): AsrProvider => PROVIDERS.find(provider => provider.id === id) ?? PROVIDERS[PROVIDERS.length - 1];

export const LOCAL_ENGINE_IDS: LocalEngineId[] = ['auto', 'mlx', 'mlx-qwen3', 'faster-whisper', 'whispercpp'];
export const MAX_PROFILES = 12;
export const defaultAsrSettings = (): AsrSettings => ({ mode: 'local', engine: 'auto', profiles: [], active: '', autoStart: false, routes: {}, useContext: true });
const KEY = 'qiaomuAsrSettings';
const newId = () => 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
export const newProfile = (provider: AsrProviderId = 'siliconflow'): AsrProfile => { const info = providerOf(provider); return { id: newId(), provider: info.id, baseUrl: info.baseUrl, model: info.defaultModel, apiKey: '', protocol: info.protocol }; };

const cleanProfile = (value: unknown, taken: Set<string>): AsrProfile | undefined => {
	if (!value || typeof value !== 'object') return undefined;
	const v = value as Partial<AsrProfile>, provider = providerOf(String(v.provider || 'siliconflow')), custom = provider.id === 'custom';
	let id = typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(v.id) ? v.id : newId(); while (taken.has(id)) id = newId(); taken.add(id);
	return {
		id, provider: provider.id,
		baseUrl: typeof v.baseUrl === 'string' && v.baseUrl.trim() ? v.baseUrl.trim().slice(0, 300) : provider.baseUrl,
		model: typeof v.model === 'string' && v.model.trim() ? v.model.trim().slice(0, 100) : provider.defaultModel,
		apiKey: typeof v.apiKey === 'string' ? v.apiKey.trim().slice(0, 300) : '',
		protocol: custom && (v.protocol === 'chat-audio' || v.protocol === 'doubao-flash') ? v.protocol : provider.protocol,
		...(typeof v.name === 'string' && v.name.trim() ? { name: v.name.trim().slice(0, 40) } : {}),
	};
};
const validRecognizer = (value: string, profiles: AsrProfile[]): boolean => value.startsWith('local:') ? (LOCAL_ENGINE_IDS as string[]).includes(value.slice(6)) : value.startsWith('cloud:') && profiles.some(item => item.id === value.slice(6));
// Settings saved before several services could be kept hold one service at the top level: it becomes the first profile.
const clean = (value: unknown): AsrSettings => {
	const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>, taken = new Set<string>();
	const raw = Array.isArray(v.profiles) ? v.profiles : (typeof v.provider === 'string' && (v.apiKey || v.baseUrl) ? [{ ...v, id: 'p1' }] : []);
	const profiles = raw.slice(0, MAX_PROFILES).map(item => cleanProfile(item, taken)).filter((item): item is AsrProfile => Boolean(item));
	const active = profiles.some(item => item.id === v.active) ? String(v.active) : (profiles[0]?.id ?? '');
	const routes: AsrSettings['routes'] = {};
	if (v.routes && typeof v.routes === 'object') for (const platform of PLATFORMS) { const value = (v.routes as Record<string, unknown>)[platform]; if (typeof value === 'string' && validRecognizer(value, profiles)) routes[platform] = value; }
	return { mode: v.mode === 'cloud' ? 'cloud' : 'local', engine: LOCAL_ENGINE_IDS.includes(v.engine as LocalEngineId) ? v.engine as LocalEngineId : 'auto', profiles, active, autoStart: v.autoStart === true, routes, useContext: v.useContext !== false };
};
export async function loadAsrSettings(): Promise<AsrSettings> {
	try { return clean((await browser.storage.local.get(KEY))[KEY]); } catch { return defaultAsrSettings(); }
}
export async function saveAsrSettings(patch: Partial<AsrSettings>): Promise<AsrSettings> {
	const next = clean({ ...(await loadAsrSettings()), ...patch });
	await browser.storage.local.set({ [KEY]: next }); return next;
}
export const activeProfile = (settings: AsrSettings): AsrProfile | undefined => settings.profiles.find(item => item.id === settings.active) ?? settings.profiles[0];
// Change one profile and save.
export const saveProfile = async (profile: AsrProfile): Promise<AsrSettings> => { const settings = await loadAsrSettings(); return saveAsrSettings({ profiles: settings.profiles.some(item => item.id === profile.id) ? settings.profiles.map(item => item.id === profile.id ? profile : item) : [...settings.profiles, profile] }); };
export const removeProfile = async (id: string): Promise<AsrSettings> => { const settings = await loadAsrSettings(); return saveAsrSettings({ profiles: settings.profiles.filter(item => item.id !== id) }); };
// Choosing a service fills in its address and its recommended model; the key stays.
export const withProvider = (profile: AsrProfile, id: AsrProviderId): AsrProfile => { const provider = providerOf(id); return { ...profile, provider: provider.id, baseUrl: provider.baseUrl, model: provider.defaultModel, protocol: provider.protocol }; };
// Podcasts from a feed count as podcasts, like Xiaoyuzhou ones.
export const platformOf = (videoKey: unknown): AsrPlatform | undefined => typeof videoKey === 'string' ? (videoKey.startsWith('rss:') ? 'xiaoyuzhou' : PLATFORMS.find(platform => videoKey.startsWith(platform + ':')) as AsrPlatform | undefined) : undefined;
export const defaultRecognizer = (settings: AsrSettings): Recognizer => settings.mode === 'cloud' && activeProfile(settings) ? 'cloud:' + activeProfile(settings)!.id : 'local:' + settings.engine;
// What applies to a platform: its own choice if it has one, else the default.
export const recognizerFor = (settings: AsrSettings, platform?: AsrPlatform): Recognizer => (platform ? settings.routes[platform] : undefined) || defaultRecognizer(settings);
// The settings as they apply to one platform: mode, engine and active service replaced by that platform's choice.
export const effectiveFor = (settings: AsrSettings, platform?: AsrPlatform): AsrSettings => {
	const value = recognizerFor(settings, platform);
	return value.startsWith('cloud:') ? { ...settings, mode: 'cloud', active: value.slice(6) } : { ...settings, mode: 'local', engine: value.slice(6) as LocalEngineId };
};
// The settings patch that makes `value` the choice for a platform (or the default, with no platform).
export const choosePatch = (settings: AsrSettings, value: Recognizer, platform?: AsrPlatform): Partial<AsrSettings> => {
	if (platform) { const routes = { ...settings.routes }; routes[platform] = value; return { routes }; }
	return value.startsWith('cloud:') ? { mode: 'cloud', active: value.slice(6) } : { mode: 'local', engine: value.slice(6) as LocalEngineId };
};
// A short name for a saved service, for lists: the service's name (and the model when several share a service).
export function profileLabel(profile: AsrProfile, all: AsrProfile[] = []): string {
	if (profile.name?.trim()) return profile.name.trim();
	const info = providerOf(profile.provider);
	const base = isLocalService(profile.baseUrl) ? '本机服务' : info.id === 'custom' ? (() => { try { return new URL(profile.baseUrl).hostname; } catch { return '自定义'; } })() : info.label.split(/[\s（(]/)[0];
	return all.filter(item => item.provider === profile.provider).length > 1 && profile.model ? `${base} · ${profile.model.split('/').pop()}` : base;
}

// Whether the service is asked for sentence timing. Only models known to return it are asked: asking another one for
// `verbose_json` can make it fail, and a service that returns segments anyway is read either way.
export function timestampsFor(provider: AsrProviderId, model: string): 'none' | 'segments' {
	if (provider === 'groq') return 'segments';
	if (provider === 'openai') return model === 'whisper-1' ? 'segments' : 'none';
	return 'none';
}
export const isHttpsOrLocal = (value: string): boolean => { try { const url = new URL(value); return !url.username && !url.password && !url.search && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))); } catch { return false; } };
// A service on this computer often needs no key.
export const isConfigured = (settings: AsrProfile): boolean => Boolean((settings.apiKey || isLocalService(settings.baseUrl)) && settings.model && isHttpsOrLocal(settings.baseUrl) && !/\s/.test(settings.apiKey));
// What the local helper is told about the service (the key travels separately and is never stored by the helper).
// Whether the service runs on this computer (then the audio does not leave it).
export const isLocalService = (baseUrl: string): boolean => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname); } catch { return false; } };
export function cloudConfig(settings: AsrProfile, all: AsrProfile[] = []): CloudConfig | undefined {
	if (!isConfigured(settings)) return undefined;
	const provider = providerOf(settings.provider), here = isLocalService(settings.baseUrl);
	const label = profileLabel(settings, all);
	return { protocol: settings.protocol, baseUrl: settings.baseUrl.replace(/\/+$/, ''), model: settings.model, timestamps: timestampsFor(settings.provider, settings.model), languageParam: settings.provider === 'groq' || settings.provider === 'openai', label, ...(provider.contextMode ? { contextMode: provider.contextMode } : {}), ...(provider.chunkSeconds ? { chunkSeconds: provider.chunkSeconds, maxChunkSeconds: provider.maxChunkSeconds } : {}) };
}

// How each way of recognising is drawn in lists: a letter on a tinted circle (the hue tells them apart at a glance), and the local
// engines the helper can run, so the list is complete even while the helper is not connected.
export const ICONS: Record<string, { text: string; hue: number }> = {
	siliconflow: { text: '硅', hue: 262 }, doubao: { text: '豆', hue: 190 }, glm: { text: '智', hue: 215 }, stepfun: { text: '阶', hue: 14 }, mimo: { text: '米', hue: 24 },
	groq: { text: 'G', hue: 8 }, openai: { text: 'O', hue: 160 }, local: { text: '本', hue: 140 }, custom: { text: '＋', hue: 220 },
	mlx: { text: 'W', hue: 150 }, 'mlx-qwen3': { text: 'Q', hue: 275 }, 'faster-whisper': { text: 'F', hue: 35 }, whispercpp: { text: 'C', hue: 200 }, auto: { text: '自', hue: 120 },
};
export const iconOf = (id: string) => ICONS[id] ?? ICONS.custom;
export interface LocalEngineInfo { id: LocalEngineId; name: string; sizeMb: number; note: string }
export const LOCAL_ENGINES: LocalEngineInfo[] = [
	{ id: 'mlx', name: 'Whisper large-v3-turbo（MLX）', sizeMb: 1700, note: 'Apple 芯片上最快，41 分钟的视频约 1 分钟' },
	{ id: 'mlx-qwen3', name: 'Qwen3-ASR 0.6B（MLX）', sizeMb: 1300, note: '中文术语识别准确，体积较小' },
	{ id: 'faster-whisper', name: 'Whisper large-v3-turbo（faster-whisper）', sizeMb: 1700, note: '任何电脑都能用，没有 GPU 也行，较慢' },
];
