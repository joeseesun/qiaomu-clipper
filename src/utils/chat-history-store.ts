import browser from './browser-polyfill';
import { snapshotConversation, type Conversation } from './chat-history';
import { chatPageKey, type ChatSource } from './chat-source';
import { cleanHistoryMedia, historyMedia, idbDone as completion, idbRequest as request } from './chat-history-media';
import { cleanLegacyHistory, legacyCleanupPlan, legacyPage, type LegacyCleanup } from './chat-history-legacy';
import { notifyHistoryChange } from './chat-history-events';
import { t } from './ui-text';

interface RecordEntry { pageKey: string; id: string; conversation: Conversation; mediaIds: string[] }
export interface ChatHistoryItem {
	pageKey: string; id: string; title: string; updatedAt: number;
	source: ChatSource; messageCount: number;
}
export type ChatHistoryCursor = [number, string, string];
interface CleanupTask { id: string; legacy: LegacyCleanup[]; media: string[]; error?: string; attempts: number }
const stores = ['conversations', 'summaries', 'meta', 'cleanup'];
export class HistoryCleanupPendingError extends Error {
	readonly historyDeleted = true;
	constructor() { super(t('对话已移除，但部分数据尚未清理完成。请点击“重试清理”。')); }
}
function put(tx: IDBTransaction, pageKey: string, chat: Conversation) {
	const source = chat.source!;
	tx.objectStore('conversations').put({ pageKey, id: chat.id, conversation: chat, mediaIds: historyMedia(chat) } satisfies RecordEntry);
	tx.objectStore('summaries').put({ pageKey, id: chat.id, title: chat.title, updatedAt: chat.updatedAt, source,
		messageCount: chat.messages.length } satisfies ChatHistoryItem);
}
async function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('qiaomu-chat-history', 2);
		req.onupgradeneeded = event => {
			const db = req.result, tx = req.transaction!;
			if (event.oldVersion === 0) {
				const conversations = db.createObjectStore('conversations', { keyPath: ['pageKey', 'id'] });
				conversations.createIndex('page', 'pageKey');
				const summaries = db.createObjectStore('summaries', { keyPath: ['pageKey', 'id'] });
				summaries.createIndex('recent', ['updatedAt', 'pageKey', 'id']);
				summaries.createIndex('pageRecent', ['pageKey', 'updatedAt', 'id']);
				db.createObjectStore('meta');
			}
			if (['conversations', 'summaries', 'meta'].some(name => !db.objectStoreNames.contains(name))) { tx.abort(); return; }
			if (!db.objectStoreNames.contains('cleanup')) db.createObjectStore('cleanup', { keyPath: 'id' });
			const conversations = tx.objectStore('conversations');
			if (!conversations.indexNames.contains('media')) conversations.createIndex('media', 'mediaIds', { multiEntry: true });
			const cursor = conversations.openCursor();
			cursor.onsuccess = () => { const row = cursor.result; if (row) { row.update({ ...row.value, mediaIds: historyMedia(row.value.conversation) }); row.continue(); } };
		};
		let blocked = false;
		req.onsuccess = () => { if (blocked) { req.result.close(); return; } req.result.onversionchange = () => req.result.close(); resolve(req.result); };
		req.onerror = () => reject(req.error);
		req.onblocked = () => { blocked = true; reject(new Error(t('请关闭其他 AI 对话窗口后重试。'))); };
	});
}

