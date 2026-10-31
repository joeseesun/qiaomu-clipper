import { openDb, requestResult, transactionDone } from './db';
import { allImageIds, deleteImages, imageIdsIn, newId } from './images';
import { deleteChat } from './ai/chat-store';
import type { Article, ArticleSummary, PublishRecord, PublishTarget } from './types';

export const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

// CJK characters count one each, other words one per run, so the number means the same in any language.
export function countWords(markdown: string): number {
	const text = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~|-]/g, ' ');
	const cjk = text.match(/[㐀-鿿぀-ヿ가-힯]/g)?.length ?? 0;
	const words = text.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
	return cjk + words;
}

export function excerptOf(markdown: string, length = 120): string {
	return markdown.replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/<[^>]+>/g, ' ').replace(/(?<![\\$])\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length);
}

export function summarize(article: Article): ArticleSummary {
	const { markdown, ...rest } = article;
	return { ...rest, excerpt: excerptOf(markdown) };
}

export function blankArticle(now = Date.now()): Article {
	return { id: newId('art_'), title: '', markdown: '', coverImageId: '', author: '', digest: '', sourceUrl: '', createdAt: now, updatedAt: now, wordCount: 0, publishes: {}, revision: 0 };
}

export function isBlank(article: Pick<Article, 'title' | 'markdown'>): boolean {
	return !article.title.trim() && !article.markdown.trim();
}

export async function getArticle(id: string): Promise<Article | undefined> {
	const db = await openDb();
	return await requestResult(db.transaction('articles').objectStore('articles').get(id)) as Article | undefined;
}

export interface ListOptions { trashed?: boolean; query?: string }

// Newest edit first. Articles are small text; reading them all is cheaper than maintaining a second index.
export async function listArticles(options: ListOptions = {}): Promise<ArticleSummary[]> {
	const db = await openDb();
	const all = await requestResult(db.transaction('articles').objectStore('articles').getAll()) as Article[];
	const query = options.query?.trim().toLowerCase();
	return all
		.filter(article => !!article.trashedAt === !!options.trashed)
		.filter(article => !query || article.title.toLowerCase().includes(query) || article.markdown.toLowerCase().includes(query))
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(summarize);
}

export async function countArticles(): Promise<{ active: number; trashed: number }> {
	const db = await openDb();
	const all = await requestResult(db.transaction('articles').objectStore('articles').getAll()) as Article[];
	const trashed = all.filter(article => article.trashedAt).length;
	return { active: all.length - trashed, trashed };
}

export class RevisionConflict extends Error { constructor() { super('revision-conflict'); } }

// Create or update. `expectedRevision` guards against a second tab saving an older copy over a newer one.
export async function saveArticle(article: Article, expectedRevision?: number): Promise<Article> {
	const db = await openDb();
	const tx = db.transaction('articles', 'readwrite');
	const store = tx.objectStore('articles');
	const current = await requestResult(store.get(article.id)) as Article | undefined;
	if (expectedRevision !== undefined && (!current || current.revision !== expectedRevision)) { tx.abort(); throw new RevisionConflict(); }
	const saved: Article = { ...article, publishes: current?.publishes ?? article.publishes, wordCount: countWords(article.markdown), updatedAt: Date.now(), revision: (current?.revision ?? -1) + 1 };
	store.put(saved);
	await transactionDone(tx);
	return saved;
}

export async function updateArticleFields(id: string, patch: Partial<Pick<Article, 'author' | 'digest' | 'sourceUrl' | 'coverImageId' | 'title'>>): Promise<Article | undefined> {
	return mutateArticle(id, current => ({ ...current, ...patch, updatedAt: Date.now(), revision: current.revision + 1 }));
}

// Keep the read and the write in one transaction so another tab cannot save between them.
async function mutateArticle(id: string, change: (current: Article) => Article): Promise<Article | undefined> {
	const db = await openDb();
	const tx = db.transaction('articles', 'readwrite');
	const store = tx.objectStore('articles');
	const current = await requestResult(store.get(id)) as Article | undefined;
	const next = current ? change(current) : undefined;
	if (next) store.put(next);
	await transactionDone(tx);
	return next;
}

export async function recordPublish(id: string, target: PublishTarget, record: PublishRecord): Promise<void> {
	// Publishing does not count as an edit: keep the edit time and the revision the editor holds.
	await mutateArticle(id, current => ({ ...current, publishes: { ...current.publishes, [target]: record } }));
}

export async function duplicateArticle(id: string): Promise<Article | undefined> {
	const current = await getArticle(id);
	if (!current) return undefined;
	const copy = { ...blankArticle(), title: current.title ? `${current.title} (copy)` : '', markdown: current.markdown, coverImageId: current.coverImageId, author: current.author, digest: current.digest, sourceUrl: current.sourceUrl };
	return saveArticle(copy);
}

export async function trashArticle(id: string): Promise<void> {
	await mutateArticle(id, current => ({ ...current, trashedAt: Date.now(), revision: current.revision + 1 }));
}

export async function restoreArticle(id: string): Promise<void> {
	await mutateArticle(id, current => {
		const { trashedAt: _gone, ...rest } = current;
		return { ...rest, revision: current.revision + 1 };
	});
}

export async function deleteArticle(id: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction('articles', 'readwrite');
	tx.objectStore('articles').delete(id);
	await transactionDone(tx);
	await deleteChat(id).catch(() => {});
	await collectUnusedImages();
}

export async function emptyTrash(now = Date.now(), olderThan = 0): Promise<number> {
	const db = await openDb();
	const all = await requestResult(db.transaction('articles').objectStore('articles').getAll()) as Article[];
	const doomed = all.filter(article => article.trashedAt && now - article.trashedAt >= olderThan);
	if (!doomed.length) return 0;
	const tx = db.transaction('articles', 'readwrite');
	for (const article of doomed) tx.objectStore('articles').delete(article.id);
	await transactionDone(tx);
	await Promise.all(doomed.map(article => deleteChat(article.id).catch(() => {})));
	await collectUnusedImages();
	return doomed.length;
}

// Trash older than 30 days goes away on its own; called when the writer opens.
export function purgeOldTrash(now = Date.now()): Promise<number> { return emptyTrash(now, TRASH_KEEP_MS); }

// A picture nothing points at any more (not in any article text, not a cover) is removed.
export async function collectUnusedImages(): Promise<number> {
	const db = await openDb();
	const articles = await requestResult(db.transaction('articles').objectStore('articles').getAll()) as Article[];
	const used = new Set<string>();
	for (const article of articles) { imageIdsIn(article.markdown).forEach(id => used.add(id)); if (article.coverImageId) used.add(article.coverImageId); }
	const unused = (await allImageIds()).filter(id => !used.has(id));
	await deleteImages(unused);
	return unused.length;
}

// Triple-u always starts a fresh article, but never piles up empty ones: an untouched blank article is reused.
export async function newOrBlankArticle(): Promise<Article> {
	const db = await openDb();
	const all = await requestResult(db.transaction('articles').objectStore('articles').getAll()) as Article[];
	const blank = all.filter(article => !article.trashedAt && isBlank(article)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
	if (blank) return blank;
	return saveArticle(blankArticle());
}
