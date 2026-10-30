import browser from '../../utils/browser-polyfill';
import { t } from '../../utils/ui-text';
import { h, toast } from '../editor/dom';
import { recordPublish } from '../articles';
import { fetchRemoteMedia, getImage } from '../images';
import { latexToPng, mermaidToPng } from '../render-assets';
import * as shared from '../../x-publish/shared';
import { whileActive, stopped as checkStopped } from '../../x-publish/stop';
import { describeXMediaMessage } from '../../x-publish/media-messages';
import { connect, injectEngine, openComposeTab } from '../../x-publish/driver';
import { LOCAL_IMAGE_HOST, localImageId, prepareForX } from './x-prepare';
import type { Publisher, PublishRequest } from './types';

const MAX_EDGE = 4096;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;

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
	if (!blob.size) throw new Error(t('图片文件为空，请重新添加这张图片'));
	let out = blob;
	let mime = (blob.type || shared.extensionMime(name, 'image/png')).split(';')[0].trim().toLowerCase();
	if (mime.startsWith('video/')) {
		if (mime !== 'video/mp4') throw new Error(t('视频格式暂不支持，请使用 MP4'));
		if (blob.size > MAX_VIDEO_BYTES) throw new Error(t('视频超过 32MB，请压缩后再添加'));
		return { base64: await blobToBase64(blob), mime, fileName: `${name.split(/[?#]/)[0].replace(/\.[a-z0-9]{2,5}$/i, '') || 'video'}.mp4`, bytes: blob.size };
	}
	if (mime === 'image/gif' && blob.size > MAX_BYTES) throw new Error(t('GIF 超过 15MB，请压缩后再添加，动图会保留'));
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
const describe = (text: string) => { for (const [pattern, make] of PROGRESS_TEXT) { const m = text.match(pattern); if (m) return make(m); } return describeXMediaMessage(text); };

function openProgress(onStop: () => void, onClose: () => void) {
	const dialog = h('dialog', { class: 'qw-dialog', 'aria-label': t('发到 X 文章') });
	const title = h('h2', { class: 'qw-dialog-title', text: t('正在发到 X 文章') });
	const line = h('p', { class: 'qw-dialog-note', role: 'status', 'aria-live': 'polite', text: t('正在准备…') });
	line.style.whiteSpace = 'pre-line';
	const actions = h('div', { class: 'qw-dialog-actions' });
	actions.style.flexWrap = 'wrap';
	const stop = h('button', { type: 'button', class: 'qw-btn', text: t('停止') });
	stop.addEventListener('click', () => { stop.disabled = true; line.textContent = t('正在停止…'); onStop(); });
	actions.append(stop);
	dialog.append(title, line, actions);
	dialog.addEventListener('cancel', event => event.preventDefault());
	document.body.append(dialog);
	dialog.showModal();
	const closeDialog = () => { dialog.close(); dialog.remove(); onClose(); };
	return {
		close: closeDialog,
		update: (text: string) => { line.textContent = text; },
		finish: (heading: string, text: string, buttons: HTMLElement[] = []) => {
			title.textContent = heading; line.textContent = text; actions.textContent = '';
			const close = h('button', { type: 'button', class: 'qw-btn', text: t('关闭') });
			close.addEventListener('click', closeDialog);
			actions.append(close, ...buttons);
		},
	};
}

