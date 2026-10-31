import browser from '../../utils/browser-polyfill';
import { t } from '../../utils/ui-text';
import { h, toast } from '../editor/dom';
import { saveImage } from '../images';
import { ASPECTS, imageModelName, loadImageModels, modelsOf, readyModels, serviceName, type ImageModelConfig } from '../image-models';
import { getLocalStorage, setLocalStorage } from '../../utils/storage-utils';

import { submitImageJob, cancelImageJob, watchImageJobs, imageJobLabel, openImageLibrary } from '../../utils/image-jobs';
import { readImageJob, readLibraryBlob } from '../../utils/image-library-store';
import { openImageLibraryDialog } from '../../utils/image-library';
import { describeImageError } from '../../utils/image-generation-error';
export { describeImageError } from '../../utils/image-generation-error';

export interface ImageApply { label: string; run: (imageId: string, prompt: string) => void | Promise<void> }
export interface ImageDialogOptions { title?: string; prompt?: string; aspect?: string; autoRun?: boolean; applies: ImageApply[]; configId?: string; modelId?: string; onComplete?: () => void | Promise<void> }

export const openImageSettings = () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html?section=image-models') }); };

// Describe a picture, pick a shape, look at the result, then decide where it goes.
export async function openImageDialog(options: ImageDialogOptions): Promise<void> {
	const store = await loadImageModels();
	const models = readyModels(store);
	const dialog = h('dialog', { class: 'qw-dialog qw-image-dialog', 'aria-label': options.title ?? t('AI 配图') });
	let unwatch: (() => void) | undefined, closed = false;
	const close = () => { closed = true; unwatch?.(); if (url) URL.revokeObjectURL(url); dialog.close(); dialog.remove(); };
	let jobId = '', pending = false;
	let url = '';
	const title = h('h2', { class: 'qw-dialog-title', text: options.title ?? t('AI 配图') });
	dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
	document.body.append(dialog);

	if (!models.length) {
		const go = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('去添加生图模型') });
		go.addEventListener('click', () => { close(); openImageSettings(); });
		const cancel = h('button', { type: 'button', class: 'qw-btn', text: t('取消'), onclick: close });
		dialog.append(title, h('p', { class: 'qw-dialog-note', text: t('还没有可用的生图模型。添加一个以后，就能在这里生成配图和封面。') }), h('div', { class: 'qw-dialog-actions' }, cancel, go));
		dialog.showModal();
		return;
	}

	const prompt = h('textarea', { class: 'qw-field', rows: 4, placeholder: t('描述想要的画面、风格和构图'), spellcheck: false });
	prompt.value = options.prompt ?? '';
	const aspect = h('select', { class: 'qw-field', 'aria-label': t('画面比例') });
	for (const a of ASPECTS) aspect.append(h('option', { value: a, text: a }));
	aspect.value = options.aspect && (ASPECTS as readonly string[]).includes(options.aspect) ? options.aspect : '16:9';
	// Every model of every connected service, grouped by service; the last choice is remembered.
	const model = h('select', { class: 'qw-field', 'aria-label': t('生图模型') });
	const choices: { key: string; config: ImageModelConfig; modelId: string }[] = [];
	for (const config of models) {
		const group = h('optgroup', { label: serviceName(config) });
		for (const modelId of modelsOf(config)) { const key = `${config.id}\u0000${modelId}`; choices.push({ key, config, modelId }); group.append(h('option', { value: key, text: imageModelName(config, modelId) })); }
		model.append(group);
	}
	const fallback = models.find(m => m.id === store.defaultId) ?? models[0];
	const remembered = String(await getLocalStorage('qiaomuWriteImageChoice') ?? '');
	const preferred = `${options.configId}\u0000${options.modelId}`;
	model.value = choices.some(c => c.key === preferred) ? preferred : choices.some(c => c.key === remembered) ? remembered : `${fallback.id}\u0000${fallback.model}`;
	const status = h('p', { class: 'qw-dialog-note', role: 'status', 'aria-live': 'polite' });
	const preview = h('div', { class: 'qw-image-preview', hidden: true });
	const generate = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('生成') });
	const cancel = h('button', { type: 'button', class: 'qw-btn', text: t('关闭'), onclick: close });
	const applies = options.applies.map(apply => { const b = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: apply.label, hidden: true }); return { apply, b }; });
	let blob: Blob | undefined;

	const stop = h('button', { type: 'button', class: 'qw-btn', text: t('停止生成'), hidden: true });
	stop.onclick = () => { if (jobId) void cancelImageJob(jobId).catch(error => { status.textContent = describeImageError(error); }); };
	const library = h('button', { type: 'button', class: 'qw-btn', text: t('图库'), onclick: () => {
		if (options.applies.length) openImageLibraryDialog(async (selected, name) => {
			const image = await saveImage(selected, name); await options.applies[0].run(image.id, name);
		}); else openImageLibrary();
	} });
	let shownImage = '';
	const refresh = async () => {
		if (!jobId) return;
		const id = jobId, job = await readImageJob(id);
		if (closed || id !== jobId || !job) return;
		const running = ['queued', 'running'].includes(job.state);
		generate.disabled = pending || running; stop.hidden = !running;
		prompt.disabled = model.disabled = aspect.disabled = pending || running;
		cancel.textContent = running ? t('移到后台') : t('关闭');
		generate.textContent = running ? t('生成中…') : blob ? t('重新生成') : t('生成');
		status.textContent = job.error ? describeImageError(new Error(job.error)) : imageJobLabel(job.state);
		if (job.state !== 'ready' || !job.imageId || shownImage === job.imageId) return;
		const result = await readLibraryBlob(job.imageId);
		if (closed || id !== jobId || !result) return;
		blob = result; shownImage = job.imageId;
		if (url) URL.revokeObjectURL(url);
		url = URL.createObjectURL(blob); preview.replaceChildren(h('img', { src: url, alt: job.prompt })); preview.hidden = false;
		applies.forEach(({ b }) => { b.hidden = false; }); generate.textContent = t('重新生成');
		void options.onComplete?.();
	};
	const safeRefresh = () => { void refresh().catch(error => { if (!closed) status.textContent = describeImageError(error); }); };
	unwatch = watchImageJobs(safeRefresh);
	const run = async () => {
		if (pending || generate.disabled) return;
		const text = prompt.value.trim();
		if (!text) { status.textContent = t('先写下想要的画面'); prompt.focus(); return; }
		const choice = choices.find(c => c.key === model.value) ?? choices[0];
		void setLocalStorage('qiaomuWriteImageChoice', choice.key);
		pending = true; generate.disabled = true; prompt.disabled = model.disabled = aspect.disabled = true;
		status.textContent = t('关闭窗口后继续生成，结果保存在图库。');
		try {
			jobId = crypto.randomUUID();
			await submitImageJob({ id: jobId, prompt: text, aspect: aspect.value, configId: choice.config.id, modelId: choice.modelId });
		} catch (error) { if (!closed) status.textContent = describeImageError(error); }
		finally { pending = false; if (!closed) { generate.disabled = false; prompt.disabled = model.disabled = aspect.disabled = false; safeRefresh(); } }
	};
	generate.addEventListener('click', () => void run());
	for (const { apply, b } of applies) {
		b.addEventListener('click', async () => {
			if (!blob) return;
			b.disabled = true;
			try { const image = await saveImage(blob, 'ai-image.png'); await apply.run(image.id, prompt.value.trim()); close(); }
			catch { toast(t('这张图片没能保存'), 'error'); b.disabled = false; }
		});
	}
	const row = h('div', { class: 'qw-image-row' }, aspect, choices.length > 1 ? model : null);
	dialog.append(title, prompt, row, status, preview, h('div', { class: 'qw-dialog-actions' }, library, cancel, stop, generate, ...applies.map(({ b }) => b)));
	dialog.showModal();
	prompt.focus();
	if (options.autoRun && prompt.value.trim()) void run();
}
