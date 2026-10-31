import { Editor, Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import DragHandle from '@tiptap/extension-drag-handle';
import { ArrowDown, ArrowUp, CopyPlus, GripVertical, Image as ImageIcon, Plus, Trash2 } from 'lucide';
import { blockCommands, currentBlockId } from './commands';
import { h, icon } from './dom';
import type { EditorHost } from './host';
import { t } from '../../utils/ui-text';

const TURN_INTO = ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'task', 'quote', 'code'];

function positionOf(editor: Editor, node: PMNode): number | undefined {
	let found: number | undefined;
	editor.state.doc.forEach((child, offset) => { if (child === node) found = offset; });
	return found;
}

export function moveBlock(editor: Editor, pos: number, direction: -1 | 1): boolean {
	const { doc } = editor.state;
	const node = doc.nodeAt(pos);
	if (!node) return false;
	const index = doc.resolve(pos).index(0);
	const target = index + direction;
	if (target < 0 || target >= doc.childCount) return false;
	const sibling = doc.child(target);
	const tr = editor.state.tr;
	if (direction < 0) {
		const siblingPos = pos - sibling.nodeSize;
		tr.delete(pos, pos + node.nodeSize).insert(siblingPos, node);
		tr.setSelection(TextSelection.near(tr.doc.resolve(siblingPos + 1)));
	} else {
		const after = pos + node.nodeSize + sibling.nodeSize;
		tr.insert(after, node).delete(pos, pos + node.nodeSize);
		tr.setSelection(TextSelection.near(tr.doc.resolve(after - node.nodeSize + 1)));
	}
	editor.view.dispatch(tr.scrollIntoView());
	return true;
}

export function duplicateBlock(editor: Editor, pos: number): void {
	const node = editor.state.doc.nodeAt(pos);
	if (node) editor.view.dispatch(editor.state.tr.insert(pos + node.nodeSize, node.copy(node.content)));
}

export function deleteBlock(editor: Editor, pos: number): void {
	const node = editor.state.doc.nodeAt(pos);
	if (!node) return;
	const tr = editor.state.tr.delete(pos, pos + node.nodeSize);
	if (tr.doc.childCount === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
	editor.view.dispatch(tr);
}

// Hovering a block shows "+" (add below) and a grip: drag to move, click for the block menu.
export function createBlockHandle(host: EditorHost, onSetCover: (src: string) => void): Extension {
	let hovered: PMNode | null = null;
	let menu: HTMLElement | null = null;
	let activeEditor: Editor | null = null;
	const closeMenu = () => { menu?.remove(); menu = null; };

	const openMenu = (anchor: HTMLElement) => {
		const editor = activeEditor;
		const node = hovered;
		if (!editor || !node) return;
		const pos = positionOf(editor, node);
		if (pos === undefined) return;
		closeMenu();
		menu = h('div', { class: 'qw-menu qw-block-menu', role: 'menu' });
		menu.addEventListener('mousedown', event => event.preventDefault());
		const selectBlock = () => {
			if (node.isTextblock || node.type.name.endsWith('List') || node.type.name === 'blockquote') editor.chain().focus().setTextSelection(pos + 1).run();
			else editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
		};
		const row = (label: string, run: () => void, danger = false, active = false, ic?: Node) => {
			const el = h('div', { class: `qw-menu-item${danger ? ' danger' : ''}${active ? ' active' : ''}`, role: 'menuitem' }, ic ? h('span', { class: 'qw-menu-icon' }, ic) : null, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: label })));
			el.addEventListener('click', () => { closeMenu(); run(); });
			menu!.append(el);
		};
		const turnable = node.isTextblock && node.type.name !== 'codeBlock' || node.type.name === 'codeBlock' || node.type.name.endsWith('List') || node.type.name === 'blockquote';
		if (turnable) {
			menu.append(h('div', { class: 'qw-menu-label', text: t('转换为') }));
			selectBlock();
			const now = currentBlockId(editor);
			for (const command of blockCommands(host).filter(item => TURN_INTO.includes(item.id))) row(command.title, () => { selectBlock(); void command.run(editor, host); }, false, command.id === now, icon(command.icon));
			menu.append(h('div', { class: 'qw-menu-sep' }));
		}
		if (node.type.name === 'image') row(t('设为封面'), () => onSetCover(String(node.attrs.src)), false, false, icon(ImageIcon));
		row(t('在下方插入空行'), () => { editor.chain().focus().insertContentAt(pos + node.nodeSize, { type: 'paragraph' }).setTextSelection(pos + node.nodeSize + 1).run(); }, false, false, icon(Plus));
		row(t('复制这一块'), () => duplicateBlock(editor, pos), false, false, icon(CopyPlus));
		row(t('上移'), () => { moveBlock(editor, pos, -1); }, false, false, icon(ArrowUp));
		row(t('下移'), () => { moveBlock(editor, pos, 1); }, false, false, icon(ArrowDown));
		row(t('删除'), () => deleteBlock(editor, pos), true, false, icon(Trash2));
		const rect = anchor.getBoundingClientRect();
		document.body.append(menu);
		menu.style.left = `${rect.left}px`;
		menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
		const away = (event: MouseEvent) => { if (menu && !menu.contains(event.target as Node)) { closeMenu(); document.removeEventListener('mousedown', away, true); } };
		document.addEventListener('mousedown', away, true);
	};

	let handleEl: HTMLElement | null = null;
	return DragHandle.configure({
		render: () => {
			const plus = h('button', { type: 'button', class: 'qw-handle-btn', title: t('在下方添加'), 'aria-label': t('在下方添加') }, icon(Plus, 15));
			const grip = h('button', { type: 'button', class: 'qw-handle-btn grip', title: t('拖动移动，点击打开菜单'), 'aria-label': t('块菜单'), 'aria-haspopup': 'menu' }, icon(GripVertical, 15));
			plus.addEventListener('click', () => {
				const editor = activeEditor; const node = hovered;
				if (!editor || !node) return;
				const pos = positionOf(editor, node);
				if (pos === undefined) return;
				const at = pos + node.nodeSize;
				editor.chain().focus().insertContentAt(at, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).setTextSelection(at + 2).run();
			});
			grip.addEventListener('click', () => openMenu(grip));
			handleEl = h('div', { class: 'qw-handle' }, plus, grip);
			return handleEl;
		},
		computePositionConfig: { placement: 'left-start', strategy: 'absolute' },
		// The pointer leaves the block on its way to the handle; keep the last block so a click on the handle still knows its target.
		onNodeChange: ({ node, editor }) => {
			if (node) hovered = node;
			activeEditor = editor;
			// The buttons sit on the middle of the block's first line, whatever its size (a heading is taller than a paragraph).
			const pos = node ? positionOf(editor, node) : undefined;
			const dom = pos === undefined ? null : editor.view.nodeDOM(pos);
			if (handleEl && dom instanceof HTMLElement) {
				const style = getComputedStyle(dom);
				const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
				handleEl.style.height = `${Math.round(line)}px`;
			}
		},
	});
}
