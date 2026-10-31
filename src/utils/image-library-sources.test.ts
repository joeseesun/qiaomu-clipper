import { afterEach, expect, it, vi } from 'vitest';
import { downloadUnsplash, folderPictures, searchUnsplash } from './image-library-sources';
afterEach(() => vi.unstubAllGlobals());
it('reads only supported visible files without any filesystem write or delete', async () => {
	const getFile = vi.fn(async () => ({ size: 8 }));
	const handle: any = { async *entries() { yield ['keep.png', { kind: 'file', getFile }]; yield ['hide.jpg', { kind: 'file', getFile }]; yield ['other.txt', { kind: 'file', getFile }]; yield ['.private', { kind: 'directory', entries: () => { throw new Error('must not read hidden folders'); } }]; } };
	const results = await folderPictures({ id: 'folder', name: 'Folder', hidden: ['hide.jpg'], handle });
	expect(results.map(r => r.name)).toEqual(['keep.png']); expect(getFile).toHaveBeenCalledTimes(1);
});
it('hotlinks Unsplash previews, preserves credits, and tracks only real downloads', async () => {
	const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [
		{ id: 'photo', urls: { small: 'https://images.unsplash.com/small', regular: 'https://images.unsplash.com/full' }, links: { download_location: 'https://api.unsplash.com/photos/photo/download?ixid=1' }, user: { name: 'Author' } },
		{ id: 'unsafe', urls: { small: 'https://evil.test/preview', regular: 'https://evil.test/full' } },
	] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://images.unsplash.com/download' }) }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) });
	vi.stubGlobal('fetch', fetcher);
	const source = { key: 'unsplash-key', proxy: '' };
	const photos = await searchUnsplash(source, 'forest', 1);
	expect(fetcher).toHaveBeenCalledTimes(1); expect(photos).toHaveLength(1); expect(photos[0].author).toBe('Author');
	expect(photos[0].link).toContain('utm_source=qiaomu_clipper');
	await downloadUnsplash(source, photos[0]);
	expect(String(fetcher.mock.calls[1][0])).toBe('https://api.unsplash.com/photos/photo/download?ixid=1');
	expect(fetcher.mock.calls[2][1]).toEqual({ signal: undefined, credentials: 'omit' });
});
it('preserves Unsplash selection tracking and rejects a caller-supplied foreign download URL', async () => {
 const { unsplashDownloadUrl } = await import('./image-library-sources');
 const f = vi.fn(async () => ({ok:true,json:async()=>({url:'https://images.unsplash.com/image'})}));vi.stubGlobal('fetch',f);
 await unsplashDownloadUrl({key:'key',proxy:''},'photo',undefined,'/photos/photo/download?ixid=original');
 expect(f).toHaveBeenCalledWith('https://api.unsplash.com/photos/photo/download?ixid=original',expect.objectContaining({redirect:'error'}));
 await expect(unsplashDownloadUrl({key:'key',proxy:''},'photo',undefined,'https://evil.example/photos/photo/download')).rejects.toThrow('invalid-photo');expect(f).toHaveBeenCalledTimes(1);
});
