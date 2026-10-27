import { normalizeToolResults, type ChatToolResult } from './chat-tools-types';
import type { ChatTurn } from './chat-llm';
import type { ChatImageGeneration } from './chat-image-generation';
import { chatSource, type ChatSource } from './chat-source';
import { historyAttachments, type HistoryAttachment } from './chat-history-media';
import { loadPageChats, storeChat, removeChat } from './chat-history-store';
export { listChatHistory, readConversation, clearChatHistory, retryHistoryCleanup, historyCleanupStatus, HistoryCleanupPendingError } from './chat-history-store';
export type { ChatHistoryItem, ChatHistoryCursor } from './chat-history-store';

export interface StoredTurn extends Omit<ChatTurn, 'images'> { bookmarked?: boolean; attachments?: HistoryAttachment[]; quote?: string; imageNumbers?: number[]; generatedImages?: ChatImageGeneration[]; tools?: ChatToolResult[] }
export interface Conversation {
	id: string;
	title: string;
	updatedAt: number;
	messages: StoredTurn[];
	source?: ChatSource;
	/** Optimistic version check prevents another window overwriting this chat. */
	revision?: number;
}

// Legacy storage key, retained only for migration/tests. New records use the full
// canonical URL plus conversation ID, so 32-bit URL hash collisions cannot mix chats.
export function chatKey(url: string, preserveUrlHash = false): string {
	let normalized = url;
	try { const parsed = new URL(url); if (!preserveUrlHash) parsed.hash = ''; normalized = parsed.href; } catch { /* keep as is */ }
	let hash = 5381;
	for (let i = 0; i < normalized.length; i++) hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
	return `qiaomuChat:${(hash >>> 0).toString(36)}`;
}
export const loadConversations = loadPageChats;
export const deleteConversation = removeChat;

// Both migration and new saves use the same explicit field allowlist. In
// particular, live page context and image request bytes must not enter history.
export function snapshotConversation(conversation: Conversation, source: ChatSource, updatedAt = Date.now()): Conversation {
	return { id: conversation.id, title: conversation.title, source: chatSource(source), messages: conversation.messages.map(({ role, content, quote, imageNumbers, generatedImages, tools, attachments, bookmarked }) => ({
		role, content, ...(role === 'user' && bookmarked === true ? { bookmarked: true } : {}), ...(attachments?.length ? { attachments: historyAttachments(attachments) } : {}), ...(tools?.length ? { tools: normalizeToolResults(tools) } : {}), ...(quote ? { quote } : {}), ...(imageNumbers?.length ? { imageNumbers: [...imageNumbers] } : {}),
		...(generatedImages?.length ? { generatedImages: generatedImages.slice(0, 4).map(({ prompt, aspect, imageId, modelLabel, jobId, error }) => ({ prompt, aspect, ...(imageId ? { imageId } : {}), ...(modelLabel ? { modelLabel } : {}), ...(jobId ? { jobId } : {}), ...(error ? { error } : {}) })) } : {}),
	})), updatedAt };
}

// Retention and model context are separate: keeping history does not increase
// the request window. Snapshot before queueing so subsequent edits cannot race.
export function saveConversation(url: string, articleTitle: string, conversation: Conversation, preserveUrlHash = false): Promise<void> {
	return storeChat(snapshotConversation(conversation, conversation.source ?? { url, title: articleTitle, preserveUrlHash }), conversation);
}
