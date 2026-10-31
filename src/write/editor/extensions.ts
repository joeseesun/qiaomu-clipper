import type { Extensions } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WriteCodeBlock, lowlight } from './code-block';
import { Embed } from './embed';
import { WriteImage } from './image';
import { MathBlock, MathInline } from './math';
import { BubbleToolbar } from './bubble';
import { createBlockHandle } from './block-handle';
import type { EditorHost } from './host';
import { PasteAndDrop } from './paste';
import { SlashMenu } from './slash';
import { t } from '../../utils/ui-text';

export interface ExtensionOptions {
	resolveImage: (id: string) => Promise<string | undefined>;
	placeholder?: string;
	// Absent in tests and headless use: only the document model is built, no floating UI.
	host?: EditorHost;
	onSetCover?: (src: string) => void;
}

// The writing surface: CommonMark + tables, task lists, local images, code with highlighting, diagrams, formulas and embedded posts / videos.
export function buildExtensions(options: ExtensionOptions): Extensions {
	const interactive: Extensions = options.host ? [
		SlashMenu.configure({ host: options.host }),
		BubbleToolbar.configure({ host: options.host }),
		PasteAndDrop.configure({ host: options.host }),
		createBlockHandle(options.host, options.onSetCover ?? (() => {})),
	] : [];
	return [
		StarterKit.configure({
			codeBlock: false,
			link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
			heading: { levels: [1, 2, 3] },
		}),
		WriteCodeBlock.configure({ lowlight, defaultLanguage: null }),
		WriteImage.configure({ resolve: options.resolveImage, allowBase64: false }),
		Table.configure({ resizable: false }),
		TableRow, TableHeader, TableCell,
		TaskList,
		TaskItem.configure({ nested: true }),
		MathInline, MathBlock, Embed,
		Placeholder.configure({ placeholder: ({ node }) => node.type.name === 'paragraph' ? (options.placeholder ?? t('写点什么，输入 / 唤起命令')) : '' , includeChildren: false }),
		...interactive,
		Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false, transformPastedText: true, transformCopiedText: false }),
	];
}