// ---- the publisher -----------------------------------------------------------------------------------------------------------
let publishing = false;
interface RetryOptions { forceNew?: boolean; resumeTabId?: number; files?: Map<string, XFile | { error: string }>; sourceMarkdown?: string }
export async function publishToX(request: PublishRequest, retryOptions: RetryOptions = {}): Promise<void> {
	if (publishing) { toast(t('X 正在处理上一次写入，请稍后重试'), 'error'); return; }
	const { article } = request;
	if (!article.markdown.trim() && !article.title.trim()) { toast(t('文章还是空的'), 'error'); return; }
	const prepared = prepareForX(article);
	const parsed = shared.parseMarkdown(prepared.markdown, { setTitle: true, setCover: true });
	const estimate = shared.articleMediaEstimate(parsed, { setCover: true });
	if (estimate.overSoftLimit) { toast(t('图片、视频、表格和图表共 {0} 项，超过 X 文章稳妥的 {1} 项，请删减后再发', [estimate.total, shared.ARTICLE_MEDIA_POLICY.limit]), 'error'); return; }
	if (!parsed.title) toast(t('文章还没有标题，X 里需要补上才能发布'));
	publishing = true;

	let port: Awaited<ReturnType<typeof connect>> | undefined;
	let stopped = false, keepConnection = false, retired = false;
	let targetTabId: number | undefined;
	let recover: ((resume: boolean) => void) | undefined;
	const controller = new AbortController();
	const disconnect = () => { try { port?.disconnect(); } catch { /* gone */ } port=undefined; };
	const retire = () => { retired = true; keepConnection = false; disconnect(); };
	const progress = openProgress(() => { stopped = true; controller.abort(); try { port?.postMessage({ type: 'cancel' }); } catch { /* gone */ } }, retire);
	const files = retryOptions.sourceMarkdown === prepared.markdown && retryOptions.files ? retryOptions.files : new Map<string, XFile | { error: string }>();
	const finishFailure = (heading: string, text: string, recovery?: { completed: number; total: number }) => {
		const buttons: HTMLElement[] = [];
		recover = resume => { if(retired || publishing)return;progress.close();void publishToX(request,{forceNew:!resume,resumeTabId:resume?targetTabId:undefined,files,sourceMarkdown:prepared.markdown}); };
		if(recovery && targetTabId) { const next=h('button',{type:'button',class:'qw-btn qw-btn-primary',text:t('继续剩余')});next.addEventListener('click',()=>recover?.(true));buttons.push(next);text += `\n${t('已保留 {0}/{1} 项媒体，可继续剩余。',[recovery.completed,recovery.total])}`; }
		const retry=h('button',{type:'button',class:recovery?'qw-btn':'qw-btn qw-btn-primary',text:t('重新写入')});retry.addEventListener('click',()=>recover?.(false));buttons.push(retry);
		if(targetTabId){const inspect=h('button',{type:'button',class:'qw-btn',text:t('去 X 检查草稿')});inspect.addEventListener('click',()=>{void browser.tabs.update(targetTabId!,{active:true});});buttons.push(inspect);}
		keepConnection = Boolean(port);
		progress.finish(heading,`${text}\n${t('重新写入会创建新草稿，当前草稿会保留。')}`,buttons);
	};
	try {
		// 1. every picture the article needs, resolved here: the X tab cannot reach the local store.
		const sources = [...new Set([...parsed.segments.filter(s => (s.type === 'image' || s.type === 'video') && s.source).map(s => String(s.source)), ...(parsed.cover ? [parsed.cover] : [])])];
		let done = 0;
		for (const source of sources) {
			if (stopped) throw Object.assign(new Error('stopped'), { stopped: true });
			progress.update(t('正在准备媒体 {0}/{1}…', [++done, sources.length]));
			try {
				if(files.get(source) && !('error' in files.get(source)!))continue;
				if (source.startsWith('data:')) continue;
				const local = localImageId(source);
				const generated = prepared.generated.find(g => g.source === source);
				let blob: Blob;
				let name = shared.guessFileName(source, 'media');
				if (generated) blob = await whileActive(generated.kind === 'mermaid' ? mermaidToPng(generated.code) : latexToPng(generated.code, generated.display),controller.signal);
				else if (local) { const image = await whileActive(getImage(local),controller.signal); if (!image) throw new Error(t('本地图片已丢失')); blob = image.blob; name = image.name || `${local}.png`; }
				else if (shared.isRemoteHttpImageSource(source)) blob = await fetchRemoteMedia(source, controller.signal);
				else throw new Error(t('不支持的图片地址'));
				files.set(source, await whileActive(toXFile(blob, name),controller.signal));
			} catch (error) { checkStopped(controller.signal); files.set(source, { error: (error as Error).message || String(error) }); }
		}

		// 2. the X tab and the engine inside it.
		if (stopped) throw Object.assign(new Error('stopped'), { stopped: true });
		progress.update(t('正在打开 X 文章…'));
		const tabId = targetTabId = retryOptions.resumeTabId ?? await whileActive(openComposeTab(controller.signal),controller.signal);
		checkStopped(controller.signal);
		await whileActive(injectEngine(tabId,controller.signal),controller.signal);
		checkStopped(controller.signal);
		port = await whileActive(connect(tabId,controller.signal),controller.signal);
		checkStopped(controller.signal);
		const result = await new Promise<{ ok: boolean; message?: string; summary?: any; cancelled?: boolean; stopUnconfirmed?: boolean; recovery?: {completed:number;total:number} }>(resolve => {
			let stopTimer: ReturnType<typeof setTimeout> | undefined;
			const stopWait = () => { stopTimer=setTimeout(()=>settle({ok:false,cancelled:true,stopUnconfirmed:true}),15000); };
			const settle: typeof resolve = result => { clearTimeout(stopTimer);controller.signal.removeEventListener('abort',stopWait);resolve(result); };
			controller.signal.addEventListener('abort',stopWait,{once:true});
			port!.onMessage.addListener((message: any) => {
				if(message?.type==='retry-request'){recover?.(false);return;}
				if(message?.type==='resume-request'){recover?.(true);return;}
				if(message?.type==='dismiss'){disconnect();return;}
				if (message?.type === 'progress' && !stopped) progress.update(describe(String(message.text || '')));
				else if (message?.type === 'done') settle({ ok: true, message: message.message, summary: message.summary });
				else if (message?.type === 'cancelled') settle({ ok: false, cancelled: true, recovery: message.recovery, stopUnconfirmed: message.stopUnconfirmed });
				else if (message?.type === 'error') settle({ ok: false, message: message.error, recovery: message.recovery });
			});
			port!.onDisconnect.addListener(() => settle({ ok: false, message: t('和 X 页面的连接断开了，可能是页面被刷新或关闭') }));
			for (const [source, file] of files) {
				if ('error' in file) port!.postMessage({ type: 'imageError', source, error: file.error });
				else port!.postMessage({ type: 'image', source, ...file });
			}
			port!.postMessage({ type: 'run', markdown: prepared.markdown, resume: Boolean(retryOptions.resumeTabId), forceNew: Boolean(retryOptions.forceNew) });
		});

		if (result.ok) {
			const record = { at: Date.now(), url: result.summary?.url as string | undefined, remoteId: result.summary?.articleId as string | undefined };
			await recordPublish(article.id, 'x', record);
			request.onRecorded(record);
			const open = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('去 X 检查草稿') });
			open.addEventListener('click', () => { void browser.tabs.update(tabId, { active: true }); });
			progress.finish(t('已写入 X 草稿'), result.message ?? t('草稿已写入，请在 X 里检查后再发布。'), [open]);
			void browser.tabs.update(tabId, { active: true }).catch(() => {});
		} else finishFailure(result.stopUnconfirmed ? t('停止尚未确认') : result.cancelled ? t('已停止') : t('没能写入 X'), result.stopUnconfirmed ? t('停止请求已发送，请先检查 X 草稿后再重试。') : result.cancelled ? t('已停止后续写入，已完成的内容保留在 X 草稿中。') : (result.message ? describeXMediaMessage(result.message) : t('未知原因')), result.recovery);
	} catch (error) {
		if ((error as { stopped?: boolean }).stopped) finishFailure(t('已停止'), t('没有写入 X。'));
		else finishFailure(t('没能写入 X'), (error as Error).message || String(error));
	} finally { publishing = false; if(!keepConnection)disconnect(); }
}

export const xPublisher: Publisher = {
	id: 'x',
	label: () => t('发到 X 文章'),
	hint: () => t('在 X 里新建一篇草稿，由你检查后发布'),
	run: publishToX,
};
export { LOCAL_IMAGE_HOST };
