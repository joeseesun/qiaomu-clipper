import { magpieKey } from './magpie';
import { generalSettings, saveSettings } from './storage-utils';
import { freshOAuth, responsesRequest, responsesText } from './oauth/accounts';
import browser from './browser-polyfill';
import type { ModelConfig, Provider } from '../types/types';
import { thinkingFields, thoughtFromLine, validEffort } from './chat-thinking';
import { tokenPlanEndpoint, tokenPlanProfile, tokenPlanTools } from './token-plan';
import { readTokenPlanStream } from './token-plan-stream';
import { normalizeNativeResult, type ChatToolResult } from './chat-tools-types';
import { loadWebSearch } from './web-search';

import { t } from './ui-text';
import { opencodeHeaders, supportsOpenCodeGoChat } from './opencode-go';
export { opencodeHeaders } from './opencode-go';
import { type ChatTurn, openAIContent, anthropicContent, geminiParts, responsesContent, imageData, validChatTurns } from './chat-content';
export type { ChatTurn } from './chat-content';

interface StreamOptions {
	model: ModelConfig;
	system: string;
	messages: ChatTurn[];
	signal?: AbortSignal;
	sessionId?: string;
	// This request's thinking strength (low / medium / high …); absent keeps the model's own setting.
	reasoningEffort?: string;
	onDelta: (text: string) => void;
	// The model's reasoning text, for services that stream it.
	onThought?: (text: string) => void;
	nativeTools?: boolean;
	onNativeTools?: (tools: ChatToolResult[]) => void;
}

type Kind = 'anthropic' | 'gemini' | 'ollama' | 'openai' | 'responses';

export function normalizeOpenAIChatEndpoint(raw: string): string {
	const url = new URL(raw.trim());
	const pathname = url.pathname.replace(/\/+$/, '');
	if (/\/(?:chat\/completions|responses|messages|completions)$/.test(pathname)) {
		url.pathname = pathname;
		return url.href;
	}
	const base = pathname && pathname !== '/' ? pathname : '/v1';
	url.pathname = `${base}/chat/completions`;
	return url.href;
}

export function openAICompatibleBasePath(pathname: string): string {
	return pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages|completions)$/, '');
}

const kindOf = (provider: Provider): Kind => {
	if (provider.oauth) return 'responses';
	const name = provider.name.toLowerCase();
	if (/\/responses\/?(?:\?|$)/.test(provider.baseUrl)) return 'responses';
	if (provider.baseUrl.includes('generativelanguage.googleapis.com')) return 'gemini';
	if (name.includes('anthropic')) return 'anthropic';
	if (name.includes('ollama')) return 'ollama';
	return 'openai';
};

export function enabledChatModels(): ModelConfig[] {
	return generalSettings.models.filter(model => model.enabled && generalSettings.providers.some(p => p.id === model.providerId));
}

