import { Images, Sparkles, FolderOpen, Camera, Upload, Download, Trash2, Pencil, X, Plus, Settings2, RotateCcw, type IconNode } from 'lucide';
import { h, icon, askConfirm, askText } from '../write/editor/dom';
import { t } from './ui-text';
import { listLibraryImages, listImageJobs, readLibraryBlob, saveLibraryImage, inspectLibraryBlob, renameLibraryImage, removeLibraryImages, removeImageJob, listLibraryFolders, saveLibraryFolder, removeLibraryFolder, type LibraryImage, type LibraryFolder } from './image-library-store';
import { cancelImageJob, watchImageJobs, imageJobLabel } from './image-jobs';
import { describeImageError } from './image-generation-error';
import { folderPictures, loadUnsplashSource, saveUnsplashSource, searchUnsplash, downloadUnsplash, type UnsplashPhoto } from './image-library-sources';

type Tab = 'images' | 'tasks' | 'folders' | 'unsplash';
interface Entry {
	id: string; name: string; meta?: string; thumb?: string; blob: () => Promise<Blob | undefined>;
	credit?: { name: string; url: string }; source?: LibraryImage['source']; remove?: () => Promise<void>; rename?: (name: string) => Promise<void>;
}
export interface LibraryOptions { onPick?: (blob: Blob, name: string) => Promise<void>; initialTab?: string; initialQuery?: string }
const button = (label: string, action: () => void, glyph?: IconNode, compact = false) => h('button', { class: 'il-button', type: 'button', ...(compact ? { 'aria-label': label, title: label } : {}), onclick: action }, glyph ? icon(glyph) : null, compact ? null : label);

