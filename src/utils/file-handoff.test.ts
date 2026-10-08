import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { putHandedFile, takeHandedFile, releaseHandedFile, pruneHandedFiles } from './file-handoff';

// A small in-memory stand-in for the parts of IndexedDB that the handoff uses.
function fakeIndexedDB(abort = false) {
	const stores: Record<string, Map<string, unknown>> = {};
	const request = <T>(run: () => T) => { const r: { result?: T; onsuccess?: () => void; onerror?: () => void } = {}; queueMicrotask(() => { r.result = run(); r.onsuccess?.(); }); return r; };
	const database = (name: string) => ({
		close() {}, createObjectStore(store: string) { stores[name + store] = new Map(); },
		transaction(store: string) {
			const map = new Map(stores[name + store]);
			const tx: { oncomplete?: () => void; onabort?: () => void; objectStore: () => unknown } = { objectStore: () => ({
				put: (value: { token: string }) => request(() => { map.set(value.token, value); return value.token; }), get: (key: string) => request(() => map.get(key)),
				getAll: () => request(() => Array.from(map.values())), delete: (key: string) => request(() => { map.delete(key); }),
			}) };
			setTimeout(() => { if (abort) tx.onabort?.(); else { stores[name + store] = map; tx.oncomplete?.(); } }, 0);
			return tx;
		},
	});
	return { open: (name: string) => { const created = !stores[name + 'files']; const r: { result: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: undefined }; queueMicrotask(() => { r.result = database(name); if (created) r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; }, stores };
}
beforeEach(() => { vi.stubGlobal('indexedDB', fakeIndexedDB()); });
afterEach(() => { vi.unstubAllGlobals(); });

it('parks a file under an unguessable token, allows upload retries, then deletes on acknowledgement', async () => {
	const file = new File(['audio'], 'talk.mp3'); const token = (await putHandedFile(file))!;
	expect(token).toMatch(/^[0-9a-f]{24}$/); expect(await takeHandedFile(token)).toBe(file); expect(await takeHandedFile(token)).toBe(file);
	await releaseHandedFile(token); expect(await takeHandedFile(token)).toBeUndefined();
	expect(await putHandedFile(file)).not.toBe(token);
});

it('does not hand out a token when put succeeds but the transaction later aborts', async () => {
	vi.stubGlobal('indexedDB', fakeIndexedDB(true));
	expect(await putHandedFile(new File(['audio'], 'talk.mp3'))).toBeUndefined();
});

it('keeps different files and their acknowledgements separate', async () => {
	const a = new File(['one'], 'one.mp4'), b = new File(['two'], 'two.mp4');
	const first = (await putHandedFile(a))!, second = (await putHandedFile(b))!;
	await releaseHandedFile(first);
	expect(await takeHandedFile(first)).toBeUndefined(); expect(await takeHandedFile(second)).toBe(b);
});

it('sweeps abandoned handoffs on background wake while preserving unexpired ones', async () => {
	const old = (await putHandedFile(new File(['old'], 'old.mp4'), 1000))!;
	const fresh = (await putHandedFile(new File(['new'], 'new.mp4'), 1000 + 30 * 60_000))!;
	await pruneHandedFiles(1000 + 61 * 60_000);
	expect(await takeHandedFile(old, 1000 + 61 * 60_000)).toBeUndefined();
	expect((await takeHandedFile(fresh, 1000 + 61 * 60_000))?.name).toBe('new.mp4');
});

it('refuses a malformed or unknown token, and a file nobody came for in an hour', async () => {
	for (const bad of ['', 'x', '../../etc', 'G'.repeat(24), 'a'.repeat(23)]) expect(await takeHandedFile(bad)).toBeUndefined();
	expect(await takeHandedFile('a'.repeat(24))).toBeUndefined();
	const token = (await putHandedFile(new File(['x'], 'a.mp3'), 1000))!; expect(await takeHandedFile(token, 1000 + 61 * 60_000)).toBeUndefined();
	const old = (await putHandedFile(new File(['x'], 'b.mp3'), 1000))!; await putHandedFile(new File(['y'], 'c.mp3'), 1000 + 61 * 60_000); expect(await takeHandedFile(old, 1000 + 61 * 60_000 + 5)).toBeUndefined(); // swept out when the next one was parked
});

it('says so when the browser has no database to park a file in, so the caller can fall back', async () => {
	vi.stubGlobal('indexedDB', undefined); expect(await putHandedFile(new File(['x'], 'a.mp3'))).toBeUndefined(); expect(await takeHandedFile('a'.repeat(24))).toBeUndefined();
});