export function buildRequest(provider: Provider, model: ModelConfig, system: string, messages: ChatTurn[], sessionId?: string, effort?: string): { url: string; init: RequestInit } {
	provider = { ...provider, apiKey: magpieKey(provider) };
	const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opencodeHeaders(provider.baseUrl, sessionId) || {}) };
	const name = provider.name.toLowerCase();
	let url = provider.baseUrl;
	let body: unknown;
	const kindNow = kindOf(provider);
	const thinking = thinkingFields(kindNow, provider, effort, model.providerModelId);
	switch (kindNow) {
		case 'gemini':
			url = `https://generativelanguage.googleapis.com/v1beta/models/${model.providerModelId}:streamGenerateContent?alt=sse`;
			headers['X-goog-api-key'] = provider.apiKey;
			body = { systemInstruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m) })), generationConfig: { maxOutputTokens: 8000 + (thinking.geminiBudget ?? 0), ...(thinking.geminiBudget ? { thinkingConfig: { thinkingBudget: thinking.geminiBudget } } : {}) } };
			break;
		case 'anthropic':
			headers['x-api-key'] = provider.apiKey;
			headers['anthropic-version'] = '2023-06-01';
			headers['anthropic-dangerous-direct-browser-access'] = 'true';
			body = { model: model.providerModelId, max_tokens: 8000 + (thinking.anthropicBudget ?? 0), system, messages: messages.map(m => ({ role: m.role, content: anthropicContent(m) })), stream: true, ...(thinking.anthropicBudget ? { thinking: { type: 'enabled', budget_tokens: thinking.anthropicBudget } } : {}) };
			break;
		case 'ollama':
			body = { model: model.providerModelId, messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content + (m.images?.length ? '\n' + m.images.map(image => image.label).join('\n') : ''), ...(m.images?.length ? { images: m.images.map(image => imageData(image).data) } : {}) }))], stream: true, options: { num_ctx: 32768 } };
			break;
		case 'responses':
			if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
			body = { model: model.providerModelId, instructions: system, input: messages.map(m => ({ role: m.role, content: responsesContent(m) })), stream: true, store: false, ...(thinking.body ?? {}) };
			break;
		default: {
			const withSystem = [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: openAIContent(m) }))];
			if (provider.baseUrl.includes('openai.azure.com')) {
				url = provider.baseUrl.replace('{deployment-id}', model.providerModelId);
				headers['api-key'] = provider.apiKey;
				body = { messages: withSystem, max_completion_tokens: 8000, stream: true };
			} else {
				url = normalizeOpenAIChatEndpoint(provider.baseUrl);
				if (name.includes('hugging')) url = provider.baseUrl.replace('{model-id}', model.providerModelId);
				if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
				body = { model: model.providerModelId, messages: withSystem, stream: true, ...(!effort && provider.presetId === 'magpie' && model.reasoningEffort && model.reasoningEfforts?.includes(model.reasoningEffort) ? { reasoning_effort: model.reasoningEffort } : {}), ...(name.includes('deepseek') ? { thinking: { type: 'disabled' } } : {}), ...(thinking.body ?? {}) };
			}
		}
	}
	return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

// Pull the text out of one streamed line, whatever the provider's wire format.
function textFromLine(kind: Kind, line: string): string {
	const raw = kind === 'ollama' ? line : line.startsWith('data:') ? line.slice(5).trim() : '';
	if (kind === 'responses') return responsesText(line);
	if (!raw || raw === '[DONE]') return '';
	try {
		const data = JSON.parse(raw);
		if (kind === 'anthropic') return data.type === 'content_block_delta' ? data.delta?.text ?? '' : '';
		if (kind === 'gemini') return (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
		if (kind === 'ollama') return data.message?.content ?? '';
		return data.choices?.[0]?.delta?.content ?? '';
	} catch { return ''; }
}

// Content scripts run under the site's network policy. Keep credentials and
// provider requests in the extension background while forwarding stream deltas.
function streamViaBackground(options: StreamOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		const port = browser.runtime.connect({ name: 'qiaomu-study-chat' });
		let answer = '';
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			options.signal?.removeEventListener('abort', abort);
			port.disconnect();
			if (error) reject(error); else resolve(answer);
		};
		const abort = () => finish(new DOMException('Aborted', 'AbortError'));
		port.onMessage.addListener(raw => {
			const message = raw as { delta?: string; thought?: string; nativeTools?: unknown[]; error?: string; done?: boolean };
			if (typeof message.delta === 'string') { answer += message.delta; options.onDelta(message.delta); }
			if (typeof message.thought === 'string') options.onThought?.(message.thought);
			if (Array.isArray(message.nativeTools)) options.onNativeTools?.(message.nativeTools.flatMap(item => { const result = normalizeNativeResult(item); return result ? [result] : []; }));
			if (message.error) finish(new Error(message.error));
			else if (message.done) finish();
		});
		port.onDisconnect.addListener(() => finish(new Error(t('AI 连接已中断，请重试'))));
		if (options.signal?.aborted) { abort(); return; }
		options.signal?.addEventListener('abort', abort, { once: true });
		port.postMessage({ modelId: options.model.id, system: options.system, messages: options.messages, ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}), ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}), ...(options.nativeTools ? { nativeTools: true } : {}) });
	});
}

