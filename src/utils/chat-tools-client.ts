import browser from './browser-polyfill';
import type { ChatCapabilities } from './chat-tools-types';
import type { UnsplashPhoto } from './image-library-sources';

export function requestChatTool<T = any>(call: unknown, signal?: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
		const port = browser.runtime.connect({ name: 'qiaomu-chat-tool' });
		let settled = false;
		const done = (error?: Error, value?: T) => {
			if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); port.disconnect();
			if (error) reject(error); else resolve(value!);
		};
		const abort = () => done(new DOMException('Aborted', 'AbortError'));
		const timer = setTimeout(() => done(new Error('search-timeout')), 32000);
		signal?.addEventListener('abort', abort, { once: true });
		port.onMessage.addListener((m: any) => m.error ? done(new Error(String(m.error))) : done(undefined, m.result));
		port.onDisconnect.addListener(() => done(new Error('search-disconnected')));
		port.postMessage(call);
	});
}
export const chatCapabilities = (signal?: AbortSignal, modelId?: string, reasoningEffort?: string) => requestChatTool<ChatCapabilities>({ type: 'capabilities', ...(modelId ? { modelId } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) }, signal);
export async function downloadChatPhoto(photo: Pick<UnsplashPhoto, 'id' | 'download'>, signal?: AbortSignal): Promise<Blob> {
	const result = await requestChatTool<{ base64: string; type: string }>({ type: 'download_image', id: photo.id, download: photo.download }, signal);
	const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
	return new Blob([bytes], { type: result.type });
}
