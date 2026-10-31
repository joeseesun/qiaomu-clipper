import type { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser, Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

// Markdown from the AI (or anywhere else) becomes real editor nodes, not text. Parsing uses an inert document so nothing in it can run.
export function markdownToFragment(editor: Editor, markdown: string): Fragment {
	const html = ((editor.storage as any).markdown.parser.parse(markdown) as string) ?? '';
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return PMDOMParser.fromSchema(editor.schema).parse(doc.body, { preserveWhitespace: false }).content;
}

// A single plain paragraph replaces text in place; anything bigger goes in as blocks.
export function replaceWithMarkdown(editor: Editor, from: number, to: number, markdown: string): void {
	const content = markdownToFragment(editor, markdown);
	const only = content.childCount === 1 && content.firstChild!.type.name === 'paragraph' ? content.firstChild!.content : null;
	const tr = editor.state.tr;
	if (only) tr.replaceWith(from, to, only);
	else tr.replaceWith(from, to, content);
	editor.view.dispatch(tr.scrollIntoView());
}

export function insertMarkdownAt(editor: Editor, where: 'cursor' | 'start' | 'end', markdown: string): number {
	const content = markdownToFragment(editor, markdown);
	const { doc, selection } = editor.state;
	let pos: number;
	if (where === 'start') pos = 0;
	else if (where === 'end') pos = doc.content.size;
	else {
		const $to = selection.$to;
		pos = $to.depth === 0 ? $to.pos : $to.after(1);
		// An empty paragraph under the cursor is replaced rather than left behind.
		const block = $to.depth >= 1 ? $to.node(1) : null;
		if (block && block.type.name === 'paragraph' && block.content.size === 0) { const start = $to.before(1); editor.view.dispatch(editor.state.tr.replaceWith(start, start + block.nodeSize, content).scrollIntoView()); return start + content.size; }
	}
	const tr = editor.state.tr.insert(pos, content);
	tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + content.size, tr.doc.content.size)), -1));
	editor.view.dispatch(tr.scrollIntoView());
	return pos;
}

// Every text block with the document position of its first character, so quoted text can be located exactly.
export function textBlocks(editor: Editor): { start: number; text: string }[] {
	const blocks: { start: number; text: string }[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.isTextblock) { blocks.push({ start: pos + 1, text: node.textBetween(0, node.content.size, '', '￼') }); return false; }
		return true;
	});
	return blocks;
}
