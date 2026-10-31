import browser from '../../utils/browser-polyfill';
import { t } from '../../utils/ui-text';
import { h, toast } from '../editor/dom';
import { recordPublish } from '../articles';
import { fetchRemoteImage, getImage } from '../images';
import { latexToPng, mermaidToPng } from '../render-assets';
import * as shared from '../../x-publish/shared';
import { connect, injectEngine, openComposeTab } from '../../x-publish/driver';
import { LOCAL_IMAGE_HOST, localImageId, prepareForX } from './x-prepare';
import type { Publisher, PublishRequest } from './types';

const MAX_EDGE = 4096;
const MAX_BYTES = 15 * 1024 * 1024;

// ---- pictures: whatever the article holds, as something X accepts ------------------------------------------------------------
interface XFile { base64: string; mime: string; fileName: string; bytes: number }

async function blobToBase64(blob: Blob): Promise<string> { return shared.arrayBufferToBase64(await blob.arrayBuffer()); }

async function redraw(blob: Blob, type: 'image/png' | 'image/jpeg', maxEdge: number): Promise<Blob> {
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('unreadable picture')); image.src = url; });
		const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round((image.naturalWidth || 800) * ratio)); canvas.height = Math.max(1, Math.round((image.naturalHeight || 600) * ratio));
		const ctx = canvas.getContext('2d')!;
		if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) => canvas.toBlob(out => (out ? resolve(out) : reject(new Error('could not save picture'))), type, 0.9));
	} finally { URL.revokeObjectURL(url); }
}

// Formats X does not take (svg, bmp) and oversized pictures are redrawn; animated GIFs and ordinary pictures are sent untouched.
export async function toXFile(blob: Blob, name: string): Promise<XFile> {
	let out = blob;
	let mime = (blob.type || shared.extensionMime(name, 'image/png')).toLowerCase();
	if (!shared.isSupportedImageMime(mime) || mime === 'image/svg+xml') { out = await redraw(out, 'image/png', MAX_EDGE); mime = 'image/png'; }
	if (out.size > MAX_BYTES) { out = await redraw(out, 'image/jpeg', 2800); mime = 'image/jpeg'; }
	if (out.size > MAX_BYTES) throw new Error(t('图片超过 15MB，压缩后仍然太大'));
	const base = name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'image';
	return { base64: await blobToBase64(out), mime, fileName: `${base}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`, bytes: out.size };
}

// ---- progress window --------------------------------------------------------------------------------------------------------
const PROGRESS_TEXT: [RegExp, (m: RegExpMatchArray) => string][] = [
	[/^Setting title/i, () => t('正在设置标题…')],
	[/^Setting cover/i, () => t('正在设置封面…')],
	[/^Pasting structured/i, () => t('正在写入正文…')],
	[/^Inserting (\d+)/i, m => t('正在插入 {0} 个特殊块…', [m[1]])],
	[/^Uploading image (\d+)\/(\d+)/i, m => t('正在上传图片 {0}/{1}…', [m[1], m[2]])],
	[/^Retrying X image (\d+)\/(\d+)/i, m => t('图片 {0}/{1} 上传失败，正在重试…', [m[1], m[2]])],
	[/^Image (\d+)\/(\d+) is in the editor/i, m => t('图片 {0}/{1} 已放入编辑器…', [m[1], m[2]])],
	[/^Reordering/i, () => t('正在整理图片位置…')],
	[/^Cleaning up/i, () => t('正在收尾…')],
];
const describe = (text: string) => { for (const [pattern, make] of PROGRESS_TEXT) { const m = text.match(pattern); if (m) return make(m); } return text; };

function openProgress(onStop: () => void) {
	const dialog = h('dialog', { class: 'qw-dialog', 'aria-label': t('发到 X 文章') });
	const title = h('h2', { class: 'qw-dialog-title', text: t('正在发到 X 文章') });
	const line = h('p', { class: 'qw-dialog-note', role: 'status', 'aria-live': 'polite', text: t('正在准备…') });
	const actions = h('div', { class: 'qw-dialog-actions' });
	const stop = h('button', { type: 'button', class: 'qw-btn', text: t('停止') });
	stop.addEventListener('click', () => { stop.disabled = true; line.textContent = t('正在停止…'); onStop(); });
	actions.append(stop);
	dialog.append(title, line, actions);
	dialog.addEventListener('cancel', event => event.preventDefault());
	document.body.append(dialog);
	dialog.showModal();
	return {
		update: (text: string) => { line.textContent = text; },
		finish: (heading: string, text: string, buttons: HTMLElement[] = []) => {
			title.textContent = heading; line.textContent = text; actions.textContent = '';
			const close = h('button', { type: 'button', class: 'qw-btn', text: t('关闭') });
			close.addEventListener('click', () => { dialog.close(); dialog.remove(); });
			actions.append(close, ...buttons);
		},
	};
}

