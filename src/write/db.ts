// One IndexedDB database for everything the writer keeps: articles, pictures and small bookkeeping values.
export const DB_NAME = 'qiaomu-write';
export const DB_VERSION = 1;

let opened: Promise<IDBDatabase> | undefined;

export function openDb(): Promise<IDBDatabase> {
	if (opened) return opened;
	opened = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains('articles')) {
				const articles = db.createObjectStore('articles', { keyPath: 'id' });
				articles.createIndex('updatedAt', 'updatedAt');
			}
			if (!db.objectStoreNames.contains('images')) {
				const images = db.createObjectStore('images', { keyPath: 'id' });
				images.createIndex('hash', 'hash', { unique: false });
			}
			if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
		};
		request.onsuccess = () => {
			const db = request.result;
			// Another tab upgrading the schema must not be blocked by this connection.
			db.onversionchange = () => { db.close(); opened = undefined; };
			resolve(db);
		};
		request.onerror = () => { opened = undefined; reject(request.error); };
		request.onblocked = () => { opened = undefined; reject(new Error('blocked')); };
	});
	return opened;
}

export function resetDbConnection(): void { opened = undefined; }

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('aborted')); });
}
