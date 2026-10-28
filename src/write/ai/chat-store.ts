import { normalizeToolResults, type ChatToolResult } from '../../utils/chat-tools-types';
import { openDb, requestResult, transactionDone } from '../db';
import { newId } from '../images';
import type { ChatImageGeneration } from '../../utils/chat-image-generation';

export interface ChatMessage { role: 'user' | 'assistant'; content: string; applied?: number[]; thought?: string; thinkMs?: number; refs?: string[]; generatedImages?: ChatImageGeneration[]; tools?: ChatToolResult[] }
export interface ChatSession { id: string; title: string; updatedAt: number; messages: ChatMessage[] }

export const MAX_SESSIONS = 10;
const keyFor = (articleId: string) => `aichat:${articleId}`;

function images(raw: unknown): ChatImageGeneration[] {
	return (Array.isArray(raw) ? raw : []).filter(i => i && typeof i.prompt === 'string' && typeof i.aspect === 'string').slice(0, 4).map(i => ({
		prompt: i.prompt.slice(0, 2000), aspect: i.aspect.slice(0, 5),
		...(typeof i.jobId === 'string' ? { jobId: i.jobId } : {}),
		...(typeof i.imageId === 'string' ? { imageId: i.imageId } : {}),
		...(typeof i.modelLabel === 'string' ? { modelLabel: i.modelLabel.slice(0, 200) } : {}),
		...(typeof i.error === 'string' ? { error: i.error.slice(0, 500) } : {}),
		where: i.where === 'end' ? 'end' : 'cursor',
	}));
}

export function newSession(): ChatSession { return { id: newId('chat_'), title: '', updatedAt: Date.now(), messages: [] }; }

export function titleOf(messages: ChatMessage[]): string {
	const first = messages.find(m => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? '';
	return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}

export function normalizeSessions(raw: unknown): ChatSession[] {
	return (Array.isArray(raw) ? raw : []).filter((s: any) => s && typeof s.id === 'string' && Array.isArray(s.messages)).map((s: any): ChatSession => ({
		id: s.id, title: String(s.title ?? ''), updatedAt: Number(s.updatedAt) || 0,
		messages: s.messages.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
			.map((m: any): ChatMessage => ({ role: m.role, ...(Array.isArray(m.tools) ? { tools: normalizeToolResults(m.tools) } : {}), content: m.content, ...(Array.isArray(m.applied) ? { applied: m.applied.filter((n: unknown) => Number.isInteger(n)) } : {}), ...(typeof m.thought === 'string' && m.thought ? { thought: m.thought } : {}), ...(typeof m.thinkMs === 'number' ? { thinkMs: m.thinkMs } : {}), ...(Array.isArray(m.refs) ? { refs: m.refs.filter((r: unknown): r is string => typeof r === 'string').slice(0, 8) } : {}), ...(Array.isArray(m.generatedImages) ? { generatedImages: images(m.generatedImages) } : {}) })),
	})).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
}

export async function loadChat(articleId: string): Promise<ChatSession[]> {
	const db = await openDb();
	return normalizeSessions(await requestResult(db.transaction('meta').objectStore('meta').get(keyFor(articleId))));
}
export async function saveChat(articleId: string, sessions: ChatSession[]): Promise<void> {
	const db = await openDb();
	const tx = db.transaction('meta', 'readwrite');
	tx.objectStore('meta').put(normalizeSessions(sessions.filter(s => s.messages.length)), keyFor(articleId));
	await transactionDone(tx);
}
export async function deleteChat(articleId: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction('meta', 'readwrite');
	tx.objectStore('meta').delete(keyFor(articleId));
	await transactionDone(tx);
}
