// Shared by extension pages and the offscreen image runner. Credentials never enter this database.
export type ImageJobState = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
export interface ImageJob {
	id: string; created: number; prompt: string; aspect: string; configId: string; modelId: string;
	modelLabel: string; state: ImageJobState; engine?: 'codex'; imageId?: string; error?: string;
}
export interface LibraryImage {
	id: string; name: string; created: number; source: 'generated' | 'upload' | 'unsplash';
	prompt?: string; modelLabel?: string; width?: number; height?: number; credit?: { name: string; url: string };
}
export interface LibraryFolder { id: string; name: string; handle: FileSystemDirectoryHandle; hidden: string[] }
type Store = 'images' | 'entries' | 'jobs' | 'folders';
export async function imageDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('qiaomu-chat-images', 2);
		request.onupgradeneeded = () => {
			for (const name of ['images', 'entries', 'jobs', 'folders']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
			const cursor = request.transaction!.objectStore('images').openCursor();
			cursor.onsuccess = () => {
				const item = cursor.result; if (!item) return;
				request.transaction!.objectStore('entries').put({ id: String(item.key), name: 'Image', created: 0, source: 'generated' }, item.key);
				item.continue();
			};
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
export async function imageTransaction<T>(stores: Store[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> {
	const db = await imageDatabase();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(stores, mode);
			const request = run(tx);
			tx.oncomplete = () => resolve(request.result);
			tx.onabort = tx.onerror = () => reject(tx.error ?? request.error ?? new Error('image-storage-error'));
		});
	} finally { db.close(); }
}
export const listLibraryImages = (): Promise<LibraryImage[]> => imageTransaction(['entries'], 'readonly', tx => tx.objectStore('entries').getAll());
export const listImageJobs = (): Promise<ImageJob[]> => imageTransaction(['jobs'], 'readonly', tx => tx.objectStore('jobs').getAll());
export const readImageJob = (id: string): Promise<ImageJob | undefined> => imageTransaction(['jobs'], 'readonly', tx => tx.objectStore('jobs').get(id));
export const writeImageJob = async (job: ImageJob): Promise<void> => { await imageTransaction(['jobs'], 'readwrite', tx => tx.objectStore('jobs').put(job, job.id)); };
export const removeImageJob = async (id: string): Promise<void> => {
	await imageTransaction(['jobs'], 'readwrite', tx => {
		const store = tx.objectStore('jobs'), request = store.get(id);
		request.onsuccess = () => { if (request.result && !['queued', 'running'].includes(request.result.state)) store.delete(id); };
		return request;
	});
};
export const readLibraryBlob = (id: string): Promise<Blob | undefined> => imageTransaction(['images'], 'readonly', tx => tx.objectStore('images').get(id));
export async function saveLibraryImage(blob: Blob, entry: LibraryImage, job?: ImageJob): Promise<void> {
	await imageTransaction(['images', 'entries', 'jobs'], 'readwrite', tx => {
		tx.objectStore('images').put(blob, entry.id);
		if (job) tx.objectStore('jobs').put(job, job.id);
		return tx.objectStore('entries').put(entry, entry.id);
	});
}
export async function renameLibraryImage(id: string, name: string): Promise<void> {
	await imageTransaction(['entries'], 'readwrite', tx => {
		const store = tx.objectStore('entries'), request = store.get(id);
		request.onsuccess = () => { if (request.result) store.put({ ...request.result, name: name.trim().slice(0, 150) || request.result.name }, id); };
		return request;
	});
}
export async function removeLibraryImages(ids: string[]): Promise<void> {
	if (!ids.length) return;
	await imageTransaction(['images', 'entries'], 'readwrite', tx => {
		let last!: IDBRequest;
		for (const id of new Set(ids)) { tx.objectStore('images').delete(id); last = tx.objectStore('entries').delete(id); }
		return last;
	});
}
export const listLibraryFolders = (): Promise<LibraryFolder[]> => imageTransaction(['folders'], 'readonly', tx => tx.objectStore('folders').getAll());
export const saveLibraryFolder = async (folder: LibraryFolder): Promise<void> => { await imageTransaction(['folders'], 'readwrite', tx => tx.objectStore('folders').put(folder, folder.id)); };
export const removeLibraryFolder = async (id: string): Promise<void> => { await imageTransaction(['folders'], 'readwrite', tx => tx.objectStore('folders').delete(id)); };
export async function inspectLibraryBlob(blob: Blob): Promise<{ width: number; height: number }> {
	if (!blob.size || blob.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('invalid-image');
	const bitmap = await createImageBitmap(blob).catch(() => { throw new Error('invalid-image'); });
	try { if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 36_000_000) throw new Error('invalid-image'); return { width: bitmap.width, height: bitmap.height }; }
	finally { bitmap.close(); }
}
