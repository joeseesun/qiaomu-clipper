import { expect, it } from 'vitest';
import { checkChatCapacityError, checkStreamEvent } from './chat-capacity';

it.each([
	['openai', { choices: [{ finish_reason: 'length' }] }],
	['anthropic', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }],
	['gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }],
	['responses', { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }],
])('rejects the %s server truncation signal', (kind, event) => {
	expect(() => checkStreamEvent('data: ' + JSON.stringify(event), kind)).toThrow(expect.objectContaining({ code: 'output-limit' }));
});
it('distinguishes context overflow from rate limits, authorization and content filters', () => {
	expect(() => checkChatCapacityError(400, '{"code":"context_length_exceeded"}')).toThrow(expect.objectContaining({ code: 'context-limit' }));
	expect(() => checkChatCapacityError(429, 'too many tokens per minute')).not.toThrow();
	expect(() => checkChatCapacityError(401, 'bad key')).not.toThrow();
	expect(() => checkStreamEvent('data: {"choices":[{"finish_reason":"stop"}]}', 'openai')).not.toThrow();
	expect(() => checkStreamEvent('data: {"error":{"message":"network error"}}', 'openai')).toThrow('network error');
});
