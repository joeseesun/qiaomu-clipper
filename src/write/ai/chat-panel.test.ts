// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Editor } from '@tiptap/core';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const sent: { system: string; messages: { role: string; content: string; images?: unknown[] }[]; reasoningEffort?: string }[] = [];
let reply = '';
let thought = '';
vi.mock('../../utils/chat-llm', () => ({
	enabledChatModels: () => [{ id: 'm1', name: 'Model One', providerId: 'p1', providerModelId: 'gpt-5.1' }],
	streamChat: vi.fn(async (options: any) => { sent.push({ system: options.system, messages: options.messages, reasoningEffort: options.reasoningEffort }); if (thought) options.onThought?.(thought); for (const part of reply.match(/[\s\S]{1,20}/g) ?? []) options.onDelta(part); return reply; }),
}));
vi.mock('../../utils/storage-utils', () => ({ generalSettings: { providers: [{ id: 'p1', name: 'Test', baseUrl: 'https://test.example/' }] }, getLocalStorage: async () => undefined, setLocalStorage: async () => {} }));
vi.mock('../image-models', () => ({ loadImageModels: async () => ({ models: [], defaultId: '' }), readyModels: () => [], ASPECTS: [], labelOf: () => '', generateImage: async () => new Blob() }));
vi.mock('../../utils/browser-polyfill', () => ({ default: { tabs: { create: async () => ({}) }, runtime: { getURL: (p: string) => p } } }));

import { resetDbConnection } from '../db';
import { buildExtensions } from '../editor/extensions';
import { editorMarkdown } from '../markdown-io';
import { mountChatPanel } from './chat-panel';
import { loadChat } from './chat-store';

const noRects = Object.assign([], { item: () => null });
(Range.prototype as any).getClientRects = () => noRects;
(Range.prototype as any).getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });

