import { createElement, X, Trash2 } from 'lucide';
import { listChatHistory, readConversation, type ChatHistoryItem, type ChatHistoryCursor, type Conversation } from './chat-history';
import { t } from './ui-text';

export function mountChatHistoryView(root: HTMLElement, trigger: HTMLButtonElement, options: {
	beforeOpen: () => void;
	onOpen: (chat: Conversation) => void;
	onDelete: (item: ChatHistoryItem) => Promise<void>;
	isCurrent: (item: ChatHistoryItem) => boolean;
}) {
	const lifetime = new AbortController();
	let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
	let next: ChatHistoryCursor | undefined, loading = false;
	root.id = `chat-history-${crypto.randomUUID()}`;
	root.setAttribute('aria-label', t('全部对话'));
	trigger.setAttribute('aria-controls', root.id);
	trigger.setAttribute('aria-expanded', 'false');
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text = '') => {
		const node = document.createElement(tag); node.className = name; node.textContent = text; return node;
	};
	const top = make('div', 'clip-chat-history-heading');
	const close = make('button', 'clip-chat-icon'); close.type = 'button'; close.setAttribute('aria-label', t('关闭历史记录')); close.append(createElement(X));
	top.append(make('strong', '', t('全部对话')), close);
	const search = make('input', 'clip-chat-history-search'); search.type = 'search'; search.placeholder = t('搜索对话、网页或链接'); search.setAttribute('aria-label', search.placeholder);
	const rows = make('div', 'clip-chat-history-rows');
	const status = make('div', 'clip-chat-history-status'); status.setAttribute('role', 'status');
	const more = make('button', 'clip-chat-link', t('加载更多')); more.type = 'button'; more.hidden = true;
	const retry = make('button', 'clip-chat-link', t('重试')); retry.type = 'button'; retry.hidden = true;
	root.append(top, search, rows, status, more, retry);
	function hide(focus = false) { root.hidden = true; generation++; loading = false; clearTimeout(timer); trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus({ preventScroll: true }); }
	function row(item: ChatHistoryItem) {
		const node = make('div', `clip-chat-history-item${options.isCurrent(item) ? ' is-current' : ''}`);
		const open = make('button', 'clip-chat-history-open'); open.type = 'button';
		const date = new Date(item.updatedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		const source = make('span', 'clip-chat-history-source', item.source.title || item.source.url); source.title = item.source.url;
		open.append(make('span', 'clip-chat-history-title', item.title || t('未命名对话')), source, make('span', 'clip-chat-history-time', date));
		open.onclick = async () => {
			const request = ++generation; open.disabled = true;
			try {
				options.beforeOpen();
				const chat = await readConversation(item.pageKey, item.id);
				if (request !== generation || root.hidden || lifetime.signal.aborted) return;
				if (!chat) { status.textContent = t('这段对话已删除，请刷新历史记录。'); node.remove(); return; }
				options.onOpen(chat); hide();
			} catch (error) { if (request === generation) status.textContent = String((error as Error).message); }
			finally { open.disabled = false; }
		};
		const remove = make('button', 'clip-chat-icon'); remove.type = 'button'; remove.title = t('删除对话'); remove.setAttribute('aria-label', `${t('删除对话')} ${item.title}`); remove.append(createElement(Trash2));
		remove.onclick = () => {
			const confirmation = make('div', 'clip-chat-history-confirm');
			const yes = make('button', 'clip-chat-link', t('删除')); yes.type = 'button';
			const no = make('button', 'clip-chat-link', t('取消')); no.type = 'button';
			confirmation.append(make('span', '', t('删除这段对话？')), yes, no); node.replaceChildren(confirmation); yes.focus();
			no.onclick = () => node.replaceWith(row(item));
			yes.onclick = async () => {
				yes.disabled = no.disabled = true;
				try { await options.onDelete(item); if (!lifetime.signal.aborted && !root.hidden) await load(false); }
				catch (error) { status.textContent = String((error as Error).message); yes.disabled = no.disabled = false; }
			};
		};
		node.append(open, remove); return node;
	}
	async function load(append: boolean) {
		const request = ++generation;
		loading = true; more.hidden = retry.hidden = true; status.textContent = t('正在加载历史记录…');
		if (!append) { rows.replaceChildren(); next = undefined; }
		try {
			const result = await listChatHistory(search.value, append ? next : undefined);
			if (request !== generation || root.hidden || lifetime.signal.aborted) return;
			rows.append(...result.items.map(row)); next = result.next; more.hidden = !next;
			status.textContent = rows.childElementCount ? '' : search.value.trim() ? t('没有匹配的对话') : t('还没有对话记录');
		} catch (error) {
			if (request !== generation || lifetime.signal.aborted) return;
			status.textContent = `${t('历史记录加载失败。')} ${String((error as Error).message)}`; retry.hidden = false;
		} finally { if (request === generation) loading = false; }
	}
	search.oninput = () => { generation++; clearTimeout(timer); timer = setTimeout(() => void load(false), 180); };
	close.onclick = () => hide(true);
	more.onclick = () => { if (!loading) void load(true); };
	retry.onclick = () => void load(false);
	root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); } }, { signal: lifetime.signal });
	document.addEventListener('pointerdown', event => { if (!root.hidden && !root.contains(event.target as Node) && !trigger.contains(event.target as Node)) hide(); }, { signal: lifetime.signal });
	return {
		toggle() { if (!root.hidden) { hide(true); return; } root.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.value = ''; search.focus({ preventScroll: true }); void load(false); },
		hide,
		destroy() { hide(); lifetime.abort(); }
	};
}
