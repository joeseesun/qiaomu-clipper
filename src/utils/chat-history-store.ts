import browser from './browser-polyfill';
import { snapshotConversation, type Conversation } from './chat-history';
import { chatPageKey, type ChatSource } from './chat-source';
import { t } from './ui-text';

interface RecordEntry { pageKey: string; id: string; conversation: Conversation }
export interface ChatHistoryItem {
	pageKey: string; id: string; title: string; updatedAt: number;
	source: ChatSource; messageCount: number;
}
export type ChatHistoryCursor = [number, string, string];
const stores = ['conversations', 'summaries', 'meta'];
function put(tx: IDBTransaction, pageKey: string, chat: Conversation) {
	const source = chat.source!;
	tx.objectStore('conversations').put({ pageKey, id: chat.id, conversation: chat } satisfies RecordEntry);
	tx.objectStore('summaries').put({ pageKey, id: chat.id, title: chat.title, updatedAt: chat.updatedAt, source,
		messageCount: chat.messages.length } satisfies ChatHistoryItem);
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function completion(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error(t('历史记录未能保存，请重试。'))); });
}
async function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('qiaomu-chat-history', 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			const conversations = db.createObjectStore('conversations', { keyPath: ['pageKey', 'id'] });
			conversations.createIndex('page', 'pageKey');
			const summaries = db.createObjectStore('summaries', { keyPath: ['pageKey', 'id'] });
			summaries.createIndex('recent', ['updatedAt', 'pageKey', 'id']);
			summaries.createIndex('pageRecent', ['pageKey', 'updatedAt', 'id']);
			db.createObjectStore('meta');
		};
		let blocked = false;
		req.onsuccess = () => {
			if (blocked) { req.result.close(); return; }
			req.result.onversionchange = () => req.result.close(); resolve(req.result);
		};
		req.onerror = () => reject(req.error);
		req.onblocked = () => { blocked = true; reject(new Error(t('请关闭其他 AI 对话窗口后重试。'))); };
	});
}

