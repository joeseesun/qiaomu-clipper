import { t } from './ui-text';

export type ChatCapacityCode = 'context-limit' | 'output-limit';
export class ChatCapacityError extends Error {
	constructor(public readonly code: ChatCapacityCode) {
		super(code === 'output-limit' ? t('模型服务已达到单次输出上限，回答尚未完成。') : t('本次完整内容超过了模型服务允许的上下文长度。'));
		this.name = 'ChatCapacityError';
	}
}
export function isChatCapacityError(error: unknown): error is ChatCapacityError {
	return error instanceof Error && ['context-limit', 'output-limit'].includes((error as ChatCapacityError).code);
}
export function checkChatCapacityError(status: number, text: string): void {
	if ([400, 413, 422].includes(status) && /context_length_exceeded|prompt_too_long|maximum context length|context (?:window|length).*(?:exceed|limit)|(?:input|prompt).*(?:too long|exceeds? (?:the )?(?:maximum|model|token))|too many (?:input )?tokens/i.test(text)) {
		throw new ChatCapacityError('context-limit');
	}
}
// Finish reasons must be checked independently of whether the partial text
// happens to be valid JSON. Never report a server-truncated response as complete.
export function checkStreamEvent(line: string, kind: string): void {
	const raw = kind === 'ollama' ? line : line.startsWith('data:') ? line.slice(5).trim() : '';
	if (!raw || raw === '[DONE]') return;
	let data: any;
	try { data = JSON.parse(raw); } catch { return; }
	const reason = data.choices?.[0]?.finish_reason ?? data.delta?.stop_reason ?? data.candidates?.[0]?.finishReason ?? data.done_reason;
	if (['length', 'max_tokens', 'MAX_TOKENS'].includes(reason)
		|| data.type === 'response.incomplete' && data.response?.incomplete_details?.reason === 'max_output_tokens') throw new ChatCapacityError('output-limit');
	if (data.error || ['error', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(data.type)) {
		const message = data.error?.message || data.message || data.response?.error?.message || data.response?.incomplete_details?.reason || data.type;
		checkChatCapacityError(400, JSON.stringify(data.error || data.response?.error || message));
		throw new Error(String(message).slice(0, 500));
	}
}
