import { getLocalStorage, setLocalStorage } from '../../utils/storage-utils';
import { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings, type PromptItem, type PromptSettings } from './prompt-library';

// The writer's own prompts and what they did with the built-in ones (switched on, pinned, how often used).
const PROMPTS_KEY = 'qiaomuWritePrompts';
const SETTINGS_KEY = 'qiaomuWritePromptSettings';
export const MAX_USER_PROMPTS = 200;

export function normalizeUserPrompts(raw: unknown): PromptItem[] {
	const seen = new Set<string>();
	return (Array.isArray(raw) ? raw : []).flatMap((item: any): PromptItem[] => {
		const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 80) : '';
		const body = typeof item?.body === 'string' ? item.body.trim() : '';
		const id = typeof item?.id === 'string' && item.id ? item.id : '';
		if (!title || !body || !id || seen.has(id)) return [];
		seen.add(id);
		const tags = Array.isArray(item.tags) ? item.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && !!tag.trim()).map((tag: string) => tag.trim()) : [];
		return [{ id, title, body, source: 'user', ...(typeof item.category === 'string' && item.category.trim() ? { category: item.category.trim() } : {}), ...(tags.length ? { tags } : {}), ...(item.run === 'insert' ? { run: 'insert' as const } : {}) }];
	}).slice(0, MAX_USER_PROMPTS);
}

export const loadUserPrompts = async (): Promise<PromptItem[]> => normalizeUserPrompts(await getLocalStorage(PROMPTS_KEY));
export const saveUserPrompts = (prompts: PromptItem[]) => setLocalStorage(PROMPTS_KEY, normalizeUserPrompts(prompts));
export const loadPromptSettings = async (): Promise<PromptSettings> => normalizePromptSettings((await getLocalStorage(SETTINGS_KEY)) ?? DEFAULT_PROMPT_SETTINGS);
export const savePromptSettings = (settings: PromptSettings) => setLocalStorage(SETTINGS_KEY, normalizePromptSettings(settings));

export function togglePinned(settings: PromptSettings, id: string): PromptSettings {
	return { ...settings, pinned: settings.pinned.includes(id) ? settings.pinned.filter(p => p !== id) : [...settings.pinned, id] };
}
export function bumpUsage(settings: PromptSettings, id: string, now = Date.now()): PromptSettings {
	return { ...settings, usage: { ...settings.usage, [id]: { count: (settings.usage[id]?.count ?? 0) + 1, last: now } } };
}

// Qiaomu-QuickPrompt exports (`[{title, content}]` or `{prompts: [...]}`) and Raycast AI Commands (`[{title, prompt}]`).
export function importablePrompts(json: unknown): { title: string; body: string; category?: string; tags?: string[] }[] {
	const list = Array.isArray(json) ? json : json && typeof json === 'object' ? (['prompts', 'items', 'commands'] as const).map(key => (json as Record<string, unknown>)[key]).find(Array.isArray) ?? [] : [];
	return (list as unknown[]).flatMap(entry => {
		if (!entry || typeof entry !== 'object') return [];
		const item = entry as Record<string, unknown>;
		const body = [item.content, item.prompt, item.body].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
		const title = [item.title, item.name].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
		if (!body) return [];
		const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : [];
		return [{ title: (title ?? body.split('\n')[0].slice(0, 30)).trim(), body: body.trim(), ...(typeof item.category === 'string' && item.category.trim() ? { category: item.category.trim() } : {}), ...(tags.length ? { tags } : {}) }];
	});
}
export const exportPrompts = (items: PromptItem[]) => JSON.stringify({ prompts: items.map(i => ({ title: i.title, content: i.body, category: i.category ?? '', tags: i.tags ?? [] })) }, null, 2);
