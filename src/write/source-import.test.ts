// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../utils/browser-polyfill', () => ({ default: {
	runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
	tabs: { query: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn() }, windows: { update: vi.fn() },
} }));
import browser from '../utils/browser-polyfill';
import { resetDbConnection } from './db';
import { getArticle, listArticles, saveArticle, trashArticle } from './articles';
import { articleFromClip, completeSourceImport, extractedArticleSource, openClipArticle, openSourcePage, sourceSnapshot } from './source-import';
import type { ClipPreview } from '../utils/clip-preview';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './editor/extensions';

const videoUrl = 'https://www.youtube.com/watch?v=dbqweBCynuI';
const clip = (url = videoUrl): ClipPreview => ({ clip: { title: 'Source title', url, markdown: 'Template without transcript' }, local: { requestId: 'source-1', content: '', name: 'Source.md', folder: '', vault: '', behavior: 'create' }, aggregate: false, native: false });
const html = '<p>Original description</p><iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe><div class="transcript"><h2>Transcript</h2><div class="transcript-heading-tools"><button>Not article content</button></div><p class="transcript-segment"><strong><span class="timestamp" data-timestamp="12">0:12</span></strong> First sentence</p><p class="transcript-segment" hidden><strong>0:32</strong> Hidden by search, still included</p></div>';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbConnection(); vi.clearAllMocks(); document.body.innerHTML = ''; });

it('imports the video, description and every caption independently of clip templates and search filters', async () => {
	const draft = clip(); draft.articleSource = extractedArticleSource({ content: html, description: 'Original description', author: 'Original creator' }, videoUrl);
	const saved = await articleFromClip(draft);
	expect(saved.markdown).toContain(`\n\n${videoUrl}\n\n`);
	expect(saved.markdown.match(/Original description/g)).toHaveLength(1);
	expect(saved.markdown).toContain('Original creator');
	expect(saved.markdown).toContain('First sentence');
	expect(saved.markdown).toContain('Hidden by search, still included');
	expect(saved.markdown).toContain('[0:12](https://www.youtube.com/watch?v=dbqweBCynuI&t=12)');
	expect(saved.markdown).not.toMatch(/Not article content|<iframe|Template without/);
	expect(saved.author).toBe('');
	expect(saved.clipSource?.waitingForCaptions).toBe(false);
	// Exercise the actual editor Markdown parser, not just a substring that happens to look like an embed.
	const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: buildExtensions({ resolveImage: async () => undefined }), content: saved.markdown });
	expect(editor.getJSON().content?.filter(node => node.type === 'embed')).toHaveLength(1);
	expect(editor.getText()).toContain('First sentence'); editor.destroy();
});

it('keeps ordinary text, images and edits without introducing video sections', async () => {
	const draft = clip('https://example.com/article'); draft.clip.markdown = 'Edited paragraph\n\n![photo](https://example.com/photo.jpg)\n\n```js\nconst x = 1;\n```';
	const saved = await articleFromClip(draft);
	expect(saved.markdown).toContain(draft.clip.markdown);
	expect(saved.markdown).not.toContain('视频简介');
	expect(saved.sourceUrl).toBe(draft.clip.url); expect(saved.clipSource?.waitingForCaptions).toBe(false);
});

it('imports the visible ordinary article even when a clip template leaves out its body', () => {
	const draft = clip('https://example.com/essay');
	document.body.innerHTML = '<article><h2>Full body</h2><p>Actual text</p><img src="https://example.com/image.jpg"><button>Reader control</button></article>';
	const snapshot = sourceSnapshot(draft, document.querySelector('article'));
	expect(snapshot.markdown).toContain('Actual text');
	expect(snapshot.markdown).toContain('https://example.com/image.jpg');
	expect(snapshot.markdown).not.toMatch(/Template without|Reader control/);
});

it('uses the selected full bilingual transcript without mutating the learning page', () => {
	document.body.innerHTML = `<article>${html}</article>`;
	const article = document.querySelector('article')!;
	const first = article.querySelector<HTMLElement>('.transcript-segment')!;
	first.dataset.translationReady = 'true'; first.dataset.translatedText = '第一句话';
	const before = article.innerHTML;
	const snapshot = sourceSnapshot(clip(), article, 'bilingual');
	expect(snapshot.markdown).toContain('第一句话'); expect(snapshot.markdown).toContain('First sentence');
	expect(snapshot.markdown).toContain('Hidden by search');
	expect(article.innerHTML).toBe(before);
});

it('retains corrected study text rather than restoring the source transcript', () => {
	const draft = clip(); draft.studyEditedAt = Date.now(); draft.clip.markdown = '**0:12** Corrected caption\n\nMy own notes';
	draft.articleSource = extractedArticleSource({ content: html }, videoUrl);
	const snapshot = sourceSnapshot(draft);
	expect(snapshot.markdown).toContain('Corrected caption'); expect(snapshot.markdown).toContain('My own notes');
	expect(snapshot.markdown).not.toContain('First sentence');
});

it('serializes repeated creation, reopens the existing draft and never overwrites edits', async () => {
	const draft = clip('https://example.com/article');
	const [a, b] = await Promise.all([articleFromClip(draft), articleFromClip(draft)]);
	expect(a.id).toBe(b.id); expect(await listArticles()).toHaveLength(1);
	await saveArticle({ ...a, markdown: 'User already edited this draft' }, a.revision);
	await openClipArticle(draft);
	expect((await getArticle(a.id))?.markdown).toBe('User already edited this draft');
	expect(browser.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://fixture/write.html?id=${a.id}` });
	await trashArticle(a.id);
	expect((await articleFromClip(draft)).id).not.toBe(a.id);
});

it('fills late captions, preserves writing made while waiting, and completes only once', async () => {
	const draft = clip(); draft.clip.markdown = '';
	const initial = await articleFromClip(draft); expect(initial.clipSource?.waitingForCaptions).toBe(true);
	draft.articleSource = extractedArticleSource({ content: html, description: 'Original description' }, videoUrl);
	const completed = completeSourceImport(initial, draft)!;
	expect(completed.markdown).toContain('Original description'); expect(completed.markdown).toContain('First sentence');
	const edited = completeSourceImport(initial, draft, 'My new introduction')!;
	expect(edited.markdown).toMatch(/^My new introduction/); expect(edited.markdown).toContain('First sentence');
	expect(edited.markdown).toContain('Original description');
	expect(completeSourceImport(completed, draft)).toBeUndefined();
	const other = { ...draft, local: { ...draft.local, requestId: 'another' } };
	expect(completeSourceImport(initial, other)).toBeUndefined();
});

it('focuses an existing writer tab and refuses external or unrelated handoff URLs', async () => {
	vi.mocked(browser.tabs.query).mockResolvedValueOnce([{ id: 42, windowId: 7, url: 'chrome-extension://fixture/write.html?id=test' } as any]);
	await openSourcePage('chrome-extension://fixture/write.html?id=test');
	expect(browser.tabs.update).toHaveBeenCalledWith(42, { active: true }); expect(browser.tabs.create).not.toHaveBeenCalled();
	await openSourcePage('https://example.com/write.html');
	await openSourcePage('chrome-extension://other/write.html');
	await openSourcePage('chrome-extension://fixture/settings.html');
	expect(browser.tabs.query).toHaveBeenCalledTimes(1);
});
