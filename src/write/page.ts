import { Editor } from '@tiptap/core';
import { Archive, ArrowLeft, Code, Download, Ellipsis, FileText, ImagePlus, Images, ListTree, Send, Settings, Sparkles, Trash2 } from 'lucide';
import browser from '../utils/browser-polyfill';
import { loadSettings } from '../utils/storage-utils';
import { t } from '../utils/ui-text';
import { aiReady, runAi } from './editor/ai';
import { mountChatPanel } from './ai/chat-panel';
import { openImageDialog } from './ai/image-dialog';
import { openImageLibraryDialog } from '../utils/image-library';
import { suggestCoverPrompt, suggestDigest, suggestTitles } from './ai/meta';
import { enabledChatModels } from '../utils/chat-llm';
import { imageUrlFor } from './images';
import { askConfirm, h, icon, toast } from './editor/dom';
import { buildExtensions } from './editor/extensions';
import type { EditorHost } from './editor/host';
import { RevisionConflict, countWords, duplicateArticle, getArticle, newOrBlankArticle, purgeOldTrash, restoreArticle, saveArticle, trashArticle } from './articles';
import { imageIdFromUrl, saveImage } from './images';
import { imageUrls, insertImageFiles, localizeRemoteImages, pickImageFiles } from './images-ui';
import { mountOutline } from './outline';
import { editorMarkdown, exportArticle, exportArticleZip, parseFrontMatter, safeFileName } from './markdown-io';
import { publishers } from './publish';
import type { Article } from './types';
import type { ClipPreview } from '../utils/clip-preview';
import { completeSourceImport, openSourcePage } from './source-import';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = h('a', { href: url, download: name });
	document.body.append(a); a.click(); a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const readingMinutes = (words: number) => Math.max(1, Math.round(words / 300));

function notice(root: HTMLElement, title: string, body: string, ...actions: HTMLElement[]): void {
	root.textContent = '';
	root.append(h('div', { class: 'qw-notice' }, h('h1', { text: title }), h('p', { text: body }), h('div', { class: 'qw-dialog-actions', style: 'justify-content:center' }, ...actions)));
}

export const listUrl = () => browser.runtime.getURL('settings.html?section=write');

// Only one tab edits an article at a time; a second tab hands over to the first.
async function claimArticle(id: string): Promise<boolean> {
	if (!navigator.locks) return true;
	return new Promise<boolean>(resolve => {
		navigator.locks.request(`qiaomu-write:${id}`, { ifAvailable: true }, lock => {
			if (!lock) { resolve(false); return undefined; }
			resolve(true);
			return new Promise<void>(() => { /* held until this tab closes */ });
		}).catch(() => resolve(true));
	});
}

export async function startWritePage(root: HTMLElement): Promise<void> {
	await loadSettings();
	void purgeOldTrash().catch(() => {});
	const params = new URLSearchParams(location.search);
	let article: Article | undefined;
	const wanted = params.get('id');
	try {
		if (!wanted) { article = await newOrBlankArticle(); history.replaceState(null, '', `write.html?id=${article.id}`); }
		else article = await getArticle(wanted);
	} catch { notice(root, t('无法打开本地文章库'), t('浏览器没有给扩展存储空间，请重启浏览器后重试。')); return; }
	if (!article) { notice(root, t('找不到这篇文章'), t('它可能已被彻底删除。'), h('a', { class: 'qw-btn qw-btn-primary', href: listUrl(), text: t('回到文章列表') })); return; }
	if (!(await claimArticle(article.id))) {
		void browser.runtime.sendMessage({ action: 'qiaomuWriteFocus', id: article.id }).catch(() => {});
		notice(root, t('这篇文章正在另一个标签页里编辑'), t('同时编辑会互相覆盖，请到那个标签页继续写。'));
		return;
	}
	if (article.trashedAt) {
		const id = article.id;
		notice(root, t('这篇文章在回收站里'), t('恢复后才能继续编辑。'), h('button', { class: 'qw-btn qw-btn-primary', type: 'button', onclick: async () => { await restoreArticle(id); location.reload(); } }, t('恢复文章')), h('a', { class: 'qw-btn', href: listUrl() }, t('回到文章列表')));
		return;
	}
	if (article.clipSource?.waitingForCaptions) {
		const key = `qiaomuPreview:${article.clipSource.previewId}`;
		try {
			const stored = (await browser.storage.local.get(key))[key] as ClipPreview | undefined;
			const completed = stored && completeSourceImport(article, stored);
			if (completed) article = await saveArticle(completed, article.revision);
		} catch { /* The original draft remains usable; the editor offers a return to the source. */ }
	}
	mountEditor(root, article);
}

