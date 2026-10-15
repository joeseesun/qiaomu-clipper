import browser from './browser-polyfill';

// Serialized by executeScript: all dependencies must stay inside this function.
export function readPageChatImage(sourceUrl: string, imageUrl: string): Promise<string | null> {
	const samePage = () => location.href.split('#')[0] === sourceUrl.split('#')[0];
	if (!samePage()) return Promise.resolve(null);
	const image = Array.from(document.images).find(img =>
		[img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-original')].some(src => {
			try { return !!src && new URL(src, document.baseURI).href === imageUrl; } catch { return false; }
		}));
	if (!image) return Promise.resolve(null);
	const limit = 12 * 1024 * 1024;
	try {
		if (image.complete && image.naturalWidth && image.naturalWidth * image.naturalHeight <= 40_000_000) {
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.drawImage(image, 0, 0);
				const data = canvas.toDataURL('image/png');
				if (data.length <= limit && samePage()) return Promise.resolve(data);
			}
		}
	} catch { /* Cross-origin images may display while canvas export is forbidden. */ }
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
	return fetch(imageUrl, { credentials: 'include', cache: 'force-cache', redirect: 'error', signal: controller.signal }).then(response => {
		if (!response.ok || !response.body || !/^image\/(png|jpeg|webp|gif|avif)(?:;|$)/i.test(response.headers.get('content-type') || '')) return null;
		const reader = response.body.getReader(), chunks: Uint8Array[] = [];
		let size = 0;
		const read = (): Promise<string | null> => reader.read().then(({ done, value }): Promise<string | null> | null => {
			if (done) {
				const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type')!.split(';')[0] });
				return new Promise<string | null>((resolve, reject) => {
					const file = new FileReader();
					file.onload = () => { const data = String(file.result); resolve(samePage() && data.length <= limit ? data : null); };
					file.onerror = reject; file.readAsDataURL(blob);
				});
			}
			size += value.length;
			if (size > limit / 1.4) { void reader.cancel(); return null; }
			chunks.push(value);
			return read();
		});
		return read();
	}).catch(() => null).finally(() => clearTimeout(timer));
}

// This bridge is available only to our reader/editor, not web-page scripts.
// It neither exports cookies nor turns the background into an arbitrary URL proxy.
export function handleChatImageSource(raw: unknown, sender: { id?: string; url?: string }): Promise<unknown> | undefined {
	const request = raw as { action?: string; sourceUrl?: string; imageUrl?: string };
	if (request?.action !== 'qiaomuChatImageSource') return;
	const allowed = ['reader.html', 'editor.html'].some(page => sender.url?.split('?')[0] === browser.runtime.getURL(page));
	if (sender.id !== browser.runtime.id || !allowed) return Promise.resolve({ dataUrl: null });
	try {
		for (const value of [request.sourceUrl, request.imageUrl]) {
			if (typeof value !== 'string' || value.length > 8192) throw new Error();
			const url = new URL(value);
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
		}
	} catch { return Promise.resolve({ dataUrl: null }); }
	return browser.tabs.query({}).then(async tabs => {
		const tab = tabs.find(tab => tab.id !== undefined && tab.url?.split('#')[0] === request.sourceUrl!.split('#')[0]);
		if (!tab?.id) return { dataUrl: null };
		const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: readPageChatImage, args: [request.sourceUrl!, request.imageUrl!] });
		return { dataUrl: results[0]?.result ?? null };
	}).catch(() => ({ dataUrl: null }));
}
