import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { createElement, WandSparkles, X, Plus, Copy, Send, Square, FilePlus2, History, Quote, Trash2, Highlighter, Settings2 } from 'lucide';
import browser from './browser-polyfill';
import { getMessage } from './i18n';
import { getLocalStorage, setLocalStorage, generalSettings } from './storage-utils';
import { streamChat, enabledChatModels, ChatTurn } from './chat-llm';
import { Conversation, StoredTurn, loadConversations, saveConversation, deleteConversation } from './chat-history';
import { showClipStatus } from './clip-bar';
import { CHAT_PREFERENCES_KEY, DEFAULT_CHAT_PREFERENCES, normalizeChatPreferences, chatFontFamily, chatSystemPrompt } from './chat-preferences';

export interface ClipChatOptions {
	// Current article text; read fresh on every question so edits are included.
	getContext: () => { title: string; markdown: string; url: string };
	// Append an answer to the note being clipped.
	onInsert: (text: string) => void | Promise<void>;
	// Reading page only: turn the selection into a highlight.
	onHighlight?: () => void;
}

const MAX_CONTEXT_CHARS = 80000;
const MAX_QUOTE_CHARS = 4000;
const SUGGESTIONS = ['qiaomuChatSuggestSummary', 'qiaomuChatSuggestPoints', 'qiaomuChatSuggestTranslate', 'qiaomuChatSuggestCritic'];
const QUOTE_SUGGESTIONS = ['qiaomuChatQuoteExplain', 'qiaomuChatQuoteTranslate', 'qiaomuChatQuoteSummary', 'qiaomuChatQuoteRewrite'];

const icon = (node: Parameters<typeof createElement>[0]) => createElement(node);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

function iconButton(className: string, node: Parameters<typeof createElement>[0], label: string): HTMLButtonElement {
	const button = el('button', className);
	button.type = 'button';
	button.title = label;
	button.setAttribute('aria-label', label);
	button.appendChild(icon(node));
	return button;
}

// The selected passage of the article: a range in the reading page, or a selection inside the Markdown editor.
function selectedArticleText(): string {
	const active = document.activeElement as HTMLElement | null;
	if (active instanceof HTMLTextAreaElement && active.id === 'ce-markdown') return active.value.slice(active.selectionStart, active.selectionEnd).trim();
	if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return '';
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed) return '';
	const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
	if (anchor?.closest('.clip-chat, .clip-bar, .clip-ask-pill, #clip-bar-status')) return '';
	return selection.toString().trim();
}

