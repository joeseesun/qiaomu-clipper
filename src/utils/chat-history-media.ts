// History owns upload copies; the library owns gallery entries. Cleanup only
// visits explicit candidates, never sweeps unrelated images, files or settings.
export interface HistoryAttachment { id: string; name: string }
export function historyAttachments(value: unknown): HistoryAttachment[] {
	return Array.isArray(value) ? value.filter(v => v && typeof v.id === 'string' && /^chat-image-[a-f0-9-]{36}$/i.test(v.id) && typeof v.name === 'string').map(v => ({ id: v.id, name: v.name.slice(0, 120) })) : [];
}
export function historyMedia(value: unknown): string[] {
	const messages = (value as { messages?: unknown[] } | null)?.messages;
	if (!Array.isArray(messages)) return [];
	const result = new Set<string>();
	for (const item of messages) {
		const turn = item as { attachments?: unknown; generatedImages?: { imageId?: unknown }[] } | null;
		for (const ref of historyAttachments(turn?.attachments)) result.add(`a:${ref.id}`);
		for (const image of Array.isArray(turn?.generatedImages) ? turn.generatedImages : []) {
			if (image && typeof image.imageId === 'string' && image.imageId.length <= 200) result.add(`g:${image.imageId}`);
		}
	}
	return [...result];
}
export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export function idbDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted')); });
}
async function existingDatabase(name: string): Promise<IDBDatabase | undefined> {
	return new Promise((resolve, reject) => {
		let missing = false, blocked = false;
		const request = indexedDB.open(name);
		request.onupgradeneeded = () => { missing = true; request.transaction!.abort(); };
		request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
		request.onerror = () => missing ? resolve(undefined) : reject(request.error);
		request.onblocked = () => { blocked = true; reject(new Error('Image storage is busy')); };
	});
}
// Check gallery ownership and job references in the same transaction as removing
// orphan blobs. A concurrent gallery save either precedes this check or writes
// its own blob afterwards, so history cleanup cannot remove a saved gallery item.
export async function cleanHistoryMedia(candidates: string[]): Promise<void> {
	if (!candidates.length) return;
	const protectedIds = new Set<string>();
	const library = await existingDatabase('qiaomu-chat-images');
	if (library) try {
		const names = ['images', 'entries', 'jobs'].filter(name => library.objectStoreNames.contains(name));
		if (!names.includes('images')) throw new Error('Unrecognized image storage');
		const tx = library.transaction(names, 'readwrite'), done = idbDone(tx);
		const ids = new Set(candidates.map(ref => ref.slice(2)));
		const inspect = () => {
			for (const id of ids) {
				if (!names.includes('entries')) { protectedIds.add(id); continue; }
				const owned = tx.objectStore('entries').getKey(id);
				owned.onsuccess = () => {
					if (owned.result !== undefined) protectedIds.add(id);
					if (!protectedIds.has(id) && candidates.includes(`g:${id}`)) tx.objectStore('images').delete(id);
				};
			}
		};
		if (names.includes('jobs')) {
			const cursor = tx.objectStore('jobs').openCursor();
			cursor.onsuccess = () => { const item = cursor.result; if (!item) { inspect(); return; } if (ids.has(item.value?.imageId)) protectedIds.add(item.value.imageId); item.continue(); };
		} else inspect();
		await done;
	} finally { library.close(); }
	const uploads = candidates.filter(ref => ref.startsWith('a:') && !protectedIds.has(ref.slice(2))).map(ref => ref.slice(2));
	if (!uploads.length) return;
	const attachments = await existingDatabase('qiaomu-chat-attachments');
	if (!attachments) return;
	try {
		const names = ['images', 'previews'].filter(name => attachments.objectStoreNames.contains(name));
		if (!names.includes('images')) throw new Error('Unrecognized attachment storage');
		const tx = attachments.transaction(names, 'readwrite'), done = idbDone(tx);
		try { for (const id of uploads) for (const name of names) tx.objectStore(name).delete(id); }
		catch (error) { try { tx.abort(); } catch { /* already aborted */ } await done.catch(() => {}); throw error; }
		await done;
	} finally { attachments.close(); }
}
