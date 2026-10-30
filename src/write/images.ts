import { t } from '../utils/ui-text';
import { openDb, requestResult, transactionDone } from './db';
import { IMAGE_SCHEME, StoredImage } from './types';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'];

export function imageUrlFor(id: string): string { return `${IMAGE_SCHEME}${id}`; }

export function imageIdFromUrl(url: string): string | undefined {
	return url.startsWith(IMAGE_SCHEME) ? url.slice(IMAGE_SCHEME.length).split(/[?#)\s]/)[0] || undefined : undefined;
}

// Every picture id a piece of Markdown points at.
export function imageIdsIn(markdown: string): string[] {
	const ids = new Set<string>();
	for (const match of markdown.matchAll(/qm-image:\/\/([A-Za-z0-9_-]+)/g)) ids.add(match[1]);
	return [...ids];
}

async function sha256(blob: Blob): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function measure(blob: Blob): Promise<{ width: number; height: number }> {
	try {
		if (typeof createImageBitmap === 'function' && blob.type !== 'image/svg+xml') {
			const bitmap = await createImageBitmap(blob);
			const size = { width: bitmap.width, height: bitmap.height };
			bitmap.close?.();
			return size;
		}
	} catch { /* fall through */ }
	return { width: 0, height: 0 };
}

export function newId(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(9));
	return `${prefix}${[...bytes].map(byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
}

// The same picture added twice is stored once.
export async function saveImage(blob: Blob, name = ''): Promise<StoredImage> {
	const hash = await sha256(blob);
	const db = await openDb();
	const existing = await requestResult(db.transaction('images').objectStore('images').index('hash').get(hash)) as StoredImage | undefined;
	if (existing) return existing;
	const { width, height } = await measure(blob);
	const image: StoredImage = { id: newId('img_'), blob, mime: blob.type || 'image/png', width, height, hash, name, createdAt: Date.now() };
	const tx = db.transaction('images', 'readwrite');
	tx.objectStore('images').put(image);
	await transactionDone(tx);
	return image;
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
	const db = await openDb();
	return await requestResult(db.transaction('images').objectStore('images').get(id)) as StoredImage | undefined;
}

export async function getImages(ids: string[]): Promise<StoredImage[]> {
	const found = await Promise.all(ids.map(getImage));
	return found.filter((image): image is StoredImage => !!image);
}

export async function allImageIds(): Promise<string[]> {
	const db = await openDb();
	return await requestResult(db.transaction('images').objectStore('images').getAllKeys()) as string[];
}

export async function deleteImages(ids: string[]): Promise<void> {
	if (!ids.length) return;
	const db = await openDb();
	const tx = db.transaction('images', 'readwrite');
	for (const id of ids) tx.objectStore('images').delete(id);
	await transactionDone(tx);
}

// Object URLs for the editor view, created once per picture and released together.
export class ImageUrlCache {
	private urls = new Map<string, string>();
	async resolve(id: string): Promise<string | undefined> {
		const known = this.urls.get(id);
		if (known) return known;
		const image = await getImage(id);
		if (!image) return undefined;
		const url = URL.createObjectURL(image.blob);
		this.urls.set(id, url);
		return url;
	}
	revokeAll(): void { for (const url of this.urls.values()) URL.revokeObjectURL(url); this.urls.clear(); }
}

export async function fetchRemoteImage(url: string, signal?: AbortSignal): Promise<Blob> {
	return fetchRemoteAsset(url, signal, false);
}

export async function fetchRemoteMedia(url: string, signal?: AbortSignal): Promise<Blob> {
	return fetchRemoteAsset(url, signal, true);
}

async function fetchRemoteAsset(url: string, signal: AbortSignal | undefined, video: boolean): Promise<Blob> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	const timeout = setTimeout(abort, video ? 60000 : 25000);
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	try {
	const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const maxBytes = video ? 32 * 1024 * 1024 : 64 * 1024 * 1024;
	if (Number(response.headers.get('content-length')) > maxBytes) { controller.abort(); throw new Error(video ? t('媒体超过 32MB，请压缩后再添加') : 'Image exceeds 64MB'); }
	let blob: Blob;
	if (response.body) {
		const reader = response.body.getReader(), parts: Uint8Array[] = []; let received = 0;
		try {
			while (true) {
				const { done, value } = await reader.read(); if (done) break;
				received += value.byteLength;
				if (received > maxBytes) { controller.abort(); throw new Error(video ? t('媒体超过 32MB，请压缩后再添加') : 'Image exceeds 64MB'); }
				parts.push(value);
			}
		} finally { reader.releaseLock(); }
		blob = new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0].trim() || '' });
	} else blob = await response.blob();
	if (!blob.type.startsWith('image/') && !(video && blob.type.split(';')[0] === 'video/mp4')) throw new Error(video ? t('不支持的媒体格式，请使用图片或 MP4') : 'not an image');
	return blob;
	} finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
