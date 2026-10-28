import { streamChatAgent } from '../../utils/chat-agent';
import { mountChatTools, keepChatPhoto, createSearchToggle } from '../../utils/chat-tool-view';
import { toolHistory, normalizeToolResults } from '../../utils/chat-tools-types';
import type { UnsplashPhoto } from '../../utils/image-library-sources';
import type { Editor } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ChevronDown, History, ImagePlus, Link as LinkIcon, MessageSquarePlus, Paperclip, Pencil, RefreshCw, Send, Sparkles, SquareStack, Square, FileText, TextCursorInput, TextQuote, Undo2, X, Copy } from 'lucide';
import { enabledChatModels } from '../../utils/chat-llm';
import { createModelPicker, modelEffort } from '../../utils/model-picker';
import { getLocalStorage, setLocalStorage, generalSettings } from '../../utils/storage-utils';
import { t } from '../../utils/ui-text';
import browser from '../../utils/browser-polyfill';
import { askText, h, icon, toast } from '../editor/dom';
import { insertMarkdownAt, replaceWithMarkdown, textBlocks } from '../editor/markdown-insert';
import { listArticles } from '../articles';
import { loadImageModels, readyModels } from '../image-models';
import { imageUrlFor, saveImage } from '../images';
import { ChatImageGenerationView, parseChatImageReply, startChatImage } from '../../utils/chat-image-generation';
import { MAX_ATTACHMENTS, articleAttachment, imageAttachment, imagesOf, referenceContext, webAttachment, type Attachment } from './attachments';
import { loadChat, newSession, saveChat, titleOf, type ChatMessage, type ChatSession } from './chat-store';
import { promptCatalog, stripPrompts, type PromptItem, type PromptSettings } from './prompt-library';
import { openPromptPicker } from './prompt-panel';
import { loadPromptSettings, loadUserPrompts } from './prompt-store';
import { fillPrompt } from './prompt-template';
import { buildSystemPrompt, findInBlocks, parseReply, type AiProposal } from './protocol';
import { starterScene } from './starter-prompts';

export interface ChatHost {
	editor: Editor;
	articleId: string;
	getTitle: () => string; setTitle: (title: string) => void;
	getDigest: () => string; setDigest: (text: string) => void;
	getMarkdown: () => string;
}

const MODEL_KEY = 'qiaomuChatModel';

function renderMarkdown(text: string): string {
	const html = marked.parse(text, { async: false, breaks: true }) as string;
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] });
}

interface PinnedSelection { text: string; from: number; to: number }

