// Prompt placeholders (from Qiaomu Agent): blanks the writer fills in before a prompt runs, TypingMind/Yao style
// (`{{主题}}`, `{{语气|轻松}}`) or Raycast style (`{argument name="语气" default="轻松" options="轻松, 正式"}`),
// and context taken from where the writer is: `{selection}`, `{article}`, `{clipboard}`, `{date}`, `{time}`, `{datetime}`, `{day}`.
export interface PromptField { name: string; defaultValue?: string; options?: string[]; context?: 'selection' | 'clipboard' }
export interface PromptContext { selection?: string; /** Title of the open article; its text already goes along as context. */ article?: string; clipboard?: string; now?: Date }

const BLANK = /\{\{\s*([^{}|\s][^{}|\n]{0,39}?)\s*(?:\|\s*([^{}\n]*?)\s*)?\}\}/g;
const ARGUMENT = /\{argument((?:\s+[a-z]+=(?:"[^"\n]*"|[^\s}]+))*)\s*\}/g;
const CONTEXT = /\{(selection|article|note|activeNote|reading|browser-tab|clipboard|date|time|datetime|day)((?:\s*\|\s*[a-z-]+)*)\}/g;

function attributes(source: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of source.matchAll(/([a-z]+)=(?:"([^"\n]*)"|([^\s}]+))/g)) result[match[1]] = match[2] ?? match[3] ?? '';
	return result;
}

// The blanks to ask for before sending, in order of first appearance; a missing selection or clipboard is asked for too.
export function promptFields(body: string, context: PromptContext = {}): PromptField[] {
	const found: { at: number; field: PromptField }[] = [];
	for (const match of body.matchAll(BLANK)) found.push({ at: match.index ?? 0, field: { name: match[1], ...(match[2] !== undefined ? { defaultValue: match[2] } : {}) } });
	let unnamed = 0;
	for (const match of body.matchAll(ARGUMENT)) {
		const attrs = attributes(match[1] ?? '');
		const options = attrs.options?.split(',').map(option => option.trim()).filter(Boolean);
		found.push({ at: match.index ?? 0, field: { name: attrs.name || `参数 ${++unnamed}`, ...(attrs.default !== undefined ? { defaultValue: attrs.default } : options?.length ? { defaultValue: options[0] } : {}), ...(options?.length ? { options } : {}) } });
	}
	for (const match of body.matchAll(CONTEXT)) {
		if (match[1] === 'selection' && !context.selection?.trim()) found.push({ at: match.index ?? 0, field: { name: '选中的文字', context: 'selection' } });
		if (match[1] === 'clipboard' && !context.clipboard?.trim()) found.push({ at: match.index ?? 0, field: { name: '剪贴板内容', context: 'clipboard' } });
	}
	const seen = new Set<string>();
	return found.sort((a, b) => a.at - b.at).map(entry => entry.field).filter(field => !seen.has(field.name) && seen.add(field.name));
}

export const usesClipboard = (body: string) => /\{clipboard(?:\s*\|[^}]*)?\}/.test(body);

function contextValue(kind: string, context: PromptContext, values: Record<string, string>): string {
	const now = context.now ?? new Date();
	switch (kind) {
		case 'selection': return context.selection?.trim() || values['选中的文字'] || '';
		case 'clipboard': return context.clipboard?.trim() || values['剪贴板内容'] || '';
		case 'article': case 'note': case 'activeNote': case 'reading': case 'browser-tab': return context.article ? `「${context.article}」` : '这篇文章';
		case 'date': return now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
		case 'time': return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
		case 'datetime': return `${contextValue('date', context, values)} ${contextValue('time', context, values)}`;
		case 'day': return now.toLocaleDateString('zh-CN', { weekday: 'long' });
		default: return '';
	}
}

// The prompt as sent: blanks filled (empty ones take their default), context placeholders resolved.
export function fillPrompt(body: string, values: Record<string, string>, context: PromptContext = {}): string {
	let unnamed = 0;
	return body
		.replace(BLANK, (_whole, name: string, fallback?: string) => values[name.trim()]?.trim() || fallback?.trim() || '')
		.replace(ARGUMENT, (_whole, source: string) => { const attrs = attributes(source ?? ''); const name = attrs.name || `参数 ${++unnamed}`; return values[name]?.trim() || attrs.default || attrs.options?.split(',')[0]?.trim() || ''; })
		.replace(CONTEXT, (_whole, kind: string) => contextValue(kind, context, values))
		.trim();
}
