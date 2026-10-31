import { normalizeNativeResult, type ChatToolResult } from './chat-tools-types';
import { TOKEN_PLAN_TOOLS, type TokenPlanTool } from './token-plan';

interface Callbacks { onDelta: (text: string) => void; onThought?: (text: string) => void; onTools?: (tools: ChatToolResult[]) => void }
const array = (v: unknown): any[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const parse = (v: unknown): any => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } };

// Native calls are executed by the provider, never by this extension. Preserve only displayable
// evidence, not arbitrary response objects, private input images or remote executable content.
export function nativeToolResult(item: any): ChatToolResult | undefined {
	const tool = str(item?.type).replace(/_call$/, '') as TokenPlanTool;
	if (!TOKEN_PLAN_TOOLS.includes(tool) || typeof item.id !== 'string') return;
	const args = parse(item.arguments);
	const state = item.status === 'completed' ? 'done' : ['failed', 'cancelled', 'incomplete'].includes(item.status) ? 'error' : 'running';
	const label = str(item.action?.query) || array(args?.queries).filter(q => typeof q === 'string').join(' · ') || str(item.goal);
	const sources = [...array(item.action?.sources), ...array(item.urls).map(url => ({ url }))];
	const output = parse(item.output);
	return normalizeNativeResult({ id: item.id, call: { type: 'provider_tool', tool, label }, state,
		error: str(item.error?.message) || str(item.error), sources,
		...(tool === 'web_extractor' ? { content: str(item.output) } : {}),
		...(tool === 'code_interpreter' ? { code: str(item.code), logs: array(item.outputs).filter(o => o?.type === 'logs').map(o => str(o.logs)).join('\n') } : {}),
		...(['web_search_image', 'image_search'].includes(tool) ? { images: array(output) } : {}),
	});
}

// Complete SSE frames, UTF-8 boundaries, completion/error events, and a missing terminal event
// all matter: an HTTP 200 or a partial answer alone does not mean a successful response.
export async function readTokenPlanStream(response: Response, callbacks: Callbacks, signal?: AbortSignal): Promise<string> {
	if (!response.body) throw new Error('Token Plan returned an empty response.');
	const reader = response.body.getReader(), decoder = new TextDecoder();
	const tools = new Map<string, ChatToolResult>();
	const texts = new Map<string, string>();
	let buffer = '', full = '', terminal = false;
	const publish = () => callbacks.onTools?.([...tools.values()]);
	const acceptItem = (item: any) => { const result = nativeToolResult(item); if (result) { tools.set(result.id, result); publish(); } };
	const acceptText = (event: any, done = false) => {
		const key = `${event.item_id || event.output_index || 0}:${event.content_index || 0}`;
		const before = texts.get(key) || '', value = str(done ? event.text : event.delta);
		const delta = done ? value.startsWith(before) ? value.slice(before.length) : '' : value;
		texts.set(key, before + delta);
		if (delta) { full += delta; callbacks.onDelta(delta); }
	};
	const frame = (frame: string) => {
		const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
		if (!data || data === '[DONE]') return;
		const e = parse(data); if (!e) throw new Error('Invalid Token Plan stream event.');
		if (e.type === 'error' || ['response.failed', 'response.incomplete', 'response.cancelled'].includes(e.type)) {
			throw new Error(`Token Plan: ${str(e.error?.message) || str(e.message) || str(e.response?.error?.message) || str(e.response?.incomplete_details?.reason) || e.type}`);
		}
		if (e.type === 'response.output_text.delta') acceptText(e);
		if (e.type === 'response.output_text.done') acceptText(e, true);
		if (/^response\.reasoning.*\.delta$/.test(e.type) && typeof e.delta === 'string') callbacks.onThought?.(e.delta);
		if (e.type === 'response.output_item.added' || e.type === 'response.output_item.done') acceptItem(e.item);
		if (e.type === 'response.completed') {
			if (e.response?.error || e.response?.status !== 'completed') throw new Error(`Token Plan: ${str(e.response?.error?.message) || e.response?.status || 'invalid completion'}`);
			for (const item of array(e.response?.output)) {
				acceptItem(item);
				if (item.type === 'message') array(item.content).forEach((p, index) => { if (p?.type === 'output_text') acceptText({ item_id: item.id, content_index: index, text: p.text }, true); });
			}
			terminal = true;
		}
	};
	try {
		for (;;) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
			buffer = buffer.replace(/\r\n/g, '\n');
			let end: number;
			while ((end = buffer.indexOf('\n\n')) >= 0) { frame(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
			if (done) break;
		}
		if (buffer.trim()) frame(buffer);
		signal?.throwIfAborted();
		if (!terminal) throw new Error('Token Plan connection ended before completion.');
		if (!full.trim()) throw new Error('Token Plan returned no answer text.');
		return full;
	} catch (error) {
		for (const [id, result] of tools) if (result.state === 'running') tools.set(id, { ...result, state: 'error', error: 'interrupted' });
		publish(); throw error;
	} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