let editor: Editor; let panel: ReturnType<typeof mountChatPanel>;
const titles: string[] = []; const digests: string[] = [];
beforeEach(() => {
	(globalThis as any).indexedDB = new IDBFactory(); resetDbConnection();
	sent.length = 0; thought = ''; titles.length = 0; digests.length = 0; document.body.textContent = '';
	editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: buildExtensions({ resolveImage: async () => undefined }), content: '# 小节\n\n第一段原文。\n\n第二段有一句重要的话。' });
	panel = mountChatPanel({ editor, articleId: 'art_1', getTitle: () => '旧标题', setTitle: t => titles.push(t), getDigest: () => '', setDigest: t => digests.push(t), getMarkdown: () => editorMarkdown(editor) });
});
afterEach(() => { panel.destroy(); editor.destroy(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const say = async (text: string) => { const input = document.querySelector<HTMLTextAreaElement>('.qw-chat-input')!; input.value = text; document.querySelector<HTMLButtonElement>('button[title="发送"]')!.click(); await settle(); };
const block = (json: unknown) => `\`\`\`qm-action\n${JSON.stringify(json)}\n\`\`\``;

it('answers about the article it can see and keeps the conversation', async () => {
	reply = '这篇文章的开头很直接。';
	await panel.toggle(true);
	expect(document.querySelectorAll('.qw-strip-item').length).toBe(4);
	await say('开头怎么样？');
	expect(sent[0].system).toContain('第二段有一句重要的话。');
	expect(sent[0].system).toContain('【文章标题】旧标题');
	expect(document.querySelector('.qw-msg.assistant')!.textContent).toContain('开头很直接');
	const stored = await loadChat('art_1');
	expect(stored[0].messages.map(m => m.role)).toEqual(['user', 'assistant']);
	expect(stored[0].title).toBe('开头怎么样？');
});

it('shows proposed edits as cards and applies each only when accepted', async () => {
	reply = `改动如下。\n${block({ type: 'replace', find: '重要的话', with: '关键的一句' })}\n${block({ type: 'setTitle', title: '新标题' })}\n${block({ type: 'insert', where: 'end', markdown: '## 结尾\n\n谢谢阅读。' })}`;
	await panel.toggle(true);
	await say('帮我改');
	expect(document.querySelectorAll('.qw-prop').length).toBe(3);
	expect(document.querySelector('.qw-msg.assistant .qw-msg-body')!.textContent!.trim()).toBe('改动如下。');
	expect(editorMarkdown(editor)).toContain('重要的话');
	const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-prop-apply'));
	buttons[0].click(); await settle();
	expect(editorMarkdown(editor)).toContain('关键的一句');
	expect(editorMarkdown(editor)).not.toContain('重要的话');
	buttons[1].click(); await settle();
	expect(titles).toEqual(['新标题']);
	buttons[2].click(); await settle();
	expect(editorMarkdown(editor).endsWith('谢谢阅读。')).toBe(true);
	expect(editor.getJSON().content!.some(n => n.type === 'heading' && (n.content?.[0] as any)?.text === '结尾')).toBe(true);
	expect(buttons.map(b => b.textContent)).toEqual(['已应用', '已应用', '已应用']);
	expect((await loadChat('art_1'))[0].messages[1].applied).toEqual([0, 1, 2]);
});

it('says so when quoted text is no longer in the article, and keeps the card usable', async () => {
	reply = block({ type: 'replace', find: '根本不存在的话', with: 'x' });
	await panel.toggle(true);
	await say('改一下');
	const button = document.querySelector<HTMLButtonElement>('.qw-prop-apply')!;
	button.click(); await settle();
	expect(button.disabled).toBe(false);
	expect(document.querySelector('.qw-toast')?.textContent).toContain('没在文章里找到');
});

it('does not offer pictures when no picture model is set up', async () => {
	reply = '好的';
	await panel.toggle(true);
	await say('配一张图');
	expect(sent[0].system).not.toContain('"type":"image"');
	expect(sent[0].system).toContain('还没有添加生图模型');
});


it('offers prompts that fit what the writer is doing, and sends one with a click', async () => {
	reply = '好的';
	await panel.toggle(true);
	const labels = Array.from(document.querySelectorAll('.qw-strip-item')).map(b => b.textContent);
	expect(labels).toContain('指出最该改的三处');
	editor.commands.setTextSelection({ from: 3, to: 8 });
	await settle();
	expect(Array.from(document.querySelectorAll('.qw-strip-item')).map(b => b.textContent)).toContain('润色这段');
	Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-strip-item')).find(b => b.textContent === '润色这段')!.click();
	await settle(); await settle();
	expect(sent[0].messages[sent[0].messages.length - 1].content).toContain('润色选中的文字');
});

it('sends the selected text as context, shows it as a chip, and lets the writer drop it', async () => {
	reply = '收到';
	await panel.toggle(true);
	editor.commands.setTextSelection({ from: 3, to: 9 });
	await settle();
	const chip = document.querySelector('.qw-chat-chips')!;
	expect(chip.textContent).toContain('选区 · ');
	await say('这段怎么改？');
	expect(sent[0].system).toContain('【作者当前选中的文字】');
	expect(sent[0].system).toContain(editor.state.doc.textBetween(3, 9));
	document.querySelector<HTMLButtonElement>('.qw-chip-x')!.click();
	await say('再来一次');
	expect(sent[1].system).not.toContain('【作者当前选中的文字】');
});

it('can leave the article out of a question', async () => {
	reply = '好';
	await panel.toggle(true);
	document.querySelector<HTMLButtonElement>('.qw-chat-chip[aria-pressed]')!.click();
	await say('随便聊聊');
	expect(sent[0].system).toContain('这次没有附上正文');
	expect(sent[0].system).not.toContain('第二段有一句重要的话。');
});

it('sends the chosen thinking strength and shows how long the model thought', async () => {
	reply = '想好了';
	thought = '先看结构，再看措辞。';
	await panel.toggle(true);
	document.querySelector<HTMLButtonElement>('.clip-chat-model')!.click();
	const effort = document.querySelector<HTMLButtonElement>('.clip-chat-effort')!;
	expect(effort.closest<HTMLElement>('.clip-chat-picker-thinking')!.hidden).toBe(false);
	effort.click();
	const levels = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'));
	expect(levels.map(b => b.textContent)).toEqual(['自动', '低', '中等', '高']);
	levels[3].click();
	await say('认真想想');
	expect(sent[0].reasoningEffort).toBe('high');
	expect(document.querySelector('.qw-thought summary')!.textContent).toMatch(/已思考 \d+ 秒/);
	expect(document.querySelector('.qw-thought-text')!.textContent).toContain('先看结构');
	expect(localStorage.getItem('qiaomuWriteEffort:m1')).toBe('high');
});

it('turns a question from the model into a card whose answer is sent back', async () => {
	reply = block({ type: 'ask', question: '写给谁看？', options: [{ label: '同行' }, { label: '普通读者', description: '不懂行' }] });
	await panel.toggle(true);
	await say('帮我写开头');
	const options = Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-ask-option'));
	expect(options.map(o => o.textContent)).toEqual(['同行', '普通读者不懂行', '其他…']);
	reply = '好的，写给普通读者。';
	options[1].click(); await settle(); await settle();
	expect(sent[1].messages[sent[1].messages.length - 1].content).toBe('普通读者');
	expect(document.querySelectorAll('.qw-msg.assistant').length).toBe(2);
});

it('drops a reply into the article and can take an applied change back', async () => {
	reply = `这样改：\n${block({ type: 'replace', find: '重要的话', with: '关键的一句' })}`;
	await panel.toggle(true);
	await say('改');
	const apply = document.querySelector<HTMLButtonElement>('.qw-prop-apply')!;
	apply.click(); await settle();
	expect(editorMarkdown(editor)).toContain('关键的一句');
	const undo = document.querySelector<HTMLButtonElement>('.qw-prop-undo')!;
	expect(undo.hidden).toBe(false);
	undo.click(); await settle();
	expect(editorMarkdown(editor)).toContain('重要的话');
	expect(editorMarkdown(editor)).not.toContain('关键的一句');
	expect(apply.disabled).toBe(false);

	reply = '## 补一节\n\n新增的内容。';
	await say('再写一节');
	const insert = Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-msg-copy')).filter(b => b.textContent?.includes('放进文章')).pop()!;
	insert.click();
	Array.from(document.querySelectorAll<HTMLElement>('.qw-chat-pop .qw-menu-item')).find(i => i.textContent === '追加到文章末尾')!.click();
	expect(editorMarkdown(editor).endsWith('新增的内容。')).toBe(true);
});

it('refuses to undo after the article was edited again', async () => {
	reply = block({ type: 'replace', find: '重要的话', with: '关键的一句' });
	await panel.toggle(true);
	await say('改');
	document.querySelector<HTMLButtonElement>('.qw-prop-apply')!.click(); await settle();
	editor.commands.insertContentAt(1, '后来又写的');
	document.querySelector<HTMLButtonElement>('.qw-prop-undo')!.click(); await settle();
	expect(editorMarkdown(editor)).toContain('关键的一句');
	expect(document.querySelector('.qw-toast')?.textContent).toContain('请直接在文章里按');
});

it('reads another article of the library as reference material', async () => {
	const { saveArticle, blankArticle } = await import('../articles');
	await saveArticle({ ...blankArticle(), title: '旧稿', markdown: '旧稿里的观点' });
	reply = '看过了';
	await panel.toggle(true);
	document.querySelector<HTMLButtonElement>('button[aria-label="添加图片、网页或其他文章"]')!.click();
	Array.from(document.querySelectorAll<HTMLElement>('.qw-chat-pop .qw-menu-item')).find(i => i.textContent === '引用其他文章…')!.click();
	await settle(); await settle();
	Array.from(document.querySelectorAll<HTMLElement>('.qw-chat-pop .qw-menu-item')).find(i => i.textContent === '旧稿')!.click();
	await settle(); await settle();
	expect(document.querySelector('.qw-chat-chips')!.textContent).toContain('旧稿');
	await say('参考旧稿');
	expect(sent[0].system).toContain('【作者附加的资料】');
	expect(sent[0].system).toContain('旧稿里的观点');
	expect(document.querySelector('.qw-msg.user .qw-msg-refs')!.textContent).toContain('旧稿');
	expect(document.querySelector('.qw-chat-chips')!.textContent).not.toContain('旧稿');
});

it('opens the prompt library on "/" and fills blanks before sending', async () => {
	reply = '收到';
	await panel.toggle(true);
	const input = document.querySelector<HTMLTextAreaElement>('.qw-chat-input')!;
	input.value = '/找角度'; input.dispatchEvent(new Event('input'));
	await settle(); await settle();
	const row = document.querySelector<HTMLElement>('.qw-prompts-row')!;
	expect(row.textContent).toContain('给选题找角度');
	row.click(); await settle();
	const field = document.querySelector<HTMLInputElement>('.qw-prompts-form input')!;
	field.value = '写作习惯';
	Array.from(document.querySelectorAll<HTMLButtonElement>('.qw-prompts-form button')).find(b => b.textContent === '发送')!.click();
	await settle(); await settle();
	expect(sent[0].messages[sent[0].messages.length - 1].content).toContain('「写作习惯」');
	expect(document.querySelector('.qw-prompts')).toBeNull();
});