function mountEditor(root: HTMLElement, initial: Article): void {
	let article = initial;
	let state: SaveState = 'saved';
	let sourceMode = false;
	let lastSaved = JSON.stringify([article.title, article.markdown, article.author, article.digest, article.sourceUrl, article.coverImageId]);
	let timer: number | undefined;
	let saving: Promise<void> = Promise.resolve();
	let conflict = false;

	// ---- chrome -----------------------------------------------------------------------------------------------------------
	const status = h('span', { class: 'qw-status', role: 'status', 'aria-live': 'polite' });
	const aiButton = h('button', { type: 'button', class: 'qw-btn', title: t('AI 助手'), 'aria-pressed': 'false' }, icon(Sparkles, 15), 'AI');
	const galleryButton = h('button', { type: 'button', class: 'qw-btn icon', title: t('图库'), 'aria-label': t('图库') }, icon(Images));
	const outlineButton = h('button', { type: 'button', class: 'qw-btn icon is-on', title: t('大纲'), 'aria-label': t('大纲'), 'aria-pressed': 'true' }, icon(ListTree));
	const sourceButton = h('button', { type: 'button', class: 'qw-btn icon', title: t('Markdown 源码'), 'aria-label': t('Markdown 源码'), 'aria-pressed': 'false' }, icon(Code));
	const exportButton = h('button', { type: 'button', class: 'qw-btn', 'aria-haspopup': 'menu' }, icon(Download, 15), t('导出'));
	const moreButton = h('button', { type: 'button', class: 'qw-btn icon', title: t('更多'), 'aria-label': t('更多'), 'aria-haspopup': 'menu' }, icon(Ellipsis));
	const publishButton = h('button', { type: 'button', class: 'qw-btn qw-btn-primary', 'aria-haspopup': 'menu' }, icon(Send, 15), t('发布'));
	const back = h('a', { class: 'qw-btn', href: listUrl() }, icon(ArrowLeft, 15), t('文章列表'));
	const top = h('header', { class: 'qw-top' }, back, status, h('span', { class: 'qw-spacer' }), galleryButton, aiButton, outlineButton, sourceButton, exportButton, publishButton, moreButton);

	const banner = h('div', { class: 'qw-banner', role: 'alert', hidden: true });
	const sourceNotice = h('div', { class: 'qw-source-notice', role: 'status', hidden: !article.clipSource?.waitingForCaptions });
	sourceNotice.append(h('span', { text: t('字幕尚未就绪，获取完成后会自动补入文章。') }),
		h('button', { type: 'button', class: 'qw-btn', onclick: () => {
			if (article.clipSource) void openSourcePage(article.clipSource.readUrl).catch(() => toast(t('无法打开来源，请重试'), 'error'));
		} }, t('回到来源获取字幕')));
	const cover = h('figure', { class: 'qw-cover', hidden: true });
	const title = h('textarea', { class: 'qw-title', rows: 1, placeholder: t('标题'), 'aria-label': t('标题'), spellcheck: false });
	title.value = article.title;
	const titleAi = h('button', { type: 'button', class: 'qw-title-ai', title: t('让 AI 起标题'), 'aria-label': t('让 AI 起标题'), 'aria-haspopup': 'menu' }, icon(Sparkles, 16));
	const titleWrap = h('div', { class: 'qw-title-wrap' }, title, titleAi);

	const authorInput = h('input', { type: 'text', value: article.author, placeholder: t('署名，可不填') });
	const digestInput = h('textarea', { rows: 2, placeholder: t('一两句话的摘要，用于发布时的简介') });
	digestInput.value = article.digest;
	const digestAi = h('button', { type: 'button', class: 'qw-btn qw-meta-ai' }, icon(Sparkles, 14), t('AI 写摘要'));
	const sourceInput = h('input', { type: 'text', value: article.sourceUrl, placeholder: 'https://…' });
	const coverPick = h('button', { type: 'button', class: 'qw-btn' }, icon(ImagePlus, 15), t('选择封面图'));
	const coverAi = h('button', { type: 'button', class: 'qw-btn' }, icon(Sparkles, 15), t('AI 生成封面'));
	const meta = h('details', { class: 'qw-meta' }, h('summary', { text: t('文章信息：封面、署名、摘要、原文链接') }),
		h('div', { class: 'qw-meta-grid' }, h('div', { class: 'qw-meta-field' }, h('span', { text: t('封面') }), h('div', { class: 'qw-meta-row' }, coverPick, coverAi)), h('label', {}, t('署名'), authorInput), h('label', {}, h('span', { class: 'qw-meta-label' }, t('摘要'), digestAi), digestInput), h('label', {}, t('原文链接'), sourceInput)));

	const mount = h('div', { class: 'qw-editor' });
	const sourceArea = h('textarea', { class: 'qw-source', hidden: true, spellcheck: false, 'aria-label': t('Markdown 源码') });
	const outline = h('aside', { class: 'qw-outline', 'aria-label': t('大纲') });
	const foot = h('footer', { class: 'qw-foot' });
	const doc = h('article', { class: 'qw-doc' }, cover, titleWrap, meta, mount, sourceArea);
	root.textContent = '';
	root.append(h('div', { class: 'qw-app' }, top, banner, sourceNotice, h('div', { class: 'qw-layout' }, h('main', { class: 'qw-scroll' }, doc), outline), foot));

	// ---- editor -----------------------------------------------------------------------------------------------------------
	const host: EditorHost = {
		pickImages: () => pickImageFiles(editor),
		insertImageFiles,
		localizeImages: localizeRemoteImages,
		aiReady,
		runAi,
		aiImage: ed => { void openImageDialog({ applies: [{ label: t('插入文章'), run: (id, prompt) => { ed.chain().focus().insertContent({ type: 'image', attrs: { src: imageUrlFor(id), alt: prompt.slice(0, 80) } }).run(); } }] }); },
	};
	const outlineRail = mountOutline(outline, () => editor, () => title.value);
	const editor: Editor = new Editor({
		element: mount,
		extensions: buildExtensions({ resolveImage: id => imageUrls.resolve(id), host, onSetCover: src => { const id = imageIdFromUrl(src); if (id) setCover(id); } }),
		content: article.markdown,
		editorProps: { attributes: { class: 'qw-prose', spellcheck: 'false', 'aria-label': t('正文') } },
		onUpdate: () => { changed(); outlineRail.refresh(); },
		onCreate: () => outlineRail.refresh(),
	});
	galleryButton.addEventListener('click', () => openImageLibraryDialog(async (blob, name) => {
		const image = await saveImage(blob, name);
		editor.chain().focus().insertContent({ type: 'image', attrs: { src: imageUrlFor(image.id), alt: name } }).run();
	}));

	const currentMarkdown = () => (sourceMode ? sourceArea.value : editorMarkdown(editor));
	const snapshot = () => ({ title: title.value.replace(/\n/g, ' ').trim(), markdown: currentMarkdown(), author: authorInput.value.trim(), digest: digestInput.value.trim(), sourceUrl: sourceInput.value.trim(), coverImageId: article.coverImageId });

	// ---- saving -----------------------------------------------------------------------------------------------------------
	const showState = (next: SaveState) => {
		state = next;
		status.textContent = next === 'saved' ? t('已保存') : next === 'saving' ? t('保存中…') : next === 'dirty' ? t('未保存') : t('保存失败');
		status.classList.toggle('error', next === 'error');
	};
	const updateFooter = () => {
		const words = snapshotWords();
		foot.textContent = '';
		foot.append(h('span', { text: t('{0} 字', [words]) }), h('span', { text: t('约 {0} 分钟读完', [readingMinutes(words)]) }));
	};
	const snapshotWords = () => countWords(snapshot().markdown);
	const refreshTitle = () => { document.title = `${title.value.trim() || t('未命名文章')} · ${t('写长文')}`; };

	const saveNow = (): Promise<void> => {
		window.clearTimeout(timer);
		saving = saving.catch(() => {}).then(async () => {
			if (conflict) return;
			const fields = snapshot();
			const key = JSON.stringify([fields.title, fields.markdown, fields.author, fields.digest, fields.sourceUrl, fields.coverImageId]);
			if (key === lastSaved) { if (state !== 'saved') showState('saved'); return; }
			showState('saving');
			try {
				article = await saveArticle({ ...article, ...fields }, article.revision);
				lastSaved = key;
				showState(JSON.stringify(snapshotKey()) === key ? 'saved' : 'dirty');
				if (state === 'dirty') schedule();
			} catch (error) {
				if (error instanceof RevisionConflict) { conflict = true; showState('error'); showConflict(); return; }
				showState('error');
				toast(t('保存失败，内容还在编辑器里。请先导出备份，再重试。'), 'error');
			}
		});
		return saving;
	};
	const snapshotKey = () => { const s = snapshot(); return [s.title, s.markdown, s.author, s.digest, s.sourceUrl, s.coverImageId]; };
	const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void saveNow(), 800); };
	function changed() { if (conflict) return; showState('dirty'); schedule(); updateFooter(); }
	function showConflict() {
		banner.hidden = false; banner.textContent = '';
		banner.append(h('span', { text: t('这篇文章在别处被修改过，继续保存会覆盖它。') }), h('button', { type: 'button', class: 'qw-btn', onclick: () => location.reload() }, t('重新载入')));
	}
	const flush = () => { if (state === 'dirty' || state === 'saving') void saveNow(); };
	window.addEventListener('beforeunload', event => { if (state === 'dirty' || state === 'error') { flush(); event.preventDefault(); } });
	document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
	window.addEventListener('pagehide', flush);
	const sourceChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
		if (area !== 'local' || conflict || !article.clipSource?.waitingForCaptions) return;
		const next = changes[`qiaomuPreview:${article.clipSource.previewId}`]?.newValue as ClipPreview | undefined;
		if (!next) return;
		// Use the same queue as autosave; a finishing save must not restore an old pending flag.
		saving = saving.catch(() => {}).then(() => {
			if (conflict) return;
			const completed = completeSourceImport(article, next, currentMarkdown());
			if (!completed) return;
			article = completed;
			if (sourceMode) sourceArea.value = completed.markdown;
			else editor.commands.setContent(completed.markdown, { emitUpdate: false });
			sourceNotice.hidden = true; outlineRail.refresh(); changed();
		});
	};
	browser.storage.onChanged.addListener(sourceChanged);
	window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(sourceChanged), { once: true });

	// ---- title ------------------------------------------------------------------------------------------------------------
	const sizeTitle = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
	title.addEventListener('input', () => { sizeTitle(); refreshTitle(); changed(); outlineRail.retitle(); });
	title.addEventListener('keydown', event => {
		if (event.isComposing) return;
		if (event.key === 'Enter') { event.preventDefault(); editor.commands.focus('start'); }
	});
	for (const input of [authorInput, digestInput, sourceInput]) input.addEventListener('input', changed);

	// ---- cover ------------------------------------------------------------------------------------------------------------
	const renderCover = async () => {
		cover.textContent = '';
		cover.hidden = !article.coverImageId;
		coverPick.lastChild!.textContent = article.coverImageId ? t('更换封面图') : t('选择封面图');
		if (!article.coverImageId) return;
		const url = await imageUrls.resolve(article.coverImageId);
		if (!url) { cover.hidden = true; return; }
		cover.append(h('img', { src: url, alt: '' }), h('div', { class: 'qw-cover-actions' },
			h('button', { type: 'button', class: 'qw-btn', onclick: () => pickCover() }, t('更换')),
			h('button', { type: 'button', class: 'qw-btn', onclick: () => setCover('') }, t('移除'))));
	};
	function setCover(id: string) { article = { ...article, coverImageId: id }; void renderCover(); changed(); }
	function pickCover() {
		const input = h('input', { type: 'file', accept: 'image/*' });
		input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { setCover((await saveImage(file, file.name)).id); } catch { toast(t('这张图片没能保存'), 'error'); } });
		input.click();
	}
	coverPick.addEventListener('click', pickCover);

	outlineButton.addEventListener('click', () => { outlineRail.toggle(); outlineButton.classList.toggle('is-on', outline.dataset.mode === 'open'); });

	// ---- source mode ------------------------------------------------------------------------------------------------------
	sourceButton.addEventListener('click', () => {
		sourceMode = !sourceMode;
		sourceButton.classList.toggle('is-on', sourceMode);
		sourceButton.setAttribute('aria-pressed', String(sourceMode));
		if (sourceMode) {
			sourceArea.value = editorMarkdown(editor);
			mount.hidden = true; sourceArea.hidden = false;
			sourceArea.style.height = 'auto'; sourceArea.style.height = `${Math.max(sourceArea.scrollHeight, window.innerHeight * 0.6)}px`;
			sourceArea.focus();
		} else {
			editor.commands.setContent(sourceArea.value, { emitUpdate: false });
			sourceArea.hidden = true; mount.hidden = false;
			outlineRail.refresh(); editor.commands.focus();
			void localizeRemoteImages(editor, true);
		}
		updateFooter();
	});
	sourceArea.addEventListener('input', () => { sourceArea.style.height = 'auto'; sourceArea.style.height = `${Math.max(sourceArea.scrollHeight, window.innerHeight * 0.6)}px`; changed(); });

	// ---- menus ------------------------------------------------------------------------------------------------------------
	let openMenu: HTMLElement | null = null;
	const closeMenu = () => { openMenu?.remove(); openMenu = null; };
	document.addEventListener('mousedown', event => { if (openMenu && !openMenu.contains(event.target as Node) && !(event.target as HTMLElement).closest('[aria-haspopup]')) closeMenu(); }, true);
	document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
	const showMenu = (anchor: HTMLElement, rows: { label: string; hint?: string; ic?: Node; danger?: boolean; run: () => void | Promise<void> }[]) => {
		const wasOpen = openMenu; closeMenu(); if (wasOpen) return;
		const menu = h('div', { class: 'qw-menu', role: 'menu' });
		for (const row of rows) {
			const item = h('div', { class: `qw-menu-item${row.danger ? ' danger' : ''}`, role: 'menuitem', tabindex: 0 }, row.ic ? h('span', { class: 'qw-menu-icon' }, row.ic) : null, h('span', { class: 'qw-menu-text' }, h('span', { class: 'qw-menu-title', text: row.label }), row.hint ? h('span', { class: 'qw-menu-hint', text: row.hint }) : null));
			const run = () => { closeMenu(); void row.run(); };
			item.addEventListener('click', run);
			item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(); } });
			menu.append(item);
		}
		document.body.append(menu);
		const rect = anchor.getBoundingClientRect();
		menu.style.top = `${rect.bottom + 6}px`;
		menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth))}px`;
		openMenu = menu;
	};

	const exportCurrent = async (): Promise<Article> => { await saveNow(); return article; };
	exportButton.addEventListener('click', () => showMenu(exportButton, [
		{ label: t('导出 Markdown'), hint: t('图片会一起打包成文件夹'), ic: icon(FileText, 14), run: async () => {
			const current = await exportCurrent();
			const { markdown, images } = await exportArticle(current);
			const name = safeFileName(current.title);
			if (!images.length) { download(new Blob([markdown], { type: 'text/markdown' }), `${name}.md`); return; }
			download(await exportArticleZip([current]), `${name}.zip`);
		} },
		{ label: t('复制 Markdown'), hint: t('只复制文字，图片以 assets 路径表示'), ic: icon(Archive, 14), run: async () => {
			const { markdown } = await exportArticle(await exportCurrent());
			await navigator.clipboard.writeText(parseFrontMatter(markdown).markdown);
			toast(t('已复制 Markdown'));
		} },
	]));

	moreButton.addEventListener('click', () => showMenu(moreButton, [
		{ label: t('设置'), ic: icon(Settings, 14), run: () => { void browser.tabs.create({ url: browser.runtime.getURL('settings.html') }); } },
		{ label: t('保存网络图片到本地'), hint: t('文章里来自网页的图片会存进本地文章库'), run: () => localizeRemoteImages(editor) },
		{ label: t('复制为新文章'), run: async () => { const copy = await duplicateArticle((await exportCurrent()).id); if (copy) window.open(`write.html?id=${copy.id}`, '_blank'); } },
		{ label: t('移到回收站'), danger: true, ic: icon(Trash2, 14), run: async () => {
			if (!(await askConfirm({ title: t('把这篇文章移到回收站？'), note: t('30 天内可以在文章列表里恢复。'), confirm: t('移到回收站'), cancel: t('取消'), danger: true }))) return;
			await saveNow(); await trashArticle(article.id); state = 'saved'; location.href = listUrl();
		} },
	]));

	publishButton.addEventListener('click', () => showMenu(publishButton, publishers.map(publisher => ({
		label: publisher.label(), hint: article.publishes[publisher.id] ? t('已于 {0} 发布过', [new Date(article.publishes[publisher.id]!.at).toLocaleDateString()]) : publisher.hint(),
		run: async () => { const current = await exportCurrent(); await publisher.run({ article: current, markdown: current.markdown, onRecorded: record => { article = { ...article, publishes: { ...article.publishes, [publisher.id]: record } }; } }); },
	}))));

	// ---- AI: chat drawer, title and summary suggestions, cover ------------------------------------------------------------------
	const fire = (name: string, node: HTMLElement) => node.dispatchEvent(new Event('input', { bubbles: true }));
	const chat = mountChatPanel({
		editor, articleId: article.id, getMarkdown: currentMarkdown,
		getTitle: () => title.value, setTitle: value => { title.value = value; fire('title', title); },
		getDigest: () => digestInput.value, setDigest: value => { digestInput.value = value; meta.open = true; fire('digest', digestInput); },
	});
	aiButton.addEventListener('click', async () => { await chat.toggle(); aiButton.classList.toggle('is-on', chat.isOpen()); aiButton.setAttribute('aria-pressed', String(chat.isOpen())); });
	document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); aiButton.click(); } });
	const needModel = () => { if (enabledChatModels().length) return false; toast(t('还没有可用的 AI 模型，请先在设置里添加'), 'error'); return true; };
	const busy = async (button: HTMLButtonElement, work: () => Promise<void>) => { const label = button.innerHTML; button.disabled = true; button.classList.add('is-busy'); try { await work(); } catch (error) { toast(String((error as Error)?.message ?? error).slice(0, 160), 'error'); } finally { button.disabled = false; button.classList.remove('is-busy'); button.innerHTML = label; } };
	titleAi.addEventListener('click', () => {
		if (needModel()) return;
		void busy(titleAi, async () => {
			const options = await suggestTitles(title.value, currentMarkdown());
			if (!options.length) { toast(t('AI 没有给出标题，再试一次'), 'error'); return; }
			showMenu(titleAi, options.map(option => ({ label: option, run: () => { title.value = option; sizeTitle(); fire('title', title); } })));
		});
	});
	digestAi.addEventListener('click', event => {
		event.preventDefault();
		if (needModel()) return;
		void busy(digestAi, async () => { const text = await suggestDigest(title.value, currentMarkdown()); if (text) { digestInput.value = text; fire('digest', digestInput); } });
	});
	coverAi.addEventListener('click', () => {
		void busy(coverAi, async () => {
			let prompt = t('为文章《{0}》设计封面。{1}', [title.value.trim() || t('未命名文章'), digestInput.value.trim()]);
			if (enabledChatModels().length && (title.value.trim() || currentMarkdown().trim())) { try { prompt = (await suggestCoverPrompt(title.value, digestInput.value, currentMarkdown())) || prompt; } catch { /* keep the plain prompt */ } }
			void openImageDialog({ title: t('AI 生成封面'), prompt, aspect: '16:9', applies: [{ label: t('设为封面'), run: id => setCover(id) }] });
		});
	});

	// ---- keyboard ---------------------------------------------------------------------------------------------------------
	document.addEventListener('keydown', event => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveNow().then(() => { if (state === 'saved') toast(t('已保存')); }); }
	});

	sizeTitle(); refreshTitle(); showState('saved'); updateFooter(); void renderCover();
	if (!article.title && !article.markdown) title.focus();
	else if (article.clipSource) title.focus({ preventScroll: true });
	else editor.commands.focus('end');
	window.addEventListener('resize', sizeTitle);
}
