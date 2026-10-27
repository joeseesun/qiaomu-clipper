import { Bookmark, createElement } from 'lucide';
import type { StoredTurn } from './chat-history';
import { t } from './ui-text';

interface Entry { turn: StoredTurn; question: HTMLElement; answers: HTMLElement[]; marker: HTMLButtonElement; saving: boolean }
interface NavigationOptions {
	area?: HTMLElement;
	viewport: HTMLElement;
	list?: HTMLElement;
	onBookmark: (turn: StoredTurn) => Promise<void>;
}

// The navigator owns only its own scroll position. The conversation scrolls
// exclusively in jump(), following an explicit mouse or keyboard activation.
export function mountChatTurnNavigation(options: NavigationOptions) {
	const { viewport, onBookmark } = options;
	const list = options.list ?? viewport;
	const sharedArea = options.area ?? viewport.closest<HTMLElement>('.clip-chat-message-area');
	const area = sharedArea ?? document.createElement('div');
	area.classList.add('clip-chat-nav-area');
	if (!sharedArea) { viewport.before(area); area.append(viewport); }
	const lifetime = new AbortController(), events = { signal: lifetime.signal };
	const uid = `chat-nav-${crypto.randomUUID()}`;
	const rail = document.createElement('nav'); rail.className = 'clip-chat-turn-nav'; rail.setAttribute('aria-label', t('提问导航')); rail.hidden = true;
	const track = document.createElement('div'); track.className = 'clip-chat-turn-track'; rail.append(track);
	const preview = document.createElement('div'); preview.className = 'clip-chat-turn-preview'; preview.hidden = true; preview.id = uid;
	preview.setAttribute('role', 'group'); preview.setAttribute('aria-label', t('提问预览'));
	const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'clip-chat-turn-preview-jump';
	const title = document.createElement('span'); title.className = 'clip-chat-turn-preview-title';
	const excerpt = document.createElement('span'); excerpt.className = 'clip-chat-turn-preview-excerpt';
	const state = document.createElement('span'); state.className = 'clip-chat-turn-preview-state';
	excerpt.id = `${uid}-excerpt`; state.id = `${uid}-state`;
	jump.setAttribute('aria-describedby', `${excerpt.id} ${state.id}`);
	jump.append(title, excerpt, state);
	const bookmark = document.createElement('button'); bookmark.type = 'button'; bookmark.className = 'clip-chat-turn-bookmark'; bookmark.append(createElement(Bookmark));
	const error = document.createElement('span'); error.className = 'clip-chat-turn-preview-error'; error.setAttribute('role', 'status');
	preview.append(jump, bookmark, error); area.append(rail, preview);
	let entries: Entry[] = [], active: Entry | undefined, opened: Entry | undefined, focused: Entry | undefined;
	let showTimer: ReturnType<typeof setTimeout> | undefined, hideTimer: ReturnType<typeof setTimeout> | undefined, frame = 0;
	let pointerInside = false, suppressFocus = false, serial = 0;
	const plain = (text: string) => text.replace(/\s+/g, ' ').trim();
	const label = (entry: Entry) => plain(entry.turn.content) || t('图片提问');
	const positionPreview = () => {
		if (!opened || preview.hidden) return;
		const bounds = area.getBoundingClientRect(), anchor = opened.marker.getBoundingClientRect();
		preview.style.top = `${Math.max(4, Math.min(anchor.top - bounds.top + anchor.height / 2 - preview.offsetHeight / 2, bounds.height - preview.offsetHeight - 4))}px`;
	};
	function paintPreview() {
		if (!opened) return;
		title.textContent = label(opened);
		excerpt.textContent = plain(opened.answers.map(answer => {
			const body = answer.querySelector<HTMLElement>('.clip-chat-body');
			return body?.innerText || body?.textContent || '';
		}).join(' ')).slice(0, 240) || t('等待回复…');
		state.textContent = [t('第 {0} 轮', [entries.indexOf(opened) + 1]), opened.turn.bookmarked ? t('已收藏') : '', opened === active ? t('当前阅读') : ''].filter(Boolean).join(' · ');
		bookmark.title = opened.turn.bookmarked ? t('取消收藏') : t('收藏这一轮');
		bookmark.setAttribute('aria-label', bookmark.title); bookmark.setAttribute('aria-pressed', String(!!opened.turn.bookmarked)); bookmark.setAttribute('aria-disabled', String(opened.saving));
		jump.setAttribute('aria-label', t('跳到提问：{0}', [label(opened).slice(0, 120)]));
		preview.classList.toggle('is-bookmarked', !!opened.turn.bookmarked);
		positionPreview();
	}
	function paintMarkers() {
		for (const [index, entry] of entries.entries()) {
			entry.marker.classList.toggle('is-current', entry === active);
			entry.marker.classList.toggle('is-bookmarked', !!entry.turn.bookmarked);
			entry.marker.setAttribute('aria-label', `${t('第 {0} 轮', [index + 1])}：${label(entry).slice(0, 120)}${entry.turn.bookmarked ? ` · ${t('已收藏')}` : ''}`);
			if (entry === active) entry.marker.setAttribute('aria-current', 'location'); else entry.marker.removeAttribute('aria-current');
			entry.marker.tabIndex = entry === (focused || active) || (!focused && !active && index === 0) ? 0 : -1;
		}
		paintPreview();
	}
	function revealMarker(entry: Entry) {
		const y = entry.marker.offsetTop, h = entry.marker.offsetHeight;
		if (y < rail.scrollTop) rail.scrollTop = y;
		else if (y + h > rail.scrollTop + rail.clientHeight) rail.scrollTop = y + h - rail.clientHeight;
	}
	function dismiss() {
		clearTimeout(showTimer); clearTimeout(hideTimer);
		opened?.marker.setAttribute('aria-expanded', 'false');
		opened = undefined; preview.hidden = true; error.textContent = '';
		entries.forEach(entry => { entry.marker.classList.remove('is-near', 'is-hovered'); });
	}
	function show(entry: Entry) {
		if (lifetime.signal.aborted || !entries.includes(entry)) return;
		clearTimeout(showTimer); clearTimeout(hideTimer);
		if (opened !== entry) error.textContent = '';
		opened?.marker.setAttribute('aria-expanded', 'false'); opened = entry;
		entry.marker.setAttribute('aria-expanded', 'true'); preview.hidden = false;
		entries.forEach((other, index) => { other.marker.classList.toggle('is-hovered', other === entry); other.marker.classList.toggle('is-near', Math.abs(index - entries.indexOf(entry)) === 1); });
		paintPreview();
	}
	function scheduleHide() {
		clearTimeout(showTimer); clearTimeout(hideTimer);
		hideTimer = setTimeout(() => { if (!preview.contains(document.activeElement) && !rail.contains(document.activeElement)) dismiss(); }, 180);
	}
	function jumpTo(entry: Entry) {
		if (!list.contains(entry.question)) return;
		const top = entry.question.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 14;
		viewport.scrollTop = Math.max(0, top); dismiss(); refresh();
		entry.question.focus({ preventScroll: true });
	}
	jump.addEventListener('click', () => { if (opened) jumpTo(opened); }, events);
	// Pointer use must not pin a hover card open by moving keyboard focus into it.
	bookmark.addEventListener('pointerdown', event => event.preventDefault(), events);
	bookmark.addEventListener('click', async () => {
		const entry = opened;
		if (!entry || entry.saving) return;
		const previous = !!entry.turn.bookmarked;
		entry.turn.bookmarked = !previous; entry.saving = true; error.textContent = ''; paintMarkers();
		try { await onBookmark(entry.turn); }
		catch { entry.turn.bookmarked = previous; if (opened === entry) error.textContent = t('收藏未能保存，请重试。'); }
		finally { entry.saving = false; if (!lifetime.signal.aborted) paintMarkers(); }
	}, events);
	for (const surface of [rail, preview]) {
		surface.addEventListener('pointerenter', () => { pointerInside = true; clearTimeout(hideTimer); }, events);
		surface.addEventListener('pointerleave', event => {
			if (event.relatedTarget instanceof Node && (rail.contains(event.relatedTarget) || preview.contains(event.relatedTarget))) return;
			pointerInside = false; scheduleHide();
		}, events);
		surface.addEventListener('focusout', event => {
			if (event.relatedTarget instanceof Node && (rail.contains(event.relatedTarget) || preview.contains(event.relatedTarget))) return;
			focused = undefined; paintMarkers();
			if (!pointerInside) scheduleHide();
		}, events);
		surface.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			event.preventDefault(); event.stopPropagation(); const marker = opened?.marker; dismiss();
			suppressFocus = true; marker?.focus({ preventScroll: true }); suppressFocus = false;
		}, events);
	}
	area.addEventListener('pointerdown', event => { if (event.target instanceof Node && !rail.contains(event.target) && !preview.contains(event.target)) dismiss(); }, events);
	rail.addEventListener('scroll', positionPreview, { ...events, passive: true });
	function refresh() {
		if (lifetime.signal.aborted) return;
		const retained = entries.filter(entry => list.contains(entry.question));
		if (retained.length !== entries.length) { entries.filter(entry => !retained.includes(entry)).forEach(entry => { entry.marker.remove(); resizeObserver?.unobserve(entry.question); entry.answers.forEach(answer => resizeObserver?.unobserve(answer)); }); entries = retained; if (opened && !entries.includes(opened)) dismiss(); if (focused && !entries.includes(focused)) focused = undefined; }
		const visible = !!entries.length && area.getBoundingClientRect().width >= 340;
		rail.hidden = !visible; area.classList.toggle('has-turn-navigation', visible);
		if (!visible) { dismiss(); return; }
		if (!viewport.clientHeight) return;
		const edge = viewport.getBoundingClientRect().top + Math.min(80, viewport.clientHeight * .2);
		let next = entries[0];
		for (const entry of entries) { if (entry.question.getBoundingClientRect().top <= edge) next = entry; else break; }
		if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2) next = entries[entries.length - 1];
		const changed = active !== next; active = next; paintMarkers();
		if (changed && !pointerInside && !rail.contains(document.activeElement) && !preview.contains(document.activeElement)) revealMarker(next);
	}
	function scheduleRefresh() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; refresh(); }); }
	// Own lifecycle observers so navigation also works without the scroll feature.
	// Observe individual messages to catch loaded images and streamed growth when
	// the viewport is the list (rather than a separate content wrapper).
	const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleRefresh);
	resizeObserver?.observe(area); resizeObserver?.observe(viewport);
	if (list !== viewport) resizeObserver?.observe(list);
	const mutations = new MutationObserver(scheduleRefresh);
	mutations.observe(list, { childList: true, subtree: true, characterData: true });
	viewport.addEventListener('scroll', scheduleRefresh, { ...events, passive: true });
	return {
		refresh, dismiss,
		add(turn: StoredTurn, element: HTMLElement) {
			resizeObserver?.observe(element);
			if (turn.role !== 'user') { entries[entries.length - 1]?.answers.push(element); return; }
			element.id = `${uid}-${++serial}`; element.tabIndex = -1;
			const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'clip-chat-turn-marker';
			marker.setAttribute('aria-controls', element.id); marker.setAttribute('aria-expanded', 'false');
			const line = document.createElement('span'); line.className = 'clip-chat-turn-line'; line.setAttribute('aria-hidden', 'true');
			marker.append(line);
			const entry: Entry = { turn, question: element, answers: [], marker, saving: false }; entries.push(entry); track.append(marker); rail.hidden = false; area.classList.add('has-turn-navigation');
			marker.addEventListener('pointerenter', () => { clearTimeout(showTimer); clearTimeout(hideTimer); showTimer = setTimeout(() => show(entry), 90); }, events);
			marker.addEventListener('focus', () => { focused = entry; paintMarkers(); if (!suppressFocus) show(entry); }, events);
			marker.addEventListener('click', () => jumpTo(entry), events);
			marker.addEventListener('keydown', event => {
				const index = entries.indexOf(entry);
				const destination = event.key === 'ArrowDown' ? Math.min(index + 1, entries.length - 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : -1;
				if (destination >= 0) { event.preventDefault(); revealMarker(entries[destination]); entries[destination].marker.focus({ preventScroll: true }); }
				else if (event.key === 'ArrowRight') { event.preventDefault(); show(entry); bookmark.focus({ preventScroll: true }); }
			}, events);
			paintMarkers(); scheduleRefresh();
		},
		reset() { dismiss(); entries.forEach(entry => { resizeObserver?.unobserve(entry.question); entry.answers.forEach(answer => resizeObserver?.unobserve(answer)); }); entries = []; active = undefined; focused = undefined; pointerInside = false; track.replaceChildren(); rail.scrollTop = 0; rail.hidden = true; area.classList.remove('has-turn-navigation'); },
		destroy() { dismiss(); lifetime.abort(); resizeObserver?.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); rail.remove(); preview.remove(); area.classList.remove('has-turn-navigation', 'clip-chat-nav-area'); if (!sharedArea && area.parentNode) area.replaceWith(viewport); }
	};
}
