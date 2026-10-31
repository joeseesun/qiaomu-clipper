import { Download, FolderInput, ImageOff, Pencil, Plus, RotateCcw, Search, Trash2, CopyPlus } from 'lucide';
import browser from '../utils/browser-polyfill';
import { t } from '../utils/ui-text';
import { askConfirm, h, icon, toast } from '../write/editor/dom';
import { countArticles, deleteArticle, duplicateArticle, emptyTrash, getArticle, listArticles, restoreArticle, saveArticle, trashArticle, blankArticle } from '../write/articles';
import { getImage } from '../write/images';
import { exportArticle, exportArticleZip, importMarkdownFiles, safeFileName } from '../write/markdown-io';
import type { ArticleSummary } from '../write/types';
import { MAX_CUSTOM_ACTIONS, builtinActions, invalidateActions, loadStoredActions, saveStoredActions, type StoredAction } from '../write/ai/actions';

const openWriter = (id?: string) => { void browser.tabs.create({ url: browser.runtime.getURL(id ? `write.html?id=${id}` : 'write.html?new=1') }); };

function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = h('a', { href: url, download: name });
	document.body.append(a); a.click(); a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const when = (time: number) => {
	const diff = Date.now() - time;
	if (diff < 60_000) return t('刚刚');
	if (diff < 3_600_000) return t('{0} 分钟前', [Math.floor(diff / 60_000)]);
	if (diff < 86_400_000) return t('{0} 小时前', [Math.floor(diff / 3_600_000)]);
	return new Date(time).toLocaleDateString();
};

