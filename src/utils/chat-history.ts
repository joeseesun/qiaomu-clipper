import { normalizeToolResults, type ChatToolResult } from './chat-tools-types';
import browser from './browser-polyfill';
import type { ChatTurn } from './chat-llm';
import type { ChatImageGeneration } from './chat-image-generation';

// A question may quote a passage the reader selected in the article.
export interface StoredTurn extends Omit<ChatTurn, 'images'> {
	quote?: string;
	imageNumbers?: number[];
	generatedImages?: ChatImageGeneration[];
	tools?: ChatToolResult[];
}

export interface Conversation {
	id: string;
	title: string;
	updatedAt: number;
	messages: StoredTurn[];
}

interface ArticleChats { url: string; title: string; updatedAt: number; conversations: Conversation[] }

const PREFIX = 'qiaomuChat:';
const INDEX_KEY = 'qiaomuChatIndex';
export const MAX_ARTICLES = 40;
export const MAX_CONVERSATIONS = 15;
export const MAX_MESSAGES = 40;

// Keep mutations in this extension document in call order, including failures.
// Snapshot the message fields before enqueueing so later edits cannot rewrite
// an earlier save while it is waiting for storage.
let pendingWrite = Promise.resolve();
function write<T>(operation: () => Promise<T>): Promise<T> {
	const result = pendingWrite.then(operation);
	pendingWrite = result.then(() => {}, () => {});
	return result;
}

function storedTurn({ role, content, quote, imageNumbers, generatedImages, tools }: StoredTurn): StoredTurn {
	return {
		role, content,
		...(quote ? { quote } : {}),
		...(imageNumbers?.length ? { imageNumbers: [...imageNumbers] } : {}),
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
	const stored: Conversation = { ...conversation, messages: conversation.messages.slice(-MAX_MESSAGES).map(storedTurn), updatedAt: Date.now() };
	return write(async () => {
		const saved = (await browser.storage.local.get([key, INDEX_KEY]));
		const article: ArticleChats = (saved[key] as ArticleChats | undefined) ?? { url, title: articleTitle, updatedAt: 0, conversations: [] };
		article.title = articleTitle;
		article.updatedAt = stored.updatedAt;
		article.conversations = [stored, ...article.conversations.filter(c => c.id !== stored.id)].slice(0, MAX_CONVERSATIONS);

		const index = ((saved[INDEX_KEY] as { key: string; updatedAt: number }[] | undefined) ?? []).filter(item => item.key !== key);
		index.unshift({ key, updatedAt: article.updatedAt });
		const dropped = index.splice(MAX_ARTICLES);
		await browser.storage.local.set({ [key]: article, [INDEX_KEY]: index });
		if (dropped.length) await browser.storage.local.remove(dropped.map(item => item.key));
	});
}

export async function deleteConversation(url: string, id: string, preserveUrlHash = false): Promise<void> {
	const key = chatKey(url, preserveUrlHash);
	return write(async () => {
		const article = (await browser.storage.local.get(key))[key] as ArticleChats | undefined;
		if (!article) return;
		article.conversations = article.conversations.filter(c => c.id !== id);
		if (article.conversations.length) await browser.storage.local.set({ [key]: article });
		else {
			const index = ((await browser.storage.local.get(INDEX_KEY))[INDEX_KEY] as { key: string }[] | undefined) ?? [];
			await browser.storage.local.remove(key);
			await browser.storage.local.set({ [INDEX_KEY]: index.filter(item => item.key !== key) });
		}
	});
}
