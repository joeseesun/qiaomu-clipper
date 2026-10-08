import browser from './browser-polyfill';
import { ClipPreview, saveClipPreview, updateClipPreview } from './clip-preview';
import { copyToClipboard } from './clipboard-utils';
import { getMessage } from './i18n';
import { createElement, Copy, Download, Paperclip, Highlighter, WandSparkles } from 'lucide';

export type ClipMode = 'read' | 'edit';
export type ClipSyncAction = ClipMode | 'copy' | 'download' | 'clip';

interface ClipBarOptions {
	mode: ClipMode;
	id: string;
	draft: ClipPreview;
	title: HTMLElement;
	// Source page, shown as a quiet link next to the title.
	domain?: string;
	url?: string;
	// Editing page: copy form fields back into the draft before any action.
	sync?: (action?: ClipSyncAction) => Promise<void>;
	// Opens or closes the AI chat panel; returns whether it is now open.
	onToggleChat?: () => boolean;
}

export const clipPageFor = (mode: ClipMode, id: string, draft: ClipPreview) => mode === 'read' && draft.mediaReadUrl
	? `${draft.mediaReadUrl}${draft.mediaReadUrl.includes('?') ? '&' : '?'}draft=${encodeURIComponent(id)}`
	: browser.runtime.getURL(mode === 'read' ? `reader.html?preview=${id}` : `editor.html?id=${id}`);

function button(id: string, icon: Parameters<typeof createElement>[0] | null, labelKey: string, className = ''): HTMLButtonElement {
	const el = document.createElement('button');
	el.type = 'button';
	el.id = id;
	if (className) el.className = className;
	if (icon) el.appendChild(createElement(icon));
	const span = document.createElement('span');
	span.textContent = getMessage(labelKey);
	el.appendChild(span);
	return el;
}

export function showClipStatus(text: string): void {
	let toast = document.getElementById('clip-bar-status');
	if (!toast) {
		toast = document.createElement('div');
		toast.id = 'clip-bar-status';
		toast.setAttribute('role', 'status');
		toast.setAttribute('aria-live', 'polite');
		document.body.appendChild(toast);
	}
	toast.textContent = text;
	toast.classList.add('is-visible');
	window.clearTimeout((toast as any)._timer);
	(toast as any)._timer = window.setTimeout(() => toast!.classList.remove('is-visible'), 4500);
}

