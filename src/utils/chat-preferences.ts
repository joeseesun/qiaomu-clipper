import { FONT_PRESETS, getFontCss } from './font-utils';

// A one-tap question shown above the input. `scope` picks when it appears: about the whole article, or about a selected passage.
export interface QuickPrompt {
	id: string;
	title: string;
	body: string;
	scope: 'article' | 'selection';
	enabled: boolean;
}

export interface ChatPreferences {
	// 'reader' follows the reading font live; preset values (__zhuque__ …) are the reading page's own fonts.
	font: string;
	customFont: string;
	fontSize: number;
	prompt: string;
	promptEnabled: boolean;
	// null = built-in defaults (follow the UI language); an array once the user has edited the list.
	quickPrompts: QuickPrompt[] | null;
}

export const MAX_QUICK_PROMPTS = 30;
const DEFAULT_QUICK_PROMPTS: Array<[string, QuickPrompt['scope'], string]> = [
	['summary', 'article', 'qiaomuChatSuggestSummary'], ['points', 'article', 'qiaomuChatSuggestPoints'],
	['translate', 'article', 'qiaomuChatSuggestTranslate'], ['critic', 'article', 'qiaomuChatSuggestCritic'],
	['q-explain', 'selection', 'qiaomuChatQuoteExplain'], ['q-translate', 'selection', 'qiaomuChatQuoteTranslate'],
	['q-summary', 'selection', 'qiaomuChatQuoteSummary'], ['q-rewrite', 'selection', 'qiaomuChatQuoteRewrite'],
];

export function defaultQuickPrompts(t: (key: string) => string): QuickPrompt[] {
	return DEFAULT_QUICK_PROMPTS.map(([id, scope, key]) => ({ id: `builtin-${id}`, title: t(key), body: t(key), scope, enabled: true }));
}

export function normalizeQuickPrompts(value: unknown): QuickPrompt[] | null {
	if (!Array.isArray(value)) return null;
	const seen = new Set<string>();
	const list: QuickPrompt[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const item = raw as Partial<QuickPrompt>;
		const title = typeof item.title === 'string' ? item.title.trim().slice(0, 40) : '';
		const body = typeof item.body === 'string' ? item.body.trim().slice(0, 2000) : '';
		if (!title || !body) continue;
		let id = typeof item.id === 'string' && item.id ? item.id.slice(0, 64) : `p-${list.length}`;
		while (seen.has(id)) id += '_';
		seen.add(id);
		list.push({ id, title, body, scope: item.scope === 'selection' ? 'selection' : 'article', enabled: item.enabled !== false });
		if (list.length >= MAX_QUICK_PROMPTS) break;
	}
	return list;
}

// What the chips show: enabled prompts for the current situation, in the user's order.
export function visibleQuickPrompts(preferences: ChatPreferences, hasQuote: boolean, t: (key: string) => string): QuickPrompt[] {
	const scope = hasQuote ? 'selection' : 'article';
	return (preferences.quickPrompts ?? defaultQuickPrompts(t)).filter(item => item.enabled && item.scope === scope);
}

export const CHAT_FONTS = ['reader', 'system', 'serif', ...FONT_PRESETS.map(font => font.value), 'mono', 'custom'];
export const CHAT_PREFERENCES_KEY = 'qiaomuChatPreferences';
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
	font: 'reader', customFont: '', fontSize: 14, prompt: '', promptEnabled: true, quickPrompts: null,
};

export function normalizeChatPreferences(value: unknown): ChatPreferences {
	const data = value && typeof value === 'object' ? value as Partial<ChatPreferences> : {};
	return {
		font: typeof data.font === 'string' && CHAT_FONTS.includes(data.font) ? data.font : 'reader',
		customFont: typeof data.customFont === 'string' ? data.customFont.replace(/["'\\;{}\n\r]/g, '').trim().slice(0, 100) : '',
		fontSize: typeof data.fontSize === 'number' && Number.isFinite(data.fontSize) ? Math.round(Math.max(12, Math.min(28, data.fontSize))) : 14,
		prompt: typeof data.prompt === 'string' ? data.prompt.slice(0, 4000) : '',
		promptEnabled: data.promptEnabled !== false,
		quickPrompts: normalizeQuickPrompts(data.quickPrompts),
	};
}

export function chatFontFamily(preferences: ChatPreferences): string {
	const fallback = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
	if (preferences.font === 'reader') return `var(--font-text, ${fallback})`;
	if (preferences.font === 'serif') return getFontCss('__serif__')!;
	if (preferences.font === 'mono') return 'ui-monospace, SFMono-Regular, Consolas, monospace';
	if (preferences.font === 'custom' && preferences.customFont) return `"${normalizeChatPreferences(preferences).customFont}", ${fallback}`;
	return getFontCss(preferences.font) ?? fallback;
}

// Keep the source and built-in reading instructions even when personalization is enabled.
export function chatSystemPrompt(base: string, preferences: ChatPreferences, source: string): string {
	const custom = preferences.promptEnabled ? preferences.prompt.trim() : '';
	return `${base}${custom ? `\n\n<user_preferences>\n${custom}\n</user_preferences>` : ''}\n\n<reading_source>\n${source}\n</reading_source>`;
}
