import { normalizeToolResults, type ChatToolResult } from './chat-tools-types';
import browser from './browser-polyfill';
import type { ChatTurn } from './chat-llm';
import type { ChatImageGeneration } from './chat-image-generation';
import { attachmentRefs, deleteChatAttachments, type ChatAttachmentRef } from './chat-attachments';

// A question may quote a passage the reader selected in the article.
export interface StoredTurn extends Omit<ChatTurn, 'images'> {
	quote?: string;
	imageNumbers?: number[];
	attachments?: ChatAttachmentRef[];
	generatedImages?: ChatImageGeneration[];
	tools?: ChatToolResult[];
	bookmarked?: boolean;
}

export interface Conversation {
	id: string;
	title: string;
	updatedAt: number;
	messages: StoredTurn[];
}

interface ArticleChats { url: string; title: string; updatedAt: number; conversations: Conversation[] }

const attachmentIds = (article?: ArticleChats): string[] => article?.conversations.flatMap(c => c.messages.flatMap(m => attachmentRefs(m.attachments).map(ref => ref.id))) ?? [];

const PREFIX = 'qiaomuChat:';
const INDEX_KEY = 'qiaomuChatIndex';
interface ArticleIndexEntry { key: string; updatedAt: number; bookmarked?: boolean }
export const MAX_ARTICLES = 40;
export const MAX_CONVERSATIONS = 15;
export const MAX_MESSAGES = 40;

const hasBookmarks = (conversation: Conversation) => conversation.messages.some(m => m.role === 'user' && m.bookmarked === true);
const keepRecentOrBookmarked = <T>(items: T[], limit: number, bookmarked: (item: T) => boolean) => items.filter((item, index) => index < limit || bookmarked(item));
// A bookmark retains the complete question-and-answer turn, including metadata.
function retainedMessages(messages: StoredTurn[]): StoredTurn[] {
	let start = Math.max(0, messages.length - MAX_MESSAGES);
	while (start > 0 && messages[start]?.role !== 'user') start--;
	let bookmarked = false;
	return messages.filter((message, index) => {
		if (message.role === 'user') bookmarked = message.bookmarked === true;
		return index >= start || bookmarked;
	});
}
function pruneArticleIndex(index: ArticleIndexEntry[]): ArticleIndexEntry[] {
	const retained = keepRecentOrBookmarked(index, MAX_ARTICLES, item => item.bookmarked === true);
	const dropped = index.filter(item => !retained.includes(item));
	index.splice(0, index.length, ...retained);
	return dropped;
}

// Keep mutations in this extension document in call order, including failures.
// Snapshot the message fields before enqueueing so later edits cannot rewrite
// an earlier save while it is waiting for storage.
let pendingWrite = Promise.resolve();
function write<T>(operation: () => Promise<T>): Promise<T> {
	const result = pendingWrite.then(operation);
	pendingWrite = result.then(() => {}, () => {});
	return result;
}

function storedTurn({ role, content, quote, imageNumbers, attachments, generatedImages, tools }: StoredTurn): StoredTurn {
	return {
		role, content,
		...(quote ? { quote } : {}),
		...(imageNumbers?.length ? { imageNumbers: [...imageNumbers] } : {}),
		...(role === 'user' && attachments?.length ? { attachments: attachmentRefs(attachments) } : {}),
		...(tools?.length ? { tools: normalizeToolResults(tools) } : {}),
		...(generatedImages?.length ? { generatedImages: generatedImages.slice(0, 4).map(({ prompt, aspect, imageId, modelLabel, jobId, error }) => ({ prompt, aspect, ...(imageId ? { imageId } : {}), ...(modelLabel ? { modelLabel } : {}), ...(jobId ? { jobId } : {}), ...(error ? { error } : {}) })) } : {}),
	};
}