// The writer's AI partner (modelled on Qiaomu Agent): a drawer beside the article. It reads the article and the selected text, takes
// pictures, web pages and other articles as extra material, thinks as hard as asked, answers, asks back when unsure, and proposes
// edits the writer applies one by one (and can take back). Replies can be dropped straight into the article.
export function mountChatPanel(host: ChatHost) {
	let sessions: ChatSession[] = [];
	let current: ChatSession = newSession();
	let controller: AbortController | undefined;
	let imageReady = false;
	let disposed = false;
	const generatedImages = new ChatImageGenerationView();
	let renderTimer = 0;
	let includeArticle = true;
	let pinned: PinnedSelection | null = null;
	let selectionOff = false;
	let attachments: Attachment[] = [];
	let userPrompts: PromptItem[] = [];
	let promptSettings: PromptSettings = { enabled: {}, pinned: [], usage: {} };
	let picker: { close: () => void; setQuery: (q: string) => void } | null = null;
	const undoers = new Map<string, () => boolean>();

	const close = h('button', { type: 'button', class: 'qw-chat-btn', title: t('关闭'), 'aria-label': t('关闭') }, icon(X, 16));
	const fresh = h('button', { type: 'button', class: 'qw-chat-btn', title: t('新对话'), 'aria-label': t('新对话') }, icon(MessageSquarePlus, 16));
	const historyButton = h('button', { type: 'button', class: 'qw-chat-btn', title: t('历史对话'), 'aria-label': t('历史对话'), 'aria-haspopup': 'menu' }, icon(History, 16));
	const head = h('div', { class: 'qw-chat-head' }, h('span', { class: 'qw-chat-title' }, icon(Sparkles, 16), t('AI 助手')), h('span', { class: 'qw-spacer' }), historyButton, fresh, close);
	const list = h('div', { class: 'qw-chat-list', role: 'log', 'aria-live': 'polite' });
	const chips = h('div', { class: 'qw-chat-chips' });
	const strip = h('div', { class: 'qw-chat-strip' });
	const input = h('textarea', { class: 'qw-chat-input', rows: 3, placeholder: t('问问 AI，或让它改文章…（/ 选提示词，@ 引用文章）'), 'aria-label': t('给 AI 的话'), spellcheck: false });
	const send = h('button', { type: 'button', class: 'qw-chat-send', title: t('发送'), 'aria-label': t('发送') }, icon(Send, 16));
	const stop = h('button', { type: 'button', class: 'qw-chat-send', title: t('停止'), 'aria-label': t('停止'), hidden: true }, icon(Square, 14));
	const attach = h('button', { type: 'button', class: 'qw-chat-tool', title: t('添加图片、网页或其他文章'), 'aria-label': t('添加图片、网页或其他文章'), 'aria-haspopup': 'menu' }, icon(Paperclip, 15));
	const promptsButton = h('button', { type: 'button', class: 'qw-chat-tool', title: t('提示词库'), 'aria-label': t('提示词库') }, icon(SquareStack, 15), h('span', { text: t('提示词') }));
	const model = createModelPicker({ getModels: enabledChatModels, getProviders: () => generalSettings.providers,
		onSelect: id => { void setLocalStorage(MODEL_KEY, id); }, onManage: () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=interpreter') }); } });
	const searchToggle = createSearchToggle();
	const tools = h('div', { class: 'qw-chat-tools' }, attach, promptsButton, searchToggle, h('span', { class: 'qw-spacer' }), model.trigger, model.popover, send, stop);
	const foot = h('div', { class: 'qw-chat-foot' }, strip, h('div', { class: 'qw-chat-compose' }, chips, input, tools));
	const grip = h('div', { class: 'qw-chat-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('调整宽度'), title: t('拖动调整宽度，双击恢复'), tabindex: 0 });
	const panel = h('aside', { class: 'qw-chat', 'aria-label': t('AI 助手'), hidden: true }, grip, head, list, foot);
	document.body.append(panel);

	// Width: drag the left edge (or use the arrow keys); the choice is remembered. The editor column makes room for it.
	const IDLE_MS = 120_000;
	const WIDTH_KEY = 'qw-chat-width', MIN_W = 340, DEFAULT_W = 420;
	const maxWidth = () => Math.max(MIN_W, Math.min(760, Math.floor(window.innerWidth * 0.6)));
	const setWidth = (value: number, save = true) => {
		const width = Math.round(Math.max(MIN_W, Math.min(maxWidth(), value)));
		document.body.style.setProperty('--qw-chat-w', `${width}px`);
		grip.setAttribute('aria-valuenow', String(width)); grip.setAttribute('aria-valuemin', String(MIN_W)); grip.setAttribute('aria-valuemax', String(maxWidth()));
		if (save) { try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* private window */ } }
	};
	let savedWidth = DEFAULT_W;
	try { savedWidth = Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_W; } catch { /* private window */ }
	setWidth(savedWidth, false);
	grip.addEventListener('pointerdown', event => {
		event.preventDefault(); grip.setPointerCapture(event.pointerId); panel.classList.add('resizing');
		const move = (e: PointerEvent) => setWidth(document.dir === 'rtl' ? e.clientX : window.innerWidth - e.clientX);
		const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); panel.classList.remove('resizing'); };
		grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
	});
	grip.addEventListener('dblclick', () => setWidth(DEFAULT_W));
	grip.addEventListener('keydown', event => {
		const step = event.shiftKey ? 48 : 16, now = panel.getBoundingClientRect().width, rtl = document.dir === 'rtl';
		if (event.key === 'ArrowLeft') setWidth(now + (rtl ? -step : step)); else if (event.key === 'ArrowRight') setWidth(now + (rtl ? step : -step)); else return;
		event.preventDefault();
	});
	window.addEventListener('resize', () => setWidth(panel.getBoundingClientRect().width || savedWidth, false));

	const persistSession = (session: ChatSession) => { session.title = titleOf(session.messages); session.updatedAt = Date.now(); sessions = [session, ...sessions.filter(s => s.id !== session.id)]; return saveChat(host.articleId, sessions); };
	const persist = () => { void persistSession(current); };
	const articleChars = () => host.getMarkdown().replace(/\s+/g, '').length;
	const selectionText = (): string => (selectionOff ? '' : pinned?.text ?? '');

	// ---- the selected text as context -----------------------------------------------------------------------------------------
	const readSelection = () => {
		const { from, to } = host.editor.state.selection;
		if (from === to) return;
		const text = host.editor.state.doc.textBetween(from, to, '\n');
		if (text.trim()) { pinned = { text, from, to }; selectionOff = false; if (!panel.hidden) { drawChips(); drawStrip(); } }
	};
	host.editor.on('selectionUpdate', readSelection);

	// ---- applying a proposal (and taking it back) -------------------------------------------------------------------------------
	const docUndo = (before: ReturnType<Editor['getJSON']> | null, afterDoc: Editor['state']['doc'], beforeDoc: Editor['state']['doc']) => () => {
		void before;
		if (!host.editor.state.doc.eq(afterDoc)) { toast(t('之后又改过文章，请直接在文章里按 ⌘Z 撤销'), 'error'); return false; }
		host.editor.view.dispatch(host.editor.state.tr.replaceWith(0, host.editor.state.doc.content.size, beforeDoc.content));
		return true;
	};
	const apply = async (proposal: AiProposal): Promise<{ ok: boolean; undo?: () => boolean }> => {
		const { editor } = host;
		const beforeDoc = editor.state.doc;
		const done = () => ({ ok: true, undo: docUndo(null, editor.state.doc, beforeDoc) });
		switch (proposal.type) {
			case 'setTitle': { const previous = host.getTitle(); host.setTitle(proposal.title); return { ok: true, undo: () => { host.setTitle(previous); return true; } }; }
			case 'setDigest': { const previous = host.getDigest(); host.setDigest(proposal.text); return { ok: true, undo: () => { host.setDigest(previous); return true; } }; }
			case 'insert': insertMarkdownAt(editor, proposal.where, proposal.markdown); return done();
			case 'replace': {
				const range = findInBlocks(textBlocks(editor), proposal.find);
				if (!range) { toast(t('没在文章里找到这段话，可能已经改过了'), 'error'); return { ok: false }; }
				replaceWithMarkdown(editor, range.from, range.to, proposal.with);
				return done();
			}
			case 'image': return { ok: false }; // Generated in chat; inserting the finished image is separate.
			case 'ask': return { ok: false };
		}
	};

	const describe = (proposal: AiProposal): { label: string; body: HTMLElement; action: string } => {
		switch (proposal.type) {
			case 'setTitle': return { label: t('改标题'), action: t('应用'), body: h('div', {}, h('div', { class: 'qw-prop-old', text: host.getTitle() || t('（还没有标题）') }), h('div', { class: 'qw-prop-new', text: proposal.title })) };
			case 'setDigest': return { label: t('写摘要'), action: t('应用'), body: h('div', { class: 'qw-prop-new', text: proposal.text }) };
			case 'insert': return { label: proposal.where === 'start' ? t('插入到开头') : proposal.where === 'end' ? t('插入到结尾') : t('插入到光标处'), action: t('插入'), body: h('div', { class: 'qw-prop-new', text: proposal.markdown.length > 400 ? `${proposal.markdown.slice(0, 400)}…` : proposal.markdown }) };
			case 'replace': return { label: t('替换这段话'), action: t('替换'), body: h('div', {}, h('div', { class: 'qw-prop-old', text: proposal.find }), h('div', { class: 'qw-prop-new', text: proposal.with || t('（删除）') })) };
			case 'image': return { label: t('生成配图'), action: t('生成并插入'), body: h('div', { class: 'qw-prop-new', text: `${proposal.prompt}（${proposal.aspect}）` }) };
			case 'ask': return { label: t('AI 想先确认一下'), action: '', body: h('div') };
		}
	};

	// ---- inserting a reply into the article ------------------------------------------------------------------------------------
	const insertReply = (text: string, where: 'cursor' | 'end' | 'selection') => {
		const { editor } = host;
		if (where === 'selection') {
			const range = pinned && editor.state.doc.textBetween(pinned.from, pinned.to, '\n') === pinned.text ? pinned : (editor.state.selection.from !== editor.state.selection.to ? { from: editor.state.selection.from, to: editor.state.selection.to } : null);
			if (!range) { toast(t('先在文章里选中要替换的文字'), 'error'); return; }
			replaceWithMarkdown(editor, range.from, range.to, text);
		} else insertMarkdownAt(editor, where, text);
		toast(t('已放进文章'));
	};

	// ---- drawing the conversation ---------------------------------------------------------------------------------------------
	const menu = (anchor: HTMLElement, rows: { label: string; ic?: Node; run: () => void }[]) => {
		document.querySelector('.qw-chat-pop')?.remove();
		const pop = h('div', { class: 'qw-menu qw-chat-pop', role: 'menu' });
		for (const row of rows) { const item = h('div', { class: 'qw-menu-item', role: 'menuitem', tabindex: 0 }, row.ic ? h('span', { class: 'qw-menu-icon' }, row.ic) : null, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: row.label }))); const run = () => { pop.remove(); row.run(); }; item.addEventListener('click', run); item.addEventListener('keydown', event => { if (event.key === 'Enter') run(); }); pop.append(item); }
		document.body.append(pop);
		const rect = anchor.getBoundingClientRect();
		pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left))}px`;
		pop.style.top = `${rect.top - pop.offsetHeight - 6 > 8 ? rect.top - pop.offsetHeight - 6 : rect.bottom + 6}px`;
		const away = (e: MouseEvent) => { if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener('mousedown', away, true); } };
		document.addEventListener('mousedown', away, true);
	};

	const insertPhoto = async (photo: UnsplashPhoto, blob: Blob, active = () => !disposed) => {
		if (!active()) return;
		const saved = await saveImage(blob, photo.description.slice(0, 80));
		if (!active()) return;
		host.editor.chain().focus().insertContent([{ type: 'image', attrs: { src: imageUrlFor(saved.id), alt: photo.description.slice(0, 80) } },
			{ type: 'paragraph', content: [{ type: 'text', text: `${photo.author} · Unsplash`, marks: [{ type: 'link', attrs: { href: photo.link, target: '_blank' } }] }] }]).run();
	};
	const drawMessage = (message: ChatMessage, index: number, streaming: boolean): HTMLElement => {
		const isLast = index === current.messages.length - 1;
		if (message.role === 'user') {
			const out = h('div', { class: 'qw-msg user' }, h('div', { class: 'qw-bubble-text-user', text: message.content }));
			if (message.refs?.length) out.append(h('div', { class: 'qw-msg-refs', text: message.refs.map(r => `📎 ${r}`).join('  ') }));
			if (index === current.messages.length - 2 && !controller) {
				const edit = h('button', { type: 'button', class: 'qw-msg-copy', title: t('编辑后重新发送') }, icon(Pencil, 12), t('编辑'));
				edit.addEventListener('click', () => { current.messages.splice(index, 2); persist(); draw(); input.value = message.content; resize(); input.focus(); });
				out.append(edit);
			}
			return out;
		}
		const parsed = parseReply(message.content);
		const body = h('div', { class: 'qw-msg-body' });
		if (parsed.text) body.innerHTML = renderMarkdown(parsed.text); // sanitised
		else if (streaming && !message.thought && !parsed.pending) body.append(h('span', { class: 'qw-typing', text: t('正在想…') }));
		if (streaming && parsed.pending) body.append(h('div', { class: 'qw-typing', text: t('正在写，已写 {0} 字…', [parsed.pendingChars]) }));
		body.querySelectorAll('a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
		const out = h('div', { class: 'qw-msg assistant' });
		if (message.thought || (message.thinkMs ?? 0) > 1500) {
			const seconds = Math.max(1, Math.round((message.thinkMs ?? 0) / 1000));
			const details = h('details', { class: 'qw-thought' }, h('summary', { text: streaming && !parsed.text ? t('思考中…') : t('已思考 {0} 秒', [seconds]) }));
			if (message.thought) details.append(h('div', { class: 'qw-thought-text', text: message.thought }));
			if (streaming && !parsed.text) details.open = true;
			out.append(details);
		}
		out.append(body);
		const pendingIdx: number[] = [];
		const owner = current;
		if (message.tools?.length) mountChatTools(out, message.tools, { persist: () => persistSession(owner), followup: text => void ask(text), insert: insertPhoto });
		let imageIndex = 0;
		if (!streaming) message.generatedImages ??= parseChatImageReply(message.content).images;
		parsed.proposals.forEach((proposal, i) => {
			if (proposal.type === 'image') {
				const image = message.generatedImages?.[imageIndex++];
				if (streaming || !image) return;
				generatedImages.mount(out, image, () => persistSession(owner), async blob => {
					const saved = await saveImage(blob, image.prompt.slice(0, 80));
					if (disposed) return;
					const { editor } = host;
					const node = { type: 'image', attrs: { src: imageUrlFor(saved.id), alt: image.prompt.slice(0, 80) } };
					if (image.where === 'end') editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
					else editor.chain().focus().insertContent(node).run();
				});
				return;
			}
			const info = describe(proposal);
			if (proposal.type === 'ask') {
				const done = message.applied?.includes(i) ?? false;
				const card = h('div', { class: 'qw-prop qw-ask' }, h('div', { class: 'qw-prop-head' }, h('span', { text: info.label })), h('div', { class: 'qw-ask-q', text: proposal.question }));
				const options = h('div', { class: 'qw-ask-options' });
				proposal.options.forEach(option => {
					const b = h('button', { type: 'button', class: 'qw-ask-option', disabled: done || streaming || !isLast }, h('span', { text: option.label }), option.description ? h('span', { class: 'im-hint', text: option.description }) : null);
					b.addEventListener('click', () => { message.applied = [...(message.applied ?? []), i]; persist(); void ask(option.label); });
					options.append(b);
				});
				if (proposal.allowOther && !done && isLast && !streaming) {
					const other = h('button', { type: 'button', class: 'qw-ask-option other', text: t('其他…') });
					other.addEventListener('click', async () => { const answer = await askText({ title: proposal.question, placeholder: t('写下你的想法'), confirm: t('发送'), cancel: t('取消') }); if (answer?.trim()) { message.applied = [...(message.applied ?? []), i]; persist(); void ask(answer.trim()); } });
					options.append(other);
				}
				card.append(options); out.append(card); return;
			}
			const done = message.applied?.includes(i) ?? false;
			const key = `${message.content.length}:${index}:${i}`;
			const button = h('button', { type: 'button', class: 'qw-btn qw-btn-primary qw-prop-apply', text: done ? t('已应用') : info.action, disabled: done || streaming });
			const undo = h('button', { type: 'button', class: 'qw-btn qw-prop-undo', title: t('撤销这次修改') }, icon(Undo2, 12), t('撤销'));
			undo.hidden = true;
			const showUndo = () => { undo.hidden = !undoers.has(key); button.hidden = !undo.hidden; };
			if (!done) pendingIdx.push(i);
			button.addEventListener('click', async () => {
				const result = await apply(proposal);
				if (!result.ok) return;
				message.applied = [...(message.applied ?? []), i]; persist();
				if (result.undo) undoers.set(key, result.undo);
				button.textContent = t('已应用'); button.disabled = true; showUndo();
			});
			undo.addEventListener('click', () => {
				const run = undoers.get(key);
				if (!run?.()) return;
				undoers.delete(key); message.applied = (message.applied ?? []).filter(n => n !== i); persist();
				button.disabled = false; button.textContent = info.action; showUndo();
			});
			out.append(h('div', { class: 'qw-prop' }, h('div', { class: 'qw-prop-head' }, h('span', { text: info.label }), h('span', { class: 'qw-prop-buttons' }, undo, button)), info.body));
			showUndo();
		});
		if (pendingIdx.length > 1 && !streaming) {
			const all = h('button', { type: 'button', class: 'qw-btn qw-prop-all', text: t('全部应用') });
			all.addEventListener('click', async () => { for (const i of pendingIdx) { const r = await apply(parsed.proposals[i]); if (r.ok) message.applied = [...(message.applied ?? []), i]; } persist(); draw(); });
			out.append(all);
		}
		if (!streaming && (parsed.text || message.content)) {
			const text = parsed.text || message.content;
			const bar = h('div', { class: 'qw-msg-actions' });
			const copy = h('button', { type: 'button', class: 'qw-msg-copy' }, icon(Copy, 12), t('复制'));
			copy.addEventListener('click', () => { void navigator.clipboard.writeText(text).then(() => { copy.textContent = t('已复制'); window.setTimeout(() => { copy.textContent = t('复制'); }, 1200); }); });
			const insert = h('button', { type: 'button', class: 'qw-msg-copy', 'aria-haspopup': 'menu' }, icon(TextCursorInput, 12), t('放进文章'), icon(ChevronDown, 11));
			insert.addEventListener('click', () => menu(insert, [
				{ label: t('插入到光标处'), run: () => insertReply(text, 'cursor') },
				{ label: t('追加到文章末尾'), run: () => insertReply(text, 'end') },
				{ label: t('替换选中的文字'), run: () => insertReply(text, 'selection') },
			]));
			bar.append(copy, insert);
			if (isLast && !controller) {
				const again = h('button', { type: 'button', class: 'qw-msg-copy' }, icon(RefreshCw, 12), t('重新生成'));
				again.addEventListener('click', () => { const question = current.messages[index - 1]; if (!question) return; current.messages.splice(index - 1, 2); persist(); void ask(question.content); });
				bar.append(again);
			}
			out.append(bar);
		}
		return out;
	};

	function draw(streaming = false) {
		generatedImages.clear();
		const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
		list.textContent = '';
		if (!enabledChatModels().length) {
			const go = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('去添加模型') });
			go.addEventListener('click', () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=interpreter') }); });
			list.append(h('div', { class: 'qw-chat-empty' }, h('p', { text: t('还没有可用的 AI 模型。添加一个以后，就能让它看你的文章、提意见、直接改。') }), go));
		} else if (!current.messages.length) {
			list.append(h('div', { class: 'qw-chat-empty qw-chat-welcome' },
				h('div', { class: 'qw-welcome-mark', 'aria-hidden': 'true' }, icon(Sparkles, 22)),
				h('p', { class: 'qw-welcome-title', text: t('一起把这篇写好') }),
				h('p', { class: 'qw-welcome-lead', text: t('我能看到你正在写的文章和选中的文字。问我问题，或者让我改标题、写摘要、润色、配图。') }),
				h('span', { class: 'qw-welcome-rule', 'aria-hidden': 'true' }),
				h('p', { class: 'qw-chat-hint', text: t('下面的快捷条会跟着你在做的事变化；输入 / 打开提示词库，输入 @ 引用别的文章。') })));
		} else current.messages.forEach((message, i) => list.append(drawMessage(message, i, streaming && i === current.messages.length - 1)));
		drawChips(); drawStrip();
		if (atBottom || streaming) list.scrollTop = list.scrollHeight;
	}

	// ---- context chips and the shortcut strip ------------------------------------------------------------------------------------
	function drawChips() {
		chips.textContent = '';
		const article = h('button', { type: 'button', class: `qw-chat-chip${includeArticle ? ' on' : ''}`, 'aria-pressed': String(includeArticle), title: includeArticle ? t('这篇文章会随问题一起发给 AI，点一下取消') : t('点一下把这篇文章附上') }, icon(FileText, 12), includeArticle ? t('当前文章') : t('不带文章'));
		article.addEventListener('click', () => { includeArticle = !includeArticle; drawChips(); });
		chips.append(article);
		if (selectionText()) {
			const count = selectionText().replace(/\s+/g, '').length;
			const chip = h('span', { class: 'qw-chat-quote', title: selectionText().slice(0, 1000) }, icon(TextQuote, 12),
				h('span', { class: 'qw-chat-quote-copy' }, h('small', { text: t('选区 · {0} 字', [count]) }), h('span', { text: selectionText().slice(0, 240) })),
				h('button', { type: 'button', class: 'qw-chip-x', 'aria-label': t('不用选区'), text: '×', onclick: () => { selectionOff = true; drawChips(); drawStrip(); } }));
			chips.append(chip);
		} else if (pinned) {
			const back = h('button', { type: 'button', class: 'qw-chat-chip', title: t('把刚才选中的文字重新作为上下文') }, icon(TextQuote, 12), t('用上次选区'));
			back.addEventListener('click', () => { selectionOff = false; drawChips(); drawStrip(); });
			chips.append(back);
		}
		for (const item of attachments) {
			const chip = h('span', { class: 'qw-chat-chip on', title: item.label }, icon(item.kind === 'image' ? ImagePlus : item.kind === 'web' ? LinkIcon : FileText, 12));
			if (item.kind === 'image') chip.append(h('img', { class: 'qw-chip-thumb', src: item.dataUrl, alt: '' }));
			chip.append(h('span', { class: 'qw-chip-label', text: item.label }), h('button', { type: 'button', class: 'qw-chip-x', 'aria-label': t('移除'), text: '×', onclick: () => { attachments = attachments.filter(a => a.id !== item.id); drawChips(); } }));
			chips.append(chip);
		}
	}
	function drawStrip() {
		strip.textContent = '';
		const scene = starterScene({ selection: !!selectionText(), articleChars: articleChars() });
		for (const item of stripPrompts(promptCatalog(userPrompts), promptSettings, scene)) {
			const b = h('button', { type: 'button', class: 'qw-strip-item', title: item.body.slice(0, 160), text: item.title });
			b.addEventListener('click', () => { picker?.close(); void openPromptPicker({ anchor: promptsButton, scene, context: promptContext, autoRun: item, onPick: usePrompt, onClose: () => { picker = null; } }).then(p => { picker = p; }); });
			strip.append(b);
		}
	}

	// ---- prompts ------------------------------------------------------------------------------------------------------------------
	const promptContext = () => ({ selection: selectionText(), article: host.getTitle().trim() || undefined });
	const usePrompt = (text: string, run: 'send' | 'insert') => { if (run === 'insert') { input.value = text; resize(); input.focus(); } else void ask(text); };
	const openPrompts = async (initialQuery?: string) => {
		picker?.close();
		picker = await openPromptPicker({ anchor: promptsButton, scene: starterScene({ selection: !!selectionText(), articleChars: articleChars() }), context: promptContext, initialQuery, onPick: usePrompt, onClose: () => { picker = null; void loadPromptState().then(drawStrip); } });
	};
	async function loadPromptState() { [userPrompts, promptSettings] = await Promise.all([loadUserPrompts(), loadPromptSettings()]); }
	promptsButton.addEventListener('click', () => { if (picker) picker.close(); else void openPrompts(); });

	// ---- attachments ---------------------------------------------------------------------------------------------------------------
	const addAttachment = async (make: () => Promise<Attachment>) => {
		if (attachments.length >= MAX_ATTACHMENTS) { toast(t('最多附加 {0} 项', [MAX_ATTACHMENTS]), 'error'); return; }
		try { attachments.push(await make()); drawChips(); } catch (error) { toast(String((error as Error)?.message ?? error).slice(0, 160), 'error'); }
	};
	const addImages = (files: File[]) => { for (const file of files.filter(f => f.type.startsWith('image/'))) void addAttachment(() => imageAttachment(file)); };
	const pickArticle = async () => {
		const items = (await listArticles()).filter(a => a.id !== host.articleId).slice(0, 30);
		if (!items.length) { toast(t('文章库里还没有别的文章')); return; }
		menu(attach, items.map(a => ({ label: a.title.trim() || t('未命名文章'), ic: icon(FileText, 14), run: () => void addAttachment(() => articleAttachment(a.id)) })));
	};
	attach.addEventListener('click', () => menu(attach, [
		{ label: t('图片…'), ic: icon(ImagePlus, 14), run: () => { const f = h('input', { type: 'file', accept: 'image/*', multiple: true }); f.addEventListener('change', () => addImages(Array.from(f.files ?? []))); f.click(); } },
		{ label: t('网页链接…'), ic: icon(LinkIcon, 14), run: async () => { const url = await askText({ title: t('读取一个网页'), placeholder: 'https://…', confirm: t('读取'), cancel: t('取消'), note: t('只读取公开网页的正文，作为这次提问的资料') }); if (url?.trim()) await addAttachment(() => webAttachment(url)); } },
		{ label: t('引用其他文章…'), ic: icon(FileText, 14), run: () => void pickArticle() },
		{ label: t('引用当前选区'), ic: icon(TextQuote, 14), run: () => { readSelection(); if (!pinned) toast(t('先在文章里选中一段文字'), 'error'); else { selectionOff = false; drawChips(); drawStrip(); } } },
	]));
	input.addEventListener('paste', event => { const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/')); if (files.length) { event.preventDefault(); addImages(files); } });
	panel.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
	panel.addEventListener('drop', event => { const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/')); if (files.length) { event.preventDefault(); addImages(files); } });

	// ---- talking ------------------------------------------------------------------------------------------------------------------
	const setBusy = (busy: boolean) => { send.hidden = busy; stop.hidden = !busy; input.disabled = busy; model.trigger.disabled = busy; searchToggle.disabled = busy; if (busy) model.close(); };
	async function ask(text: string) {
		const question = text.trim();
		const models = enabledChatModels();
		if (!question || !models.length || controller || disposed) return;
		const owner = current;
		const request = new AbortController();
		controller = request;
		const chosen = models.find(m => m.id === model.value) ?? models[0];
		void setLocalStorage(MODEL_KEY, chosen.id);
		const level = modelEffort(chosen);
		const { editor } = host;
		const headings: string[] = [];
		editor.state.doc.descendants(node => { if (node.type.name === 'heading') headings.push(node.textContent.trim()); return false; });
		const sent = attachments;
		attachments = [];
		const systemContext = { title: host.getTitle(), digest: host.getDigest(), markdown: host.getMarkdown(), selection: selectionText(), headings, imageReady, includeArticle, references: referenceContext(sent) };
		current.messages.push({ role: 'user', content: question, ...(sent.length ? { refs: sent.map(a => a.label) } : {}) }, { role: 'assistant', content: '' });
		const reply = current.messages[current.messages.length - 1];
		const history = current.messages.slice(0, -2).map(m => ({ role: m.role, content: m.content + toolHistory(m.tools) + (m.generatedImages?.length ? `\n[图片任务：${m.generatedImages.map(i => `${i.prompt}；${i.imageId ? '已生成，图片数据未附上' : i.jobId ? '已提交后台' : '未生成'}`).join('；')}]` : '') }));
		const images = imagesOf(sent);
		const turns = [...history, { role: 'user' as const, content: question, ...(images.length ? { images } : {}) }];
		input.value = ''; resize();
		setBusy(true); draw(true);
		const started = Date.now();
		let firstText = 0;
		let stalled = false;
		let idle = 0;
		let completed = false;
		const active = () => !disposed && current === owner && controller === request && !request.signal.aborted;
		const watch = () => { window.clearTimeout(idle); idle = window.setTimeout(() => { stalled = true; request.abort(); }, IDLE_MS); };
		watch();
		try {
			imageReady = readyModels(await loadImageModels()).length > 0;
			if (!active()) return;
			const system = buildSystemPrompt({ ...systemContext, imageReady });
			await streamChatAgent({
				model: chosen, system, messages: turns, signal: request.signal, reasoningEffort: level,
				onThought: delta => { if (!active()) return; watch(); reply.thought = (reply.thought ?? '') + delta; reply.thinkMs = Date.now() - started; schedule(); },
				previousTools: owner.messages.flatMap(m => m.tools || []), canInsert: true,
				onUseImage: async (photo, action) => { const blob = await keepChatPhoto(photo, request.signal); if (active() && action === 'insert') await insertPhoto(photo, blob, active); },
				onTools: results => { if (!active()) return; watch(); reply.tools = results; schedule(); },
				onText: value => { if (!active()) return; watch(); if (!firstText) { firstText = Date.now(); reply.thinkMs = firstText - started; } reply.content = value; schedule(); },
			});
			completed = active();
		} catch (error) {
			if (stalled) reply.content = reply.content ? `${reply.content}\n\n${t('（中断：{0}）', [t('模型太久没有回应')])}` : t('出错了：{0}', [t('模型太久没有回应，请重试或换一个模型')]);
			else if ((error as Error)?.name !== 'AbortError') reply.content = reply.content ? `${reply.content}\n\n${t('（中断：{0}）', [String((error as Error)?.message ?? error).slice(0, 160)])}` : t('出错了：{0}', [String((error as Error)?.message ?? error).slice(0, 200)]);
		} finally {
			window.clearTimeout(idle);
			if (controller === request) { controller = undefined; if (!disposed) setBusy(false); }
			if (reply.tools?.length) { reply.tools = normalizeToolResults(reply.tools); await persistSession(owner); }
			if (disposed || current !== owner) return;
			// A streaming redraw still queued would repaint the unfinished state over the final one.
			if (renderTimer) { cancelAnimationFrame(renderTimer); renderTimer = 0; }
			if (!reply.content.trim() && !reply.thought && !reply.tools?.length) current.messages.splice(-2, 2); // nothing came back; do not keep an empty exchange
			if (reply.thinkMs !== undefined && !reply.thought && reply.thinkMs < 1500) delete reply.thinkMs;
			const parsedImages = parseChatImageReply(reply.content);
			if (completed) reply.generatedImages = parsedImages.images;
			persist(); draw(); input.focus();
			if (completed && !parsedImages.pending) for (const image of reply.generatedImages ?? []) void startChatImage(image, () => persistSession(owner));
		}
	}
	function schedule() { if (!renderTimer) renderTimer = requestAnimationFrame(() => { renderTimer = 0; draw(true); }); }

	const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(220, input.scrollHeight)}px`; };
	input.addEventListener('input', () => {
		resize();
		// "/" at the very start opens the prompt library; "@" after a space or at the start picks another article.
		if (/^[/、／]/.test(input.value) && !input.value.includes('\n')) { const q = input.value.slice(1); if (picker) picker.setQuery(q); else void openPrompts(q); }
		else if (picker && !input.value) picker.close();
		if (/(^|\s)@$/.test(input.value)) { input.value = input.value.slice(0, -1); resize(); void pickArticle(); }
	});
	input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (picker && /^[/、／]/.test(input.value)) return; void ask(input.value); } });
	send.addEventListener('click', () => void ask(input.value));
	stop.addEventListener('click', () => controller?.abort());
	fresh.addEventListener('click', () => { controller?.abort(); current = newSession(); attachments = []; draw(); input.focus(); });
	close.addEventListener('click', () => toggle(false));
	historyButton.addEventListener('click', () => {
		document.querySelector('.qw-chat-history')?.remove();
		const shown = sessions.filter(item => item.messages.length);
		if (!shown.length) { toast(t('还没有历史对话')); return; }
		const pop = h('div', { class: 'qw-menu qw-chat-history', role: 'menu' });
		for (const s of shown) {
			const del = h('button', { type: 'button', class: 'qw-chip-x', 'aria-label': t('删除这段对话'), title: t('删除这段对话'), text: '×' });
			const row = h('div', { class: `qw-menu-item${s.id === current.id ? ' active' : ''}`, role: 'menuitem', tabindex: 0 }, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: s.title || t('新对话') }), h('span', { class: 'qw-menu-hint', text: new Date(s.updatedAt).toLocaleString() })), del);
			row.addEventListener('click', () => { controller?.abort(); current = s; pop.remove(); draw(); });
			del.addEventListener('click', event => { event.stopPropagation(); sessions = sessions.filter(item => item.id !== s.id); if (current.id === s.id) current = newSession(); void saveChat(host.articleId, sessions); pop.remove(); draw(); });
			pop.append(row);
		}
		const rect = historyButton.getBoundingClientRect();
		pop.style.top = `${rect.bottom + 6}px`; pop.style.left = `${Math.max(8, rect.right - 280)}px`;
		document.body.append(pop);
		const away = (e: MouseEvent) => { if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener('mousedown', away, true); } };
		document.addEventListener('mousedown', away, true);
	});

	// ---- models and thinking strength ----------------------------------------------------------------------------------------------
	async function refreshModels() {
		if (controller) return;
		const models = enabledChatModels(), saved = await getLocalStorage(MODEL_KEY);
		if (disposed || controller) return;
		model.setModels(models.some(m => m.id === saved) ? String(saved) : models[0]?.id || '');
		imageReady = readyModels(await loadImageModels()).length > 0;
	}

	async function toggle(open = panel.hidden) {
		panel.hidden = !open;
		document.body.classList.toggle('qw-chat-open', open);
		if (!open) { model.close(); picker?.close(); return; }
		await Promise.all([refreshModels(), loadPromptState()]);
		if (!sessions.length) { sessions = await loadChat(host.articleId); if (!current.messages.length && sessions[0]) current = sessions[0]; }
		readSelection();
		draw(); input.focus();
	}
	return { toggle, isOpen: () => !panel.hidden, destroy: () => { disposed = true; model.destroy(); controller?.abort(); if (renderTimer) cancelAnimationFrame(renderTimer); generatedImages.clear(); picker?.close(); host.editor.off('selectionUpdate', readSelection); panel.remove(); } };
}