export function mountImageLibrary(root: HTMLElement, options: LibraryOptions = {}): () => void {
	root.classList.add('image-library');
	let tab: Tab = ['images', 'tasks', 'folders', 'unsplash'].includes(options.initialTab || '') ? options.initialTab as Tab : 'images';
	let alive = true, version = 0, shown = 48, entries: Entry[] = [], selected = new Set<string>(), urls: string[] = [];
	let folder: LibraryFolder | undefined, folderEntries: Entry[] = [], photos: UnsplashPhoto[] = [], photoPage = 1, photoQuery = '', request: AbortController | undefined;
	let observer: IntersectionObserver | undefined, busy = false;
	const title = h('h1', { text: t('图库') });
	const nav = h('nav', { class: 'il-tabs', 'aria-label': t('图库') });
	const generate = button(t('生成图片'), () => { void import('../write/ai/image-dialog').then(m => m.openImageDialog({ applies: [], onComplete: refresh })); }, Sparkles);
	generate.classList.add('il-primary');
	root.append(h('header', { class: 'il-header' }, title, generate), nav);
	const search = h('input', { class: 'il-field il-search', type: 'search', placeholder: t('搜索图片'), 'aria-label': t('搜索图片') });
	const filter = h('select', { class: 'il-field', 'aria-label': t('图片来源') });
	for (const [value, label] of [['all', t('全部')], ['generated', t('AI 生成')], ['upload', t('上传图片')], ['unsplash', 'Unsplash']]) filter.append(h('option', { value, text: label }));
	const tools = h('div', { class: 'il-tools' }), actions = h('div', { class: 'il-tools' });
	const status = h('p', { class: 'il-status', role: 'status', 'aria-live': 'polite' });
	const body = h('div', { class: 'il-body' });
	const picked = h('span'), selection = h('div', { class: 'il-selection', hidden: true }, picked);
	const importInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true });
	root.append(tools, actions, status, body, selection, importInput);
	function report(error: unknown) { if (alive) status.textContent = describeImageError(error); }
	async function act(run: () => Promise<void>) {
		if (busy) return; busy = true; root.setAttribute('aria-busy', 'true');
		try { await run(); } catch (error) { report(error); }
		finally { busy = false; root.removeAttribute('aria-busy'); }
	}
	function clean() { version++; observer?.disconnect(); for (const url of urls) URL.revokeObjectURL(url); urls = []; }
	const objectUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
	function selectionBar() {
		selection.replaceChildren(picked); selection.hidden = !selected.size; picked.textContent = t('已选择 {0} 张', [selected.size]);
		if (!selected.size) return;
		const chosen = entries.filter(e => selected.has(e.id));
		if (options.onPick) selection.append(button(t('插入文章'), () => void act(async () => {
			for (const entry of chosen) { const blob = await entry.blob(); if (!blob) throw new Error('empty-image'); await options.onPick!(blob, entry.name); }
		})));
		if (chosen.some(e => !e.id.startsWith('owned:'))) selection.append(button(t('保存到图库'), () => void act(async () => {
			for (const entry of chosen) await keep(entry);
			status.textContent = t('已保存'); selected.clear(); selectionBar();
		}), Download));
		if (chosen.every(e => e.remove)) selection.append(button(tab === 'folders' ? t('隐藏') : t('删除'), () => void removeEntries(chosen), Trash2));
		selection.append(button(t('取消'), () => { selected.clear(); draw(); }));
	}
	async function keep(entry: Entry): Promise<void> {
		if (entry.id.startsWith('owned:')) return;
		const blob = await entry.blob(); if (!blob) throw new Error('empty-image');
		const dimensions = await inspectLibraryBlob(blob), id = crypto.randomUUID();
		await saveLibraryImage(blob, { id, name: entry.name, created: Date.now(), source: entry.credit ? 'unsplash' : 'upload', credit: entry.credit, ...dimensions });
	}
	async function removeEntries(chosen: Entry[]) {
		if (tab !== 'folders' && !await askConfirm({ title: t('删除所选图片？'), note: t('只删除图库中的副本，已插入文章的图片不受影响。'), confirm: t('删除'), cancel: t('取消'), danger: true })) return;
		await act(async () => { for (const entry of chosen) await entry.remove?.(); selected.clear(); await refresh(); });
	}
	async function preview(entry: Entry) {
		const dialog = h('dialog', { class: 'il-preview image-library', 'aria-label': entry.name });
		let previewUrl = '', disposed = false;
		const close = () => { disposed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); dialog.close(); dialog.remove(); };
		dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
		const image = h('img', { alt: entry.name });
		const previewStatus = h('p', { role: 'status' });
		const controls = h('div', { class: 'il-tools' }, button(t('关闭'), close, X));
		dialog.append(h('h2', { text: entry.name }), image, previewStatus, controls);
		if (entry.credit) dialog.append(h('a', { href: entry.credit.url, target: '_blank', rel: 'noopener noreferrer', text: `${entry.credit.name} · Unsplash` }));
		document.body.append(dialog); dialog.showModal();
		try {
			// Unsplash previews stay hotlinked; download tracking happens only on a real selection.
			if (entry.thumb) image.src = entry.thumb;
			else { const blob = await entry.blob(); if (!blob || disposed) return; previewUrl = URL.createObjectURL(blob); image.src = previewUrl; }
			const run = (operation: (blob: Blob) => Promise<void>) => { void (async () => { try { const blob = await entry.blob(); if (!blob || disposed) return; await operation(blob); } catch (error) { previewStatus.textContent = describeImageError(error); } })(); };
			controls.append(button(t('下载图片'), () => run(async blob => {
				const url = URL.createObjectURL(blob), anchor = h('a', { href: url, download: entry.name.replace(/[\\/:*?"<>|]/g, '-') + (/\.(png|jpe?g|webp)$/i.test(entry.name) ? '' : blob.type === 'image/webp' ? '.webp' : blob.type === 'image/jpeg' ? '.jpg' : '.png') });
				anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
			}), Download));
			if (options.onPick) controls.append(button(t('插入文章'), () => run(async blob => { await options.onPick!(blob, entry.name); close(); })));
			if (!entry.id.startsWith('owned:')) controls.append(button(t('保存到图库'), () => { void keep(entry).then(() => { previewStatus.textContent = t('已保存'); }).catch(error => { previewStatus.textContent = describeImageError(error); }); }));
		} catch (error) { previewStatus.textContent = describeImageError(error); }
	}
	function draw() {
		clean(); body.replaceChildren(); const current = version;
		const query = search.value.trim().toLocaleLowerCase();
		const visible = entries.filter(e => (tab === 'unsplash' || e.name.toLocaleLowerCase().includes(query)) && (tab !== 'images' || filter.value === 'all' || e.source === filter.value));
		if (!visible.length) { body.append(h('div', { class: 'il-empty', text: query ? t('没有找到图片') : t('这里还没有图片') })); selectionBar(); return; }
		const grid = h('div', { class: 'il-grid' }); body.append(grid);
		const loaders = new Map<Element, () => void>();
		if (typeof IntersectionObserver !== 'undefined') observer = new IntersectionObserver(records => records.forEach(record => { if (record.isIntersecting) { loaders.get(record.target)?.(); loaders.delete(record.target); observer?.unobserve(record.target); } }), { rootMargin: '200px' });
		for (const entry of visible.slice(0, shown)) {
			const image = h('img', { alt: entry.name, loading: 'lazy' });
			const open = h('button', { class: 'il-thumb', type: 'button', 'aria-label': entry.name, onclick: () => void preview(entry) }, image);
			const checkbox = h('input', { type: 'checkbox', 'aria-label': t('选择图片'), checked: selected.has(entry.id) });
			checkbox.onchange = () => { if (checkbox.checked) selected.add(entry.id); else selected.delete(entry.id); selectionBar(); };
			const row = h('div', { class: 'il-card-actions' }, checkbox, h('span', { class: 'il-name', text: entry.name }));
			if (entry.rename) row.append(button(t('重命名'), () => void act(async () => {
				const name = await askText({ title: t('重命名'), value: entry.name, confirm: t('保存'), cancel: t('取消') });
				if (name?.trim()) { await entry.rename!(name); await refresh(); }
			}), Pencil, true));
			if (entry.remove) row.append(button(tab === 'folders' ? t('隐藏') : t('删除'), () => void removeEntries([entry]), Trash2, true));
			const card = h('article', { class: 'il-card' }, open, row);
			if (entry.credit) card.append(h('a', { class: 'il-meta', href: entry.credit.url, target: '_blank', rel: 'noopener noreferrer', text: `${entry.credit.name} · Unsplash` }));
			else if (entry.meta) card.append(h('p', { class: 'il-meta', text: entry.meta }));
			grid.append(card);
			const load = () => {
				if (entry.thumb) { image.src = entry.thumb; return; }
				void entry.blob().then(blob => { if (blob && alive && current === version) image.src = objectUrl(blob); }).catch(() => {});
			};
			if (observer) { loaders.set(open, load); observer.observe(open); } else load();
		}
		if (visible.length > shown) body.append(button(t('加载更多'), () => { shown += 48; draw(); }));
		if (tab === 'unsplash' && photos.length >= photoPage * 24) body.append(button(t('加载更多'), () => void findPhotos(true)));
		selectionBar();
	}
	function ownedEntry(entry: LibraryImage): Entry {
		return { id: `owned:${entry.id}`, name: entry.name, source: entry.source, meta: entry.modelLabel, credit: entry.credit, blob: () => readLibraryBlob(entry.id), rename: name => renameLibraryImage(entry.id, name), remove: () => removeLibraryImages([entry.id]) };
	}
	async function refresh(): Promise<void> {
		const target = tab, current = ++version;
		if (target === 'images') {
			const images = await listLibraryImages(); if (!alive || target !== tab || current !== version) return;
			entries = images.sort((a, b) => b.created - a.created).map(ownedEntry); draw();
		} else if (target === 'tasks') {
			const jobs = await listImageJobs(); if (!alive || target !== tab || current !== version) return;
			clean(); body.replaceChildren(); selection.hidden = true;
			if (!jobs.length) body.append(h('div', { class: 'il-empty', text: t('暂无生图任务') }));
			for (const job of jobs.sort((a, b) => b.created - a.created)) {
				const pending = ['queued', 'running'].includes(job.state);
				const controls = h('div', { class: 'il-tools' });
				if (pending) controls.append(button(t('停止生成'), () => void act(() => cancelImageJob(job.id))));
				else controls.append(button(t('重新生成'), () => void import('../write/ai/image-dialog').then(m => m.openImageDialog({ prompt: job.prompt, aspect: job.aspect, applies: [], configId: job.configId, modelId: job.modelId })), RotateCcw),
					button(t('删除记录'), () => void act(async () => { await removeImageJob(job.id); await refresh(); }), Trash2));
				if (job.imageId) controls.prepend(button(t('查看图片'), () => void preview({ id: `owned:${job.imageId}`, name: job.prompt, blob: () => readLibraryBlob(job.imageId!) })));
				body.append(h('article', { class: 'il-job' }, h('div', { class: 'il-job-head' }, h('strong', { text: imageJobLabel(job.state) }), h('time', { text: new Date(job.created).toLocaleString() })),
					h('p', { class: 'il-job-prompt', text: job.prompt }), h('p', { class: 'il-meta', text: job.modelLabel }),
					job.error ? h('p', { class: 'il-error', text: describeImageError(new Error(job.error)) }) : null, controls));
			}
		} else if (target === 'folders') { if (folder) await readFolder(folder, false); else { entries = []; draw(); } }
		else { entries = photoEntries(); draw(); }
	}
	async function upload(files: File[]) {
		await act(async () => {
			let count = 0, failed = 0;
			for (const file of files.slice(0, 50)) {
				try { const dimensions = await inspectLibraryBlob(file), id = crypto.randomUUID(); await saveLibraryImage(file, { id, name: file.name, created: Date.now(), source: 'upload', ...dimensions }); count++; }
				catch { failed++; }
			}
			status.textContent = t('已导入 {0} 张，失败 {1} 张', [count, failed + Math.max(0, files.length - 50)]); await refresh();
		});
	}
	importInput.onchange = () => { void upload(Array.from(importInput.files || [])); importInput.value = ''; };
	root.ondragover = event => { event.preventDefault(); };
	root.ondrop = event => { event.preventDefault(); if (tab === 'images') void upload(Array.from(event.dataTransfer?.files || [])); };
	async function readFolder(next: LibraryFolder, requestPermission: boolean) {
		const target = ++version;
		const handle = next.handle as any;
		let permission = await handle.queryPermission({ mode: 'read' });
		if (permission !== 'granted' && requestPermission) permission = await handle.requestPermission({ mode: 'read' });
		if (permission !== 'granted') { if (tab === 'folders') { status.textContent = t('请点击文件夹重新授权读取'); entries = []; draw(); } return; }
		const pictures = await folderPictures(next);
		if (!alive || tab !== 'folders' || target !== version) return;
		folder = next;
		void folderTools().catch(report);
		folderEntries = pictures.map(p => ({ id: `${next.id}:${p.path}`, name: p.name, meta: p.path, blob: async () => p.file, remove: async () => { next.hidden = Array.from(new Set([...next.hidden, p.path])); await saveLibraryFolder(next); } }));
		entries = folderEntries; draw();
		status.textContent = t('只读取图片，隐藏和移除不会删除原文件。每次最多显示 500 张。');
	}
	async function folderTools() {
		const folders = await listLibraryFolders(); if (!alive || tab !== 'folders') return;
		actions.replaceChildren();
		for (const item of folders) actions.append(button(item.name, () => void act(() => readFolder(item, true)), FolderOpen));
		actions.append(button(t('添加文件夹'), () => void act(async () => {
			const picker = (window as any).showDirectoryPicker;
			if (!picker) throw new Error(t('当前浏览器不支持文件夹读取，请使用上传图片。'));
			const handle = await picker({ mode: 'read', id: 'qiaomu-image-library' });
			const next: LibraryFolder = { id: crypto.randomUUID(), name: handle.name, handle, hidden: [] };
			await saveLibraryFolder(next); await folderTools(); await readFolder(next, true);
		}), Plus));
		if (folder) actions.append(button(t('恢复隐藏图片'), () => void act(async () => { folder!.hidden = []; await saveLibraryFolder(folder!); await readFolder(folder!, false); }), RotateCcw),
			button(t('移除文件夹'), () => void act(async () => { await removeLibraryFolder(folder!.id); folder = undefined; await folderTools(); await refresh(); }), Trash2));
	}
	function photoEntries(): Entry[] {
		return photos.map(photo => ({ id: `unsplash:${photo.id}`, name: photo.description, thumb: photo.thumb, credit: { name: photo.author, url: photo.link }, blob: async () => downloadUnsplash(await loadUnsplashSource(), photo) }));
	}
	async function findPhotos(more = false) {
		request?.abort(); const controller = new AbortController(); request = controller;
		const query = search.value.trim(), page = more && query === photoQuery ? photoPage + 1 : 1;
		status.textContent = t('正在读取图片…');
		try {
			const source = await loadUnsplashSource();
			if (!source.key && !source.proxy) { status.textContent = t('先设置 Unsplash API Key。'); return; }
			const result = await searchUnsplash(source, query, page, controller.signal);
			if (!alive || controller.signal.aborted || tab !== 'unsplash') return;
			photos = page === 1 ? result : [...photos, ...result]; photoQuery = query; photoPage = page; shown = photos.length;
			entries = photoEntries(); draw(); status.textContent = '';
		} catch (error) { if (!controller.signal.aborted) report(error); }
	}
	const unsplashSettings = () => openUnsplashSettings(() => { if (alive) void findPhotos(); });

	function switchTab(next: Tab) {
		tab = next; selected.clear(); search.value = ''; shown = 48; request?.abort(); status.textContent = ''; actions.replaceChildren();
		nav.querySelectorAll('button').forEach(node => node.setAttribute('aria-current', node.dataset.tab === tab ? 'page' : 'false'));
		tools.replaceChildren(); filter.value = 'all';
		if (tab !== 'tasks') tools.append(search);
		if (tab === 'images') tools.append(filter, button(t('上传图片'), () => importInput.click(), Upload));
		if (tab === 'folders') void folderTools().catch(report);
		if (tab === 'unsplash') { if (options.initialQuery) { search.value = options.initialQuery; options.initialQuery = ''; } tools.append(button(t('搜索'), () => void findPhotos()), button(t('设置'), unsplashSettings, Settings2)); if (!photos.length) void findPhotos(); }
		void refresh().catch(report);
	}
	for (const [id, label, glyph] of [['images', t('我的图片'), Images], ['tasks', t('生图任务'), Sparkles], ['folders', t('本地文件夹'), FolderOpen], ['unsplash', 'Unsplash', Camera]] as const) {
		const b = button(label, () => switchTab(id), glyph); b.dataset.tab = id; nav.append(b);
	}
	search.oninput = () => { if (tab !== 'unsplash') { shown = 48; draw(); } };
	search.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing && tab === 'unsplash') void findPhotos(); };
	filter.onchange = draw;
	const stop = watchImageJobs(() => { if (tab === 'images' || tab === 'tasks') void refresh().catch(report); });
	switchTab(tab);
	return () => { alive = false; clean(); stop(); request?.abort(); root.ondrop = root.ondragover = null; };
}

