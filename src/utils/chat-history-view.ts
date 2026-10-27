import { createElement, X, Trash2 } from 'lucide';
import { listChatHistory, readConversation, historyCleanupStatus, retryHistoryCleanup, type ChatHistoryItem, type ChatHistoryCursor, type Conversation } from './chat-history';
import { watchHistoryChanges } from './chat-history-events';
import { t } from './ui-text';

export function mountChatHistoryView(root: HTMLElement, trigger: HTMLButtonElement, options: {
	beforeOpen: () => void;
	onOpen: (chat: Conversation) => void;
	onDelete: (item: ChatHistoryItem) => Promise<void>;
	onClear: () => Promise<void>;
	isCurrent: (item: ChatHistoryItem) => boolean;
}) {
	const lifetime = new AbortController(), originalTitle = trigger.title;
	let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
	let next: ChatHistoryCursor | undefined, loading = false, busy = false;
	let cancelConfirmation: (() => void) | undefined;
	root.id = `chat-history-${crypto.randomUUID()}`;
	root.setAttribute('aria-label', t('全部对话'));
	trigger.setAttribute('aria-controls', root.id);
	trigger.setAttribute('aria-expanded', 'false');
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text = '') => {
		const node = document.createElement(tag); node.className = name; node.textContent = text; return node;
	};
	const top = make('div', 'clip-chat-history-heading');
	const clear = make('button', 'clip-chat-link clip-chat-history-clear', t('清空历史')); clear.type = 'button';
	const close = make('button', 'clip-chat-icon'); close.type = 'button'; close.setAttribute('aria-label', t('关闭历史记录')); close.append(createElement(X));
	top.append(make('strong', '', t('全部对话')), clear, close);
	const search = make('input', 'clip-chat-history-search'); search.type = 'search'; search.placeholder = t('搜索对话、网页或链接'); search.setAttribute('aria-label', search.placeholder);
	const notice = make('div', 'clip-chat-history-cleanup'); notice.hidden = true;
	const failure = make('span', ''); failure.setAttribute('role', 'alert');
	const retryCleanup = make('button', 'clip-chat-link', t('重试清理')); retryCleanup.type = 'button';
	notice.append(failure, retryCleanup);
	const rows = make('div', 'clip-chat-history-rows');
	const status = make('div', 'clip-chat-history-status'); status.setAttribute('role', 'status');
	const more = make('button', 'clip-chat-link', t('加载更多')); more.type = 'button'; more.hidden = true;
	const retry = make('button', 'clip-chat-link', t('重试')); retry.type = 'button'; retry.hidden = true;
	root.append(top, notice, search, rows, status, more, retry);
	function hide(focus = false) { cancelConfirmation?.(); root.hidden = true; generation++; loading = false; clearTimeout(timer); trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus({ preventScroll: true }); }
	async function refreshCleanup() {
		try {
			const result = await historyCleanupStatus(); if (lifetime.signal.aborted) return;
			trigger.classList.toggle('has-cleanup', result.pending > 0);
			trigger.title = result.pending ? `${originalTitle} · ${t('有待完成的数据清理')}` : originalTitle;
			if (result.pending) { notice.dataset.pending = 'true'; notice.hidden = false; retryCleanup.hidden = false; failure.textContent = t('部分数据尚未清理完成。关闭窗口后仍可在这里重试。'); }
			else if (notice.dataset.pending) { notice.hidden = true; delete notice.dataset.pending; }
		} catch (error) {
			if (!lifetime.signal.aborted) { notice.hidden = false; retryCleanup.hidden = false; failure.textContent = String((error as Error).message); }
		}
	}
	async function operate(action: () => Promise<void>) {
		if (busy) return;
		busy = true; cancelConfirmation = undefined;
		root.setAttribute('aria-busy', 'true'); search.disabled = true;
		for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button'))) if (button !== close) button.disabled = true;
		notice.hidden = true; delete notice.dataset.pending; failure.textContent = '';
		try { await action(); }
		catch (error) { if (!lifetime.signal.aborted) { failure.textContent = String((error as Error).message); notice.hidden = false; retryCleanup.hidden = true; } }
		finally {
			busy = false; if (!lifetime.signal.aborted) {
				root.removeAttribute('aria-busy'); search.disabled = false;
				for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button'))) button.disabled = false;
				await refreshCleanup(); if (!root.hidden) await load(false);
			}
		}
	}
	function confirm(host: HTMLElement, label: string, action: () => Promise<void>, cancel: () => void) {
		cancelConfirmation?.();
		const confirmation = make('div', 'clip-chat-history-confirm'); confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', label);
		const yes = make('button', 'clip-chat-link', t('确认删除')); yes.type = 'button';
		const no = make('button', 'clip-chat-link', t('取消')); no.type = 'button';
		confirmation.append(make('span', '', label), yes, no); host.replaceChildren(confirmation);
		cancelConfirmation = () => { cancelConfirmation = undefined; cancel(); }; no.onclick = () => cancelConfirmation?.();
		yes.onclick = () => void operate(action); no.focus({ preventScroll: true });
	}
	function row(item: ChatHistoryItem) {
		const node = make('div', `clip-chat-history-item${options.isCurrent(item) ? ' is-current' : ''}`);
		const open = make('button', 'clip-chat-history-open'); open.type = 'button';
		const date = new Date(item.updatedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		const source = make('span', 'clip-chat-history-source', item.source.title || item.source.url); source.title = item.source.url;
		open.append(make('span', 'clip-chat-history-title', item.title || t('未命名对话')), source, make('span', 'clip-chat-history-time', date));
		open.onclick = async () => {
			if (busy) return;
			const request = ++generation; open.disabled = true;
			try {
				options.beforeOpen(); const chat = await readConversation(item.pageKey, item.id);
				if (request !== generation || root.hidden || lifetime.signal.aborted) return;
				if (!chat) { status.textContent = t('这段对话已删除，请刷新历史记录。'); node.remove(); return; }
				options.onOpen(chat); hide();
			} catch (error) { if (request === generation) status.textContent = String((error as Error).message); }
			finally { open.disabled = false; }
		};
		const remove = make('button', 'clip-chat-icon'); remove.type = 'button'; remove.title = t('删除对话'); remove.setAttribute('aria-label', `${t('删除对话')} ${item.title}`); remove.append(createElement(Trash2));
		remove.onclick = () => { if (!busy) confirm(node, t('删除这段对话及不再使用的关联图片？图库素材和其他对话会保留。'), () => options.onDelete(item), () => { const replacement = row(item); node.replaceWith(replacement); replacement.querySelector<HTMLButtonElement>('.clip-chat-icon')?.focus(); }); };
		node.append(open, remove); return node;
	}
	async function load(append: boolean) {
		if (busy) return;
		cancelConfirmation?.(); const request = ++generation;
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
	clear.onclick = () => { if (!busy) confirm(rows, t('清空所有网页的全部对话历史及不再使用的关联图片？此操作无法撤销，图库素材和设置会保留。'), options.onClear, () => { void load(false); clear.focus(); }); };
	search.oninput = () => { generation++; clearTimeout(timer); timer = setTimeout(() => void load(false), 180); };
	close.onclick = () => hide(true);
	more.onclick = () => { if (!loading) void load(true); };
	retry.onclick = () => void load(false);
	retryCleanup.onclick = () => void operate(retryHistoryCleanup);
	root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (cancelConfirmation) cancelConfirmation(); else hide(true); } }, { signal: lifetime.signal });
	document.addEventListener('pointerdown', event => { if (!root.hidden && !root.contains(event.target as Node) && !trigger.contains(event.target as Node)) hide(); }, { signal: lifetime.signal });
	const unwatch = watchHistoryChanges(change => { if (!busy) { void refreshCleanup(); if (change.type !== 'cleanup' && !root.hidden) void load(false); } });
	void refreshCleanup();
	return {
		toggle() { if (!root.hidden) { hide(true); return; } root.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.value = ''; search.focus({ preventScroll: true }); void load(false); void refreshCleanup(); },
		hide,
		destroy() { hide(); lifetime.abort(); unwatch(); trigger.classList.remove('has-cleanup'); trigger.title = originalTitle; }
	};
}
