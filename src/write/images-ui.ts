import type { Editor } from '@tiptap/core';
import { toast } from './editor/dom';
import { ACCEPTED_IMAGE_TYPES, ImageUrlCache, fetchRemoteImage, imageUrlFor, saveImage } from './images';
import { t } from '../utils/ui-text';

export const imageUrls = new ImageUrlCache();

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 80);

export async function insertImageFiles(editor: Editor, files: File[], at?: number): Promise<void> {
	let position = at;
	let failed = 0;
	for (const file of files) {
		if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) { failed++; continue; }
		try {
			const image = await saveImage(file, file.name);
			const node = { type: 'image', attrs: { src: imageUrlFor(image.id), alt: baseName(file.name) } };
			if (position === undefined) editor.chain().focus().insertContent(node).run();
			else { editor.chain().focus().insertContentAt(position, node).run(); position += 1; }
		} catch { failed++; }
	}
	if (failed) toast(t('{0} 张图片没能加入（格式不支持、超过 25MB 或保存失败）', [failed]), 'error');
}

export function pickImageFiles(editor: Editor): void {
	const input = document.createElement('input');
	input.type = 'file'; input.accept = ACCEPTED_IMAGE_TYPES.join(','); input.multiple = true;
	input.addEventListener('change', () => { if (input.files?.length) void insertImageFiles(editor, Array.from(input.files)); });
	input.click();
}

// Pictures that still live on the web are copied into the local store so the article keeps working offline and can be published as is.
export async function localizeRemoteImages(editor: Editor, quiet = false): Promise<void> {
	const targets: { src: string }[] = [];
	editor.state.doc.descendants(node => { if (node.type.name === 'image' && /^https?:/i.test(String(node.attrs.src))) targets.push({ src: String(node.attrs.src) }); });
	if (!targets.length) { if (!quiet) toast(t('文章里的图片都已经在本地了')); return; }
	let saved = 0; let failed = 0;
	for (const { src } of [...new Map(targets.map(item => [item.src, item])).values()]) {
		try {
			const blob = await fetchRemoteImage(src);
			const image = await saveImage(blob, src.split('/').pop()?.split('?')[0] ?? '');
			const local = imageUrlFor(image.id);
			const tr = editor.state.tr;
			editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image' && node.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: local }); });
			editor.view.dispatch(tr);
			saved++;
		} catch { failed++; }
	}
	if (!quiet || failed) toast(failed ? t('已保存 {0} 张图片，{1} 张下载失败（保留原链接）', [saved, failed]) : t('已把 {0} 张网络图片保存到本地', [saved]), failed ? 'error' : 'info');
}
