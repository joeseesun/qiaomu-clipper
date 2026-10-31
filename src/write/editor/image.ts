import Image from '@tiptap/extension-image';
import { h } from './dom';
import { imageIdFromUrl } from '../images';
import { t } from '../../utils/ui-text';

export interface WriteImageOptions {
	// Turns qm-image://id into something an <img> can show (an object URL).
	resolve: (id: string) => Promise<string | undefined>;
}

const MIN_WIDTH = 80;

export const WriteImage = Image.extend<WriteImageOptions & Record<string, unknown>>({
	inline: false,
	group: 'block',
	draggable: true,
	addOptions() { return { ...(this.parent?.() ?? {}), resolve: async () => undefined } as never; },
	addAttributes() {
		return {
			...this.parent?.(),
			width: {
				default: null,
				parseHTML: el => { const value = parseInt(el.getAttribute('width') ?? '', 10); return Number.isFinite(value) && value > 0 ? value : null; },
				renderHTML: attrs => (attrs.width ? { width: attrs.width } : {}),
			},
		};
	},
	addStorage() {
		return {
			markdown: {
				serialize(state: any, node: any) {
					const { src, alt, title, width } = node.attrs;
					if (width) {
						const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
						state.write(`<img src="${esc(src)}" alt="${esc(alt ?? '')}"${title ? ` title="${esc(title)}"` : ''} width="${width}">`);
					} else {
						state.write(`![${(alt ?? '').replace(/[\[\]\n]/g, ' ')}](${String(src).replace(/[()\s]/g, encodeURIComponent)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`);
					}
					state.closeBlock(node);
				},
				parse: {},
			},
		};
	},
	addNodeView() {
		const resolve = this.options.resolve;
		return ({ node, editor, getPos }) => {
			const img = h('img', { draggable: false, alt: '' });
			const grip = h('span', { class: 'qw-image-grip', role: 'slider', 'aria-label': t('拖动调整图片宽度'), tabindex: 0 });
			const dom = h('figure', { class: 'qw-image' }, img, grip);
			dom.dataset.missing = t('图片文件已丢失');
			let current = node;
			const show = () => {
				img.alt = current.attrs.alt ?? '';
				if (current.attrs.title) img.title = current.attrs.title; else img.removeAttribute('title');
				img.style.width = current.attrs.width ? `${current.attrs.width}px` : '';
				const src = String(current.attrs.src ?? '');
				const id = imageIdFromUrl(src);
				if (id) { dom.classList.add('loading'); void resolve(id).then(url => { dom.classList.remove('loading'); if (url) img.src = url; else dom.classList.add('missing'); }); }
				else img.src = src;
			};
			show();
			const setWidth = (width: number | null) => {
				const pos = typeof getPos === 'function' ? getPos() : undefined;
				if (pos === undefined) return;
				editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width }));
			};
			grip.addEventListener('pointerdown', event => {
				event.preventDefault();
				const startX = event.clientX;
				const startWidth = img.getBoundingClientRect().width;
				const max = (dom.parentElement?.clientWidth ?? 900);
				grip.setPointerCapture(event.pointerId);
				const move = (e: PointerEvent) => { img.style.width = `${Math.round(Math.min(max, Math.max(MIN_WIDTH, startWidth + e.clientX - startX)))}px`; };
				const up = () => {
					grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
					const width = Math.round(img.getBoundingClientRect().width);
					setWidth(width >= max - 2 ? null : width);
				};
				grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
			});
			grip.addEventListener('keydown', event => {
				const step = event.shiftKey ? 50 : 10;
				const width = Math.round(img.getBoundingClientRect().width);
				if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(width + step); }
				if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(Math.max(MIN_WIDTH, width - step)); }
			});
			grip.addEventListener('dblclick', () => setWidth(null));
			return {
				dom,
				update(updated) {
					if (updated.type.name !== 'image') return false;
					const srcChanged = updated.attrs.src !== current.attrs.src;
					current = updated;
					if (srcChanged) show(); else { img.style.width = current.attrs.width ? `${current.attrs.width}px` : ''; img.alt = current.attrs.alt ?? ''; }
					return true;
				},
				selectNode() { dom.classList.add('selected'); },
				deselectNode() { dom.classList.remove('selected'); },
			};
		};
	},
});