// One top bar for both reading and editing: switch mode, share to RSS, copy, download, clip.
export function createClipBar({ mode, id, draft, title, domain, url, sync, onToggleChat }: ClipBarOptions): HTMLElement {
	const bar = document.createElement('header');
	bar.className = 'clip-bar';
	// Slot for page-specific tools (the reader's font settings) so they live in the bar, not beside it.
	const extras = document.createElement('div');
	extras.className = 'clip-bar-extras';

	const titleWrap = document.createElement('div');
	titleWrap.className = 'clip-bar-title';
	titleWrap.appendChild(title);
	if (domain) {
		const source = document.createElement('a');
		source.className = 'clip-bar-domain';
		source.textContent = domain;
		if (url) { source.href = url; source.target = '_blank'; source.rel = 'noopener noreferrer'; }
		titleWrap.appendChild(source);
	}
	// Number of highlights on this page; hidden until there is one.
	const highlights = document.createElement('button');
	highlights.type = 'button';
	highlights.className = 'clip-bar-highlights';
	highlights.hidden = true;
	highlights.append(createElement(Highlighter), document.createElement('span'));
	highlights.addEventListener('click', () => { if (domain) void browser.runtime.sendMessage({ action: 'openHighlights', domain }); });
	titleWrap.appendChild(highlights);

	const segment = document.createElement('div');
	segment.className = 'clip-bar-segment';
	segment.setAttribute('role', 'tablist');
	for (const target of ['read', 'edit'] as ClipMode[]) {
		const tab = document.createElement('button');
		tab.type = 'button';
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-selected', String(target === mode));
		tab.textContent = getMessage(target === 'read' ? 'qiaomuActionReadShort' : 'qiaomuActionEditShort');
		if (target !== mode) {
			tab.addEventListener('click', async () => {
				await sync?.(target);
				location.href = clipPageFor(target, id, draft);
			});
		}
		segment.appendChild(tab);
	}

	const rss = document.createElement('label');
	rss.className = 'clip-bar-rss';
	const rssText = document.createElement('span');
	rssText.textContent = getMessage('qiaomuShareRss');
	const rssSwitch = document.createElement('input');
	rssSwitch.type = 'checkbox';
	rssSwitch.className = 'switch';
	rssSwitch.checked = draft.aggregate;
	rssSwitch.addEventListener('change', async () => {
		draft.aggregate = rssSwitch.checked;
		await updateClipPreview(draft);
	});
	rss.append(rssText, rssSwitch);

	const copy = button('clip-bar-copy', Copy, 'qiaomuActionCopy');
	copy.addEventListener('click', async () => {
		await sync?.('copy');
		showClipStatus(await copyToClipboard(draft.local.content) ? getMessage('qiaomuEditorCopied') : getMessage('copyToClipboard'));
	});

	const download = button('clip-bar-download', Download, 'qiaomuActionDownload');
	download.addEventListener('click', async () => {
		await sync?.('download');
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([draft.local.content], { type: 'text/markdown' }));
		link.download = draft.local.name;
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 1000);
	});

	const clip = button('clip-bar-clip', Paperclip, 'qiaomuEditorClip', 'is-primary');
	const isDone = () => Boolean(draft.localDone && (!draft.aggregate || draft.rssDone));
	const markDone = () => { clip.disabled = true; clip.querySelector('span')!.textContent = getMessage('qiaomuEditorClipped'); };
	if (isDone()) markDone();
	clip.addEventListener('click', async () => {
		if (clip.disabled) return;
		clip.disabled = true;
		showClipStatus('…');
		try {
			await sync?.('clip');
			showClipStatus((await saveClipPreview(draft)).join(' · '));
		} catch (error) { showClipStatus(String(error)); }
		if (isDone()) markDone(); else clip.disabled = false;
	});
	document.addEventListener('keydown', event => {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); clip.click(); }
	});

	const ai = button('clip-bar-ai', WandSparkles, 'qiaomuChatTitle', 'is-icon');
	ai.title = getMessage('qiaomuChatTitle');
	ai.setAttribute('aria-label', ai.title);
	ai.querySelector('span')?.remove();
	ai.setAttribute('aria-pressed', 'false');
	ai.hidden = !onToggleChat;
	ai.addEventListener('click', () => { onToggleChat?.(); });
	// The panel can also open from a text selection or close itself.
	document.addEventListener('clip-chat-state', event => { ai.setAttribute('aria-pressed', String((event as CustomEvent<boolean>).detail)); });

	bar.append(titleWrap, segment, rss, ai, copy, download, clip);
	bar.insertBefore(extras, rss);
	return bar;
}

// Hide the bar while scrolling down; bring it back on scroll up, when the pointer nears the top, or on focus.
// `collapseLayout`: also give the freed height back to the page (editor panes scroll inside, so they need it).
// Page-level scrolling (reading mode) keeps its layout fixed, otherwise hiding the bar shifts the content and re-triggers scrolling.
export function autoHideBar(bar: HTMLElement, { collapseLayout = false }: { collapseLayout?: boolean } = {}): void {
	const root = document.documentElement;
	root.classList.toggle('clip-bar-collapse', collapseLayout);
	const lastTop = new WeakMap<object, number>();
	let quietUntil = 0;
	const setHidden = (hidden: boolean) => {
		if (bar.classList.contains('is-hidden') === hidden) return;
		bar.classList.toggle('is-hidden', hidden);
		root.classList.toggle('clip-bar-hidden', hidden);
		quietUntil = Date.now() + 400; // layout changes caused by the transition are not user scrolling
	};
	document.addEventListener('scroll', event => {
		const target = event.target as Document | HTMLElement;
		// The chat panel scrolls on its own and must not toggle the bar.
		if (target !== document && (target as HTMLElement).closest?.('.clip-chat')) return;
		const top = target === document ? window.scrollY : (target as HTMLElement).scrollTop;
		const previous = lastTop.get(target);
		lastTop.set(target, top);
		if (previous === undefined || Date.now() < quietUntil) return;
		const delta = top - previous;
		if (Math.abs(delta) < 8) return;
		if (delta > 0 && top > 50) setHidden(true);
		else if (delta < 0) setHidden(false);
	}, { capture: true, passive: true });
	document.addEventListener('mousemove', event => { if (event.clientY < 40) setHidden(false); }, { passive: true });
	bar.addEventListener('focusin', () => setHidden(false));
}

export function setClipBarHighlights(bar: HTMLElement, count: number): void {
	const chip = bar.querySelector<HTMLButtonElement>('.clip-bar-highlights');
	if (!chip) return;
	chip.hidden = count <= 0;
	chip.querySelector('span')!.textContent = String(count);
	chip.title = getMessage('qiaomuHighlightCount', String(count));
	chip.setAttribute('aria-label', chip.title);
}