// The "Write long articles" page of the settings: every article kept on this computer, newest edit first.
export async function initializeWriteSettings(): Promise<void> {
	const root = document.getElementById('write-home');
	if (!root) return;
	let view: 'active' | 'trash' = 'active';
	let query = '';

	const search = h('input', { type: 'search', class: 'write-search', placeholder: t('搜索标题和正文'), 'aria-label': t('搜索文章'), autocomplete: 'off', spellcheck: false });
	const tabActive = h('button', { type: 'button', class: 'write-tab is-active', role: 'tab' });
	const tabTrash = h('button', { type: 'button', class: 'write-tab', role: 'tab' });
	const list = h('div', { class: 'write-list', role: 'list' });
	const note = h('p', { class: 'write-note', text: t('文章和图片只保存在这台电脑的这个浏览器里。清除站点数据或卸载扩展会丢失，请定期导出备份。') });

	const newButton = h('button', { type: 'button', class: 'write-btn write-btn-primary' }, icon(Plus, 15), t('新建文章'));
	const importButton = h('button', { type: 'button', class: 'write-btn' }, icon(FolderInput, 15), t('导入'));
	const exportAllButton = h('button', { type: 'button', class: 'write-btn' }, icon(Download, 15), t('导出全部'));
	const emptyTrashButton = h('button', { type: 'button', class: 'write-btn write-btn-danger', hidden: true }, icon(Trash2, 15), t('清空回收站'));
	const actions = document.getElementById('write-actions');
	actions?.append(importButton, exportAllButton, emptyTrashButton, newButton);
	root.append(h('div', { class: 'write-bar' }, h('div', { class: 'write-search-wrap' }, icon(Search, 15), search), h('div', { class: 'write-tabs', role: 'tablist' }, tabActive, tabTrash)), list, note);

	const row = (article: ArticleSummary) => {
		const title = article.title.trim() || t('未命名文章');
		const thumb = h('div', { class: 'write-thumb', 'aria-hidden': 'true' });
		if (article.coverImageId) void getImage(article.coverImageId).then(image => { if (image) { const img = h('img', { alt: '' }); img.src = URL.createObjectURL(image.blob); thumb.append(img); } else thumb.append(icon(ImageOff, 18)); });
		const badges = h('span', { class: 'write-badges' });
		if (article.publishes.x) badges.append(h('span', { class: 'write-badge', text: t('已发 X') }));
		if (article.publishes.wechat) badges.append(h('span', { class: 'write-badge', text: t('已发公众号') }));
		const info = h('div', { class: 'write-info' }, h('div', { class: 'write-title', text: title }), h('div', { class: 'write-excerpt', text: article.excerpt || t('还没有内容') }),
			h('div', { class: 'write-meta' }, h('span', { text: view === 'trash' ? t('删除于 {0}', [when(article.trashedAt ?? article.updatedAt)]) : t('更新于 {0}', [when(article.updatedAt)]) }), h('span', { text: t('{0} 字', [article.wordCount]) }), badges));
		const buttons = h('div', { class: 'write-row-actions' });
		const mk = (label: string, ic: Node, run: () => Promise<void> | void, danger = false) => {
			const b = h('button', { type: 'button', class: `write-icon${danger ? ' danger' : ''}`, title: label, 'aria-label': label }, ic);
			b.addEventListener('click', event => { event.stopPropagation(); void Promise.resolve(run()).catch(() => toast(t('操作没有成功，请重试'), 'error')); });
			buttons.append(b);
		};
		if (view === 'active') {
			mk(t('复制一份'), icon(CopyPlus, 15), async () => { await duplicateArticle(article.id); await refresh(); });
			mk(t('导出'), icon(Download, 15), async () => { const full = await getArticle(article.id); if (!full) return; const { markdown, images } = await exportArticle(full); const name = safeFileName(full.title); if (images.length) download(await exportArticleZip([full]), `${name}.zip`); else download(new Blob([markdown], { type: 'text/markdown' }), `${name}.md`); });
			mk(t('移到回收站'), icon(Trash2, 15), async () => { await trashArticle(article.id); toast(t('已移到回收站，30 天内可以恢复')); await refresh(); }, true);
		} else {
			mk(t('恢复'), icon(RotateCcw, 15), async () => { await restoreArticle(article.id); await refresh(); });
			mk(t('彻底删除'), icon(Trash2, 15), async () => {
				if (!(await askConfirm({ title: t('彻底删除这篇文章？'), note: t('删除后无法恢复，文章里的图片也会一起清理。'), confirm: t('彻底删除'), cancel: t('取消'), danger: true }))) return;
				await deleteArticle(article.id); await refresh();
			}, true);
		}
		const item = h('div', { class: 'write-row', role: 'listitem' }, h('div', { class: 'write-row-main', role: view === 'active' ? 'button' : undefined, tabindex: view === 'active' ? 0 : undefined }, thumb, info), buttons);
		if (view === 'active') {
			const main = item.firstElementChild as HTMLElement;
			main.addEventListener('click', () => openWriter(article.id));
			main.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWriter(article.id); } });
		}
		return item;
	};

	async function refresh(): Promise<void> {
		const [items, counts] = await Promise.all([listArticles({ trashed: view === 'trash', query }), countArticles()]);
		tabActive.textContent = t('全部文章 {0}', [counts.active]);
		tabTrash.textContent = t('回收站 {0}', [counts.trashed]);
		tabActive.classList.toggle('is-active', view === 'active'); tabTrash.classList.toggle('is-active', view === 'trash');
		tabActive.setAttribute('aria-selected', String(view === 'active')); tabTrash.setAttribute('aria-selected', String(view === 'trash'));
		emptyTrashButton.hidden = view !== 'trash' || !counts.trashed;
		newButton.hidden = view === 'trash'; importButton.hidden = view === 'trash'; exportAllButton.hidden = view === 'trash' || !counts.active;
		list.textContent = '';
		if (!items.length) {
			list.append(h('div', { class: 'write-empty' }, h('p', { class: 'write-empty-title', text: query ? t('没有找到匹配的文章') : view === 'trash' ? t('回收站是空的') : t('还没有文章') }),
				query || view === 'trash' ? null : h('p', { text: t('点「新建文章」，或在任意网页连按 3 次 U 开始写。') })));
			return;
		}
		for (const item of items) list.append(row(item));
	}

	tabActive.addEventListener('click', () => { view = 'active'; void refresh(); });
	tabTrash.addEventListener('click', () => { view = 'trash'; void refresh(); });
	let typing: number | undefined;
	search.addEventListener('input', () => { window.clearTimeout(typing); typing = window.setTimeout(() => { query = search.value; void refresh(); }, 160); });
	newButton.addEventListener('click', () => openWriter());
	emptyTrashButton.addEventListener('click', async () => {
		if (!(await askConfirm({ title: t('清空回收站？'), note: t('这些文章会被彻底删除，无法恢复。'), confirm: t('清空'), cancel: t('取消'), danger: true }))) return;
		await emptyTrash(); await refresh();
	});
	exportAllButton.addEventListener('click', async () => {
		const summaries = await listArticles();
		const full = (await Promise.all(summaries.map(item => getArticle(item.id)))).filter((item): item is NonNullable<typeof item> => !!item);
		if (full.length) download(await exportArticleZip(full), `qiaomu-articles-${new Date().toISOString().slice(0, 10)}.zip`);
	});
	importButton.addEventListener('click', () => {
		const input = h('input', { type: 'file', accept: '.md,.markdown,.txt,.zip,image/*', multiple: true });
		input.addEventListener('change', async () => {
			const files = Array.from(input.files ?? []);
			if (!files.length) return;
			try {
				const parsed = await importMarkdownFiles(files);
				if (!parsed.length) { toast(t('没有找到 Markdown 文件'), 'error'); return; }
				for (const item of parsed) await saveArticle({ ...blankArticle(), title: item.title, markdown: item.markdown, author: item.author, digest: item.digest, sourceUrl: item.sourceUrl, coverImageId: item.coverPath });
				toast(t('已导入 {0} 篇文章', [parsed.length]));
				await refresh();
			} catch { toast(t('导入失败，文件可能已损坏'), 'error'); }
		});
		input.click();
	});
	document.addEventListener('qiaomu-write-shown', () => { void refresh(); });
	await refresh();
	await initializeAiActions();
}