// Same article, same chats: ignore the #fragment and trailing noise.
export function chatKey(url: string, preserveUrlHash = false): string {
	let normalized = url;
	try { const parsed = new URL(url); if (!preserveUrlHash) parsed.hash = ''; normalized = parsed.href; } catch { /* keep as is */ }
	let hash = 5381;
	for (let i = 0; i < normalized.length; i++) hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
	return `${PREFIX}${(hash >>> 0).toString(36)}`;
}

export async function loadConversations(url: string, preserveUrlHash = false): Promise<Conversation[]> {
	const key = chatKey(url, preserveUrlHash);
	const saved = (await browser.storage.local.get(key))[key] as ArticleChats | undefined;
	return [...(saved?.conversations ?? [])].map(c => ({ ...c, messages: c.messages.map(m => ({ ...m, ...(m.tools ? { tools: normalizeToolResults(m.tools) } : {}) })) })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveConversation(url: string, articleTitle: string, conversation: Conversation, preserveUrlHash = false): Promise<void> {
	const key = chatKey(url, preserveUrlHash);
	const stored: Conversation = { ...conversation, messages: retainedMessages(conversation.messages).map(turn => ({ ...storedTurn(turn), ...(turn.role === 'user' && turn.bookmarked === true ? { bookmarked: true } : {}) })), updatedAt: Date.now() };
	return write(async () => {
		const saved = (await browser.storage.local.get([key, INDEX_KEY]));
		const article: ArticleChats = (saved[key] as ArticleChats | undefined) ?? { url, title: articleTitle, updatedAt: 0, conversations: [] };
		const previousAttachments = attachmentIds(article);
		article.title = articleTitle;
		article.updatedAt = stored.updatedAt;
		article.conversations = keepRecentOrBookmarked([stored, ...article.conversations.filter(c => c.id !== stored.id)], MAX_CONVERSATIONS, hasBookmarks);

		const index = ((saved[INDEX_KEY] as ArticleIndexEntry[] | undefined) ?? []).filter(item => item.key !== key);
		index.unshift({ key, updatedAt: article.updatedAt, ...(article.conversations.some(hasBookmarks) ? { bookmarked: true } : {}) });
		const dropped = pruneArticleIndex(index);
		await browser.storage.local.set({ [key]: article, [INDEX_KEY]: index });
		if (dropped.length) {
			const keys = dropped.map(item => item.key);
			const droppedArticles = await browser.storage.local.get(keys);
			await browser.storage.local.remove(keys);
			await deleteChatAttachments(Object.values(droppedArticles).flatMap(item => attachmentIds(item as ArticleChats)));
		}
		const retained = new Set(attachmentIds(article));
		await deleteChatAttachments(previousAttachments.filter(id => !retained.has(id)));
	});
}

export async function deleteConversation(url: string, id: string, preserveUrlHash = false): Promise<void> {
	const key = chatKey(url, preserveUrlHash);
	return write(async () => {
		const article = (await browser.storage.local.get(key))[key] as ArticleChats | undefined;
		if (!article) return;
		const removed = article.conversations.find(c => c.id === id)?.messages.flatMap(m => attachmentRefs(m.attachments).map(ref => ref.id)) ?? [];
		article.conversations = article.conversations.filter(c => c.id !== id);
		if (article.conversations.length) {
			const index = ((await browser.storage.local.get(INDEX_KEY))[INDEX_KEY] as ArticleIndexEntry[] | undefined) ?? [];
			await browser.storage.local.set({ [key]: article, [INDEX_KEY]: index.map(item => item.key === key ? { key: item.key, updatedAt: item.updatedAt, ...(article.conversations.some(hasBookmarks) ? { bookmarked: true } : {}) } : item) });
		}
		else {
			const index = ((await browser.storage.local.get(INDEX_KEY))[INDEX_KEY] as { key: string }[] | undefined) ?? [];
			await browser.storage.local.remove(key);
			await browser.storage.local.set({ [INDEX_KEY]: index.filter(item => item.key !== key) });
		}
		const retained = new Set(attachmentIds(article));
		await deleteChatAttachments(removed.filter(id => !retained.has(id)));
	});
}
