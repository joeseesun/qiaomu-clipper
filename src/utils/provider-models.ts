import { Provider } from '../types/types';
import { openAICompatibleBasePath, opencodeHeaders } from './chat-llm';
import { freshOAuth, oauthModelsRequest } from './oauth/accounts';
import { brandOf } from './provider-catalog';
import { saveSettings } from './storage-utils';
import { isOpenCodeGo, supportsOpenCodeGoChat } from './opencode-go';
import modelNames from './model-names.json';

// A vendor that lists only ids gets a readable name from the bundled snapshot (scripts/update-model-names.mjs). Its own name always wins.
const NAMES = modelNames as Record<string, string>;
export function readableName(id: string, name?: string): string {
	if (name && name.trim() && name !== id) return name;
	const key = id.toLowerCase();
	return NAMES[key] || NAMES[key.split('/').pop() || ''] || (name && name.trim()) || id;
}

export interface ProviderModel {
	id: string;
	name: string;
}

// Derive discovery from the configured inference URL, including custom gateways.
export function modelListRequest(provider: Provider): { url: URL; headers: Record<string, string>; kind: string } {
	const url = new URL(provider.baseUrl);
	const headers: Record<string, string> = { Accept: 'application/json', ...(opencodeHeaders(provider.baseUrl) || {}) };
	let kind = 'openai';
	if (url.hostname === 'generativelanguage.googleapis.com') {
		kind = 'gemini';
		url.pathname = url.pathname.replace(/\/models(?:\/.*)?$/, '/models');
		headers['x-goog-api-key'] = provider.apiKey;
		url.searchParams.delete('key');
		url.searchParams.set('pageSize', '1000');
	} else if (/\/api\/(chat|generate)\/?$/.test(url.pathname)) {
		kind = 'ollama';
		url.pathname = url.pathname.replace(/\/(chat|generate)\/?$/, '/tags');
		if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
	} else if (url.hostname.endsWith('.openai.azure.com') || url.pathname.includes('/deployments/')) {
		// Azure model IDs are deployment names, not the model catalog IDs.
		throw new Error('deployment-models');
	} else {
		const anthropic = /\/messages\/?$/.test(url.pathname);
		url.pathname = openAICompatibleBasePath(url.pathname) + '/models';
		if (anthropic) {
			kind = 'anthropic';
			headers['x-api-key'] = provider.apiKey;
			headers['anthropic-version'] = '2023-06-01';
			headers['anthropic-dangerous-direct-browser-access'] = 'true';
			url.searchParams.set('limit', '1000');
		} else if (provider.apiKey) {
			headers.Authorization = `Bearer ${provider.apiKey}`;
		}
	}
	return { url, headers, kind };
}

// What to show when the vendor's own list cannot be read (no /models endpoint, no key yet, offline): its common models from the catalogue.
export function fallbackModels(provider: Pick<Provider, 'presetId' | 'baseUrl' | 'name'>): ProviderModel[] {
	return (brandOf(provider)?.popularModels || []).filter(m => supportsOpenCodeGoChat(provider.baseUrl, m.id)).map(m => ({ id: m.id, name: readableName(m.id, m.name) }));
}

export async function fetchProviderModels(input: Provider, signal?: AbortSignal): Promise<ProviderModel[]> {
	const provider = { ...input, apiKey: (input.apiKey || '').trim(), baseUrl: (input.baseUrl || '').trim() };
	if (provider.oauth) return fetchAccountModels(input, signal);
	if (provider.apiKeyRequired && !provider.apiKey.trim()) throw new Error('missing-api-key');
	const { url, headers, kind } = modelListRequest(provider);
	const models = new Map<string, ProviderModel>();
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal?.aborted) controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timeout = setTimeout(abort, 15000);
	const pages = new Set<string>();
	try {
		while (true) {
			if (pages.has(url.href)) throw new Error('invalid-model-list');
			pages.add(url.href);
			const response = await fetch(url.href, { headers, signal: controller.signal, credentials: 'omit' }).catch((e: unknown) => { if (controller.signal.aborted) throw e;
				throw new Error(`network:${e instanceof Error ? e.message : e}`); });
			if (!response.ok) throw new Error(`http-${response.status}`);
			const data = await response.json();
			const entries = kind === 'gemini' || kind === 'ollama' ? data.models : data.data;
			if (!Array.isArray(entries)) throw new Error('invalid-model-list');
			for (const entry of entries) {
				if (!entry || typeof entry !== 'object') continue;
				// Gateways that mix media models into one catalogue list their protocols; keep chat-capable ones.
				if (Array.isArray(entry.supported_protocols) && !entry.supported_protocols.some((x: unknown) => x === 'openai:chat-completions' || (!isOpenCodeGo(provider.baseUrl) && x === 'anthropic:messages'))) continue;
				if (kind === 'gemini' && !entry.supportedGenerationMethods?.includes('generateContent')) continue;
				const id = kind === 'gemini' ? entry.name?.replace(/^models\//, '') : kind === 'ollama' ? entry.model || entry.name : entry.id;
				if (typeof id !== 'string' || !id.trim() || !supportsOpenCodeGoChat(provider.baseUrl, id)) continue;
				const name = entry.displayName || entry.display_name || (kind !== 'gemini' ? entry.name : undefined);
				models.set(id, { id, name: readableName(id, typeof name === 'string' ? name : undefined) });
			}
			if (kind === 'gemini' && data.nextPageToken) {
				url.searchParams.set('pageToken', data.nextPageToken);
			} else if (kind === 'anthropic' && data.has_more && data.last_id) {
				url.searchParams.set('after_id', data.last_id);
			} else break;
		}
		return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', abort);
	}
}

// A signed-in ChatGPT or Codex account lists its own models; both answer with
// either an OpenAI-style `data` list or ChatGPT's `models` catalogue.
async function fetchAccountModels(provider: Provider, signal?: AbortSignal): Promise<ProviderModel[]> {
	const oauth = await freshOAuth(provider, () => saveSettings());
	const { url, headers } = oauthModelsRequest(oauth);
	const response = await fetch(url, { headers, signal, credentials: 'omit' });
	if (!response.ok) throw new Error(`http-${response.status}`);
	const data = await response.json();
	const entries = Array.isArray(data.models) ? data.models : data.data;
	if (!Array.isArray(entries)) throw new Error('invalid-model-list');
	const models = new Map<string, ProviderModel>();
	for (const entry of entries) {
		const id = entry?.slug || entry?.id;
		if (typeof id !== 'string' || !id || (entry.visibility && entry.visibility !== 'list')) continue;
		const name = entry.display_name || entry.name;
		models.set(id, { id, name: typeof name === 'string' && name.trim() ? name : id });
	}
	return [...models.values()];
}
