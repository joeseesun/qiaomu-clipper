import { normalizeNativeResult, publicWebUrl, type ChatToolResult, type SearchSource } from './chat-tools-types';

interface Callbacks { onDelta: (text: string) => void; onThought?: (text: string) => void; onTools?: (tools: ChatToolResult[]) => void }
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];

/** Reduces actual app-server events, not model-written tool instructions. */
export class CodexChatStream {
	private tools = new Map<string, ChatToolResult>();
	private texts = new Map<string, { phase: string; text: string }>();
	private refs = new Map<string, SearchSource>();
	private streamed = '';
	private terminal = false;
	constructor(private callbacks: Callbacks) {}
	private publish() { this.callbacks.onTools?.([...this.tools.values()]); }
	private tool(item: ChatToolResult) { this.tools.set(item.id, item); this.publish(); }
	start() { this.tool({ id: 'codex-session', call: { type: 'provider_tool', provider: 'codex', tool: 'codex_session', label: '正在连接本机 Codex…' }, state: 'running' }); }
	accept(event: any): void {
		if (event.type === 'session') {
			this.tool({ id: 'codex-session', call: { type: 'provider_tool', provider: 'codex', tool: 'codex_session', label: `${str(event.model)} · ${str(event.effort)} · ${event.resumed ? '已接续原生上下文' : '已建立原生上下文'}` }, state: 'running' }); return;
		}
		if (event.type === 'error') throw new Error(str(event.message) || 'Codex 请求失败');
		if (event.type === 'cancelled') throw new DOMException('Aborted', 'AbortError');
		if (event.type === 'warning') {
			this.tool({ id: 'codex-retry', call: { type: 'provider_tool', provider: 'codex', tool: 'codex_progress', label: event.retrying ? '连接中断，Codex 正在重试' : 'Codex 返回错误' }, state: event.retrying ? 'running' : 'error', error: str(event.message), content: str(event.message) }); return;
		}
		if (event.type === 'done') { this.terminal = true; this.complete(); return; }
		if (event.type !== 'event') return;
		const p = event.params || {}, item = p.item || {}, completed = event.method === 'item/completed';
		if (item.type === 'webSearch' && typeof item.id === 'string') {
			const action = item.action || {}, results = array(item.results);
			const sources = results.flatMap(r => {
				const url = publicWebUrl(r?.url); if (!url) return [];
				const source = { url, title: str(r.title) || url, snippet: str(r.snippet) };
				if (typeof r.ref_id === 'string') this.refs.set(r.ref_id, source);
				return [source];
			});
			const url = publicWebUrl(action.url);
			if (url && !sources.some(s => s.url === url)) sources.push({ url, title: url, snippet: '' });
			const failure = results.find(r => r?.type === 'error' || r?.type === 'error_result');
			const result = normalizeNativeResult({ id: item.id,
				call: { type: 'provider_tool', provider: 'codex', tool: action.type === 'openPage' ? 'web_extractor' : action.type === 'findInPage' ? 'web_find' : 'web_search',
					label: str(action.pattern) || str(action.query) || array(action.queries).map(str).join(' · ') || str(item.query) || url || '原生网页工具' },
				state: failure ? 'error' : completed ? 'done' : 'running', sources,
				...(failure ? { error: str(failure.message) || str(failure.error) || '网页工具返回错误' } : {}) });
			if (result) this.tool(result); return;
		}
		if (item.type === 'contextCompaction') {
			this.tool({ id: item.id, call: { type: 'provider_tool', provider: 'codex', tool: 'codex_progress', label: 'Codex 正在整理会话上下文' }, state: completed ? 'done' : 'running' }); return;
		}
		if (item.type === 'agentMessage') {
			const before = this.texts.get(item.id) || { phase: str(item.phase), text: '' };
			before.phase = str(item.phase) || before.phase;
			this.texts.set(item.id, before);
			if (completed) this.text(item.id, str(item.text), true);
			return;
		}
		if (event.method === 'item/agentMessage/delta') this.text(str(p.itemId), str(p.delta));
		if (event.method === 'item/reasoning/summaryTextDelta') this.callbacks.onThought?.(str(p.delta));
		if (event.method === 'item/reasoning/summaryPartAdded') this.callbacks.onThought?.('\n');
	}
	private text(id: string, value: string, done = false) {
		const entry = this.texts.get(id) || { phase: '', text: '' };
		const delta = done ? value.startsWith(entry.text) ? value.slice(entry.text.length) : '' : value;
		entry.text = done ? value : entry.text + value;
		this.texts.set(id, entry);
		if (entry.phase === 'commentary') {
			if (done) this.tool({ id, call: { type: 'provider_tool', provider: 'codex', tool: 'codex_progress', label: '模型执行进度' }, state: 'done', content: entry.text });
		} else if (delta) { this.streamed += delta; this.callbacks.onDelta(delta); }
	}
	private complete() {
		for (const [id, item] of this.tools) if (item.state === 'running') this.tools.set(id, { ...item, state: id === 'codex-session' || id === 'codex-retry' ? 'done' : 'error', ...(id !== 'codex-session' && id !== 'codex-retry' ? { error: '工具没有返回完成事件' } : {}) });
		this.publish();
	}
	interrupt(error = 'interrupted') {
		for (const [id, item] of this.tools) if (item.state === 'running') this.tools.set(id, { ...item, state: 'error', error });
		this.publish();
	}
	finish(): string {
		if (!this.terminal) throw new Error('Codex 连接在完成前中断，请重试。');
		const final = [...this.texts.values()].filter(m => m.phase !== 'commentary').map(m => m.text).join('\n\n') || this.streamed;
		if (!final.trim()) throw new Error('Codex 未返回回答，请重试。');
		// Some models emit native citation tokens. Only resolve IDs observed in
		// actual web results; never manufacture URLs from a model-supplied ID.
		return final.replace(/\uE200cite\uE202([^\uE201]+)\uE201/g, (original, ids: string) => {
			const links = ids.split('\uE202').flatMap(id => { const source = this.refs.get(id); return source ? [`[${source.title.replace(/[\[\]]/g, '')}](${source.url})`] : []; });
			return links.length ? links.join('、') : original;
		});
	}
}
