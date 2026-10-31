import type { Editor } from '@tiptap/core';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { getImages, imageIdsIn, saveImage } from './images';
import type { Article } from './types';

// What the editor holds, as Markdown. Task items stay tight (the serializer separates them with blank lines) and the text ends cleanly.
export function editorMarkdown(editor: Editor): string {
	const raw = (editor.storage as any).markdown.getMarkdown() as string;
	return raw.replace(/^([ \t]*- \[[ xX]\] .*)\n\n(?=[ \t]*- \[[ xX]\] )/gm, '$1\n').replace(/\s+$/, '');
}

export function safeFileName(title: string, fallback = 'untitled'): string {
	const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
	return name || fallback;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };

export interface ExportedFile { name: string; blob: Blob }

// Markdown whose pictures are plain files next to it (`assets/…`), readable by any other Markdown tool.
export async function exportArticle(article: Article): Promise<{ markdown: string; images: { path: string; blob: Blob }[] }> {
	const ids = imageIdsIn(article.markdown);
	if (article.coverImageId && !ids.includes(article.coverImageId)) ids.push(article.coverImageId);
	const stored = await getImages(ids);
	const paths = new Map<string, string>();
	const images = stored.map(image => {
		const path = `assets/${image.id}.${EXT[image.mime] ?? 'png'}`;
		paths.set(image.id, path);
		return { path, blob: image.blob };
	});
	let markdown = article.markdown.replace(/qm-image:\/\/([A-Za-z0-9_-]+)/g, (whole, id) => paths.get(id) ?? whole);
	const front: string[] = ['---', `title: ${JSON.stringify(article.title)}`];
	if (article.author) front.push(`author: ${JSON.stringify(article.author)}`);
	if (article.digest) front.push(`digest: ${JSON.stringify(article.digest)}`);
	if (article.sourceUrl) front.push(`source_url: ${JSON.stringify(article.sourceUrl)}`);
	if (article.coverImageId && paths.has(article.coverImageId)) front.push(`cover: ${JSON.stringify(paths.get(article.coverImageId))}`);
	front.push(`created: ${new Date(article.createdAt).toISOString()}`, `updated: ${new Date(article.updatedAt).toISOString()}`, '---', '');
	markdown = `${front.join('\n')}\n${markdown}\n`;
	return { markdown, images };
}

export async function exportArticleZip(articles: Article[]): Promise<Blob> {
	const files: Record<string, Uint8Array> = {};
	const used = new Set<string>();
	for (const article of articles) {
		let folder = safeFileName(article.title, 'untitled');
		for (let n = 2; used.has(folder); n++) folder = `${safeFileName(article.title, 'untitled')} ${n}`;
		used.add(folder);
		const { markdown, images } = await exportArticle(article);
		files[`${folder}/${folder}.md`] = strToU8(markdown);
		for (const image of images) files[`${folder}/${image.path}`] = new Uint8Array(await image.blob.arrayBuffer());
	}
	return new Blob([zipSync(files, { level: 1 }) as unknown as BlobPart], { type: 'application/zip' });
}

export interface ParsedMarkdown { title: string; markdown: string; author: string; digest: string; sourceUrl: string; coverPath: string }

// Reads the small front-matter block this app writes (and the common `title:` form of other tools).
export function parseFrontMatter(text: string): ParsedMarkdown {
	const result: ParsedMarkdown = { title: '', markdown: text, author: '', digest: '', sourceUrl: '', coverPath: '' };
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (match) {
		const read = (key: string) => {
			const line = match[1].split(/\r?\n/).find(l => new RegExp(`^${key}\\s*:`, 'i').test(l));
			if (!line) return '';
			const value = line.replace(/^[^:]+:\s*/, '').trim();
			try { return value.startsWith('"') ? String(JSON.parse(value)) : value.replace(/^'(.*)'$/, '$1'); } catch { return value; }
		};
		result.title = read('title'); result.author = read('author'); result.digest = read('digest') || read('description');
		result.sourceUrl = read('source_url') || read('source'); result.coverPath = read('cover');
		result.markdown = text.slice(match[0].length);
	}
	result.markdown = result.markdown.replace(/^\s+/, '');
	if (!result.title) {
		const heading = result.markdown.match(/^#\s+(.+)\n?/);
		if (heading) { result.title = heading[1].trim(); result.markdown = result.markdown.slice(heading[0].length).replace(/^\s+/, ''); }
	}
	return result;
}

// Pictures that sit next to an imported file (relative paths) are brought into the local store and re-pointed.
export async function adoptRelativeImages(markdown: string, lookup: (path: string) => Blob | undefined): Promise<string> {
	const found = new Map<string, string>();
	for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]+src="([^"]+)"/g)) {
		const path = match[1] ?? match[2];
		if (!path || /^(https?:|data:|qm-image:)/i.test(path) || found.has(path)) continue;
		const clean = decodeURIComponent(path).replace(/^\.\//, '');
		const blob = lookup(clean);
		if (!blob) continue;
		const image = await saveImage(blob, clean.split('/').pop() ?? '');
		found.set(path, `qm-image://${image.id}`);
	}
	let output = markdown;
	for (const [path, replacement] of found) output = output.split(path).join(replacement);
	return output;
}

export async function importMarkdownFiles(files: File[]): Promise<ParsedMarkdown[]> {
	const loose = new Map<string, Blob>();
	const docs: { name: string; text: string; lookup: (path: string) => Blob | undefined }[] = [];
	for (const file of files) {
		if (/\.zip$/i.test(file.name)) {
			const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
			const blobs = new Map<string, Blob>();
			for (const [path, data] of Object.entries(entries)) {
				const ext = path.split('.').pop()?.toLowerCase() ?? '';
				if (MIME[ext]) blobs.set(path, new Blob([data as unknown as BlobPart], { type: MIME[ext] }));
			}
			for (const [path, data] of Object.entries(entries)) {
				if (!/\.(md|markdown|txt)$/i.test(path) || path.includes('__MACOSX')) continue;
				const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
				docs.push({ name: path, text: strFromU8(data), lookup: rel => blobs.get(dir + rel) ?? blobs.get(rel) });
			}
		} else if (/\.(md|markdown|txt)$/i.test(file.name)) {
			docs.push({ name: file.name, text: await file.text(), lookup: rel => loose.get(rel.split('/').pop() ?? rel) });
		} else if (file.type.startsWith('image/')) loose.set(file.name, file);
	}
	const out: ParsedMarkdown[] = [];
	for (const doc of docs) {
		const parsed = parseFrontMatter(doc.text);
		if (!parsed.title) parsed.title = doc.name.split('/').pop()!.replace(/\.(md|markdown|txt)$/i, '');
		parsed.markdown = await adoptRelativeImages(parsed.markdown, doc.lookup);
		if (parsed.coverPath) {
			const blob = doc.lookup(decodeURIComponent(parsed.coverPath).replace(/^\.\//, ''));
			if (blob) parsed.coverPath = (await saveImage(blob)).id; else parsed.coverPath = '';
		}
		out.push(parsed);
	}
	return out;
}
