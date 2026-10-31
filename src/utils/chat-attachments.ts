import { prepareChatImage } from './chat-images';
import { type ChatImage, validChatTurns } from './chat-content';
import { t } from './ui-text';

export interface ChatAttachmentRef { id: string; name: string }
export interface ChatAttachment extends ChatAttachmentRef { images: ChatImage[]; thumbnail: string }
export const MAX_CHAT_ATTACHMENTS = 6;
export const CHAT_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/svg+xml';
export const MAX_CHAT_FILE_BYTES = 12 * 1024 * 1024;

export function attachmentRefs(value: unknown): ChatAttachmentRef[] {
	if (!Array.isArray(value)) return [];
	return value.filter(item => item && typeof item.id === 'string' && /^chat-image-[a-f0-9-]{36}$/.test(item.id) && typeof item.name === 'string')
		.slice(0, MAX_CHAT_ATTACHMENTS).map(({ id, name }) => ({ id, name: name.slice(0, 120) }));
}

export async function prepareChatAttachment(file: File, signal: AbortSignal): Promise<ChatAttachment> {
	const extensions: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
	const type = file.type.toLowerCase() || extensions[file.name.split('.').pop()?.toLowerCase() || ''];
	if (!CHAT_IMAGE_TYPES.split(',').includes(type)) throw new Error(t('不支持这种图片格式，请使用 PNG、JPEG、WebP、GIF、AVIF、BMP 或 SVG。'));
	if (!file.size || file.size > MAX_CHAT_FILE_BYTES) throw new Error(t('单张图片不能超过 12 MB。'));
	signal.throwIfAborted();
	const { parts, thumbnail } = await prepareChatImage(file.type === type ? file : new Blob([file], { type }), signal).catch(error => {
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
		throw new Error(error instanceof Error && error.message !== 'The source image could not be decoded.' ? error.message : t('这张图片读不出来'));
	});
	signal.throwIfAborted();
	const name = (file.name || t('图片')).slice(0, 120);
	const images = parts.map((dataUrl, i) => ({ dataUrl, label: `${t('附件图片：{0}', [name])}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}` }));
	if (!validChatTurns([{ role: 'user', content: '', images }])) throw new Error(t('图片数量或大小超出限制，请减少所选图片后重试。'));
	return { id: `chat-image-${crypto.randomUUID()}`, name, images, thumbnail };
}

// Only mounted extension pages use this store. Conversation metadata contains
// opaque references, never image bytes. Thumbnails have a separate store so
// reopening a long conversation does not decode every full-size attachment.
async function database(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('qiaomu-chat-attachments', 1);
		request.onupgradeneeded = () => { request.result.createObjectStore('images'); request.result.createObjectStore('previews'); };
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction) => () => T): Promise<T> {
	const db = await database();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(['images', 'previews'], mode);
			tx.onabort = tx.onerror = () => reject(tx.error || new Error(t('图片未能保存，请重试。')));
			const result = run(tx);
			tx.oncomplete = () => resolve(result());
		});
	} finally { db.close(); }
}

export async function saveChatAttachments(attachments: ChatAttachment[]): Promise<void> {
	if (!attachments.length) return;
	await transaction('readwrite', tx => {
		for (const { thumbnail, ...item } of attachments) {
			tx.objectStore('images').put(item, item.id);
			tx.objectStore('previews').put(thumbnail, item.id);
		}
		return () => {};
	});
}

export async function readChatAttachments(refs: ChatAttachmentRef[]): Promise<ChatImage[]> {
	if (!refs.length) return [];
	const records = await transaction('readonly', tx => {
		const requests = refs.map(ref => tx.objectStore('images').get(ref.id));
		return () => requests.map(request => request.result as Omit<ChatAttachment, 'thumbnail'> | undefined);
	});
	return records.flatMap((record, i) => {
		if (!record || !validChatTurns([{ role: 'user', content: '', images: record.images }]) || !record.images?.length) throw new Error(t('附件图片“{0}”已丢失，请重新添加或新建对话。', [refs[i].name]));
		return record.images;
	});
}

export const readChatAttachmentPreview = (id: string): Promise<string | undefined> => transaction('readonly', tx => {
	const request = tx.objectStore('previews').get(id); return () => request.result;
});

export async function deleteChatAttachments(ids: string[]): Promise<void> {
	if (!ids.length) return;
	await transaction('readwrite', tx => {
		for (const id of new Set(ids)) { tx.objectStore('images').delete(id); tx.objectStore('previews').delete(id); }
		return () => {};
	});
}