// "AI shortcuts": the instructions offered when text is selected. The built-in ones are fixed; the writer adds their own.
async function initializeAiActions(): Promise<void> {
	const root = document.getElementById('write-ai-actions');
	if (!root) return;
	let actions = await loadStoredActions();
	const list = h('div', { class: 'im-list', role: 'list' });
	const add = h('button', { type: 'button', class: 'write-btn' }, icon(Plus, 15), t('添加指令'));
	root.append(h('div', { class: 'settings-section-header' }, h('h3', { text: t('AI 快捷指令') }), h('div', { class: 'settings-section-actions' }, add)),
		h('div', { class: 'setting-item-description', text: t('在文章里选中文字，点浮动工具栏上的 AI，就能用这些指令改写。内置的不能改，你自己的可以随便加。') }), list);

	const persist = async () => { await saveStoredActions(actions); invalidateActions(); render(); };
	function render() {
		list.textContent = '';
		for (const builtin of builtinActions()) list.append(h('div', { class: 'write-row im-row', role: 'listitem' }, h('div', { class: 'write-row-main' }, h('div', { class: 'write-info' }, h('div', { class: 'write-title' }, builtin.name, h('span', { class: 'write-badge im-default', text: t('内置') }))))));
		for (const action of actions) {
			const buttons = h('div', { class: 'write-row-actions im-actions' });
			const mk = (label: string, ic: Node, run: () => void | Promise<void>, danger = false) => { const b = h('button', { type: 'button', class: `write-icon${danger ? ' danger' : ''}`, title: label, 'aria-label': label }, ic); b.addEventListener('click', () => { void Promise.resolve(run()); }); buttons.append(b); };
			mk(t('编辑'), icon(Pencil, 15), () => openDialog(action));
			mk(t('删除'), icon(Trash2, 15), async () => { if (!(await askConfirm({ title: t('删除这条指令？'), confirm: t('删除'), cancel: t('取消'), danger: true }))) return; actions = actions.filter(a => a.id !== action.id); await persist(); }, true);
			list.append(h('div', { class: 'write-row im-row', role: 'listitem' }, h('div', { class: 'write-row-main' }, h('div', { class: 'write-info' }, h('div', { class: 'write-title', text: action.name }), h('div', { class: 'write-excerpt', text: action.prompt }))), buttons));
		}
	}
	function openDialog(existing?: StoredAction): void {
		const dialog = h('dialog', { class: 'qw-dialog', 'aria-label': t('AI 快捷指令') });
		const name = h('input', { class: 'qw-field', type: 'text', maxlength: 24, placeholder: t('名字，例如「口语化」'), spellcheck: false });
		const prompt = h('textarea', { class: 'qw-field', rows: 5, placeholder: t('告诉 AI 怎么改，例如：改得更口语，像跟朋友聊天，去掉套话'), spellcheck: false });
		name.value = existing?.name ?? ''; prompt.value = existing?.prompt ?? '';
		const error = h('p', { class: 'qw-dialog-note im-error', role: 'alert', hidden: true });
		const close = () => { dialog.close(); dialog.remove(); };
		const save = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', text: t('保存') });
		save.addEventListener('click', async () => {
			const n = name.value.trim(); const p = prompt.value.trim();
			if (!n || !p) { error.hidden = false; error.textContent = t('名字和指令都要填'); return; }
			if (!existing && actions.length >= MAX_CUSTOM_ACTIONS) { error.hidden = false; error.textContent = t('最多 {0} 条', [MAX_CUSTOM_ACTIONS]); return; }
			actions = existing ? actions.map(a => (a.id === existing.id ? { ...a, name: n, prompt: p } : a)) : [...actions, { id: `act_${Date.now().toString(36)}`, name: n, prompt: p }];
			close(); await persist();
		});
		dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
		dialog.append(h('h2', { class: 'qw-dialog-title', text: existing ? t('编辑指令') : t('添加指令') }), name, h('div', { style: 'height:10px' }), prompt, error, h('div', { class: 'qw-dialog-actions' }, h('button', { type: 'button', class: 'qw-btn', text: t('取消'), onclick: close }), save));
		document.body.append(dialog); dialog.showModal(); name.focus();
	}
	add.addEventListener('click', () => openDialog());
	render();
}
