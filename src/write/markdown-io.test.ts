import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { unzipSync, strFromU8 } from 'fflate';
import { blankArticle, saveArticle } from './articles';
import { resetDbConnection } from './db';
import { saveImage, imageIdsIn } from './images';
import { exportArticle, exportArticleZip, importMarkdownFiles, parseFrontMatter, safeFileName } from './markdown-io';

beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetDbConnection(); });
const png = (seed: string) => new Blob([seed], { type: 'image/png' });

it('reads front matter written here and by other tools, falling back to the first heading', () => {
	expect(parseFrontMatter('---\ntitle: "带 \\"引号\\" 的标题"\nauthor: 乔木\ndescription: 摘要\n---\n\n正文')).toMatchObject({ title: '带 "引号" 的标题', author: '乔木', digest: '摘要', markdown: '正文' });
	expect(parseFrontMatter('# 标题\n\n正文')).toMatchObject({ title: '标题', markdown: '正文' });
	expect(parseFrontMatter('没有标题').title).toBe('');
});

it('names files safely', () => {
	expect(safeFileName('a/b:c*d?')).toBe('a b c d');
	expect(safeFileName('   ')).toBe('untitled');
});

it('exports pictures as files next to the text and brings them back on import', async () => {
	const picture = await saveImage(png('picture-bytes'));
	const cover = await saveImage(png('cover-bytes'));
	const article = await saveArticle({ ...blankArticle(), title: '往返', markdown: `正文\n\n![图](qm-image://${picture.id})`, coverImageId: cover.id, author: '乔木' });
	const { markdown, images } = await exportArticle(article);
	expect(markdown).toContain(`![图](assets/${picture.id}.png)`);
	expect(markdown).toMatch(/cover: "assets\/img_/);
	expect(images.length).toBe(2);

	const zip = await exportArticleZip([article]);
	const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
	const names = Object.keys(files);
	expect(names.some(name => name.endsWith('往返.md'))).toBe(true);
	expect(names.filter(name => name.includes('/assets/')).length).toBe(2);

	resetDbConnection(); (globalThis as any).indexedDB = new IDBFactory();
	const file = new File([zip], 'backup.zip');
	const [back] = await importMarkdownFiles([file]);
	expect(back.title).toBe('往返');
	expect(back.author).toBe('乔木');
	expect(imageIdsIn(back.markdown).length).toBe(1);
	expect(back.coverPath).toMatch(/^img_/);
	expect(strFromU8(files[names.find(name => name.endsWith('.md'))!])).toContain('title: "往返"');
});

it('imports a loose Markdown file together with the pictures picked beside it', async () => {
	const file = new File(['# 来自别处\n\n![x](pics/a.png)\n\n![y](https://example.com/b.png)'], 'note.md', { type: 'text/markdown' });
	const image = new File(['pixels'], 'a.png', { type: 'image/png' });
	const [parsed] = await importMarkdownFiles([file, image]);
	expect(parsed.title).toBe('来自别处');
	expect(parsed.markdown).toContain('qm-image://');
	expect(parsed.markdown).toContain('https://example.com/b.png');
});
