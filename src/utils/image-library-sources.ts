import { getLocalStorage, setLocalStorage } from './storage-utils';
import type { LibraryFolder } from './image-library-store';
export interface FolderPicture { name: string; path: string; file: File }
export async function folderPictures(folder: LibraryFolder): Promise<FolderPicture[]> {
	const pictures: FolderPicture[] = [];
	let visited = 0;
	async function walk(handle: FileSystemDirectoryHandle, prefix = '', depth = 0): Promise<void> {
		if (depth > 6) return;
		for await (const [name, entry] of (handle as any).entries()) {
			if (++visited > 3000 || pictures.length >= 500) return;
			if (name.startsWith('.')) continue;
			const path = prefix + name;
			if (entry.kind === 'directory') await walk(entry, `${path}/`, depth + 1);
			else if (/\.(png|jpe?g|webp)$/i.test(name) && !folder.hidden.includes(path)) {
				try { const file = await entry.getFile(); if (file.size && file.size <= 20 * 1024 * 1024) pictures.push({ name, path, file }); } catch { /* a file can disappear during a scan */ }
			}
		}
	}
	await walk(folder.handle); return pictures;
}
export interface UnsplashSource { key: string; proxy: string }
export interface UnsplashPhoto { id: string; description: string; thumb: string; full: string; author: string; authorLink?: string; link: string; download: string }
const CONFIG = 'qiaomuUnsplash';
export async function loadUnsplashSource(): Promise<UnsplashSource> {
	const raw = await getLocalStorage(CONFIG);
	return { key: typeof raw?.key === 'string' ? raw.key : '', proxy: typeof raw?.proxy === 'string' ? raw.proxy : '' };
}
export async function saveUnsplashSource(source: UnsplashSource): Promise<void> {
	if (source.proxy && new URL(source.proxy).protocol !== 'https:') throw new Error('unsplash-https-required');
	await setLocalStorage(CONFIG, source);
}
const base = (source: UnsplashSource) => source.proxy.trim().replace(/\/+$/, '') || 'https://api.unsplash.com';
async function unsplashRequest(source: UnsplashSource, path: string, signal?: AbortSignal): Promise<any> {
	const url = new URL(base(source) + path);
	if (url.protocol !== 'https:') throw new Error('unsplash-https-required');
	const response = await fetch(url.href, { signal, credentials: 'omit', redirect: 'error', headers: source.proxy ? {} : { Authorization: `Client-ID ${source.key}`, 'Accept-Version': 'v1' } });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
}
const isPhotoUrl = (value: unknown): value is string => typeof value === 'string' && /^https:\/\/images\.unsplash\.com\//.test(value);
export async function searchUnsplash(source: UnsplashSource, query: string, page: number, signal?: AbortSignal, options: { count?: number; orientation?: string; color?: string } = {}): Promise<UnsplashPhoto[]> {
	const count = Math.max(1, Math.min(30, options.count || 24));
	const filters = `${options.orientation ? `&orientation=${encodeURIComponent(options.orientation)}` : ''}${options.color ? `&color=${encodeURIComponent(options.color)}` : ''}`;
	const result = await unsplashRequest(source, query ? `/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&page=${page}${filters}` : `/photos?order_by=popular&per_page=${count}&page=${page}`, signal);
	const rows: any[] = query ? result.results : result;
	return (Array.isArray(rows) ? rows : []).filter(p => typeof p.id === 'string' && isPhotoUrl(p.urls?.small) && isPhotoUrl(p.urls?.regular) && /^https:\/\/api\.unsplash\.com\/photos\/[^/]+\/download/.test(p.links?.download_location))
		.map(p => ({ id: p.id, description: String(p.alt_description || p.description || p.user?.name || 'Unsplash'), thumb: p.urls.small, full: p.urls.regular, author: String(p.user?.name || 'Unsplash'), authorLink: p.user?.username ? `https://unsplash.com/@${encodeURIComponent(p.user.username)}?utm_source=qiaomu_clipper&utm_medium=referral` : undefined, link: `https://unsplash.com/photos/${encodeURIComponent(p.id)}?utm_source=qiaomu_clipper&utm_medium=referral`, download: new URL(p.links.download_location).pathname + new URL(p.links.download_location).search }));
}
export async function unsplashDownloadUrl(source: UnsplashSource, id: string, signal?: AbortSignal, trackingPath?: string): Promise<string> {
	if (!/^[\w-]{1,100}$/.test(id)) throw new Error('invalid-photo');
	const path = `/photos/${encodeURIComponent(id)}/download`;
	const tracking = new URL(trackingPath || path, 'https://api.unsplash.com');
	if (tracking.origin !== 'https://api.unsplash.com' || tracking.pathname !== path || tracking.href.length > 4000) throw new Error('invalid-photo');
	const result = await unsplashRequest(source, path + tracking.search, signal);
	if (!isPhotoUrl(result.url)) throw new Error('empty-image');
	return result.url;
}
export async function downloadUnsplash(source: UnsplashSource, photo: UnsplashPhoto, signal?: AbortSignal): Promise<Blob> {
	// Track a real selection, never a thumbnail view, as required by Unsplash.
	const result = await unsplashRequest(source, photo.download, signal);
	if (!isPhotoUrl(result.url)) throw new Error('empty-image');
	const response = await fetch(result.url, { signal, credentials: 'omit' });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.blob();
}
