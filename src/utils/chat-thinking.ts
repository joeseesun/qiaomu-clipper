import type { ModelConfig, Provider } from '../types/types';
import { tokenPlanProfile } from './token-plan';

// How strongly a model thinks before it answers. Vendors disagree on the switch, so each wire format gets its own field.
// The rules follow Qiaomu Agent's thinking.ts, expressed for plain fetch bodies.
export type Effort = 'low' | 'medium' | 'high';
export const EFFORTS: Effort[] = ['low', 'medium', 'high'];

const FAMILIES = [
	/claude-(?:sonnet|opus|haiku)-4-[5-9]/, /claude-(?:opus|sonnet)-4(?:-\d{8})?$/, /claude-(?:opus|sonnet|fable|mythos|haiku)-5/,
	/(?:^|\/)gpt-5/, /(?:^|\/)o[134](?:-|$)/, /gemini-(?:2-5|3)/,
	/deepseek-(?:v4|flash|reasoner|r1)/, /kimi-k2-[5-9]|kimi-k3|(?:^|\/)k3(?:-|$)/, /glm-(?:4-[5-9]|5)/,
	/qwen3|qwen-(?:plus|flash|max)|qwq/, /mimo-v2/, /minimax-m[23]/, /grok-(?:3-mini|4)/,
];

export const normalizeModelId = (model: string) => model.trim().toLowerCase().replace(/[._]/g, '-');
export const isDeepSeekModel = (model: string) => /(?:^|\/)deepseek(?:-|$)/.test(normalizeModelId(model));
export const knownToThink = (model: string) => FAMILIES.some(pattern => pattern.test(normalizeModelId(model)));

// The levels worth offering: what the model's settings list, else the usual three for models known to think, else none.
export function effortOptions(model: Pick<ModelConfig, 'providerModelId' | 'reasoningEfforts'>, provider?: Pick<Provider, 'baseUrl'>): string[] {
	const native = tokenPlanProfile(provider, model.providerModelId);
	if (native) return native.efforts;
	if (model.reasoningEfforts?.length) return model.reasoningEfforts;
	return knownToThink(model.providerModelId) ? [...EFFORTS] : [];
}

export const validEffort = (value: unknown): string | undefined => (typeof value === 'string' && /^[a-z0-9_-]{1,12}$/.test(value) ? value : undefined);

const ANTHROPIC_BUDGET: Record<Effort, number> = { low: 2048, medium: 6000, high: 16000 };
const GEMINI_BUDGET: Record<Effort, number> = { low: 1024, medium: 8192, high: 24576 };
const isLevel = (effort: string): effort is Effort => effort === 'low' || effort === 'medium' || effort === 'high';

export type WireKind = 'anthropic' | 'gemini' | 'ollama' | 'openai' | 'responses';
export interface ThinkingFields { body?: Record<string, unknown>; anthropicBudget?: number; geminiBudget?: number }

export function thinkingFields(kind: WireKind, provider: Pick<Provider, 'name' | 'baseUrl' | 'presetId'>, effort: string | undefined, modelId = ''): ThinkingFields {
	if (!effort) return {};
	const name = provider.name.toLowerCase();
	if (kind === 'anthropic') return isLevel(effort) ? { anthropicBudget: ANTHROPIC_BUDGET[effort] } : {};
	if (kind === 'gemini') return isLevel(effort) ? { geminiBudget: GEMINI_BUDGET[effort] } : {};
	if (kind === 'ollama') return {};
	if (kind === 'responses') return { body: { reasoning: { effort } } };
	// OpenAI-style chat completions.
	if (provider.baseUrl.includes('openrouter.ai') || name.includes('openrouter')) return { body: { reasoning: { effort } } };
	if (name.includes('deepseek') || isDeepSeekModel(modelId)) return effort === 'none' ? { body: { thinking: { type: 'disabled' } } } : ['low', 'high', 'max'].includes(effort) ? { body: { thinking: { type: 'enabled' }, reasoning_effort: effort } } : isLevel(effort) ? { body: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } } : {};
	if (provider.presetId === 'magpie' || provider.baseUrl.includes('api.openai.com')) return { body: { reasoning_effort: effort } };
	if (!isLevel(effort)) return {};
	// Other compatible services each read a different field and ignore the rest.
	return { body: { thinking: { type: 'enabled' }, enable_thinking: true, reasoning_effort: effort, reasoning: { effort } } };
}

// The model's own reasoning text from one streamed line, where the service sends it.
export function thoughtFromLine(kind: WireKind, line: string): string {
	const raw = kind === 'ollama' ? line : line.startsWith('data:') ? line.slice(5).trim() : '';
	if (!raw || raw === '[DONE]') return '';
	try {
		const data = JSON.parse(raw);
		if (kind === 'anthropic') return data.type === 'content_block_delta' && typeof data.delta?.thinking === 'string' ? data.delta.thinking : '';
		if (kind === 'responses') return typeof data.type === 'string' && data.type.startsWith('response.reasoning') && data.type.endsWith('.delta') && typeof data.delta === 'string' ? data.delta : '';
		if (kind === 'openai') { const d = data.choices?.[0]?.delta; return typeof d?.reasoning_content === 'string' ? d.reasoning_content : typeof d?.reasoning === 'string' ? d.reasoning : ''; }
		return '';
	} catch { return ''; }
}
