import { generateCodexImage } from '../utils/codex-image';
import { t } from '../utils/ui-text';
import { getLocalStorage, setLocalStorage, generalSettings, oauthStore } from '../utils/storage-utils';
import { CHATGPT_BASE, CODEX_BASE, freshOAuth, oauthModelsRequest } from '../utils/oauth/accounts';
import type { Provider } from '../types/types';

// Picture-making services the writer can call. Keys stay in this browser's local storage (never synced), like the speech-recognition keys.
export type ImageEngine = 'api' | 'ark' | 'gemini' | 'openrouter' | 'oauth' | 'jimeng' | 'codex';
// One service the writer connected. `models` are the ones offered when making a picture (the first is the default); `model` mirrors it.
// An account service (`engine: 'oauth'`) has no key: it uses the ChatGPT / Codex sign-in of the provider named by `providerId`.
export interface ImageModelConfig { id: string; sourceId: string; engine: ImageEngine; name: string; baseUrl: string; apiKey: string; model: string; models: string[]; providerId?: string; agentModel?: string; catalog?: { baseUrl: string; models: ListedModel[] } }
export interface ImageModelStore { models: ImageModelConfig[]; defaultId: string }
export interface ImageSource { id: string; name: string; sub: string; engine: ImageEngine; baseUrl: string; keyUrl: string; models: { id: string; name?: string }[]; providerId?: string }

