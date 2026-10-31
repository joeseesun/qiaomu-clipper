import library from './prompt-library.json';
import { STARTER_PROMPTS, SCENE_NAMES, type StarterScene } from './starter-prompts';

// Where a prompt comes from: built-in scene prompts, the two curated libraries, or the writer's own.
export type PromptSource = 'scene' | 'qiaomu' | 'yao' | 'user';

export interface PromptItem {
	id: string; title: string; body: string; source: PromptSource; category?: string; tags?: string[];
	scenes?: StarterScene[];
	// "insert" puts the prompt in the composer instead of sending it.
	run?: 'send' | 'insert';
	url?: string;
}

// Per-prompt state kept with the writer's settings.
export interface PromptSettings {
	// Explicit choices; without one, scene prompts and the writer's own are on and the curated libraries are off.
	enabled: Record<string, boolean>;
	pinned: string[];
	usage: Record<string, { count: number; last: number }>;
}
export const DEFAULT_PROMPT_SETTINGS: PromptSettings = { enabled: {}, pinned: [], usage: {} };

export const SOURCE_NAMES: Record<PromptSource, string> = { scene: '场景', qiaomu: '乔木精选', yao: 'Yao Open Prompts', user: '我的' };
export const LIBRARY_FROM = library.from;

export function normalizePromptSettings(raw: unknown): PromptSettings {
	const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
	return {
		enabled: Object.fromEntries(Object.entries(record(data.enabled)).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')),
		pinned: Array.isArray(data.pinned) ? Array.from(new Set(data.pinned.filter((id): id is string => typeof id === 'string' && id.length > 0))) : [],
		usage: Object.fromEntries(Object.entries(record(data.usage)).flatMap(([id, value]) => { const e = record(value); return typeof e.count === 'number' && typeof e.last === 'number' ? [[id, { count: e.count, last: e.last }]] : []; })),
	};
}

const SCENES = Object.keys(STARTER_PROMPTS) as StarterScene[];
export const BUILTIN_PROMPTS: PromptItem[] = [
	...SCENES.flatMap(scene => STARTER_PROMPTS[scene].map((p): PromptItem => ({ id: p.id, title: p.label, body: p.body, source: 'scene', category: SCENE_NAMES[scene], scenes: [scene] }))),
	...library.items.map((item: any): PromptItem => ({ id: item.id, title: item.title, body: item.body, source: item.source === 'yao' ? 'yao' : 'qiaomu', category: item.category, ...(item.run === 'insert' ? { run: 'insert' as const } : {}), ...(typeof item.url === 'string' ? { url: item.url } : {}) })),
];

export const promptCatalog = (userPrompts: PromptItem[]): PromptItem[] => [...userPrompts, ...BUILTIN_PROMPTS];

export const isEnabled = (item: PromptItem, settings: PromptSettings): boolean => settings.enabled[item.id] ?? (item.source === 'scene' || item.source === 'user');

// The strip above the composer: pinned prompts in the writer's order, then a few that fit what is on screen.
export function stripPrompts(catalog: PromptItem[], settings: PromptSettings, scene: StarterScene): PromptItem[] {
	const byId = new Map(catalog.map(item => [item.id, item]));
	const pinned = settings.pinned.flatMap(id => { const item = byId.get(id); return item && isEnabled(item, settings) ? [item] : []; });
	const suggested = catalog.filter(item => item.scenes?.includes(scene) && isEnabled(item, settings) && !pinned.includes(item));
	return [...pinned, ...suggested.slice(0, pinned.length ? 3 : 4)];
}

// Case-insensitive match on title, body, category, tags and source name; every word must match.
export function matchesPrompt(item: PromptItem, query: string): boolean {
	const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return true;
	const text = [item.title, item.body, item.category ?? '', ...(item.tags ?? []), SOURCE_NAMES[item.source]].join('\n').toLocaleLowerCase();
	return words.every(word => text.includes(word));
}

// Most used first, recent use breaking ties; unused ones keep catalog order.
export function byUsage(items: PromptItem[], settings: PromptSettings): PromptItem[] {
	return items.map((item, index) => ({ item, index })).sort((a, b) => {
		const x = settings.usage[a.item.id]; const y = settings.usage[b.item.id];
		return (y?.count ?? 0) - (x?.count ?? 0) || (y?.last ?? 0) - (x?.last ?? 0) || a.index - b.index;
	}).map(entry => entry.item);
}
