import type { Editor } from '@tiptap/core';
import { askText, h, toast } from './dom';
import type { AiAction } from './host';
import { insertMarkdownAt, replaceWithMarkdown } from './markdown-insert';
import { BUILTIN_PROMPTS, allActions } from '../ai/actions';
import { enabledChatModels, streamChat } from '../../utils/chat-llm';
import { getLocalStorage, setLocalStorage } from '../../utils/storage-utils';
import { t } from '../../utils/ui-text';

const MODEL_KEY = 'qiaomuChatModel';

export function aiReady(): boolean { return enabledChatModels().length > 0; }

const RULES = '只输出结果本身，使用 Markdown，不要解释，不要加引号或前后说明。保持原文的事实、人名、数字和链接不变。';

export function systemPromptFor(action: AiAction, instruction = ''): string {
	if (action === 'custom') return `你是写作助手。按用户的要求处理给出的文字。要求：${instruction}。${RULES}`;
	return BUILTIN_PROMPTS[action] ?? BUILTIN_PROMPTS.polish;
}

function markdownOf(editor: Editor, from: number, to: number): string {
	try {
		const slice = editor.state.doc.cut(from, to);
		const text = ((editor.storage as any).markdown.serializer.serialize(slice) as string).trim();
		if (text) return text;
	} catch { /* fall back to plain text */ }
	return editor.state.doc.textBetween(from, to, '\n\n');
}

// A card next to the text with the model's answer streaming in; nothing touches the article until the writer accepts.
export function runAi(editor: Editor, action: AiAction): void {
	void (async () => {
		const models = enabledChatModels();
		if (!models.length) { toast(t('还没有可用的 AI 模型，请先在设置里添加'), 'error'); return; }
		const { from, to, empty } = editor.state.selection;
		if (empty && action !== 'continue') { toast(t('先选中要修改的文字'), 'error'); return; }
		let instruction = '';
		const customAction = (await allActions()).find(item => item.id === action && !item.builtin);
		if (action === 'custom') {
			const answer = await askText({ title: t('想让 AI 怎么改？'), placeholder: t('例如：改得更口语，去掉套话'), confirm: t('开始'), cancel: t('取消') });
			if (!answer?.trim()) { editor.commands.focus(); return; }
			instruction = answer.trim();
		}
		const isContinue = action === 'continue';
		const range = isContinue ? { from: editor.state.selection.$to.end(), to: editor.state.selection.$to.end() } : { from, to };
		const source = isContinue ? markdownOf(editor, 0, editor.state.doc.content.size) : markdownOf(editor, from, to);
		const original = isContinue ? '' : editor.state.doc.textBetween(from, to);

		const saved = await getLocalStorage(MODEL_KEY);
		const picker = h('select', { class: 'qw-field qw-ai-model', 'aria-label': t('模型') });
		for (const model of models) picker.append(h('option', { value: model.id, text: model.name }));
		if (models.some(model => model.id === saved)) picker.value = String(saved);
		const output = h('div', { class: 'qw-ai-output', 'aria-live': 'polite', text: t('正在生成…') });
		const replace = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: isContinue ? t('插入文章') : t('替换原文'), disabled: true });
		const after = isContinue ? null : h('button', { type: 'button', class: 'qw-btn', text: t('放在原文后面'), disabled: true });
		const retry = h('button', { type: 'button', class: 'qw-btn', text: t('重新生成') });
		const close = h('button', { type: 'button', class: 'qw-btn', text: t('放弃') });
		const panel = h('div', { class: 'qw-ai-panel', role: 'dialog', 'aria-label': 'AI' }, h('div', { class: 'qw-ai-head' }, picker), output, h('div', { class: 'qw-ai-actions' }, close, retry, ...(after ? [after] : []), replace));
		document.body.append(panel);
		const anchor = editor.view.coordsAtPos(range.to);
		panel.style.left = `${Math.max(12, Math.min(window.innerWidth - panel.offsetWidth - 12, anchor.left - 40))}px`;
		panel.style.top = `${Math.min(window.innerHeight - panel.offsetHeight - 12, anchor.bottom + 10)}px`;

		let controller: AbortController | undefined;
		let result = '';
		const start = async () => {
			controller?.abort();
			controller = new AbortController();
			result = '';
			output.textContent = t('正在生成…');
			output.classList.remove('error');
			replace.disabled = true; if (after) after.disabled = true;
			const model = models.find(item => item.id === picker.value) ?? models[0];
			void setLocalStorage(MODEL_KEY, model.id);
			try {
				await streamChat({ model, system: customAction ? customAction.prompt : systemPromptFor(action, instruction), messages: [{ role: 'user', content: source }], signal: controller.signal, onDelta: delta => { result += delta; output.textContent = result; } });
				result = result.trim();
				output.textContent = result || t('模型没有返回内容');
				replace.disabled = after ? false : !result; if (after) after.disabled = !result;
			} catch (error) {
				if ((error as Error)?.name === 'AbortError') return;
				output.classList.add('error');
				output.textContent = t('生成失败：{0}', [String((error as Error)?.message ?? error).slice(0, 200)]);
			}
		};
		const finish = () => { controller?.abort(); panel.remove(); editor.commands.focus(); };
		close.addEventListener('click', finish);
		retry.addEventListener('click', () => void start());
		panel.addEventListener('keydown', event => { if (event.key === 'Escape') finish(); });
		const apply = (mode: 'replace' | 'after') => {
			if (!result) return;
			let target = range;
			// The selection may have moved while the answer was streaming; only replace text that is still the same.
			if (!isContinue && editor.state.doc.textBetween(range.from, range.to) !== original) { target = { from: editor.state.selection.to, to: editor.state.selection.to }; mode = 'after'; toast(t('原文已经变化，结果插在了光标后面')); }
			if (mode === 'replace' && !isContinue) replaceWithMarkdown(editor, target.from, target.to, result);
			else { editor.commands.setTextSelection(Math.min(target.to, editor.state.doc.content.size)); insertMarkdownAt(editor, 'cursor', result); }
			finish();
		};
		replace.addEventListener('click', () => apply('replace'));
		after?.addEventListener('click', () => apply('after'));
		void start();
	})();
}
