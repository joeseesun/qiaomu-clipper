import type { ModelConfig, Provider } from '../types/types';

export const positiveTokenLimit = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

// Only explicit OUTPUT fields count. A context window is not an output budget.
export function outputLimitMetadata(entry: any, kind: string): { maxOutputTokens?: number } {
	const value = [entry?.outputTokenLimit, entry?.output_token_limit, entry?.max_output_tokens,
		entry?.max_completion_tokens, entry?.top_provider?.max_completion_tokens,
		entry?.limits?.output, entry?.limit?.output, kind === 'anthropic' ? entry?.max_tokens : undefined]
		.map(positiveTokenLimit).find(value => value !== undefined);
	return value ? { maxOutputTokens: value } : {};
}

const cache = new Map<string, { until: number; limits: Map<string, number> }>();

export async function resolveOutputLimit(provider: Provider, model: ModelConfig, signal?: AbortSignal): Promise<number | undefined> {
	signal?.throwIfAborted();
	const explicit = positiveTokenLimit(model.outputTokenLimit);
	if (explicit) return explicit;
	// Account endpoints and Ollama own their generation settings. Do not force API
	// parameters onto account backends, or allocate local GPU memory automatically.
	if (provider.oauth || provider.name.toLowerCase().includes('ollama')) return undefined;
	const key = JSON.stringify([provider.id, provider.baseUrl, provider.apiKey]);
	let found = cache.get(key);
	if (!found || found.until < Date.now()) {
		try {
			const { fetchProviderModels } = await import('./provider-models');
			const models = await fetchProviderModels(provider, signal);
			signal?.throwIfAborted();
			found = { until: Date.now() + 30 * 60_000, limits: new Map(models.flatMap(m => m.maxOutputTokens ? [[m.id, m.maxOutputTokens] as const] : [])) };
		} catch {
			signal?.throwIfAborted();
			found = { until: Date.now() + 60_000, limits: new Map() };
		}
		cache.set(key, found);
	}
	const discovered = found.limits.get(model.providerModelId);
	if (discovered) return discovered;
	// These official API aliases document a short default and a larger maximum.
	// Never apply an upstream limit to an unidentified gateway/deployment.
	if (new URL(provider.baseUrl).hostname === 'api.deepseek.com'
		&& ['deepseek-flash', 'deepseek-v4-pro'].includes(model.providerModelId)) return 393216;
	return undefined;
}
