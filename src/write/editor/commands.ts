import type { Editor } from '@tiptap/core';
import { Bold, Code, ImagePlus, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, List, ListChecks, ListOrdered, Minus, Quote, Sigma, Sparkles, Strikethrough, Table, Type, Video, Workflow, SquareSigma, IconNode, FileCode2 } from 'lucide';
import { askText } from './dom';
import type { EditorHost } from './host';
import { parseEmbedUrl } from './markdown-plugins';
import { t } from '../../utils/ui-text';

export interface BlockCommand {
	id: string;
	title: string;
	hint: string;
	keywords: string;
	icon: IconNode;
	run: (editor: Editor, host: EditorHost) => void | Promise<void>;
}

const chain = (editor: Editor) => editor.chain().focus();

export function blockCommands(host: EditorHost): BlockCommand[] {
	const items: BlockCommand[] = [
		{ id: 'paragraph', title: t('正文'), hint: t('普通段落'), keywords: 'text paragraph zhengwen', icon: Type, run: e => { chain(e).setParagraph().run(); } },
		{ id: 'h1', title: t('大标题'), hint: '#', keywords: 'h1 heading title biaoti', icon: Heading1, run: e => { chain(e).setHeading({ level: 1 }).run(); } },
		{ id: 'h2', title: t('中标题'), hint: '##', keywords: 'h2 heading biaoti', icon: Heading2, run: e => { chain(e).setHeading({ level: 2 }).run(); } },
		{ id: 'h3', title: t('小标题'), hint: '###', keywords: 'h3 heading biaoti', icon: Heading3, run: e => { chain(e).setHeading({ level: 3 }).run(); } },
		{ id: 'bullet', title: t('无序列表'), hint: '-', keywords: 'ul bullet list liebiao', icon: List, run: e => { chain(e).toggleBulletList().run(); } },
		{ id: 'ordered', title: t('有序列表'), hint: '1.', keywords: 'ol ordered number list liebiao', icon: ListOrdered, run: e => { chain(e).toggleOrderedList().run(); } },
		{ id: 'task', title: t('待办列表'), hint: '[ ]', keywords: 'todo task check daiban', icon: ListChecks, run: e => { chain(e).toggleTaskList().run(); } },
		{ id: 'quote', title: t('引用'), hint: '>', keywords: 'quote blockquote yinyong', icon: Quote, run: e => { chain(e).toggleBlockquote().run(); } },
		{ id: 'code', title: t('代码块'), hint: '```', keywords: 'code codeblock daima', icon: Code, run: e => { chain(e).toggleCodeBlock().run(); } },
		{ id: 'mermaid', title: t('流程图'), hint: 'Mermaid', keywords: 'mermaid diagram flow chart liuchengtu tu', icon: Workflow, run: e => { chain(e).insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A[开始] --> B[结束]' }] }).run(); } },
		{ id: 'rule', title: t('分割线'), hint: '---', keywords: 'hr divider rule fenge', icon: Minus, run: e => { chain(e).setHorizontalRule().run(); } },
		{ id: 'table', title: t('表格'), hint: '3 × 3', keywords: 'table biaoge', icon: Table, run: e => { chain(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
		{ id: 'image', title: t('图片'), hint: t('从电脑选择，也可直接粘贴或拖入'), keywords: 'image picture photo tupian', icon: ImageIcon, run: (_e, h) => h.pickImages() },
		{ id: 'ai-image', title: t('AI 配图'), hint: t('描述画面，让 AI 生成'), keywords: 'ai image generate picture peitu shengtu', icon: ImagePlus, run: (e, h) => h.aiImage(e) },
		{ id: 'math', title: t('行内公式'), hint: '$x$', keywords: 'math formula inline gongshi', icon: Sigma, run: e => { chain(e).insertContent({ type: 'mathInline', attrs: { latex: '' } }).run(); } },
		{ id: 'math-block', title: t('公式块'), hint: '$$', keywords: 'math formula block latex gongshi', icon: SquareSigma, run: e => { chain(e).insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run(); } },
		{ id: 'embed', title: t('推文 / 视频链接'), hint: t('X 推文、YouTube、B 站'), keywords: 'tweet twitter x video youtube bilibili embed tuiwen shipin', icon: Video, run: async e => {
			const url = await askText({ title: t('嵌入推文或视频'), placeholder: 'https://x.com/…/status/…', confirm: t('嵌入'), cancel: t('取消'), note: t('支持 X 推文，以及 YouTube、B 站、Vimeo 视频链接') });
			if (url === undefined) { e.commands.focus(); return; }
			if (!parseEmbedUrl(url)) { e.commands.focus(); const { toast } = await import('./dom'); toast(t('这个链接不是支持的推文或视频'), 'error'); return; }
			chain(e).insertEmbed(url.trim()).run();
		} },
	];
	if (host.aiReady()) items.push({ id: 'ai-continue', title: t('AI 续写'), hint: t('接着当前内容往下写'), keywords: 'ai continue write xuxie', icon: Sparkles, run: (e, h) => h.runAi(e, 'continue') });
	return items;
}

export interface MarkCommand { id: string; title: string; icon: IconNode; isActive: (e: Editor) => boolean; run: (e: Editor) => void }

export const markCommands: MarkCommand[] = [
	{ id: 'bold', title: t('加粗'), icon: Bold, isActive: e => e.isActive('bold'), run: e => { e.chain().focus().toggleBold().run(); } },
	{ id: 'italic', title: t('斜体'), icon: Italic, isActive: e => e.isActive('italic'), run: e => { e.chain().focus().toggleItalic().run(); } },
	{ id: 'strike', title: t('删除线'), icon: Strikethrough, isActive: e => e.isActive('strike'), run: e => { e.chain().focus().toggleStrike().run(); } },
	{ id: 'code', title: t('行内代码'), icon: FileCode2, isActive: e => e.isActive('code'), run: e => { e.chain().focus().toggleCode().run(); } },
];

// The name of the block the cursor is in, for the "turn into" menu.
export function currentBlockId(editor: Editor): string {
	if (editor.isActive('heading', { level: 1 })) return 'h1';
	if (editor.isActive('heading', { level: 2 })) return 'h2';
	if (editor.isActive('heading', { level: 3 })) return 'h3';
	if (editor.isActive('taskList')) return 'task';
	if (editor.isActive('bulletList')) return 'bullet';
	if (editor.isActive('orderedList')) return 'ordered';
	if (editor.isActive('blockquote')) return 'quote';
	if (editor.isActive('codeBlock')) return 'code';
	return 'paragraph';
}