export function openImageLibraryDialog(onPick: (blob: Blob, name: string) => Promise<void>): void {
	const dialog = h('dialog', { class: 'il-dialog image-library', 'aria-label': t('图库') }), root = h('div');
	const close = () => { dispose(); dialog.close(); dialog.remove(); };
	dialog.append(button(t('关闭'), close, X), root);
	const dispose = mountImageLibrary(root, { onPick: async (blob, name) => { await onPick(blob, name); } });
	dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
	document.body.append(dialog); dialog.showModal();
}

export function openUnsplashSettings(onSaved?: () => void) {
		void (async () => {
			const source = await loadUnsplashSource(), dialog = h('dialog', { class: 'image-library il-settings', 'aria-label': 'Unsplash' });
			const key = h('input', { class: 'il-field', type: 'password', autocomplete: 'off', 'aria-label': 'API Key (Access Key)' }); key.value = source.key;
			const proxy = h('input', { class: 'il-field', type: 'url', placeholder: 'https://…', 'aria-label': t('代理地址') }); proxy.value = source.proxy;
			const advanced = h('details', { class: 'il-advanced' },
				h('summary', { text: t('高级设置') }), h('label', {}, t('代理地址'), proxy),
				h('p', { text: t('使用自己的 Access Key，或填写代理地址。搜索词会发送到所选服务。') }));
			const message = h('p', { class: 'il-status', role: 'status' });
			const close = () => { dialog.close(); dialog.remove(); };
			dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
			dialog.append(h('h2', { text: 'Unsplash' }), h('label', {}, 'API Key (Access Key)', key),
				h('a', { href: 'https://unsplash.com/oauth/applications', target: '_blank', rel: 'noopener noreferrer', text: t('获取密钥') }), advanced, message,
				h('div', { class: 'il-tools' }, button(t('取消'), close), button(t('保存'), () => {
					void saveUnsplashSource({ key: key.value.trim(), proxy: proxy.value.trim() }).then(() => { close(); onSaved?.(); }).catch(error => { message.textContent = describeImageError(error); });
				})));
			document.body.append(dialog); dialog.showModal();
		})().catch(error => { console.error('Unsplash settings failed', error); });
	}
