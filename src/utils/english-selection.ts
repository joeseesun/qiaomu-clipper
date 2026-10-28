import type { EnglishContext } from './english-dictionary';
import { englishText } from './english-ui';

export const selectionApi = () => (typeof browser !== 'undefined' ? browser : chrome) as typeof chrome;
export interface LearningSelection { input: EnglishContext; range: Range; rect: DOMRect }
// Prefer a full card below/above/beside the selection; shorten it only when needed.
export function learningCardBounds(rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, viewportWidth: number, viewportHeight: number, desiredHeight: number) {
	const edge = 8, gap = 10, width = Math.max(1, Math.min(480, viewportWidth - edge * 2));
	const height = Math.max(1, Math.min(desiredHeight, viewportHeight - edge * 2));
	const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge));
	const below = Math.max(0, viewportHeight - edge - rect.bottom - gap), above = Math.max(0, rect.top - gap - edge);
	if (below >= height) return { left, top: rect.bottom + gap, width, height };
	if (above >= height) return { left, top: rect.top - gap - height, width, height };
	const top = Math.max(edge, Math.min(rect.top, viewportHeight - height - edge));
	if (viewportWidth - rect.right - gap - edge >= width) return { left: rect.right + gap, top, width, height };
	if (rect.left - gap - edge >= width) return { left: rect.left - gap - width, top, width, height };
	if (below || above) return below >= above ? { left, top: rect.bottom + gap, width, height: Math.min(height, below) } : { left, top: edge, width, height: Math.min(height, above) };
	// A selection covering the entire viewport leaves no adjacent space.
	return { left, top: edge, width, height };
}
export function captureEnglishSelection(doc: Document = document): LearningSelection | undefined {
	// An input may retain the page's previous DOM range while it owns focus.
	if (doc.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .learning-composer')) return;
	const selection = doc.getSelection();
	if (!selection || selection.isCollapsed || !selection.rangeCount) return;
	const range = selection.getRangeAt(0).cloneRange();
	const element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
	if (!element || element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-qiaomu-selection-ui], .clip-chat, .clip-bar, .clip-ask-pill, .learning-selection-menu, .learning-composer, #qiaomu-note-card')) return;
	const text = selection.toString().replace(/\s+/g, ' ').trim();
	if (!text) return;
	const block = element.closest('p, li, blockquote, pre, h1, h2, h3, h4, td') || element;
	const content = block.textContent || '';
	let offset = Math.max(0, content.indexOf(selection.toString()));
	try { const before = range.cloneRange(); before.selectNodeContents(block); before.setEnd(range.startContainer, range.startOffset); offset = before.toString().length; } catch { /* multi-block selection */ }
	const start = Math.max(0, offset - 500);
	const nearby = (direction: 'previousElementSibling' | 'nextElementSibling'): string => {
		let neighbor = block[direction];
		for (let i = 0; neighbor && i < 3; i++, neighbor = neighbor?.[direction] || null) {
			if (neighbor.matches('h1,h2,h3,h4,h5,h6')) break;
			if (!neighbor.matches('p,li,blockquote,pre,td') || neighbor.closest('[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[data-qiaomu-selection-ui],.clip-chat') || neighbor.querySelector('input,textarea,[contenteditable]:not([contenteditable="false"])')) continue;
			const style = doc.defaultView?.getComputedStyle(neighbor);
			if (style?.display === 'none' || style?.visibility === 'hidden') continue;
			return ((neighbor as HTMLElement).innerText ?? neighbor.textContent ?? '').replace(/\s+/g, ' ').trim();
		}
		return '';
	};
	const beforeBudget = Math.max(0, 500 - offset), afterBudget = Math.max(0, 700 - (content.length - offset - text.length));
	const context = [beforeBudget ? nearby('previousElementSibling').slice(-beforeBudget) : '', content.slice(start, Math.min(content.length, offset + text.length + 700)), afterBudget ? nearby('nextElementSibling').slice(0, afterBudget) : ''].filter(Boolean).join('\n').replace(/[\t ]+/g, ' ').trim().slice(0, 3000);
	const rect = range.getBoundingClientRect();
	if (!rect.width && !rect.height) return;
	const theme = doc.documentElement.classList.contains('theme-dark') ? 'dark' : doc.documentElement.classList.contains('theme-light') ? 'light' : undefined;
	return { input: { text, context, title: doc.title.slice(0, 300), ...(theme ? { theme } : {}) }, range, rect };
}

// Extension-owned frame: site CSS, media CSP and scripts cannot alter the learning UI.
export async function openEnglishLearning(selection: LearningSelection, language?: string, trigger?: HTMLElement): Promise<void> {
	const doc = selection.range.startContainer.ownerDocument || document;
	const view = doc.defaultView || window, api = selectionApi(), l = englishText(language);
	view.dispatchEvent(new Event('qiaomu-close-learning'));
	const host = doc.createElement('div'); host.id = 'qiaomu-english-card'; host.dataset.qiaomuSelectionUi = 'true';
	const root = host.attachShadow({ mode: 'closed' });
	const css = doc.createElement('style');
	css.textContent = ':host{all:initial!important;display:block!important;position:fixed!important;left:var(--qiaomu-learning-left)!important;top:var(--qiaomu-learning-top)!important;width:var(--qiaomu-learning-width)!important;height:var(--qiaomu-learning-height)!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;color-scheme:light dark!important}iframe{display:block;width:100%;height:100%;border:0;border-radius:14px;box-shadow:0 8px 32px #0003;background:light-dark(#fff,#232426)}.error{font:14px/1.5 system-ui;padding:18px;border-radius:14px;background:light-dark(#fff,#232426);color:light-dark(#202124,#eee)}button{font:inherit;margin-left:12px;cursor:pointer}';
	root.append(css);
	doc.documentElement.append(host);
	// Popover top layer escapes transformed page ancestors without changing their layout.
	host.setAttribute('popover', 'manual');
	try { host.showPopover(); } catch { /* older reader/browser */ }
	let disposed = false, height = 420, frame: HTMLIFrameElement | undefined;
	const lifetime = new AbortController();
	const position = () => {
		const rect = selection.range.startContainer.isConnected ? selection.range.getBoundingClientRect() : selection.rect;
		for (const [key, value] of Object.entries(learningCardBounds(rect, view.innerWidth, view.innerHeight, height))) host.style.setProperty(`--qiaomu-learning-${key}`, `${value}px`, 'important');
	};
	const close = (restore = true) => {
		if (disposed) return;
		const ownedFocus = doc.activeElement === host || doc.activeElement === doc.body;
		disposed = true; lifetime.abort(); host.remove();
		if (!restore || !ownedFocus) return;
		if (trigger?.isConnected && trigger.getClientRects().length) { trigger.focus({ preventScroll: true }); return; }
		const start = selection.range.startContainer, element = start.nodeType === 1 ? start as HTMLElement : start.parentElement;
		const target = element?.closest<HTMLElement>('p, li, blockquote, pre, h1, h2, h3, h4, td') || element;
		if (target?.isConnected) {
			const old = target.getAttribute('tabindex'); target.tabIndex = -1; target.focus({ preventScroll: true });
			// Chrome blurs an otherwise non-focusable paragraph if tabindex is removed
			// immediately. Restore the page attribute only after focus leaves it.
			if (old === null) target.addEventListener('blur', () => { if (target.getAttribute('tabindex') === '-1') target.removeAttribute('tabindex'); }, { once: true });
			else target.setAttribute('tabindex', old);
			const current = doc.getSelection(); current?.removeAllRanges(); current?.addRange(selection.range);
		}
	};
	view.addEventListener('qiaomu-close-learning', () => close(false), { signal: lifetime.signal });
	view.addEventListener('pagehide', () => close(false), { signal: lifetime.signal });
	view.addEventListener('resize', position, { signal: lifetime.signal });
	doc.addEventListener('scroll', position, { capture: true, passive: true, signal: lifetime.signal });
	doc.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { signal: lifetime.signal });
	doc.addEventListener('pointerdown', e => { if (!e.composedPath().includes(host)) close(false); }, { signal: lifetime.signal });
	position();
	try {
		const result = await api.runtime.sendMessage({ action: 'qiaomuEnglishOpen', input: selection.input }) as { token?: string };
		if (disposed) return;
		if (!result?.token) throw new Error('selection');
		frame = doc.createElement('iframe'); frame.title = l('title'); frame.allow = 'autoplay'; frame.src = api.runtime.getURL(`english-learning.html#${result.token}`);
		const token = result.token;
		view.addEventListener('message', event => {
			if (event.source !== frame?.contentWindow || event.origin !== api.runtime.getURL('').replace(/\/$/, '') || event.data?.token !== token) return;
			if (event.data?.type === 'close') close();
			if (event.data?.type === 'height' && Number.isFinite(event.data.height)) { height = Math.max(160, Math.min(640, event.data.height)); position(); }
		}, { signal: lifetime.signal });
		root.append(frame);
	} catch {
		if (disposed) return;
		const error = doc.createElement('div'); error.className = 'error'; error.textContent = selection.input.text.length > 1500 || !/[a-zA-Z]/.test(selection.input.text) ? l('invalid') : l('expired');
		const button = doc.createElement('button'); button.textContent = l('close'); button.onclick = () => close(); error.append(button); root.append(error); height = 100; position(); button.focus();
	}
}
