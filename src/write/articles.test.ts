import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbConnection } from './db';
import { blankArticle, collectUnusedImages, countWords, deleteArticle, duplicateArticle, emptyTrash, getArticle, listArticles, newOrBlankArticle, purgeOldTrash, recordPublish, restoreArticle, RevisionConflict, saveArticle, trashArticle, TRASH_KEEP_MS } from './articles';
import { allImageIds, imageIdFromUrl, imageIdsIn, saveImage } from './images';

beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); });

const png = (seed: string) => new Blob([seed], { type: 'image/png' });

it('counts Chinese characters and words alike', () => {
	expect(countWords('你好，世界')).toBe(4);
	expect(countWords('Hello brave new world')).toBe(4);
	expect(countWords('```\ncode code\n``` 你好 ![x](a.png) done')).toBe(3);
});

it('creates, reads, searches and orders articles', async () => {
	const a = await saveArticle({ ...blankArticle(), title: 'Alpha', markdown: 'about cats' });
	await new Promise(r => setTimeout(r, 3));
	const b = await saveArticle({ ...blankArticle(), title: 'Beta', markdown: '你好 dogs' });
	expect((await listArticles()).map(x => x.id)).toEqual([b.id, a.id]);
	expect((await listArticles({ query: 'CATS' })).map(x => x.id)).toEqual([a.id]);
	expect((await getArticle(a.id))?.wordCount).toBe(2);
	expect((await listArticles())[0].excerpt).toContain('dogs');
	expect('markdown' in (await listArticles())[0]).toBe(false);
});

it('refuses to overwrite a newer revision saved from another tab', async () => {
	const saved = await saveArticle({ ...blankArticle(), title: 'x' });
	const second = await saveArticle({ ...saved, title: 'from tab two' }, saved.revision);
	await expect(saveArticle({ ...saved, title: 'stale' }, saved.revision)).rejects.toBeInstanceOf(RevisionConflict);
	expect((await getArticle(saved.id))?.title).toBe('from tab two');
	expect(second.revision).toBe(saved.revision + 1);
});

it('moves to the trash, restores, and deletes for good only on request', async () => {
	const a = await saveArticle({ ...blankArticle(), title: 'A' });
	await trashArticle(a.id);
	expect(await listArticles()).toEqual([]);
	expect((await listArticles({ trashed: true })).length).toBe(1);
	await restoreArticle(a.id);
	expect((await listArticles()).length).toBe(1);
	await trashArticle(a.id);
	await deleteArticle(a.id);
	expect(await getArticle(a.id)).toBeUndefined();
});

it('empties the trash and purges only entries older than 30 days', async () => {
	const old = await saveArticle({ ...blankArticle(), title: 'old' });
	const fresh = await saveArticle({ ...blankArticle(), title: 'fresh' });
	await trashArticle(old.id); await trashArticle(fresh.id);
	expect(await purgeOldTrash(Date.now() + TRASH_KEEP_MS - 1000)).toBe(0);
	expect(await purgeOldTrash(Date.now() + TRASH_KEEP_MS + 1000)).toBe(2);
	const again = await saveArticle({ ...blankArticle(), title: 'z' });
	await trashArticle(again.id);
	expect(await emptyTrash()).toBe(1);
});

it('stores a picture once and removes it when no article uses it', async () => {
	const one = await saveImage(png('same'));
	const two = await saveImage(png('same'));
	expect(two.id).toBe(one.id);
	const other = await saveImage(png('other'));
	const art = await saveArticle({ ...blankArticle(), markdown: `![a](qm-image://${one.id})` });
	expect(imageIdsIn(art.markdown)).toEqual([one.id]);
	expect(imageIdFromUrl(`qm-image://${one.id}`)).toBe(one.id);
	expect(await collectUnusedImages()).toBe(1);
	expect(await allImageIds()).toEqual([one.id]);
	await deleteArticle(art.id);
	expect(await allImageIds()).toEqual([]);
	expect(other.id).not.toBe(one.id);
});

it('keeps a cover picture alive even when the text does not show it', async () => {
	const cover = await saveImage(png('cover'));
	await saveArticle({ ...blankArticle(), coverImageId: cover.id });
	expect(await collectUnusedImages()).toBe(0);
});

it('reuses an untouched blank article instead of piling up new ones', async () => {
	const first = await newOrBlankArticle();
	const second = await newOrBlankArticle();
	expect(second.id).toBe(first.id);
	await saveArticle({ ...first, title: 'used' }, first.revision);
	expect((await newOrBlankArticle()).id).not.toBe(first.id);
});

it('duplicates an article and records publishes without counting them as edits', async () => {
	const a = await saveArticle({ ...blankArticle(), title: 'T', markdown: 'body' });
	const copy = await duplicateArticle(a.id);
	expect(copy?.markdown).toBe('body');
	expect(copy?.id).not.toBe(a.id);
	await recordPublish(a.id, 'x', { at: 1, url: 'https://x.com/a' });
	const after = await getArticle(a.id);
	expect(after?.publishes.x?.url).toBe('https://x.com/a');
	expect(after?.revision).toBe(a.revision);
	expect(after?.updatedAt).toBe(a.updatedAt);
});

it('keeps formulas, tags and fenced code out of the list excerpt', async () => {
	const { excerptOf } = await import('./articles');
	expect(excerptOf('Hello $E=mc^2$ and $5 or $6\n\n$$\n\\int x\n$$\n\n<img src="a" width="3"> tail')).toBe('Hello E=mc^2 and $5 or $6 tail');
});

it('preserves the newest text when recording a publish while an editor saves', async () => {
	const article = await saveArticle({ ...blankArticle(), markdown: 'before' });
	await Promise.all([
		recordPublish(article.id, 'x', { at: 1, url: 'https://x.com/draft' }),
		saveArticle({ ...article, markdown: 'after' }, article.revision),
	]);
	const saved = await getArticle(article.id);
	expect(saved?.markdown).toBe('after');
	expect(saved?.publishes.x?.url).toBe('https://x.com/draft');
});

it('keeps publish receipts when an editor saves its older in-memory copy', async () => {
	const article = await saveArticle({ ...blankArticle(), markdown: 'before' });
	await recordPublish(article.id, 'x', { at: 1, url: 'https://x.com/draft' });
	await saveArticle({ ...article, markdown: 'after' }, article.revision);
	expect((await getArticle(article.id))?.publishes.x?.url).toBe('https://x.com/draft');
});

it('does not let an already open editor resurrect an article moved to trash', async () => {
	const article = await saveArticle({ ...blankArticle(), markdown: 'before' });
	await trashArticle(article.id);
	await expect(saveArticle({ ...article, markdown: 'stale editor' }, article.revision)).rejects.toBeInstanceOf(RevisionConflict);
	expect((await getArticle(article.id))?.trashedAt).toBeTruthy();
});