// The migration marker and its cleanup job commit together. Even after a crash,
// imported conversations stay readable and cleanup can be explicitly retried.
async function database(): Promise<IDBDatabase> {
	const db = await open();
	try {
		if (await request(db.transaction('meta').objectStore('meta').get('legacy-imported'))) return db;
		const legacy = await browser.storage.local.get(null);
		const imported: { pageKey: string; chat: Conversation }[] = [], completeKeys = new Set<string>();
		for (const [key, raw] of Object.entries(legacy)) {
			if (!key.startsWith('qiaomuChat:') || !raw || typeof raw !== 'object') continue;
			const article = raw as { url?: string; title?: string; conversations?: Conversation[] };
			const pageKey = legacyPage(key, article);
			if (!pageKey || !Array.isArray(article.conversations)) continue;
			let complete = true;
			for (const chat of article.conversations) {
				if (!chat || typeof chat.id !== 'string' || typeof chat.title !== 'string' || !Array.isArray(chat.messages)
					|| chat.messages.some(turn => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string')) { complete = false; continue; }
				try {
					const source = { url: article.url!, title: article.title || article.url!, preserveUrlHash: pageKey !== chatPageKey(article.url!) };
					const snapshot = snapshotConversation(chat, source, Number(chat.updatedAt) || 0);
					if (snapshot.messages.length) imported.push({ pageKey, chat: { ...snapshot, revision: 1 } });
				} catch { complete = false; }
			}
			if (complete) completeKeys.add(key);
		}
		const task: CleanupTask = { id: crypto.randomUUID(), legacy: await legacyCleanupPlan(legacy, undefined, completeKeys), media: [], attempts: 0 };
		const tx = db.transaction(stores, 'readwrite'), done = completion(tx);
		const check = tx.objectStore('meta').get('legacy-imported'); let installed = false;
		check.onsuccess = () => {
			if (check.result) return;
			for (const { pageKey, chat } of imported) put(tx, pageKey, chat);
			tx.objectStore('meta').put(true, 'legacy-imported');
			if (task.legacy.length) { tx.objectStore('cleanup').put(task); installed = true; }
		};
		await done;
		if (installed) await processCleanup(db, task).catch(() => { /* durable job + visible retry, never discard failure */ });
		return db;
	} catch (error) { db.close(); throw error; }
}
let pending = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
	const run = () => typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('qiaomu-chat-history-write', operation) : operation();
	const result = pending.then(run); pending = result.then(() => {}, () => {}); return result;
}
async function processCleanup(db: IDBDatabase, task: CleanupTask): Promise<void> {
	try {
		const remaining = await cleanLegacyHistory(task.legacy);
		const legacyText = Object.entries(remaining).filter(([key]) => key.startsWith('qiaomuChat:')).map(([, value]) => JSON.stringify(value));
		const refs = [...new Set(task.media)], index = db.transaction('conversations').objectStore('conversations').index('media');
		const counts = await Promise.all(refs.map(ref => request(index.count(ref))));
		const unused = refs.filter((ref, i) => counts[i] === 0 && !legacyText.some(value => value.includes(JSON.stringify(ref.slice(2)))));
		await cleanHistoryMedia(unused);
		const tx = db.transaction('cleanup', 'readwrite'), done = completion(tx); tx.objectStore('cleanup').delete(task.id); await done;
		notifyHistoryChange({ type: 'cleanup' });
	} catch (error) {
		const tx = db.transaction('cleanup', 'readwrite'), done = completion(tx);
		tx.objectStore('cleanup').put({ ...task, attempts: task.attempts + 1, error: String((error as Error).message) }); await done;
		notifyHistoryChange({ type: 'cleanup' }); throw new HistoryCleanupPendingError();
	}
}
export async function historyCleanupStatus(): Promise<{ pending: number }> {
	await pending; const db = await database();
	try { return { pending: await request(db.transaction('cleanup').objectStore('cleanup').count()) }; } finally { db.close(); }
}
export function retryHistoryCleanup(): Promise<void> {
	return mutate(async () => {
		const db = await database();
		try {
			const tasks = await request<CleanupTask[]>(db.transaction('cleanup').objectStore('cleanup').getAll()); let failed = false;
			for (const task of tasks) try { await processCleanup(db, task); } catch { failed = true; }
			if (failed) throw new HistoryCleanupPendingError();
		} finally { db.close(); }
	});
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
			const tx = db.transaction(stores, 'readwrite'), done = completion(tx); let conflict = false, revision = 0;
			const task: CleanupTask = { id: crypto.randomUUID(), legacy: [], media: [], attempts: 0 };
			const previous = tx.objectStore('conversations').get([pageKey, snapshot.id]);
			const deleted = tx.objectStore('meta').get(JSON.stringify(['deleted', pageKey, snapshot.id]));
			deleted.onsuccess = () => {
				const row = previous.result as RecordEntry | undefined;
				if (deleted.result || (row && row.conversation.revision !== owner.revision) || (!row && owner.revision !== undefined)) { conflict = true; tx.abort(); return; }
				revision = (row?.conversation.revision ?? 0) + 1;
				const keep = new Set(historyMedia(snapshot)); task.media = (row?.mediaIds ?? []).filter(ref => !keep.has(ref));
				put(tx, pageKey, { ...snapshot, revision });
				if (task.media.length) tx.objectStore('cleanup').put(task);
			};
			await done.catch(error => { throw conflict ? new Error(t('这段对话已在其他窗口更新或删除，请从历史记录重新打开。')) : error; });
			owner.revision = revision; owner.updatedAt = snapshot.updatedAt;
			// The history save succeeded. An attachment failure is a separate durable
			// cleanup task, not a reason to retry the save with an obsolete revision.
			if (task.media.length) await processCleanup(db, task).catch(() => {});
		} finally { db.close(); }
	});
}
function legacyMedia(records: Record<string, unknown>, plan: LegacyCleanup[]): string[] {
	return plan.flatMap(item => {
		const chats = (records[item.key] as { conversations?: unknown[] } | null)?.conversations;
		return Array.isArray(chats) ? chats.filter(chat => item.mode !== 'selected' || item.ids.includes(String((chat as { id?: unknown } | null)?.id))).flatMap(historyMedia) : [];
	});
}
export function removeChat(url: string, id: string, preserveUrlHash = false): Promise<void> {
	return mutate(async () => {
		const db = await database(), pageKey = chatPageKey(url, preserveUrlHash);
		try {
			const legacy = await browser.storage.local.get(null), plan = await legacyCleanupPlan(legacy, { pageKey, id });
			const task: CleanupTask = { id: crypto.randomUUID(), legacy: plan, media: legacyMedia(legacy, plan), attempts: 0 };
			const tx = db.transaction(stores, 'readwrite'), done = completion(tx);
			const previous = tx.objectStore('conversations').get([pageKey, id]);
			previous.onsuccess = () => {
				task.media = [...new Set([...task.media, ...historyMedia((previous.result as RecordEntry | undefined)?.conversation)])];
				tx.objectStore('conversations').delete([pageKey, id]); tx.objectStore('summaries').delete([pageKey, id]);
				tx.objectStore('meta').put(true, JSON.stringify(['deleted', pageKey, id]));
				tx.objectStore('cleanup').put(task);
			};
			await done; notifyHistoryChange({ type: 'deleted', pageKey, id });
			await processCleanup(db, task);
		} finally { db.close(); }
	});
}
export function clearChatHistory(): Promise<void> {
	return mutate(async () => {
		const db = await database();
		try {
			const legacy = await browser.storage.local.get(null), plan = await legacyCleanupPlan(legacy);
			const media = new Set(legacyMedia(legacy, plan));
			const task: CleanupTask = { id: crypto.randomUUID(), legacy: plan, media: [], attempts: 0 };
			const tx = db.transaction(stores, 'readwrite'), done = completion(tx);
			const cursor = tx.objectStore('conversations').openCursor();
			cursor.onsuccess = () => {
				const item = cursor.result;
				if (!item) { task.media = [...media]; tx.objectStore('summaries').clear(); tx.objectStore('cleanup').put(task); return; }
				const row = item.value as RecordEntry;
				for (const ref of historyMedia(row.conversation)) media.add(ref);
				tx.objectStore('meta').put(true, JSON.stringify(['deleted', row.pageKey, row.id])); item.delete(); item.continue();
			};
			await done; notifyHistoryChange({ type: 'cleared' });
			await processCleanup(db, task);
			const older = await request<CleanupTask[]>(db.transaction('cleanup').objectStore('cleanup').getAll());
			for (const item of older) await processCleanup(db, item);
		} finally { db.close(); }
	});
}