// One atomic import, including its completion marker. Remove the legacy copy only
// after commit; an interrupted cleanup can never cause re-import or resurrect chats.
async function database(): Promise<IDBDatabase> {
	const db = await open();
	try {
		if (await request(db.transaction('meta').objectStore('meta').get('legacy-imported'))) return db;
		const legacy = await browser.storage.local.get(null);
		const tx = db.transaction(stores, 'readwrite');
		const done = completion(tx);
		const importedKeys: string[] = [];
		const check = tx.objectStore('meta').get('legacy-imported');
		check.onsuccess = () => {
			if (check.result) return;
			for (const [key, value] of Object.entries(legacy)) {
				if (!key.startsWith('qiaomuChat:') || !value || typeof value !== 'object') continue;
				const article = value as { url?: string; title?: string; conversations?: Conversation[] };
				if (typeof article.url !== 'string' || !Array.isArray(article.conversations)) continue;
				const hash = (url: string) => { let n = 5381; for (let i = 0; i < url.length; i++) n = ((n << 5) + n + url.charCodeAt(i)) | 0; return `qiaomuChat:${(n >>> 0).toString(36)}`; };
				const preserveUrlHash = key !== hash(chatPageKey(article.url));
				const pageKey = chatPageKey(article.url, preserveUrlHash);
				let complete = true;
				for (const chat of article.conversations) {
					if (!chat || typeof chat.id !== 'string' || typeof chat.title !== 'string' || !Array.isArray(chat.messages)
						|| chat.messages.some(turn => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string')) { complete = false; continue; }
					const source = { url: article.url, title: article.title || article.url, preserveUrlHash };
					let snapshot: Conversation;
					try { snapshot = snapshotConversation(chat, source, Number(chat.updatedAt) || 0); }
					catch { complete = false; continue; }
					if (snapshot.messages.length) put(tx, pageKey, { ...snapshot, revision: 1 });
				}
				if (complete) importedKeys.push(key);
			}
			tx.objectStore('meta').put(true, 'legacy-imported');
		};
		await done;
		// Leave malformed legacy records (and their index) available for recovery.
		// They must not be discarded merely because other pages imported correctly.
		if ('qiaomuChatIndex' in legacy && Object.keys(legacy).filter(key => key.startsWith('qiaomuChat:')).every(key => importedKeys.includes(key))) importedKeys.push('qiaomuChatIndex');
		if (importedKeys.length) await browser.storage.local.remove(importedKeys).catch(console.warn);
		return db;
	} catch (error) { db.close(); throw error; }
}

let pending = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
	const run = () => typeof navigator !== 'undefined' && navigator.locks
		? navigator.locks.request('qiaomu-chat-history-write', operation) : operation();
	const result = pending.then(run);
	pending = result.then(() => {}, () => {});
	return result;
}

export async function loadPageChats(url: string, preserveUrlHash = false, latestOnly = false): Promise<Conversation[]> {
	await pending;
	const db = await database();
	try {
		if (latestOnly) {
			const pageKey = chatPageKey(url, preserveUrlHash);
			const cursor = await request(db.transaction('summaries').objectStore('summaries').index('pageRecent').openCursor(IDBKeyRange.bound([pageKey], [pageKey, []]), 'prev'));
			if (!cursor) return [];
			const summary = cursor.value as ChatHistoryItem;
			const row = await request<RecordEntry | undefined>(db.transaction('conversations').objectStore('conversations').get([pageKey, summary.id]));
			return row ? [row.conversation] : [];
		}
		const rows = await request<RecordEntry[]>(db.transaction('conversations').objectStore('conversations').index('page').getAll(chatPageKey(url, preserveUrlHash)));
		return rows.map(row => row.conversation).sort((a, b) => b.updatedAt - a.updatedAt);
	} finally { db.close(); }
}

export async function readConversation(pageKey: string, id: string): Promise<Conversation | undefined> {
	await pending;
	const db = await database();
	try { return (await request<RecordEntry | undefined>(db.transaction('conversations').objectStore('conversations').get([pageKey, id])))?.conversation; }
	finally { db.close(); }
}

// Only summaries are read while browsing history. Message bodies are loaded after
// choosing a chat; paging never brings all conversations or attachments into RAM.
export async function listChatHistory(query = '', before?: ChatHistoryCursor, limit = 40): Promise<{ items: ChatHistoryItem[]; next?: ChatHistoryCursor }> {
	await pending;
	const db = await database();
	try {
		return await new Promise((resolve, reject) => {
			const items: ChatHistoryItem[] = [], needle = query.trim().toLocaleLowerCase();
			const req = db.transaction('summaries').objectStore('summaries').index('recent').openCursor(before ? IDBKeyRange.upperBound(before, true) : null, 'prev');
			req.onerror = () => reject(req.error);
			req.onsuccess = () => {
				const cursor = req.result;
				if (!cursor) { resolve({ items }); return; }
				const item = cursor.value as ChatHistoryItem;
				if (!needle || `${item.title}\n${item.source.title}\n${item.source.url}`.toLocaleLowerCase().includes(needle)) {
					if (items.length === limit) { const last = items[items.length - 1]; resolve({ items, next: [last.updatedAt, last.pageKey, last.id] }); return; }
					items.push(item);
				}
				cursor.continue();
			};
		});
	} finally { db.close(); }
}

export function storeChat(snapshot: Conversation, owner: Conversation): Promise<void> {
	return mutate(async () => {
		const db = await database(), source = snapshot.source!, pageKey = chatPageKey(source.url, source.preserveUrlHash);
		try {
			const tx = db.transaction(stores, 'readwrite'), done = completion(tx);
			let conflict = false, revision = 0;
			const previous = tx.objectStore('conversations').get([pageKey, snapshot.id]);
			const deleted = tx.objectStore('meta').get(JSON.stringify(['deleted', pageKey, snapshot.id]));
			deleted.onsuccess = () => {
				const row = previous.result as RecordEntry | undefined;
				if (deleted.result || (row && row.conversation.revision !== owner.revision)) { conflict = true; tx.abort(); return; }
				revision = (row?.conversation.revision ?? 0) + 1;
				put(tx, pageKey, { ...snapshot, revision });
			};
			await done.catch(error => { throw conflict ? new Error(t('这段对话已在其他窗口更新或删除，请从历史记录重新打开。')) : error; });
			owner.revision = revision;
			owner.updatedAt = snapshot.updatedAt;
		} finally { db.close(); }
	});
}

export function removeChat(url: string, id: string, preserveUrlHash = false): Promise<void> {
	return mutate(async () => {
		const db = await database(), pageKey = chatPageKey(url, preserveUrlHash);
		try {
			const tx = db.transaction(stores, 'readwrite'), done = completion(tx);
			tx.objectStore('conversations').delete([pageKey, id]);
			tx.objectStore('summaries').delete([pageKey, id]);
			tx.objectStore('meta').put(true, JSON.stringify(['deleted', pageKey, id]));
			await done;
		} finally { db.close(); }
	});
}
