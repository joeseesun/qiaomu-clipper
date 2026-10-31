import type { Editor } from '@tiptap/core';
import { ChevronsLeft, ChevronsRight } from 'lucide';
import { h, icon } from './editor/dom';
import { t } from '../utils/ui-text';

export interface OutlineItem { text: string; level: number; pos: number }
export type OutlineMode = 'open' | 'tick';

const STORAGE_KEY = 'qiaomuWriteOutline';
const TOP_GAP = 96;

export function headingsOf(editor: Editor): OutlineItem[] {
	const items: OutlineItem[] = [];
	editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') items.push({ text: node.textContent.trim(), level: node.attrs.level, pos }); return false; });
	return items;
}

// The heading the reader is on: the last one whose top has passed the line just under the top bar.
export function activeHeading(tops: number[], line = TOP_GAP): number {
	let active = 0;
	tops.forEach((top, index) => { if (top <= line) active = index; });
	return active;
}

function savedMode(): OutlineMode {
	try { const value = localStorage.getItem(STORAGE_KEY); if (value === 'open' || value === 'tick') return value; } catch { /* private window */ }
	return window.innerWidth >= 1180 ? 'open' : 'tick';
}

// A reading rail like Feishu's: the document title and its headings, the current one in colour. Folded, it is a column of short
// ticks (longer for higher levels); pointing at them opens the full list.
export function mountOutline(aside: HTMLElement, getEditor: () => Editor, getTitle: () => string) {
	let mode = savedMode();
	let items: OutlineItem[] = [];
	let active = 0;
	let pop: HTMLElement | null = null;
	let closeTimer: number | undefined;
	let refreshTimer: number | undefined;
	let raf = 0;

	const goTo = (item: OutlineItem) => {
		const editor = getEditor();
		editor.chain().setTextSelection(item.pos + 1).run();
		const dom = editor.view.nodeDOM(item.pos);
		if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};
	const list = (): HTMLElement => {
		const box = h('div', { class: 'qw-ol-list', role: 'list' });
		items.forEach((item, index) => {
			const row = h('button', { type: 'button', class: `qw-ol-item${index === active ? ' active' : ''}`, 'aria-current': index === active ? 'true' : 'false', title: item.text, text: item.text || t('（空标题）') });
			row.style.paddingInlineStart = `${8 + (item.level - 1) * 14}px`;
			row.addEventListener('click', () => goTo(item));
			box.append(row);
		});
		return box;
	};
	const closePop = () => { window.clearTimeout(closeTimer); pop?.remove(); pop = null; };
	const openPop = () => {
		window.clearTimeout(closeTimer);
		if (pop || mode !== 'tick' || !items.length) return;
		const rect = aside.getBoundingClientRect();
		pop = h('div', { class: 'qw-ol-pop' }, h('div', { class: 'qw-ol-head' }, h('span', { class: 'qw-ol-title', text: getTitle().trim() || t('未命名文章') })), list());
		pop.style.top = `${Math.max(60, rect.top)}px`;
		pop.style.right = '12px';
		pop.addEventListener('mouseenter', () => window.clearTimeout(closeTimer));
		pop.addEventListener('mouseleave', () => { closeTimer = window.setTimeout(closePop, 160); });
		document.body.append(pop);
	};
	const toggle = () => {
		mode = mode === 'open' ? 'tick' : 'open';
		try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private window */ }
		closePop(); render();
	};

	function render() {
		aside.textContent = '';
		aside.hidden = items.length === 0;
		aside.dataset.mode = mode;
		if (!items.length) return;
		if (mode === 'open') {
			const fold = h('button', { type: 'button', class: 'qw-ol-fold', title: t('收起大纲'), 'aria-label': t('收起大纲') }, icon(ChevronsRight, 16));
			fold.addEventListener('click', toggle);
			aside.append(h('div', { class: 'qw-ol-head' }, fold, h('span', { class: 'qw-ol-title', text: getTitle().trim() || t('未命名文章') })), list());
		} else {
			const ticks = h('div', { class: 'qw-ol-ticks', role: 'button', tabindex: 0, 'aria-label': t('展开大纲') });
			items.forEach((item, index) => { const tick = h('span', { class: `qw-ol-tick l${item.level}${index === active ? ' active' : ''}` }); ticks.append(tick); });
			ticks.addEventListener('click', toggle);
			ticks.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
			aside.append(ticks, h('button', { type: 'button', class: 'qw-ol-fold ghost', title: t('展开大纲'), 'aria-label': t('展开大纲'), onclick: toggle }, icon(ChevronsLeft, 16)));
		}
	}

	const sync = () => {
		raf = 0;
		if (!items.length) return;
		const tops = items.map(item => { const dom = getEditor().view.nodeDOM(item.pos); return dom instanceof HTMLElement ? dom.getBoundingClientRect().top : Number.POSITIVE_INFINITY; });
		const next = activeHeading(tops);
		if (next === active) return;
		active = next;
		aside.querySelectorAll('.qw-ol-item').forEach((el, i) => { el.classList.toggle('active', i === active); el.setAttribute('aria-current', i === active ? 'true' : 'false'); });
		aside.querySelectorAll('.qw-ol-tick').forEach((el, i) => el.classList.toggle('active', i === active));
		pop?.querySelectorAll('.qw-ol-item').forEach((el, i) => el.classList.toggle('active', i === active));
	};
	const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
	const scrollRoot = aside.closest('.qw-layout')?.querySelector('.qw-scroll') || window;
	scrollRoot.addEventListener('scroll', onScroll, { passive: true });
	aside.addEventListener('mouseenter', openPop);
	aside.addEventListener('mouseleave', () => { closeTimer = window.setTimeout(closePop, 160); });

	return {
		// Called after every edit; reads the headings again a moment later so typing is not slowed down.
		refresh() {
			window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				const next = headingsOf(getEditor());
				const same = next.length === items.length && next.every((item, i) => item.text === items[i].text && item.level === items[i].level);
				items = next;
				if (!same) { active = 0; closePop(); render(); }
				else items.forEach((item, i) => { items[i] = next[i]; });
				sync();
			}, 200);
		},
		retitle() { const title = aside.querySelector('.qw-ol-title'); if (title) title.textContent = getTitle().trim() || t('未命名文章'); },
		toggle,
		destroy() { scrollRoot.removeEventListener('scroll', onScroll); window.clearTimeout(refreshTimer); cancelAnimationFrame(raf); closePop(); },
	};
}
