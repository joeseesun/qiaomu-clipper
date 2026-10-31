// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import { buildExtensions } from './extensions';
import { parseEmbedUrl } from './markdown-plugins';
import { editorMarkdown } from '../markdown-io';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function roundTrip(markdown: string): string {
	editor = new Editor({ element: document.createElement('div'), extensions: buildExtensions({ resolveImage: async () => undefined }), content: markdown });
	return editorMarkdown(editor);
}

const same = (markdown: string) => expect(roundTrip(markdown)).toBe(markdown);

it('keeps headings, emphasis, links, quotes and lists', () => {
	same('# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code` with a [link](https://example.com).\n\n> quoted\n\n- one\n- two\n\n1. first\n2. second');
});

it('keeps task lists, rules and tables', () => {
	same('- [x] done\n- [ ] todo\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
});

it('keeps fenced code with its language, including mermaid', () => {
	same('```ts\nconst a = 1;\n```\n\n```mermaid\ngraph TD\n  A-->B\n```');
});

it('keeps local images, and a resized image as an html tag', () => {
	same('![cover](qm-image://img_abc123)');
	const resized = roundTrip('<img src="qm-image://img_abc123" alt="x" width="320">');
	expect(resized).toContain('width="320"');
	expect(resized).toContain('qm-image://img_abc123');
});

it('keeps inline and block formulas but leaves money alone', () => {
	same('Energy is $E=mc^2$ here.\n\n$$\n\\int_0^1 x^2 dx\n$$');
	const money = roundTrip('It costs $5 and then $10 more.');
	expect(money).not.toContain('math');
	expect(money.replace(/\\/g, '')).toContain('$5 and then $10');
});

it('turns a link alone on its line into an embedded card and writes it back as that link', () => {
	same('Intro\n\nhttps://x.com/vista8/status/1234567890\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nOutro');
	expect(editor!.getJSON().content!.filter(n => n.type === 'embed').length).toBe(2);
	const inline = roundTrip('See https://x.com/vista8/status/1234567890 for more');
	expect(editor!.getJSON().content!.some(n => n.type === 'embed')).toBe(false);
	expect(inline).toContain('https://x.com/vista8/status/1234567890');
});

it('recognises the supported link shapes only', () => {
	expect(parseEmbedUrl('https://twitter.com/a/status/1')?.kind).toBe('tweet');
	expect(parseEmbedUrl('https://youtu.be/dQw4w9WgXcQ')?.kind).toBe('youtube');
	expect(parseEmbedUrl('https://www.bilibili.com/video/BV1xx411c7mD')?.kind).toBe('bilibili');
	expect(parseEmbedUrl('https://example.com/status/1')).toBeUndefined();
	expect(parseEmbedUrl('https://x.com/home')).toBeUndefined();
});
