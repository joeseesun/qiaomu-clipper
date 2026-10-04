import { generalSettings } from './storage-utils';
import browser from './browser-polyfill';
import type { ModelConfig, Provider } from '../types/types';

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

interface StreamOptions {
	model: ModelConfig;
	system: string;
	messages: ChatTurn[];
	signal?: AbortSignal;
	onDelta: (text: string) => void;
}

type Kind = 'anthropic' | 'gemini' | 'ollama' | 'openai';

export function normalizeOpenAIChatEndpoint(raw: string): string {
	const url = new URL(raw.trim());
	url.pathname = `${openAICompatibleBasePath(url.pathname)}/chat/completions`;
	return url.href;
}

export function openAICompatibleBasePath(pathname: string): string {
	return pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages|completions)$/, '');
}

const kindOf = (provider: Provider): Kind => {
	const name = provider.name.toLowerCase();
	if (provider.baseUrl.includes('generativelanguage.googleapis.com')) return 'gemini';
	if (name.includes('anthropic')) return 'anthropic';
	if (name.includes('ollama')) return 'ollama';
	return 'openai';
};

export function enabledChatModels(): ModelConfig[] {
	return generalSettings.models.filter(model => model.enabled && generalSettings.providers.some(p => p.id === model.providerId));
}

function buildRequest(provider: Provider, model: ModelConfig, system: string, messages: ChatTurn[]): { url: string; init: RequestInit } {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const name = provider.name.toLowerCase();
	let url = provider.baseUrl;
	let body: unknown;
	switch (kindOf(provider)) {
		case 'gemini':
			url = `https://generativelanguage.googleapis.com/v1beta/models/${model.providerModelId}:streamGenerateContent?alt=sse`;
			headers['X-goog-api-key'] = provider.apiKey;
			body = { systemInstruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: 8000 } };
			break;
		case 'anthropic':
			headers['x-api-key'] = provider.apiKey;
			headers['anthropic-version'] = '2023-06-01';
			headers['anthropic-dangerous-direct-browser-access'] = 'true';
			body = { model: model.providerModelId, max_tokens: 8000, system, messages, stream: true };
			break;
		case 'ollama':
			body = { model: model.providerModelId, messages: [{ role: 'system', content: system }, ...messages], stream: true, options: { num_ctx: 32768 } };
			break;
		default: {
			const withSystem = [{ role: 'system', content: system }, ...messages];
			if (provider.baseUrl.includes('openai.azure.com')) {
				url = provider.baseUrl.replace('{deployment-id}', model.providerModelId);
				headers['api-key'] = provider.apiKey;
				body = { messages: withSystem, max_completion_tokens: 8000, stream: true };
			} else {
				url = normalizeOpenAIChatEndpoint(provider.baseUrl);
				if (name.includes('hugging')) url = provider.baseUrl.replace('{model-id}', model.providerModelId);
				if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
				body = { model: model.providerModelId, messages: withSystem, stream: true, ...(name.includes('deepseek') ? { thinking: { type: 'disabled' } } : {}) };
			}
		}
	}
	return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

// Pull the text out of one streamed line, whatever the provider's wire format.
function textFromLine(kind: Kind, line: string): string {
	const raw = kind === 'ollama' ? line : line.startsWith('data:') ? line.slice(5).trim() : '';
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
			const message = raw as { delta?: string; error?: string; done?: boolean };
			if (typeof message.delta === 'string') { answer += message.delta; options.onDelta(message.delta); }
			if (message.error) finish(new Error(message.error));
			else if (message.done) finish();
		});
		port.onDisconnect.addListener(() => finish(new Error('AI 连接已中断，请重试')));
		if (options.signal?.aborted) { abort(); return; }
		options.signal?.addEventListener('abort', abort, { once: true });
		port.postMessage({ modelId: options.model.id, system: options.system, messages: options.messages });
	});
}

export async function streamChat({ model, system, messages, signal, onDelta }: StreamOptions): Promise<string> {
	if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
		return streamViaBackground({ model, system, messages, signal, onDelta });
	}
	const provider = generalSettings.providers.find(p => p.id === model.providerId);
	if (!provider) throw new Error(`Provider not found for model ${model.name}`);
	if (provider.apiKeyRequired && !provider.apiKey) throw new Error(`API key is not set for provider ${provider.name}`);

	const { url, init } = buildRequest(provider, model, system, messages);
	const response = await fetch(url, { ...init, signal });
	if (!response.ok) {
		const text = (await response.text()).slice(0, 300);
		if (kindOf(provider) === 'ollama' && response.status === 403) throw new Error('Ollama 拒绝了来自浏览器扩展的请求，请设置 OLLAMA_ORIGINS 后重试。');
		throw new Error(`${provider.name} ${response.status}: ${text}`);
	}
	if (!response.body) throw new Error('The provider returned an empty response.');

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
		}
	}
	const tail = textFromLine(kind, buffer.trim());
	if (tail) { full += tail; onDelta(tail); }
	if (!full) throw new Error('The model returned no text.');
	return full;
}
