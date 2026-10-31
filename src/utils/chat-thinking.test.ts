import { expect, it } from 'vitest';
import { buildRequest } from './chat-llm';
import { effortOptions, knownToThink, thinkingFields, thoughtFromLine, validEffort } from './chat-thinking';
import type { ModelConfig, Provider } from '../types/types';

const provider = (over: Partial<Provider> = {}): Provider => ({ id: 'p', name: 'Some API', baseUrl: 'https://api.example.com/v1', apiKey: 'k', ...over });
const model = (id: string, over: Partial<ModelConfig> = {}): ModelConfig => ({ id: 'm', providerId: 'p', providerModelId: id, name: id, enabled: true, ...over });
const body = (p: Provider, m: ModelConfig, effort?: string) => JSON.parse(String(buildRequest(p, m, 'sys', [{ role: 'user', content: 'hi' }], undefined, effort).init.body));

it('offers levels only for models that think, or that list their own', () => {
	expect(knownToThink('claude-sonnet-5-5')).toBe(true);
	expect(knownToThink('gpt-4.1-mini')).toBe(false);
	expect(effortOptions(model('gpt-5.1'))).toEqual(['low', 'medium', 'high']);
	expect(effortOptions(model('gpt-4o'))).toEqual([]);
	expect(effortOptions(model('whatever', { reasoningEfforts: ['minimal', 'high'] }))).toEqual(['minimal', 'high']);
	expect(validEffort('high')).toBe('high');
	expect(validEffort('bad value!')).toBeUndefined();
});

it('leaves the request alone when no level is chosen', () => {
	expect(body(provider(), model('gpt-5'))).toEqual({ model: 'gpt-5', messages: expect.any(Array), stream: true });
	expect(thinkingFields('openai', provider(), undefined)).toEqual({});
});

it('switches thinking on the way each kind of service expects', () => {
	expect(body(provider({ baseUrl: 'https://api.openai.com/v1', name: 'OpenAI' }), model('gpt-5'), 'high').reasoning_effort).toBe('high');
	expect(body(provider({ baseUrl: 'https://openrouter.ai/api/v1', name: 'OpenRouter' }), model('x/y'), 'medium').reasoning).toEqual({ effort: 'medium' });
	const deepseek = body(provider({ name: 'DeepSeek' }), model('deepseek-reasoner'), 'high');
	expect(deepseek.thinking).toEqual({ type: 'enabled' });
	expect(deepseek.reasoning_effort).toBe('high');
	expect(body(provider({ name: 'DeepSeek' }), model('deepseek-chat'), 'none').thinking).toEqual({ type: 'disabled' });
	const generic = body(provider(), model('qwen3-max'), 'low');
	expect(generic).toMatchObject({ enable_thinking: true, reasoning_effort: 'low', reasoning: { effort: 'low' } });
});

it('gives Claude and Gemini a thinking budget and room to answer after it', () => {
	const claude = body(provider({ name: 'Anthropic', baseUrl: 'https://api.anthropic.com' }), model('claude-sonnet-5-5'), 'medium');
	expect(claude.thinking).toEqual({ type: 'enabled', budget_tokens: 6000 });
	expect(claude.max_tokens).toBeGreaterThan(6000);
	const gemini = body(provider({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }), model('gemini-2.5-pro'), 'high');
	expect(gemini.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 24576 });
	expect(gemini.generationConfig.maxOutputTokens).toBeGreaterThan(24576);
	expect(body(provider({ name: 'Anthropic', baseUrl: 'https://api.anthropic.com' }), model('claude-sonnet-5-5')).thinking).toBeUndefined();
});

it('reads the model\'s reasoning text out of a stream', () => {
	expect(thoughtFromLine('openai', 'data: {"choices":[{"delta":{"reasoning_content":"先想想"}}]}')).toBe('先想想');
	expect(thoughtFromLine('openai', 'data: {"choices":[{"delta":{"content":"答案"}}]}')).toBe('');
	expect(thoughtFromLine('anthropic', 'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"嗯"}}')).toBe('嗯');
	expect(thoughtFromLine('responses', 'data: {"type":"response.reasoning_summary_text.delta","delta":"摘要"}')).toBe('摘要');
	expect(thoughtFromLine('openai', '')).toBe('');
});

it('disables DeepSeek translation thinking by model identity even behind a renamed proxy', () => {
 const p = provider({ name: 'My proxy' });
 expect(body(p, model('deepseek-flash'), 'none').thinking).toEqual({ type: 'disabled' });
 expect(body(p, model('deepseek-flash'), 'high').thinking).toEqual({ type: 'enabled' });
 expect(body(p, model('gpt-5'))).not.toHaveProperty('thinking');
 // Router protocols must retain their own parameter format.
 expect(body(provider({ baseUrl: 'https://openrouter.ai/api/v1' }), model('deepseek/deepseek-flash'), 'none').reasoning).toEqual({ effort: 'none' });
});

it('does not leak saved chat thinking strength into a DeepSeek translation override', () => {
 const m = model('deepseek-flash', {reasoningEffort:'high',reasoningEfforts:['high']});
 const result = body(provider({presetId:'magpie'}),m,'none');
 expect(result.thinking).toEqual({type:'disabled'});
 expect(result).not.toHaveProperty('reasoning_effort');
 expect(m.reasoningEffort).toBe('high');
});