export async function streamChat({ model: chosen, system, messages, signal, onDelta, onThought, sessionId, reasoningEffort, nativeTools, onNativeTools }: StreamOptions): Promise<string> {
	const effort = validEffort(reasoningEffort);
	// For account (OAuth) models the level travels on the model itself.
	const model: ModelConfig = effort ? { ...chosen, reasoningEffort: effort, reasoningEfforts: Array.from(new Set([...(chosen.reasoningEfforts ?? []), effort])) } : chosen;
	if (!validChatTurns(messages)) throw new Error(t('图片数量或大小超出限制，请减少所选图片后重试。'));
	if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
		return streamViaBackground({ model: chosen, system, messages, signal, onDelta, onThought, sessionId, reasoningEffort: effort, nativeTools, onNativeTools });
	}
	const provider = generalSettings.providers.find(p => p.id === model.providerId);
	if (!provider) throw new Error(`Provider not found for model ${model.name}`);
	if (!provider.oauth && provider.apiKeyRequired && !provider.apiKey) throw new Error(`API key is not set for provider ${provider.name}`);

	if (!provider.oauth && !supportsOpenCodeGoChat(provider.baseUrl, model.providerModelId)) throw new Error(t('此 OpenCode Go 模型或端点尚不支持，请从聊天模型列表中选择。'));
	const native = nativeTools && !provider.oauth ? tokenPlanProfile(provider, model.providerModelId, effort) : undefined;
	let { url, init } = provider.oauth
		? responsesRequest(await freshOAuth(provider, () => saveSettings()), model, system, messages)
		: buildRequest(provider, model, system, messages, sessionId, effort);
	if (native) {
		if (!native.vision && messages.some(m => m.images?.length)) throw new Error(t('当前模型不支持看图，请选择支持图片的模型。'));
		const web = await loadWebSearch();
		url = tokenPlanEndpoint(provider)!;
		init = { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` }, body: JSON.stringify({
			model: model.providerModelId, instructions: system, input: messages.map(m => ({ role: m.role, content: responsesContent(m) })),
			stream: true, store: false, tools: tokenPlanTools(native, web.enabled, messages.some(m => m.images?.length)),
			...(effort ? { reasoning: { effort } } : {}),
		}) };
	}
	const response = await fetch(url, { ...init, signal });
	if (!response.ok) {
		const text = (await response.text()).slice(0, 300);
		if (kindOf(provider) === 'ollama' && response.status === 403) throw new Error(t('Ollama 拒绝了来自浏览器扩展的请求，请设置 OLLAMA_ORIGINS 后重试。'));
		if (messages.some(m => m.images?.length) && [400, 413, 415, 422].includes(response.status)) throw new Error(t('图片请求被当前服务拒绝，请减少图片或换一个支持读图的模型。') + ` (${provider.name} ${response.status})`);
		throw new Error(`${provider.name} ${response.status}: ${text}`);
	}
	if (!response.body) throw new Error('The provider returned an empty response.');
	if (native) return readTokenPlanStream(response, { onDelta, onThought, onTools: onNativeTools }, signal);

	const kind = kindOf(provider);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			const text = textFromLine(kind, line.trim());
			if (text) { full += text; onDelta(text); }
			else if (onThought) { const thought = thoughtFromLine(kind, line.trim()); if (thought) onThought(thought); }
		}
	}
	const tail = textFromLine(kind, buffer.trim());
	if (tail) { full += tail; onDelta(tail); }
	if (!full) throw new Error('The model returned no text.');
	return full;
}
