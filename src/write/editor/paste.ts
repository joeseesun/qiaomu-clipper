import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorHost } from './host';
import { parseEmbedUrl } from './markdown-plugins';

const imageFiles = (list: FileList | null | undefined): File[] => Array.from(list ?? []).filter(file => file.type.startsWith('image/'));

// Pictures pasted or dropped go into the local store; a lone tweet / video link becomes a card; web pictures are saved locally.
export const PasteAndDrop = Extension.create<{ host: EditorHost }>({
	name: 'pasteAndDrop',
	addOptions() { return { host: undefined as unknown as EditorHost }; },
	addProseMirrorPlugins() {
		const editor = this.editor;
		const host = this.options.host;
		return [new Plugin({
			key: new PluginKey('qw-paste'),
			props: {
				handlePaste(view, event) {
					const files = imageFiles(event.clipboardData?.files);
					if (files.length) { event.preventDefault(); void host.insertImageFiles(editor, files); return true; }
					const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
					const { $from, empty } = view.state.selection;
					if (empty && text && !/\s/.test(text) && parseEmbedUrl(text) && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
						event.preventDefault();
						return editor.chain().focus().insertEmbed(text).run();
					}
					if (event.clipboardData?.types.includes('text/html') && /<img\b[^>]+src=["']https?:/i.test(event.clipboardData.getData('text/html'))) window.setTimeout(() => void host.localizeImages(editor, true), 80);
					return false;
				},
				handleDrop(view, event) {
					const files = imageFiles(event.dataTransfer?.files);
					if (!files.length) return false;
					event.preventDefault();
					const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
					void host.insertImageFiles(editor, files, at);
					return true;
				},
			},
		})];
	},
});
