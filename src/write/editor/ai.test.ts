// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const calls: { system: string; content: string }[] = [];
vi.mock('../../utils/chat-llm', () => ({
	enabledChatModels: () => [{ id: 'm1', name: 'Model One' }],
	streamChat: vi.fn(async (options: { system: string; messages: { content: string }[]; onDelta: (text: string) => void }) => {
		calls.push({ system: options.system, content: options.messages[0].content });
		options.onDelta('润色后'); options.onDelta('的文字');
		return '润色后的文字';
	}),
}));
vi.mock('../../utils/storage-utils', () => ({ getLocalStorage: async () => undefined, setLocalStorage: async () => {} }));

import { buildExtensions } from './extensions';
import { runAi, systemPromptFor } from './ai';
import { editorMarkdown } from '../markdown-io';

// jsdom has no layout; ProseMirror asks ranges for their rectangles when the card is placed.
const noRects = Object.assign([], { item: () => null });
(Range.prototype as any).getClientRects = () => noRects;
(Range.prototype as any).getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

let editor: Editor;
beforeEach(() => { calls.length = 0; document.body.textContent = ''; editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: buildExtensions({ resolveImage: async () => undefined }), content: '第一段原文。\n\n第二段。' }); });
afterEach(() => editor.destroy());
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-ai-panel button')).find(b => b.textContent === label)!;

it('streams a rewrite of the selection into a card and replaces the text only when accepted', async () => {
	editor.commands.setTextSelection({ from: 1, to: 7 });
	runAi(editor, 'polish');
	await settle();
	expect(calls[0].system).toContain('润色');
	expect(calls[0].content).toBe('第一段原文。');
	expect(document.querySelector('.qw-ai-output')!.textContent).toBe('润色后的文字');
	expect(editorMarkdown(editor)).toContain('第一段原文。');
	button('替换原文').click();
	expect(editorMarkdown(editor)).toBe('润色后的文字\n\n第二段。');
	expect(document.querySelector('.qw-ai-panel')).toBeNull();
});

it('leaves the article alone when the card is discarded', async () => {
	editor.commands.setTextSelection({ from: 1, to: 7 });
	runAi(editor, 'shorten');
	await settle();
	button('放弃').click();
	expect(editorMarkdown(editor)).toBe('第一段原文。\n\n第二段。');
	expect(document.querySelector('.qw-ai-panel')).toBeNull();
});

it('can put the result after the original, and continues from the end of the article', async () => {
	editor.commands.setTextSelection({ from: 1, to: 7 });
	runAi(editor, 'expand');
	await settle();
	button('放在原文后面').click();
	expect(editorMarkdown(editor)).toContain('第一段原文。');
	expect(editorMarkdown(editor)).toContain('润色后的文字');
	editor.commands.setContent('只有一段。');
	editor.commands.focus('end');
	runAi(editor, 'continue');
	await settle();
	expect(calls[calls.length - 1].content).toBe('只有一段。');
	button('插入文章').click();
	expect(editorMarkdown(editor)).toContain('润色后的文字');
});

it('writes a different instruction for each action', () => {
	const prompts = (['polish', 'shorten', 'expand', 'toEnglish', 'toChinese', 'continue'] as const).map(action => systemPromptFor(action));
	expect(new Set(prompts).size).toBe(prompts.length);
	expect(systemPromptFor('custom', '更口语')).toContain('更口语');
});
