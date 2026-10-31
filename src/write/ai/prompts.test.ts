import { beforeEach, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('../../utils/storage-utils', () => ({ getLocalStorage: async (k: string) => store[k], setLocalStorage: async (k: string, v: unknown) => { store[k] = v; } }));
import { BUILTIN_PROMPTS, byUsage, isEnabled, matchesPrompt, normalizePromptSettings, promptCatalog, stripPrompts, type PromptItem } from './prompt-library';
import { fillPrompt, promptFields } from './prompt-template';
import { bumpUsage, exportPrompts, importablePrompts, loadPromptSettings, loadUserPrompts, normalizeUserPrompts, saveUserPrompts, togglePinned } from './prompt-store';
import { starterScene } from './starter-prompts';

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

it('finds the blanks to ask for and fills them, with defaults and context', () => {
	const body = '写「{{主题}}」，语气{{语气|轻松}}，{argument name="篇幅" options="短, 长"}，选中的是：{selection}，今天 {date}';
	expect(promptFields(body, { selection: '一段话' }).map(f => [f.name, f.defaultValue, f.options])).toEqual([['主题', undefined, undefined], ['语气', '轻松', undefined], ['篇幅', '短', ['短', '长']]]);
	expect(promptFields(body).map(f => f.name)).toContain('选中的文字');
	const out = fillPrompt(body, { 主题: '写作', 篇幅: '长' }, { selection: '一段话', now: new Date(2026, 9, 17) });
	expect(out).toContain('「写作」');
	expect(out).toContain('语气轻松');
	expect(out).toContain('长，选中的是：一段话');
	expect(out).toContain('2026年10月17日');
	expect(fillPrompt('读 {article}', {}, { article: '我的文章' })).toBe('读 「我的文章」');
});

it('picks the scene from what the writer is looking at', () => {
	expect(starterScene({ selection: true, articleChars: 500 })).toBe('selection');
	expect(starterScene({ selection: false, articleChars: 3 })).toBe('empty');
	expect(starterScene({ selection: false, articleChars: 900 })).toBe('draft');
});

it('keeps curated libraries off until switched on, and suggests prompts for the scene', () => {
	const settings = normalizePromptSettings({});
	const own: PromptItem = { id: 'u1', title: '我的口语化', body: '改得更口语', source: 'user' };
	const catalog = promptCatalog([own]);
	expect(catalog[0]).toBe(own);
	expect(catalog.some(p => p.source === 'qiaomu') && catalog.some(p => p.source === 'yao')).toBe(true);
	expect(isEnabled(own, settings)).toBe(true);
	expect(isEnabled(BUILTIN_PROMPTS.find(p => p.source === 'qiaomu')!, settings)).toBe(false);
	expect(isEnabled(BUILTIN_PROMPTS.find(p => p.source === 'qiaomu')!, { ...settings, enabled: { [BUILTIN_PROMPTS.find(p => p.source === 'qiaomu')!.id]: true } })).toBe(true);
	const strip = stripPrompts(catalog, { ...settings, pinned: ['u1'] }, 'selection');
	expect(strip[0].id).toBe('u1');
	expect(strip.length).toBe(4);
	expect(stripPrompts(catalog, settings, 'draft').every(p => p.scenes?.includes('draft'))).toBe(true);
});

it('searches every word and orders by use', () => {
	const a: PromptItem = { id: 'a', title: '润色', body: '让文字更顺', source: 'user', tags: ['编辑'] };
	const b: PromptItem = { id: 'b', title: '翻译', body: '中英互译', source: 'user' };
	expect(matchesPrompt(a, '润色 编辑')).toBe(true);
	expect(matchesPrompt(a, '润色 翻译')).toBe(false);
	expect(matchesPrompt(b, '')).toBe(true);
	const settings = bumpUsage(bumpUsage(normalizePromptSettings({}), 'b', 1), 'b', 2);
	expect(byUsage([a, b], settings).map(p => p.id)).toEqual(['b', 'a']);
	expect(togglePinned(togglePinned(settings, 'a'), 'a').pinned).toEqual([]);
});

it('stores the writer\'s prompts and settings, dropping invalid entries', async () => {
	await saveUserPrompts([{ id: '1', title: ' 标题 ', body: ' 内容 ', source: 'user', tags: ['x', ' '] }, { id: '1', title: '重复', body: 'x', source: 'user' }, { id: '2', title: '', body: 'x', source: 'user' }]);
	const loaded = await loadUserPrompts();
	expect(loaded).toEqual([{ id: '1', title: '标题', body: '内容', source: 'user', tags: ['x'] }]);
	expect(await loadPromptSettings()).toEqual({ enabled: {}, pinned: [], usage: {} });
	expect(normalizeUserPrompts('nonsense')).toEqual([]);
});

it('imports QuickPrompt and Raycast exports and writes its own', () => {
	expect(importablePrompts([{ title: 'A', content: 'a' }, { name: 'B', prompt: 'b', tags: ['t'] }, { title: 'no body' }]).map(p => [p.title, p.body])).toEqual([['A', 'a'], ['B', 'b']]);
	expect(importablePrompts({ prompts: [{ content: '只有正文，第一行就是标题\n第二行' }] })[0].title).toBe('只有正文，第一行就是标题');
	expect(JSON.parse(exportPrompts([{ id: '1', title: 'T', body: 'B', source: 'user', category: 'c' }])).prompts[0]).toEqual({ title: 'T', content: 'B', category: 'c', tags: [] });
});
