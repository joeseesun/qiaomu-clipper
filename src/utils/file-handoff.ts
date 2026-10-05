// A file chosen on one extension page (the settings' study page) has to reach another (the study page that plays it). A page cannot
// pass a File in an address, so it is parked in the extension's own database for a moment, under a one-time token, and taken from there.
const DB = 'qiaomu-handoff', STORE = 'files', KEEP_MS = 60 * 60_000;
type Entry = { token: string; file: File; at: number };

const open = (): Promise<IDBDatabase | undefined> => new Promise(resolve => {
	if (typeof indexedDB === 'undefined') { resolve(undefined); return; }
	try {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'token' }); };
		request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(undefined);
	} catch { resolve(undefined); }
});
const done = <T>(request: IDBRequest<T>): Promise<T | undefined> => new Promise(resolve => { request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(undefined); });
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');

// Park a file; the token to take it with, or undefined when the browser has no database to park it in.
export async function putHandedFile(file: File, now = Date.now()): Promise<string | undefined> {
	const db = await open(); if (!db) return undefined;
	try {
		const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
		const old = (await done(store.getAll())) as Entry[] | undefined;
		for (const entry of old ?? []) if (now - entry.at > KEEP_MS) store.delete(entry.token); // what nobody came for
		const token = newToken(); await done(store.put({ token, file, at: now } satisfies Entry)); return token;
	} catch { return undefined; } finally { db.close(); }
}
// Take it, once: it is removed as it is read.
export async function takeHandedFile(token: string, now = Date.now()): Promise<File | undefined> {
	if (!/^[0-9a-f]{24}$/.test(token)) return undefined;
	const db = await open(); if (!db) return undefined;
	try {
		const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
		const entry = (await done(store.get(token))) as Entry | undefined; if (!entry) return undefined;
		store.delete(token); return now - entry.at <= KEEP_MS ? entry.file : undefined;
	} catch { return undefined; } finally { db.close(); }
}
