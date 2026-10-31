import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BlockCommand, blockCommands } from './commands';
import { h, icon } from './dom';
import type { EditorHost } from './host';
import { t } from '../../utils/ui-text';

interface SlashState { range: { from: number; to: number } | null; query: string; index: number }
const key = new PluginKey<SlashState>('qw-slash');

// A Chinese IME turns "/" into "、" (or "／"); the writer meant the same thing.
export const SLASH_TRIGGER = /(?:^|\s)[/、／]([^\s/、／]{0,16})$/;

export function matchCommands(items: BlockCommand[], query: string): BlockCommand[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(item => item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q));
}

// Typing "/" at the start of a line, or after a space, opens the block menu; more letters narrow it down.
export const SlashMenu = Extension.create<{ host: EditorHost }>({
	name: 'slashMenu',
	addOptions() { return { host: undefined as unknown as EditorHost }; },
	addProseMirrorPlugins() {
		const editor = this.editor;
		const host = this.options.host;
		let menu: HTMLElement | null = null;
		let items: BlockCommand[] = [];

		const close = () => { menu?.remove(); menu = null; };
		const choose = (item: BlockCommand | undefined, range: { from: number; to: number }) => {
			if (!item) return;
			editor.chain().focus().deleteRange(range).run();
			close();
			void item.run(editor, host);
		};

		return [new Plugin<SlashState>({
			key,
			state: {
				init: () => ({ range: null, query: '', index: 0 }),
				apply(tr, previous, _old, state) {
					const meta = tr.getMeta(key) as Partial<SlashState> | undefined;
					if (meta) return { ...previous, ...meta };
					const { selection } = state;
					if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.name === 'codeBlock') return { range: null, query: '', index: 0 };
					const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, '￼');
					const match = before.match(SLASH_TRIGGER);
					if (!match) return { range: null, query: '', index: 0 };
					const slash = selection.from - match[1].length - 1;
					const same = previous.range && previous.range.from === slash && previous.query === match[1];
					return { range: { from: slash, to: selection.from }, query: match[1], index: same ? previous.index : 0 };
				},
			},
			props: {
				handleKeyDown(view, event) {
					const state = key.getState(view.state);
					if (!state?.range || !menu || !items.length || event.isComposing) return false;
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						const next = (state.index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
						view.dispatch(view.state.tr.setMeta(key, { index: next }));
						return true;
					}
					if (event.key === 'Enter' || event.key === 'Tab') { choose(items[state.index], state.range); return true; }
					if (event.key === 'Escape') { view.dispatch(view.state.tr.setMeta(key, { range: null, query: '', index: 0 })); return true; }
					return false;
				},
			},
			view: () => ({
				update(view) {
					const state = key.getState(view.state);
					if (!state?.range || !view.hasFocus()) { close(); return; }
					items = matchCommands(blockCommands(host), state.query);
					if (!items.length) { close(); return; }
					if (!menu) {
						menu = h('div', { class: 'qw-menu qw-slash', role: 'listbox', 'aria-label': t('插入内容') });
						menu.addEventListener('mousedown', event => event.preventDefault());
						document.body.append(menu);
					}
					menu.textContent = '';
					const range = state.range;
					items.forEach((item, index) => {
						const row = h('div', { class: `qw-menu-item${index === state.index ? ' active' : ''}`, role: 'option', 'aria-selected': index === state.index ? 'true' : 'false' },
							h('span', { class: 'qw-menu-icon' }, icon(item.icon)), h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: item.title }), h('span', { class: 'qw-menu-hint', text: item.hint })));
						row.addEventListener('click', () => choose(item, range));
						row.addEventListener('mousemove', () => { if (key.getState(view.state)?.index !== index) view.dispatch(view.state.tr.setMeta(key, { index })); });
						menu!.append(row);
					});
					const coords = view.coordsAtPos(state.range.from);
					const height = Math.min(menu.offsetHeight || 320, 320);
					const below = window.innerHeight - coords.bottom > height + 16;
					menu.style.left = `${Math.min(coords.left, window.innerWidth - 300)}px`;
					menu.style.top = `${below ? coords.bottom + 6 : Math.max(8, coords.top - height - 6)}px`;
					menu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
				},
				destroy: close,
			}),
		})];
	},
});