export const IMAGE_SOURCES: ImageSource[] = [
	{ id: 'codex-local', get name() { return t('本机 Codex'); }, get sub() { return t('使用本机已登录的 Codex，需要本地助手'); }, engine: 'codex', baseUrl: '', keyUrl: '', models: [{ id: 'imagegen', get name() { return t('内置 ImageGen'); } }] },
	{ id: 'jimeng', get name() { return t('即梦（自部署）'); }, get sub() { return t('连接自己的 jimeng-api 服务'); }, engine: 'jimeng', baseUrl: '', keyUrl: '', models: [{ id: 'jimeng-4.5' }] },
	{ id: 'ark', name: '豆包 Seedream', sub: '火山方舟 · ark.cn-beijing.volces.com', engine: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
		models: [{ id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro' }, { id: 'doubao-seedream-5-0-flash-260915', name: 'Seedream 5.0 Flash' }, { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' }, { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' }] },
	{ id: 'gemini', name: 'Google Gemini 生图', sub: 'Nano Banana · generativelanguage.googleapis.com', engine: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', models: [{ id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' }] },
	{ id: 'openai', name: 'OpenAI', sub: 'api.openai.com', engine: 'api', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'gpt-image-1' }] },
	{ id: 'openrouter', name: 'OpenRouter', sub: 'openrouter.ai · 中转', engine: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', models: [{ id: 'google/gemini-2.5-flash-image' }, { id: 'bytedance-seed/seedream-4.5' }] },
	{ id: 'siliconflow', name: 'SiliconFlow', sub: 'FLUX 等 · api.siliconflow.cn', engine: 'api', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak', models: [{ id: 'black-forest-labs/FLUX.1-schnell' }, { id: 'Qwen/Qwen-Image' }] },
	{ id: 'zhipu', name: '智谱 CogView', sub: 'open.bigmodel.cn', engine: 'api', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', models: [{ id: 'cogview-4' }] },
	{ id: 'custom', name: '自定义', sub: 'OpenAI 兼容 /images/generations', engine: 'api', baseUrl: '', keyUrl: '', models: [] },
];

const KEY = 'qiaomuImageModels';
export const ASPECTS = ['16:9', '4:3', '3:2', '1:1', '3:4', '2:3', '9:16', '21:9'] as const;
export type Aspect = typeof ASPECTS[number];
// ImageGen is a capability, not the model that orchestrates the Codex turn.
export const CODEX_IMAGE_MODEL = 'imagegen';
export function usesCodexImagegen(config: { engine: ImageEngine; providerId?: string; model?: string }): boolean {
	return config.engine === 'codex' || (config.engine === 'oauth' && (config.model === CODEX_IMAGE_MODEL || generalSettings.providers.some(p => p.id === config.providerId && p.oauth?.kind === 'codex')));
}
export function imageModelName(config: ImageModelConfig, id = config.model): string { return usesCodexImagegen(config) ? t('内置 ImageGen') : id; }
function orchestrationModel(id: unknown): string | undefined {
	return typeof id === 'string' && /^(gpt-(?!image)|codex-)/i.test(id) && !/auto-review/i.test(id) ? id.trim() : undefined;
}

export function emptyStore(): ImageModelStore { return { models: [], defaultId: '' }; }

export function normalizeStore(raw: unknown): ImageModelStore {
	const value = (raw ?? {}) as Partial<ImageModelStore>;
	const models = (Array.isArray(value.models) ? value.models : []).filter((m): m is ImageModelConfig => !!m && typeof m.id === 'string' && typeof m.model === 'string' && ['api', 'ark', 'gemini', 'openrouter', 'oauth', 'jimeng', 'codex'].includes(m.engine))
		.map(m => {
			if (usesCodexImagegen(m)) {
				const agentModel = orchestrationModel(m.agentModel) || orchestrationModel(m.model)
					|| (m.engine === 'oauth' ? generalSettings.models?.filter(model => model.providerId === m.providerId && model.enabled).map(model => orchestrationModel(model.providerModelId)).find(Boolean) : undefined);
				return { id: m.id, sourceId: m.sourceId, engine: m.engine, name: String(m.name || ''), baseUrl: '', apiKey: '', model: CODEX_IMAGE_MODEL, models: [CODEX_IMAGE_MODEL], ...(m.providerId ? { providerId: m.providerId } : {}), ...(agentModel ? { agentModel } : {}) };
			}
			// One-time compatibility for the deployment previously configured as OpenAI-compatible.
			// Never infer a protocol from arbitrary model names or move credentials to a different URL.
			if (m.engine === 'api' && m.sourceId === 'custom' && String(m.baseUrl).trim().replace(/\/+$/, '') === 'https://www.t5t6.com/jimeng-api/v1') {
				const ids = [m.model, ...(Array.isArray(m.models) ? m.models : [])].filter((id): id is string => typeof id === 'string' && !!id.trim() && !/video/i.test(id)).map(id => id.trim() === 'jimeng' ? 'jimeng-4.5' : id.trim());
				m = { ...m, engine: 'jimeng', sourceId: 'jimeng', model: ids[0] || 'jimeng-4.5', models: ids };
			}
			const primary = m.model.trim();
			const list = Array.from(new Set([primary, ...(Array.isArray(m.models) ? m.models : []).filter((x): x is string => typeof x === 'string').map(x => x.trim())].filter(Boolean)));
			const catalog = m.catalog && typeof m.catalog.baseUrl === 'string' && Array.isArray(m.catalog.models) ? { baseUrl: m.catalog.baseUrl, models: m.catalog.models.filter(x => x && typeof x.id === 'string' && x.id && !/video/i.test(x.id)).map(x => ({ id: x.id, ...(typeof x.name === 'string' ? { name: x.name } : {}) })) } : undefined;
			return { id: m.id, sourceId: String(m.sourceId || 'custom'), engine: m.engine, name: String(m.name || ''), baseUrl: String(m.baseUrl || '').trim(), apiKey: String(m.apiKey || '').trim(), model: primary || list[0] || '', models: list, ...(typeof m.providerId === 'string' && m.providerId ? { providerId: m.providerId } : {}), ...(catalog ? { catalog } : {}) };
		});
	const defaultId = models.some(m => m.id === value.defaultId) ? String(value.defaultId) : models[0]?.id ?? '';
	return { models, defaultId };
}

export async function loadImageModels(): Promise<ImageModelStore> { return normalizeStore(await getLocalStorage(KEY)); }
export async function saveImageModels(store: ImageModelStore): Promise<void> { await setLocalStorage(KEY, normalizeStore(store)); }

export const providerOf = (config: Pick<ImageModelConfig, 'providerId'>): Provider | undefined => generalSettings.providers.find(p => p.id === config.providerId && p.oauth);
// Every model the writer can pick for this service when making a picture.
export const modelsOf = (config: ImageModelConfig): string[] => usesCodexImagegen(config) ? [CODEX_IMAGE_MODEL] : (config.models.length ? config.models : [config.model]).filter(Boolean);

export function isReady(model: ImageModelConfig): boolean {
	if (!model.model.trim()) return false;
	if (model.engine === 'codex') return true;
	if (model.engine === 'oauth') return !!providerOf(model);
	const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(model.baseUrl);
	if (model.engine === 'api' || model.engine === 'jimeng') return !!model.baseUrl.trim() && (!!model.apiKey.trim() || local);
	return !!model.apiKey.trim();
}
export function serviceName(model: ImageModelConfig): string {
	if (model.name.trim()) return model.name.trim();
	if (model.engine === 'oauth') return providerOf(model)?.name ?? t('账号登录');
	return IMAGE_SOURCES.find(s => s.id === model.sourceId)?.name ?? model.engine;
}
export function labelOf(model: ImageModelConfig, modelId = model.model): string { return `${serviceName(model)} · ${imageModelName(model, modelId)}`; }

// Picture services that need no key: the ChatGPT / Codex accounts already signed in under the language-model providers.
export function accountSources(): ImageSource[] {
	return generalSettings.providers.filter(p => p.oauth).map(p => ({
		id: `account:${p.id}`, providerId: p.id, engine: 'oauth' as const, baseUrl: '', keyUrl: '', name: p.name,
		sub: p.oauth!.kind === 'codex' ? t('内置 ImageGen') : t('ChatGPT 账号 · gpt-image'),
		models: p.oauth!.kind === 'codex' ? [{ id: CODEX_IMAGE_MODEL, name: t('内置 ImageGen') }] : [{ id: 'gpt-image-1' }],
	}));
}
export function readyModels(store: ImageModelStore): ImageModelConfig[] { return store.models.filter(isReady); }

// ---- making a picture ---------------------------------------------------------------------------------------------------------
export function ratioOf(aspect: string): number { const [w, h] = aspect.split(':').map(Number); return w && h ? w / h : 1; }
export function openAiSize(aspect: string): '1024x1024' | '1536x1024' | '1024x1536' { const r = ratioOf(aspect); return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024'; }
// Seedream wants an explicit WxH of about 2K in total pixels (1K for the old 3.0 family), aspect between 1:16 and 16:1.
export function arkSize(model: string, aspect: string): string {
	const area = /seedream[-/.]3[-.]0/i.test(model) ? 1024 * 1024 : 2048 * 2048; const r = Math.min(16, Math.max(1 / 16, ratioOf(aspect)));
	return `${Math.round(Math.sqrt(area * r) / 8) * 8}x${Math.round(Math.sqrt(area / r) / 8) * 8}`;
}

const trimBase = (url: string) => url.trim().replace(/\/+$/, '');
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_WAIT_MS = 180000;

function fromBase64(b64: string, type = 'image/png'): Blob {
	const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: IMAGE_MIME.includes(type) ? type : bytes[0] === 0xff ? 'image/jpeg' : 'image/png' });
}
async function fromUrl(url: string, signal?: AbortSignal): Promise<Blob> {
	if (url.startsWith('data:')) { const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url); if (!m) throw new Error('empty-image'); return fromBase64(m[2], m[1]); }
	if (!/^https:\/\//i.test(url)) throw new Error('empty-image');
	const res = await fetch(url, { signal, credentials: 'omit' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const blob = await res.blob();
	return new Blob([blob], { type: IMAGE_MIME.includes(blob.type) ? blob.type : 'image/png' });
}

async function send(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
	const timeout = AbortSignal.timeout ? AbortSignal.timeout(MAX_WAIT_MS) : undefined;
	const combined = signal && timeout && (AbortSignal as any).any ? (AbortSignal as any).any([signal, timeout]) : signal ?? timeout;
	const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: combined, credentials: 'omit' });
	const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
	const detail = String(json?.error?.message ?? json?.message ?? (typeof json?.error === 'string' ? json.error : '')).slice(0, 200);
	if (!res.ok || json?.error) throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : text && !json ? `: ${text.slice(0, 160)}` : ''}`);
	if (typeof json?.code === 'number' && json.code < 0) throw new Error(`service-error: ${detail || json.code}`);
	return json;
}

export function arkBody(model: string, prompt: string, aspect: string): Record<string, unknown> {
	return { model, prompt: `${prompt.trim()}\nImage aspect ratio: ${aspect}.`, size: arkSize(model, aspect), response_format: 'b64_json', watermark: false };
}

export async function generateImage(config: ImageModelConfig, prompt: string, aspect: string = '16:9', signal?: AbortSignal, modelId?: string, account?: Provider): Promise<Blob> {
	const text = prompt.trim();
	// The writer may pick any of the service's models for this picture.
	if (modelId && modelId !== config.model && !usesCodexImagegen(config)) config = { ...config, model: modelId };
	if (!text) throw new Error('empty-prompt');
	if (config.engine === 'codex') return generateCodexImage(text, aspect, config.agentModel || orchestrationModel(config.model) || '', signal);
	if (!isReady(config) && !(config.engine === 'oauth' && account?.oauth)) throw new Error('not-ready');
	if (config.engine === 'oauth') return generateWithAccount(config, text, aspect, signal, account);
	const key = config.apiKey.trim();
	const source = IMAGE_SOURCES.find(s => s.id === config.sourceId);
	const base = trimBase(config.baseUrl || source?.baseUrl || '');
	if (config.engine === 'gemini') {
		const json = await send(`${base || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(config.model)}:generateContent`, { 'x-goog-api-key': key },
			{ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }, signal);
		const hit = (json?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
		if (!hit) throw new Error('empty-image');
		return fromBase64(hit.inlineData.data, hit.inlineData.mimeType);
	}
	if (config.engine === 'openrouter') {
		const headers = { Authorization: `Bearer ${key}` };
		const root = base || 'https://openrouter.ai/api/v1';
		try {
			const json = await send(`${root}/images`, headers, { model: config.model, prompt: text, n: 1, aspect_ratio: aspect, output_format: 'png' }, signal);
			const item = json?.data?.[0];
			if (item?.b64_json) return fromBase64(item.b64_json, item.media_type);
			if (item?.url) return await fromUrl(item.url, signal);
		} catch (error) { if (!/HTTP (404|405)/.test(String((error as Error).message))) throw error; }
		// Models that only speak chat completions return the picture inside the message.
		const json = await send(`${root}/chat/completions`, headers, { model: config.model, messages: [{ role: 'user', content: text }], modalities: ['image', 'text'], image_config: { aspect_ratio: aspect } }, signal);
		const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
		if (!url) throw new Error('empty-image');
		return await fromUrl(url, signal);
	}
	const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
	const body = config.engine === 'jimeng'
		? { model: config.model === 'jimeng' ? 'jimeng-4.5' : config.model, prompt: text, ratio: aspect, resolution: '2k', response_format: 'url' }
		: config.engine === 'ark' ? arkBody(config.model, text, aspect) : { model: config.model, prompt: text, n: 1, size: openAiSize(aspect) };
	const json = await send(`${base || 'https://api.openai.com/v1'}/images/generations`, headers, body, signal);
	const item = json?.data?.[0] ?? json?.images?.[0];
	if (item?.b64_json) return fromBase64(item.b64_json);
	const url = item?.url;
	if (!url) throw new Error('empty-image');
	return await fromUrl(url, signal);
}


// ---- ChatGPT / Codex accounts ----------------------------------------------------------------------------------------------
// These account adapters are separate from the local app-server route.
// For Codex, the top-level model orchestrates image_generation; it is not an image model.
async function accountHeaders(provider: Provider): Promise<{ oauth: NonNullable<Provider['oauth']>; headers: Record<string, string> }> {
	const oauth = await freshOAuth(provider, oauthStore);
	const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${oauth.access}` };
	return { oauth, headers };
}

