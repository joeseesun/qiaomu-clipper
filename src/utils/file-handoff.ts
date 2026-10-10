// A file chosen on one extension page (the settings' study page) has to reach another (the study page that plays it). A page cannot
// pass a File in an address, so it is parked briefly under a random token. Acknowledgement follows a successful helper upload.
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
// Request success precedes transaction commit: an aborted write must not open a reader with a nonexistent token.
const committed = (tx: IDBTransaction): Promise<boolean> => new Promise(resolve => {
	tx.oncomplete = () => resolve(true); tx.onabort = tx.onerror = () => resolve(false);
});
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');

// Park a file; the token to take it with, or undefined when the browser has no database to park it in.
export async function putHandedFile(file: File, now = Date.now()): Promise<string | undefined> {
	const db = await open(); if (!db) return undefined;
	try {
		const tx = db.transaction(STORE, 'readwrite'), finished = committed(tx), store = tx.objectStore(STORE);
		const old = (await done(store.getAll())) as Entry[] | undefined;
		for (const entry of old ?? []) if (now - entry.at > KEEP_MS) store.delete(entry.token); // what nobody came for
		const token = newToken(); const written = await done(store.put({ token, file, at: now } satisfies Entry)); return await finished && written ? token : undefined;
	} catch { return undefined; } finally { db.close(); }
}
// Read without consuming: a refresh or interrupted upload can retry during the original one-hour handoff window.
export async function takeHandedFile(token: string, now = Date.now()): Promise<File | undefined> {
	if (!/^[0-9a-f]{24}$/.test(token)) return undefined;
	const db = await open(); if (!db) return undefined;
	try {
		const tx = db.transaction(STORE, 'readwrite'), finished = committed(tx), store = tx.objectStore(STORE);
		const entry = (await done(store.get(token))) as Entry | undefined; if (!entry) return undefined;
		const valid = now - entry.at <= KEEP_MS;
		if (!valid) store.delete(token);
		return await finished && valid ? entry.file : undefined;
	} catch { return undefined; } finally { db.close(); }
}

// The helper now owns the staged file. Do not keep a second large media copy in extension storage.
export async function releaseHandedFile(token: string): Promise<void> {
	if (!/^[0-9a-f]{24}$/.test(token)) return;
	const db = await open(); if (!db) return;
	try { const tx = db.transaction(STORE, 'readwrite'), finished = committed(tx); tx.objectStore(STORE).delete(token); await finished; }
	finally { db.close(); }
}

// Also called when the background worker wakes, so abandoned large handoffs are swept without another file selection.
export async function pruneHandedFiles(now = Date.now()): Promise<void> {
	const db = await open(); if (!db) return;
	try {
		const tx = db.transaction(STORE, 'readwrite'), finished = committed(tx), store = tx.objectStore(STORE);
		const old = (await done(store.getAll())) as Entry[] | undefined;
		for (const entry of old ?? []) if (now - entry.at > KEEP_MS) store.delete(entry.token);
		await finished;
	} catch { /* Optional handoff cleanup must not interrupt background startup. */ } finally { db.close(); }
}
