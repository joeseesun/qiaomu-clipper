import { marked } from 'marked';
import DOMPurify from 'dompurify';
import browser from './browser-polyfill';
import { type ChatImage, MAX_CHAT_IMAGE_DATA, MAX_CHAT_IMAGE_PARTS } from './chat-content';
import { t } from './ui-text';
import { decodeChatSvg } from './chat-svg';

export interface ArticleImage { url: string; index: number; alt: string }
export const MAX_SELECTED_IMAGES = 16;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;

export function articleImages(markdown: string, sourceUrl: string): ArticleImage[] {
	const template = document.createElement('template');
	template.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { gfm: true }) as string, { ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src', 'alt'] });
	const seen = new Set<string>(), images: ArticleImage[] = [];
	for (const img of Array.from(template.content.querySelectorAll('img'))) {
		try {
			const raw = img.getAttribute('src'); if (!raw) continue;
			const url = new URL(raw, sourceUrl);
			if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) || url.username || url.password) continue;
			if (url.protocol === 'data:' && !/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(raw)) continue;
			if (seen.has(url.href)) continue;
			seen.add(url.href);
			images.push({ url: url.href, index: images.length + 1, alt: (img.getAttribute('alt') || '').slice(0, 200) });
		} catch { /* Invalid or local vault paths cannot be sent as images. */ }
	}
	return images;
}

// Preserve the text/image order without putting signed URLs or base64 strings
// into the model's text context. The actual raster data travels in image parts.
export function imageAwareArticle(markdown: string, sourceUrl: string, images: ArticleImage[]): string {
	if (!images.length) return markdown;
	const template = document.createElement('template');
	template.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { gfm: true }) as string);
	for (const img of Array.from(template.content.querySelectorAll('img'))) {
		let index: number | undefined;
		try { index = images.find(image => image.url === new URL(img.getAttribute('src') || '', sourceUrl).href)?.index; } catch { /* unavailable image */ }
		img.replaceWith(document.createTextNode(index ? `[图 ${index}]` : '[图片未提供]'));
	}
	return template.innerHTML;
}

export function imageTiles(width: number, height: number): Array<{ x: number; y: number; width: number; height: number; scale: number }> {
	if (width <= 0 || height <= 0 || width * height > 40_000_000) throw new Error(t('图片尺寸过大或无效，请选择其他图片。'));
	const long = height > width * 2.5;
	const scale = long ? Math.min(1, 1280 / width) : Math.min(1, 1600 / Math.max(width, height));
	const step = long ? Math.floor(1600 / scale) : height;
	const overlap = long ? Math.floor(80 / scale) : 0;
	const tiles = [];
	for (let y = 0; y < height; y += step - overlap) {
		tiles.push({ x: 0, y, width, height: Math.min(step, height - y), scale });
		if (y + step >= height) break;
		if (tiles.length >= MAX_CHAT_IMAGE_PARTS) throw new Error(t('图片过长，请分段选择后重试。'));
	}
	return tiles;
}

function aborted(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); }

async function fetchImage(url: string, signal: AbortSignal): Promise<Blob> {
	if (url.startsWith('data:') && url.length > MAX_DOWNLOAD_BYTES * 1.4) throw new Error('image-too-large');
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
	const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
	try {
		aborted(signal);
		const response = await fetch(url, { credentials: 'include', cache: 'force-cache', redirect: 'error', signal: controller.signal });
		if (!response.ok || !response.body) throw new Error('image-unavailable');
		const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
		if (!/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(type)) throw new Error('not-image');
		if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) throw new Error('image-too-large');
		const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
		for (;;) {
			const { done, value } = await reader.read(); if (done) break;
			size += value.length;
			if (size > MAX_DOWNLOAD_BYTES) { await reader.cancel(); throw new Error('image-too-large'); }
			chunks.push(value);
		}
		return new Blob(chunks as BlobPart[], { type });
	} finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}

async function prepareImage(blob: Blob, signal: AbortSignal): Promise<string[]> {
	aborted(signal);
	const bitmap = blob.type === 'image/svg+xml' ? await decodeChatSvg(blob, signal) : await createImageBitmap(blob).then(source => ({ source, width: source.width, height: source.height, close: () => source.close() }));
	try {
		const tiles = imageTiles(bitmap.width, bitmap.height), data: string[] = [];
		for (const tile of tiles) {
			aborted(signal);
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(tile.width * tile.scale); canvas.height = Math.round(tile.height * tile.scale);
			const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas-unavailable');
			ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(bitmap.source, tile.x, tile.y, tile.width, tile.height, 0, 0, canvas.width, canvas.height);
			data.push(canvas.toDataURL('image/jpeg', 0.9));
			canvas.width = 0; canvas.height = 0;
		}
		return data;
	} finally { bitmap.close(); }
}

// One cache per mounted chat. Bytes never enter storage.local, the vault, or a native helper.
export class ChatImageSession {
	private cache = new Map<string, string[]>();
	private source = '';
	clear() { this.cache.clear(); this.source = ''; }
	async read(images: ArticleImage[], sourceUrl: string, signal: AbortSignal, progress?: (ready: number, failed: number) => void): Promise<{ images: ChatImage[]; ready: number[]; failed: number[] }> {
		if (images.length > MAX_SELECTED_IMAGES) throw new Error(t('一次最多读取 {0} 张图片，请在图片列表中分批选择。', [MAX_SELECTED_IMAGES]));
		if (sourceUrl !== this.source) { this.clear(); this.source = sourceUrl; }
		const result: ChatImage[] = [], ready: number[] = [], failed: number[] = [];
		let total = 0;
		for (const image of images) {
			aborted(signal);
			try {
				let data = this.cache.get(image.url);
				if (!data) {
					let blob: Blob;
					try { blob = await fetchImage(image.url, signal); }
					catch {
						aborted(signal);
						const fallback = await browser.runtime.sendMessage({ action: 'qiaomuChatImageSource', sourceUrl, imageUrl: image.url }) as { dataUrl?: string };
						aborted(signal);
						if (!fallback?.dataUrl) throw new Error('image-unavailable');
						blob = await fetchImage(fallback.dataUrl, signal);
					}
					data = await prepareImage(blob, signal);
					aborted(signal);
					const size = data.reduce((sum, item) => sum + item.length, 0);
					if (size > MAX_CHAT_IMAGE_DATA) throw new Error('image-too-large');
					let cacheSize = Array.from(this.cache.values()).flat().reduce((sum, item) => sum + item.length, 0);
					for (const key of this.cache.keys()) { if (cacheSize + size <= MAX_CHAT_IMAGE_DATA) break; cacheSize -= this.cache.get(key)!.reduce((sum, item) => sum + item.length, 0); this.cache.delete(key); }
					this.cache.set(image.url, data);
				}
				total += data.reduce((sum, item) => sum + item.length, 0);
				if (total > MAX_CHAT_IMAGE_DATA || result.length + data.length > MAX_CHAT_IMAGE_PARTS) throw new RangeError('image-budget');
				result.push(...data.map((dataUrl, part) => ({ dataUrl, label: `图 ${image.index}${data!.length > 1 ? ` (${part + 1}/${data!.length}, 从上到下)` : ''}` })));
				ready.push(image.index);
			} catch (error) {
				aborted(signal);
				if (error instanceof RangeError) throw new Error(t('图片数量或大小超出限制，请减少所选图片后重试。'));
				failed.push(image.index);
			}
			progress?.(ready.length, failed.length);
		}
		return { images: result, ready, failed };
	}
}
