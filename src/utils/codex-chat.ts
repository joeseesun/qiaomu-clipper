import browser from './browser-polyfill';
import type { ModelConfig, Provider } from '../types/types';
import type { ChatTurn } from './chat-content';
import type { ChatToolResult } from './chat-tools-types';
import { CodexChatStream } from './codex-chat-stream';
import { loadWebSearch } from './web-search';

export const CODEX_CHAT_HOST = 'ai.qiaomu.clipper.codex_chat';
let namespacePromise: Promise<string> | undefined;
function namespace(): Promise<string> {
	return namespacePromise ??= browser.storage.local.get('qiaomuCodexChatNamespace').then(async stored => {
		if (typeof stored.qiaomuCodexChatNamespace === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(stored.qiaomuCodexChatNamespace)) return stored.qiaomuCodexChatNamespace;
		const value = crypto.randomUUID(); await browser.storage.local.set({ qiaomuCodexChatNamespace: value }); return value;
	}).catch(error => { namespacePromise = undefined; throw error; });
}

export async function streamCodexChat(options: {
	provider: Provider; model: ModelConfig; system: string; messages: ChatTurn[]; sessionId?: string; signal?: AbortSignal;
	onDelta: (text: string) => void; onThought?: (text: string) => void; onNativeTools?: (tools: ChatToolResult[]) => void;
}): Promise<string> {
	const [scope, web] = await Promise.all([namespace(), loadWebSearch()]);
	options.signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const stream = new CodexChatStream({ onDelta: options.onDelta, onThought: options.onThought, onTools: options.onNativeTools });
		stream.start();
		const port = browser.runtime.connectNative(CODEX_CHAT_HOST);
		const chunks = new Map<string, string>();
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			options.signal?.removeEventListener('abort', abort);
			try {
				if (error) { stream.interrupt(error.name === 'AbortError' ? 'interrupted' : error.message); reject(error); }
				else resolve(stream.finish());
			} catch (error) { stream.interrupt(String((error as Error).message)); reject(error); }
			finally { port.disconnect(); chunks.clear(); }
		};
		const abort = () => { try { port.postMessage({ action: 'cancel' }); } catch { /* disconnected */ } finish(new DOMException('Aborted', 'AbortError')); };
		port.onMessage.addListener((raw: any) => {
			if (settled) return;
			try {
				if (raw?.type === 'chunk') {
					const part = (chunks.get(raw.id) || '') + raw.text;
					if (part.length > 64 * 1024 * 1024) throw new Error('Codex 工具事件过大');
					if (!raw.last) { chunks.set(raw.id, part); return; }
					chunks.delete(raw.id); raw = JSON.parse(part);
				}
				stream.accept(raw);
				if (raw.type === 'done') finish();
			} catch (error) { finish(error as Error); }
		});
		port.onDisconnect.addListener(() => finish(new Error('Codex 原生对话连接已中断。请确认本机 Codex 已登录、原生对话助手已安装，然后重试。')));
		options.signal?.addEventListener('abort', abort, { once: true });
		if (options.signal?.aborted) { abort(); return; }
		port.postMessage({ action: 'chat', namespace: scope, sessionId: options.sessionId || crypto.randomUUID(),
			accountEmail: options.provider.oauth?.email, model: options.model.providerModelId, effort: options.model.reasoningEffort,
			system: options.system, messages: options.messages, web: web.enabled });
	});
}
