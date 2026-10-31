import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { ChevronDown, Link as LinkIcon, Sparkles } from 'lucide';
import { markCommands } from './commands';
import { allActions } from '../ai/actions';
import { h, icon } from './dom';
import type { AiAction, EditorHost } from './host';
import { t } from '../../utils/ui-text';

const key = new PluginKey('qw-bubble');

export function normalizeHref(raw: string): string {
	const value = raw.trim();
	if (!value) return '';
	if (/^(https?:|mailto:|tel:|#|\/)/i.test(value)) return value;
	return `https://${value}`;
}

// A small bar above selected text: bold, italic, link and the AI helper.
export const BubbleToolbar = Extension.create<{ host: EditorHost }>({
	name: 'bubbleToolbar',
	addOptions() { return { host: undefined as unknown as EditorHost }; },
	addProseMirrorPlugins() {
		const editor = this.editor;
		const host = this.options.host;
		const bar = h('div', { class: 'qw-bubble', role: 'toolbar', 'aria-label': t('文字格式') });
		let mode: 'marks' | 'link' = 'marks';
		let cachedActions: { id: string; name: string }[] = [];
		void allActions().then(list => { cachedActions = list; });
		let pointerDown = false;
		let aiMenu: HTMLElement | null = null;
		bar.addEventListener('mousedown', event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); });

		const closeAiMenu = () => { aiMenu?.remove(); aiMenu = null; };
		const hide = () => { bar.remove(); closeAiMenu(); mode = 'marks'; };

		const button = (title: string, content: Node, active: boolean, run: () => void) => {
			const el = h('button', { type: 'button', class: `qw-tool${active ? ' active' : ''}`, title, 'aria-label': title, 'aria-pressed': active ? 'true' : 'false' }, content);
			el.addEventListener('click', run);
			return el;
		};

		const renderLink = () => {
			bar.textContent = '';
			const current = editor.getAttributes('link').href as string | undefined;
			const input = h('input', { class: 'qw-bubble-input', type: 'text', placeholder: t('粘贴或输入链接'), spellcheck: false, 'aria-label': t('链接地址') });
			input.value = current ?? '';
			const apply = () => {
				const href = normalizeHref(input.value);
				if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); else editor.chain().focus().extendMarkRange('link').unsetLink().run();
				mode = 'marks'; sync(editor.view);
			};
			input.addEventListener('keydown', event => {
				if (event.isComposing) return;
				if (event.key === 'Enter') { event.preventDefault(); apply(); }
				if (event.key === 'Escape') { event.preventDefault(); mode = 'marks'; editor.commands.focus(); sync(editor.view); }
			});
			bar.append(input, h('button', { type: 'button', class: 'qw-bubble-text', text: t('确定'), onclick: apply }));
			if (current) bar.append(h('button', { type: 'button', class: 'qw-bubble-text', text: t('移除链接'), onclick: () => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); mode = 'marks'; sync(editor.view); } }));
			queueMicrotask(() => input.focus());
		};

		const renderMarks = () => {
			bar.textContent = '';
			for (const mark of markCommands) bar.append(button(mark.title, icon(mark.icon, 15), mark.isActive(editor), () => { mark.run(editor); sync(editor.view); }));
			bar.append(button(t('链接'), icon(LinkIcon, 15), editor.isActive('link'), () => { mode = 'link'; sync(editor.view); }));
			if (host.aiReady()) {
				const ai = h('button', { type: 'button', class: 'qw-tool qw-tool-ai', title: t('AI 帮我改'), 'aria-haspopup': 'menu' }, icon(Sparkles, 15), h('span', { text: 'AI' }), icon(ChevronDown, 12));
				ai.addEventListener('click', () => {
					if (aiMenu) { closeAiMenu(); return; }
					aiMenu = h('div', { class: 'qw-menu qw-ai-menu', role: 'menu' });
					const actions = [...cachedActions, { id: 'custom', name: t('按我的要求改…') }];
					for (const action of actions) {
						const row = h('div', { class: 'qw-menu-item', role: 'menuitem', tabindex: -1 }, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: action.name })));
						row.addEventListener('click', () => { closeAiMenu(); host.runAi(editor, action.id); });
						aiMenu.append(row);
					}
					const rect = ai.getBoundingClientRect();
					aiMenu.style.left = `${rect.left}px`; aiMenu.style.top = `${rect.bottom + 6}px`;
					aiMenu.addEventListener('mousedown', event => event.preventDefault());
					document.body.append(aiMenu);
				});
				bar.append(h('span', { class: 'qw-tool-sep' }), ai);
			}
		};

		function sync(view: import('@tiptap/pm/view').EditorView) {
			const { selection } = view.state;
			const insideBar = bar.contains(document.activeElement);
			const eligible = selection instanceof TextSelection && !selection.empty && !selection.$from.parent.type.spec.code && !(view.state.doc.textBetween(selection.from, selection.to).trim() === '');
			if (!eligible || pointerDown || (!view.hasFocus() && !insideBar)) { if (!insideBar || !eligible) hide(); return; }
			if (mode === 'link') renderLink(); else renderMarks();
			if (!bar.isConnected) document.body.append(bar);
			const start = view.coordsAtPos(selection.from);
			const end = view.coordsAtPos(selection.to);
			const width = bar.offsetWidth;
			const centre = (start.left + (start.top === end.top ? end.left : Math.max(start.left, end.right))) / 2;
			const left = Math.max(8, Math.min(window.innerWidth - width - 8, centre - width / 2));
			const above = start.top - bar.offsetHeight - 8;
			bar.style.left = `${left}px`;
			bar.style.top = `${above >= 8 ? above : end.bottom + 8}px`;
		}

		const release = () => { if (pointerDown) { pointerDown = false; sync(editor.view); } };
		document.addEventListener('mouseup', release);
		document.addEventListener('mousedown', event => { if (aiMenu && !aiMenu.contains(event.target as Node) && !bar.contains(event.target as Node)) closeAiMenu(); });

		return [new Plugin({
			key,
			props: { handleDOMEvents: { mousedown: () => { pointerDown = true; return false; }, blur: (view, event) => { if (!bar.contains((event as FocusEvent).relatedTarget as Node)) queueMicrotask(() => { if (!view.hasFocus() && !bar.contains(document.activeElement)) hide(); }); return false; } } },
			view: () => ({
				update: view => { if (mode === 'link' && !view.state.selection.empty) return; sync(view); },
				destroy: () => { document.removeEventListener('mouseup', release); hide(); },
			}),
		})];
	},
});