// Side panel for asking questions about the article, using the models configured under "AI 解读".
export function mountClipChat(options: ClipChatOptions): { toggle: () => boolean } {
	const root = document.documentElement;
	const panel = el('aside', 'clip-chat');
	panel.hidden = true;
	panel.setAttribute('aria-label', getMessage('qiaomuChatTitle'));

	const header = el('div', 'clip-chat-header');
	const title = el('div', 'clip-chat-title');
	title.append(icon(WandSparkles), el('span', '', getMessage('qiaomuChatTitle')));
	const modelSelect = el('select', 'clip-chat-model');
	const historyButton = iconButton('clip-chat-icon', History, getMessage('qiaomuChatHistory'));
	const newChat = iconButton('clip-chat-icon', Plus, getMessage('qiaomuChatNew'));
	const close = iconButton('clip-chat-icon', X, getMessage('close'));
	const settingsButton = iconButton('clip-chat-icon', Settings2, getMessage('qiaomuChatPreferences'));
	settingsButton.setAttribute('aria-expanded', 'false');
	header.append(title, modelSelect, historyButton, newChat, settingsButton, close);

	const historyList = el('div', 'clip-chat-history');
	historyList.hidden = true;
	const context = el('div', 'clip-chat-context');
	const messagesEl = el('div', 'clip-chat-messages');
	messagesEl.setAttribute('aria-live', 'polite');
	const suggestions = el('div', 'clip-chat-suggestions');

	const quoteBar = el('div', 'clip-chat-quote');
	quoteBar.hidden = true;
	const quoteText = el('span', 'clip-chat-quote-text');
	const quoteClear = iconButton('clip-chat-icon', X, getMessage('close'));
	quoteBar.append(icon(Quote), quoteText, quoteClear);

	const composer = el('form', 'clip-chat-composer');
	const input = el('textarea');
	input.rows = 2;
	input.placeholder = getMessage('qiaomuChatPlaceholder');
	const send = iconButton('clip-chat-send', Send, getMessage('qiaomuChatSend'));
	send.type = 'submit';
	composer.append(input, send);

	const resizer = el('div', 'clip-chat-resize');
	resizer.setAttribute('role', 'separator');
	resizer.setAttribute('aria-orientation', 'vertical');
	panel.append(resizer, header, historyList, context, messagesEl, suggestions, quoteBar, composer);
	document.body.appendChild(panel);

	let preferences = normalizeChatPreferences(null);
	const applyAppearance = () => {
		panel.style.setProperty('--clip-chat-font', chatFontFamily(preferences));
		panel.style.setProperty('--clip-chat-size', `${preferences.fontSize}px`);
	};
	const preferencesReady = getLocalStorage(CHAT_PREFERENCES_KEY).then(value => {
		preferences = normalizeChatPreferences(value); applyAppearance();
	}).catch(() => { applyAppearance(); });
	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && changes[CHAT_PREFERENCES_KEY]) {
			preferences = normalizeChatPreferences(changes[CHAT_PREFERENCES_KEY].newValue); applyAppearance();
		}
	});
	const settingsForm = el('form', 'clip-chat-settings');
	settingsForm.id = `chat-settings-${crypto.randomUUID()}`;
	settingsButton.setAttribute('aria-controls', settingsForm.id);
	settingsForm.hidden = true;
	settingsForm.setAttribute('aria-label', getMessage('qiaomuChatPreferences'));
	panel.appendChild(settingsForm);
	function closePreferences() {
		settingsForm.hidden = true;
		settingsButton.setAttribute('aria-expanded', 'false');
		applyAppearance();
		settingsButton.focus();
	}
	async function openPreferences() {
		await preferencesReady;
		if (!settingsForm.hidden) { closePreferences(); return; }
		historyList.hidden = true;
		settingsForm.replaceChildren();
		settingsForm.append(el('h3', '', getMessage('qiaomuChatPreferences')), el('p', 'clip-chat-settings-note', getMessage('qiaomuChatPreferencesScope')));
		const field = (key: string, control: HTMLElement) => {
			const label = el('label', 'clip-chat-settings-field');
			label.append(el('span', '', getMessage(key)), control); settingsForm.append(label);
		};
		const font = el('select');
		for (const value of ['system', 'serif', 'mono', 'custom']) {
			const option = el('option', '', getMessage(`qiaomuChatFont${value}`)); option.value = value; font.append(option);
		}
		font.value = preferences.font; field('qiaomuChatFont', font);
		const customFont = el('input'); customFont.type = 'text'; customFont.maxLength = 100;
		customFont.value = preferences.customFont; customFont.placeholder = 'PingFang SC'; field('qiaomuChatCustomFont', customFont);
		const customLabel = customFont.parentElement!;
		const size = el('input'); size.type = 'range'; size.min = '12'; size.max = '28'; size.step = '1'; size.value = String(preferences.fontSize);
		field('qiaomuChatFontSize', size);
		const sizeValue = el('output'); size.parentElement!.append(sizeValue);
		const preview = el('p', 'clip-chat-settings-preview', getMessage('qiaomuChatFontPreview')); settingsForm.append(preview);
		const promptEnabled = el('input'); promptEnabled.type = 'checkbox'; promptEnabled.checked = preferences.promptEnabled;
		field('qiaomuChatPromptEnabled', promptEnabled);
		const prompt = el('textarea'); prompt.rows = 5; prompt.maxLength = 4000; prompt.value = preferences.prompt;
		prompt.placeholder = getMessage('qiaomuChatPromptPlaceholder'); field('qiaomuChatCustomPrompt', prompt);
		settingsForm.append(el('p', 'clip-chat-settings-note', getMessage('qiaomuChatPromptScope')));
		const status = el('p', 'clip-chat-settings-note'); status.setAttribute('role', 'status');
		const draft = () => normalizeChatPreferences({font: font.value, customFont: customFont.value, fontSize: Number(size.value), prompt: prompt.value, promptEnabled: promptEnabled.checked});
		const refresh = () => {
			customLabel.hidden = font.value !== 'custom';
			sizeValue.value = `${size.value} px`; size.setAttribute('aria-valuetext', sizeValue.value);
			preview.style.fontFamily = chatFontFamily(draft()); preview.style.fontSize = `${size.value}px`;
			prompt.disabled = !promptEnabled.checked;
		};
		settingsForm.oninput = refresh;
		const actions = el('div', 'clip-chat-settings-actions');
		const reset = el('button', 'clip-chat-link', getMessage('qiaomuChatPreferencesReset')); reset.type = 'button';
		reset.onclick = () => { font.value = DEFAULT_CHAT_PREFERENCES.font; customFont.value = ''; size.value = String(DEFAULT_CHAT_PREFERENCES.fontSize); prompt.value = ''; promptEnabled.checked = true; refresh(); };
		const cancel = el('button', 'clip-chat-link', getMessage('cancel')); cancel.type = 'button'; cancel.onclick = closePreferences;
		const save = el('button', 'clip-chat-link', getMessage('save')); save.type = 'submit';
		actions.append(reset, cancel, save); settingsForm.append(status, actions);
		settingsForm.onsubmit = async event => {
			event.preventDefault(); save.disabled = true;
			try {
				const next = draft(); await setLocalStorage(CHAT_PREFERENCES_KEY, next); preferences = next; closePreferences();
			} catch { status.textContent = getMessage('qiaomuChatPreferencesSaveError'); }
			finally { save.disabled = false; }
		};
		refresh(); settingsForm.style.top = `${header.offsetHeight}px`; settingsForm.hidden = false; settingsButton.setAttribute('aria-expanded', 'true'); font.focus();
	}
	settingsButton.addEventListener('click', () => { void openPreferences(); });
	settingsForm.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePreferences(); } });

	// Width is shared with the page: the article re-lays out beside the panel (reading mode reserves it via --clipper-sidebar-width).
	const MIN_WIDTH = 320;
	const clampWidth = (width: number) => Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, Math.min(760, window.innerWidth * 0.6))));
	const applyWidth = (width: number) => {
		const value = `${clampWidth(width)}px`;
		root.style.setProperty('--clip-chat-width', value);
		if (!panel.hidden) root.style.setProperty('--clipper-sidebar-width', value);
		settingsForm.style.top = historyList.style.top = `${header.offsetHeight}px`;
	};
	resizer.addEventListener('pointerdown', event => {
		event.preventDefault();
		resizer.setPointerCapture(event.pointerId);
		resizer.classList.add('is-dragging');
		root.classList.add('clip-chat-resizing');
	});
	resizer.addEventListener('pointermove', event => {
		if (resizer.hasPointerCapture(event.pointerId)) applyWidth(window.innerWidth - event.clientX);
	});
	const stopDrag = (event: PointerEvent) => {
		if (!resizer.hasPointerCapture(event.pointerId)) return;
		resizer.releasePointerCapture(event.pointerId);
		resizer.classList.remove('is-dragging');
		root.classList.remove('clip-chat-resizing');
		void setLocalStorage('qiaomuChatWidth', panel.offsetWidth);
	};
	resizer.addEventListener('pointerup', stopDrag);
	resizer.addEventListener('pointercancel', stopDrag);
	window.addEventListener('resize', () => { if (!panel.hidden) applyWidth(panel.offsetWidth); settingsForm.style.top = `${header.offsetHeight}px`; });

	const newConversation = (): Conversation => ({ id: crypto.randomUUID(), title: '', updatedAt: 0, messages: [] });
	let conversation = newConversation();
	let quote = '';
	let controller: AbortController | null = null;

	const setBusy = (busy: boolean) => {
		send.replaceChildren(icon(busy ? Square : Send));
		send.title = getMessage(busy ? 'qiaomuChatStop' : 'qiaomuChatSend');
		send.setAttribute('aria-label', send.title);
	};
	setBusy(false);

	const render = (text: string) => DOMPurify.sanitize(marked.parse(text, { gfm: true }) as string);
	const persist = () => {
		const { title: articleTitle, url } = options.getContext();
		if (conversation.messages.length) void saveConversation(url, articleTitle, conversation).catch(() => {});
	};

	function addMessage(turn: StoredTurn): HTMLElement {
		const wrap = el('div', `clip-chat-message is-${turn.role}`);
		if (turn.quote) {
			const quoted = el('blockquote', 'clip-chat-quoted', turn.quote.length > 240 ? `${turn.quote.slice(0, 240)}…` : turn.quote);
			wrap.appendChild(quoted);
		}
		const body = el('div', 'clip-chat-body');
		if (turn.role === 'user') body.textContent = turn.content; else body.innerHTML = render(turn.content);
		wrap.appendChild(body);
		messagesEl.appendChild(wrap);
		messagesEl.scrollTop = messagesEl.scrollHeight;
		return wrap;
	}

	function addActions(wrap: HTMLElement, answer: string) {
		const actions = el('div', 'clip-chat-actions');
		const copy = iconButton('clip-chat-action', Copy, getMessage('qiaomuActionCopy'));
		copy.append(el('span', '', getMessage('qiaomuActionCopy')));
		copy.addEventListener('click', async () => { await navigator.clipboard.writeText(answer).catch(() => {}); showClipStatus(getMessage('qiaomuEditorCopied')); });
		const insert = iconButton('clip-chat-action', FilePlus2, getMessage('qiaomuChatInsert'));
		insert.append(el('span', '', getMessage('qiaomuChatInsert')));
		insert.addEventListener('click', async () => { await options.onInsert(answer); showClipStatus(getMessage('qiaomuChatInserted')); });
		actions.append(copy, insert);
		wrap.appendChild(actions);
	}

	function refreshContext() {
		const { markdown } = options.getContext();
		context.textContent = getMessage('qiaomuChatContext', String(markdown.length));
	}

	function refreshQuote() {
		quoteBar.hidden = !quote;
		quoteText.textContent = quote.length > 160 ? `${quote.slice(0, 160)}…` : quote;
		if (!conversation.messages.length && !controller) renderSuggestions();
	}

	function renderSuggestions() {
		suggestions.replaceChildren();
		if (input.disabled) return;
		for (const key of quote ? QUOTE_SUGGESTIONS : SUGGESTIONS) {
			const chip = el('button', 'clip-chat-chip', getMessage(key));
			chip.type = 'button';
			chip.addEventListener('click', () => { void ask(getMessage(key)); });
			suggestions.appendChild(chip);
		}
	}

	// Rebuild the message list from the current conversation (also used when restoring history).
	function renderConversation() {
		messagesEl.replaceChildren();
		suggestions.replaceChildren();
		const models = enabledChatModels();
		if (!models.length) {
			const empty = el('div', 'clip-chat-empty');
			empty.append(el('p', '', getMessage('qiaomuChatNoModel')));
			const open = el('button', 'clip-chat-link', getMessage('qiaomuChatOpenSettings'));
			open.type = 'button';
			open.addEventListener('click', () => { void browser.runtime.openOptionsPage(); });
			empty.appendChild(open);
			messagesEl.appendChild(empty);
			input.disabled = true; send.disabled = true;
			return;
		}
		input.disabled = false; send.disabled = false;
		for (const turn of conversation.messages) {
			const wrap = addMessage(turn);
			if (turn.role === 'assistant') addActions(wrap, turn.content);
		}
		if (!conversation.messages.length) renderSuggestions();
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function populateModels() {
		const models = enabledChatModels();
		const saved = await getLocalStorage('qiaomuChatModel');
		modelSelect.replaceChildren(...models.map(model => { const option = el('option', '', model.name); option.value = model.id; return option; }));
		modelSelect.value = models.some(m => m.id === saved) ? saved : (models[0]?.id ?? '');
		modelSelect.hidden = models.length < 2;
	}

	const apiTurn = (turn: StoredTurn): ChatTurn => ({
		role: turn.role,
		content: turn.quote ? `${getMessage('qiaomuChatAboutSelection')}\n"""\n${turn.quote}\n"""\n\n${turn.content}` : turn.content,
	});

	async function ask(question: string) {
		await preferencesReady;
		const text = question.trim();
		if (!text || controller) return;
		const model = enabledChatModels().find(m => m.id === modelSelect.value);
		if (!model) return;
		historyList.hidden = true;
		suggestions.replaceChildren();
		input.value = '';
		const turn: StoredTurn = { role: 'user', content: text, ...(quote ? { quote } : {}) };
		quote = '';
		refreshQuote();
		if (!conversation.messages.length) conversation.title = text.slice(0, 40);
		conversation.messages.push(turn);
		addMessage(turn);
		const answerWrap = addMessage({ role: 'assistant', content: '' });
		const body = answerWrap.querySelector('.clip-chat-body') as HTMLElement;
		body.classList.add('is-thinking');

		const { title: articleTitle, markdown, url } = options.getContext();
		const article = markdown.length > MAX_CONTEXT_CHARS ? `${markdown.slice(0, MAX_CONTEXT_CHARS)}\n\n[…${getMessage('qiaomuChatTruncated')}]` : markdown;
		const system = chatSystemPrompt(getMessage('qiaomuChatSystem'), preferences, `# ${articleTitle}\n${url}\n\n${article}`);

		controller = new AbortController();
		setBusy(true);
		let answer = '';
		let failed = false;
		let frame = 0;
		const paint = () => { frame = 0; body.classList.remove('is-thinking'); body.innerHTML = render(answer); messagesEl.scrollTop = messagesEl.scrollHeight; };
		try {
			await streamChat({ model, system, messages: conversation.messages.map(apiTurn), signal: controller.signal, onDelta: delta => { answer += delta; if (!frame) frame = requestAnimationFrame(paint); } });
		} catch (error) {
			if ((error as Error).name !== 'AbortError') {
				failed = true;
				answerWrap.classList.add('is-error');
				body.classList.remove('is-thinking');
				body.textContent = `${getMessage('qiaomuChatError')}\n${String((error as Error).message ?? error).slice(0, 300)}`;
			}
		} finally {
			cancelAnimationFrame(frame);
			if (failed) conversation.messages.pop(); // keep the question out of the history; the user can retry
			else if (answer) {
				conversation.messages.push({ role: 'assistant', content: answer });
				body.classList.remove('is-thinking');
				body.innerHTML = render(answer);
				addActions(answerWrap, answer);
			} else { answerWrap.remove(); conversation.messages.pop(); }
			persist();
			controller = null;
			setBusy(false);
			messagesEl.scrollTop = messagesEl.scrollHeight;
			input.focus();
		}
	}

	async function showHistory() {
		historyList.style.top = `${header.offsetHeight}px`;
		if (!historyList.hidden) { historyList.hidden = true; return; }
		const { url } = options.getContext();
		const list = (await loadConversations(url)).filter(c => c.messages.length);
		historyList.replaceChildren();
		if (!list.length) historyList.appendChild(el('div', 'clip-chat-history-empty', getMessage('qiaomuChatNoHistory')));
		for (const item of list) {
			const row = el('div', `clip-chat-history-item${item.id === conversation.id ? ' is-current' : ''}`);
			const open = el('button', 'clip-chat-history-open');
			open.type = 'button';
			open.append(el('span', 'clip-chat-history-title', item.title || '…'), el('span', 'clip-chat-history-time', new Date(item.updatedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
			open.addEventListener('click', () => { controller?.abort(); conversation = item; historyList.hidden = true; renderConversation(); });
			const remove = iconButton('clip-chat-icon', Trash2, getMessage('delete'));
			remove.addEventListener('click', async () => {
				await deleteConversation(url, item.id);
				row.remove();
				if (item.id === conversation.id) { conversation = newConversation(); renderConversation(); }
			});
			row.append(open, remove);
			historyList.appendChild(row);
		}
		historyList.hidden = false;
	}

	composer.addEventListener('submit', event => {
		event.preventDefault();
		if (controller) controller.abort(); else void ask(input.value);
	});
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
		if (event.key === 'Escape') toggle();
	});
	modelSelect.addEventListener('change', () => { void setLocalStorage('qiaomuChatModel', modelSelect.value); });
	historyButton.addEventListener('click', () => { if (!settingsForm.hidden) closePreferences(); void showHistory(); });
	newChat.addEventListener('click', () => { if (!settingsForm.hidden) closePreferences(); controller?.abort(); conversation = newConversation(); historyList.hidden = true; renderConversation(); refreshContext(); input.focus(); });
	close.addEventListener('click', () => toggle());
	quoteClear.addEventListener('click', () => { quote = ''; refreshQuote(); });

	let storedWidth = 0;
	void getLocalStorage('qiaomuChatWidth').then(width => { storedWidth = Number(width) || 0; });
	let initialized = false;
	function toggle(open = panel.hidden): boolean {
		if (!open && !settingsForm.hidden) closePreferences();
		panel.hidden = !open;
		root.classList.toggle('clip-chat-open', open);
		document.dispatchEvent(new CustomEvent('clip-chat-state', { detail: open }));
		if (open) {
			applyWidth(storedWidth || 400);
			refreshContext();
			if (!initialized) {
				initialized = true;
				// Pick up where the last conversation about this article left off.
				void Promise.all([populateModels(), loadConversations(options.getContext().url).catch(() => [])]).then(([, saved]) => {
					const last = saved.find(c => c.messages.length);
					if (last && !conversation.messages.length) conversation = last;
					renderConversation();
				});
			}
			input.focus();
		} else {
			root.style.removeProperty('--clipper-sidebar-width');
		}
		return open;
	}

	// Ask about a passage: quote it above the composer and offer passage-specific prompts.
	function askAbout(text: string) {
		// Without a model the panel only guides to the settings; a quote would just sit there.
		quote = enabledChatModels().length ? text.slice(0, MAX_QUOTE_CHARS) : '';
		if (panel.hidden) toggle(true);
		historyList.hidden = true;
		refreshQuote();
		input.focus();
	}
	mountSelectionPill(askAbout, options.onHighlight);

	return { toggle: () => toggle() };
}

// One small capsule next to the selection: Highlight (reading page) and Ask AI. Can be turned off in the settings.
function mountSelectionPill(onAsk: (text: string) => void, onHighlight?: () => void) {
	const pill = el('div', 'clip-ask-pill');
	pill.hidden = true;
	pill.setAttribute('role', 'toolbar');
	const segment = (node: Parameters<typeof createElement>[0], label: string) => {
		const button = el('button', 'clip-ask-pill-button');
		button.type = 'button';
		button.append(icon(node), el('span', '', label));
		// Keep the selection alive while pressing the capsule.
		button.addEventListener('mousedown', event => event.preventDefault());
		return button;
	};
	let text = '';
	const hide = () => { pill.hidden = true; };
	if (onHighlight) {
		const highlight = segment(Highlighter, getMessage('highlightSelection'));
		highlight.addEventListener('click', () => { hide(); onHighlight(); });
		pill.appendChild(highlight);
	}
	const ask = segment(WandSparkles, getMessage('qiaomuChatAskSelection'));
	ask.addEventListener('click', () => { hide(); onAsk(text); });
	pill.appendChild(ask);
	document.body.appendChild(pill);

	let enabled = generalSettings.selectionToolbar !== false;
	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.general_settings) {
			enabled = (changes.general_settings.newValue as { selectionToolbar?: boolean } | undefined)?.selectionToolbar !== false;
			if (!enabled) hide();
		}
	});

	document.addEventListener('mouseup', event => {
		if (pill.contains(event.target as Node)) return;
		const { clientX, clientY } = event;
		setTimeout(() => {
			text = enabled ? selectedArticleText() : '';
			if (text.length < 2) { hide(); return; }
			pill.hidden = false;
			const width = pill.offsetWidth || 120;
			pill.style.left = `${Math.min(Math.max(8, clientX - width / 2), window.innerWidth - width - 8)}px`;
			pill.style.top = `${clientY > 90 ? clientY - 46 : clientY + 18}px`;
		}, 0);
	});
	document.addEventListener('mousedown', event => { if (!pill.contains(event.target as Node)) hide(); });
	document.addEventListener('scroll', hide, { capture: true, passive: true });
	document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}