export function imageFromResponsesEvents(lines: string[]): { b64?: string; partial?: string } {
	let partial: string | undefined; let final: string | undefined;
	for (const line of lines) {
		if (!line.startsWith('data:')) continue;
		const raw = line.slice(5).trim();
		if (!raw || raw === '[DONE]') continue;
		try {
			const data = JSON.parse(raw);
			if (data.type === 'response.image_generation_call.partial_image' && typeof data.partial_image_b64 === 'string') partial = data.partial_image_b64;
			const item = data.item ?? data.output_item;
			if ((data.type === 'response.output_item.done' || data.type === 'response.output_item.added') && item?.type === 'image_generation_call' && typeof item.result === 'string' && item.result) final = item.result;
			for (const out of data.response?.output ?? []) if (out?.type === 'image_generation_call' && typeof out.result === 'string' && out.result) final = out.result;
			if (data.type === 'response.failed' || data.type === 'error') throw new Error(String(data.response?.error?.message ?? data.error?.message ?? data.message ?? 'generation failed'));
		} catch (error) { if ((error as Error).message && !(error instanceof SyntaxError)) throw error; }
	}
	return { b64: final, partial };
}

async function generateWithAccount(config: ImageModelConfig, prompt: string, aspect: string, signal?: AbortSignal, preparedAccount?: Provider): Promise<Blob> {
	const provider = preparedAccount ?? providerOf(config);
	if (!provider?.oauth) throw new Error('not-ready');
	const { oauth, headers } = preparedAccount?.oauth ? { oauth: preparedAccount.oauth, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${preparedAccount.oauth.access}` } as Record<string, string> } : await accountHeaders(provider);
	const size = openAiSize(aspect);
	if (oauth.kind !== 'codex') {
		const json = await send(`${CHATGPT_BASE}/images/generations`, headers, { model: config.model, prompt, n: 1, size }, signal);
		const item = json?.data?.[0];
		if (item?.b64_json) return fromBase64(item.b64_json);
		if (item?.url) return await fromUrl(item.url, signal);
		throw new Error('empty-image');
	}
	if (oauth.accountId) headers['chatgpt-account-id'] = oauth.accountId;
	headers.Accept = 'text/event-stream'; headers['OpenAI-Beta'] = 'responses=experimental'; headers.originator = 'codex_cli_rs';
	const agentModel = orchestrationModel(config.agentModel) || orchestrationModel(config.model)
		|| generalSettings.models?.filter(m => m.providerId === provider.id && m.enabled).map(m => orchestrationModel(m.providerModelId)).find(Boolean) || 'gpt-5.5';
	const body = { model: agentModel, instructions: 'Draw exactly one picture for the request using the image generation tool. Do not describe it in text.', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }], tools: [{ type: 'image_generation', output_format: 'png', size }], tool_choice: { type: 'image_generation' }, store: false, stream: true };
	const timeout = AbortSignal.timeout ? AbortSignal.timeout(MAX_WAIT_MS) : undefined;
	const res = await fetch(`${CODEX_BASE}/responses`, { method: 'POST', headers, body: JSON.stringify(body), signal: signal && timeout && (AbortSignal as any).any ? (AbortSignal as any).any([signal, timeout]) : signal ?? timeout, credentials: 'omit' });
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
	const found = imageFromResponsesEvents((await res.text()).split('\n'));
	const b64 = found.b64;
	if (!b64) throw new Error('empty-image');
	return fromBase64(b64);
}

// ---- which models a service offers --------------------------------------------------------------------------------------------
const IMAGE_ID = /image|flux|diffusion|dall|cogview|seedream|seededit|imagen|kolors|wanx|hunyuan-?image|stable|sd3|midjourney|banana|jimeng/i;
export interface ListedModel { id: string; name?: string }

// Output capability takes priority over names. A vision input model is not necessarily an image generator.
function imageCapability(model: any): boolean | undefined {
	if (/video/i.test(String(model.id ?? model.name ?? '')) || model.type === 'video') return false;
	const output = model.capabilities?.output_modalities ?? model.architecture?.output_modalities ?? model.output_modalities;
	if (Array.isArray(output)) return output.includes('image');
	if (['image', 'text', 'audio', 'embedding'].includes(model.type)) return model.type === 'image';
	return IMAGE_ID.test(String(model.id ?? model.name ?? '')) ? true : undefined;
}

// Best effort, like Qiaomu Design: the service's own list narrowed to picture models (OpenRouter and Gemini can say so themselves).
export async function fetchImageModels(source: ImageSource, baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ListedModel[]> {
	if (usesCodexImagegen(source)) return [{ id: CODEX_IMAGE_MODEL, name: t('内置 ImageGen') }];
	const base = trimBase(baseUrl || source.baseUrl);
	const get = async (url: string, headers: Record<string, string> = {}) => { const res = await fetch(url, { headers, signal, credentials: 'omit' }); if (!res.ok) throw new Error(`HTTP ${res.status}`); const json = await res.json(); if (json?.error || (typeof json?.code === 'number' && json.code < 0)) throw new Error(String(json?.error?.message ?? json?.message ?? 'model-list-error').slice(0, 200)); return json; };
	if (source.engine === 'oauth') {
		const provider = generalSettings.providers.find(p => p.id === source.providerId && p.oauth);
		if (!provider?.oauth) throw new Error('not-ready');
		const oauth = await freshOAuth(provider, oauthStore);
		const request = oauthModelsRequest(oauth);
		const json = await get(request.url, request.headers);
		const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
		const ids = list.map(m => ({ id: String(m.id ?? m.slug ?? ''), name: typeof m.display_name === 'string' ? m.display_name : undefined })).filter(m => m.id);
		return ids.filter(m => IMAGE_ID.test(m.id));
	}
	if (source.id === 'openrouter') {
		const json = await get('https://openrouter.ai/api/v1/models?output_modalities=image');
		return (json?.data ?? []).map((m: any) => ({ id: m.id, name: m.name }));
	}
	if (source.engine === 'gemini') {
		const json = await get(`${base}/models?pageSize=200`, { 'x-goog-api-key': apiKey });
		return (json?.models ?? []).filter((m: any) => /image/i.test(m.name)).map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName }));
	}
	if (source.engine === 'ark') return source.models;
	const json = await get(`${base}/models`, apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
	const raw = json?.data ?? json?.models;
	if (!Array.isArray(raw)) throw new Error('model-list-error');
	const all = raw.filter(m => m && typeof m === 'object' && (m.id || m.name));
	const images = all.filter(m => imageCapability(m) === true);
	const candidates = images.length ? images : all.filter(m => imageCapability(m) !== false);
	const seen = new Set<string>();
	return candidates.map((m: any) => ({ id: String(m.id ?? m.name), name: typeof m.display_name === 'string' && m.display_name !== m.id ? m.display_name : undefined })).filter(m => !seen.has(m.id) && !!seen.add(m.id));
}
