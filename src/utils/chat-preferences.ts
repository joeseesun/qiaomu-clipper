export interface ChatPreferences {
	font: 'system' | 'serif' | 'mono' | 'custom';
	customFont: string;
	fontSize: number;
	prompt: string;
	promptEnabled: boolean;
}

export const CHAT_PREFERENCES_KEY = 'qiaomuChatPreferences';
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
	font: 'system', customFont: '', fontSize: 14, prompt: '', promptEnabled: true,
};

export function normalizeChatPreferences(value: unknown): ChatPreferences {
	const data = value && typeof value === 'object' ? value as Partial<ChatPreferences> : {};
	return {
		font: ['system', 'serif', 'mono', 'custom'].includes(data.font ?? '') ? data.font! : 'system',
		customFont: typeof data.customFont === 'string' ? data.customFont.replace(/["'\\;{}\n\r]/g, '').trim().slice(0, 100) : '',
		fontSize: typeof data.fontSize === 'number' && Number.isFinite(data.fontSize) ? Math.round(Math.max(12, Math.min(28, data.fontSize))) : 14,
		prompt: typeof data.prompt === 'string' ? data.prompt.slice(0, 4000) : '',
		promptEnabled: data.promptEnabled !== false,
	};
}

export function chatFontFamily(preferences: ChatPreferences): string {
	const fallback = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
	if (preferences.font === 'serif') return '"Songti SC", "Noto Serif CJK SC", Georgia, serif';
	if (preferences.font === 'mono') return 'ui-monospace, SFMono-Regular, Consolas, monospace';
	if (preferences.font === 'custom' && preferences.customFont) return `"${normalizeChatPreferences(preferences).customFont}", ${fallback}`;
	return fallback;
}

// Keep the source and built-in reading instructions even when personalization is enabled.
export function chatSystemPrompt(base: string, preferences: ChatPreferences, source: string): string {
	const custom = preferences.promptEnabled ? preferences.prompt.trim() : '';
	return `${base}${custom ? `\n\n<user_preferences>\n${custom}\n</user_preferences>` : ''}\n\n<reading_source>\n${source}\n</reading_source>`;
}