// ---- the publisher -----------------------------------------------------------------------------------------------------------
export async function publishToX(request: PublishRequest): Promise<void> {
	const { article } = request;
	if (!article.markdown.trim() && !article.title.trim()) { toast(t('文章还是空的'), 'error'); return; }
	const prepared = prepareForX(article);
	const parsed = shared.parseMarkdown(prepared.markdown, { setTitle: true, setCover: true });
	const estimate = shared.articleMediaEstimate(parsed, { setCover: true });
	if (estimate.overSoftLimit) { toast(t('图片、表格和图表共 {0} 项，超过 X 文章稳妥的 {1} 项，请删减后再发', [estimate.total, shared.ARTICLE_MEDIA_POLICY.limit]), 'error'); return; }
	if (!parsed.title) toast(t('文章还没有标题，X 里需要补上才能发布'));

	let port: Awaited<ReturnType<typeof connect>> | undefined;
	let stopped = false;
	const progress = openProgress(() => { stopped = true; try { port?.postMessage({ type: 'cancel' }); } catch { /* gone */ } });
	try {
		// 1. every picture the article needs, resolved here: the X tab cannot reach the local store.
		const sources = [...new Set([...parsed.segments.filter(s => s.type === 'image' && s.source).map(s => String(s.source)), ...(parsed.cover ? [parsed.cover] : [])])];
		const files = new Map<string, XFile | { error: string }>();
		let done = 0;
		for (const source of sources) {
			if (stopped) throw Object.assign(new Error('stopped'), { stopped: true });
			progress.update(t('正在准备图片 {0}/{1}…', [++done, sources.length]));
			try {
				if (source.startsWith('data:')) continue;
				const local = localImageId(source);
				const generated = prepared.generated.find(g => g.source === source);
				let blob: Blob;
				let name = source.split('/').pop() ?? 'image';
				if (generated) blob = generated.kind === 'mermaid' ? await mermaidToPng(generated.code) : await latexToPng(generated.code, generated.display);
				else if (local) { const image = await getImage(local); if (!image) throw new Error(t('本地图片已丢失')); blob = image.blob; name = image.name || `${local}.png`; }
				else if (shared.isRemoteHttpImageSource(source)) blob = await fetchRemoteImage(source);
				else throw new Error(t('不支持的图片地址'));
				files.set(source, await toXFile(blob, name));
			} catch (error) { files.set(source, { error: (error as Error).message || String(error) }); }
		}

		// 2. the X tab and the engine inside it.
		progress.update(t('正在打开 X 文章…'));
		const tabId = await openComposeTab();
		await injectEngine(tabId);
		port = await connect(tabId);
		const result = await new Promise<{ ok: boolean; message?: string; summary?: any; cancelled?: boolean }>(resolve => {
			port!.onMessage.addListener((message: any) => {
				if (message?.type === 'progress') progress.update(describe(String(message.text || '')));
				else if (message?.type === 'done') resolve({ ok: true, message: message.message, summary: message.summary });
				else if (message?.type === 'cancelled') resolve({ ok: false, cancelled: true });
				else if (message?.type === 'error') resolve({ ok: false, message: message.error });
			});
			port!.onDisconnect.addListener(() => resolve({ ok: false, message: t('和 X 页面的连接断开了，可能是页面被刷新或关闭') }));
			for (const [source, file] of files) {
				if ('error' in file) port!.postMessage({ type: 'imageError', source, error: file.error });
				else port!.postMessage({ type: 'image', source, ...file });
			}
			port!.postMessage({ type: 'run', markdown: prepared.markdown });
		});

		if (result.ok) {
			const record = { at: Date.now(), url: result.summary?.url as string | undefined, remoteId: result.summary?.articleId as string | undefined };
			await recordPublish(article.id, 'x', record);
			request.onRecorded(record);
			const open = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('去 X 检查草稿') });
			open.addEventListener('click', () => { void browser.tabs.update(tabId, { active: true }); });
			progress.finish(t('已写入 X 草稿'), result.message ?? t('草稿已写入，请在 X 里检查后再发布。'), [open]);
			void browser.tabs.update(tabId, { active: true }).catch(() => {});
		} else progress.finish(result.cancelled ? t('已停止') : t('没能写入 X'), result.cancelled ? t('X 里可能留下了写到一半的草稿，可以在文章列表里删除。') : result.message ?? t('未知原因'));
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) progress.finish(t('已停止'), t('没有写入 X。'));
		else progress.finish(t('没能写入 X'), (error as Error).message || String(error));
	} finally { try { port?.disconnect(); } catch { /* done */ } }
}

export const xPublisher: Publisher = {
	id: 'x',
	label: () => t('发到 X 文章'),
	hint: () => t('在 X 里新建一篇草稿，由你检查后发布'),
	run: publishToX,
};
export { LOCAL_IMAGE_HOST };
