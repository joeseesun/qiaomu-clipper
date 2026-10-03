import { createElement, Columns2, PanelLeft, RectangleHorizontal, PictureInPicture2, ExternalLink } from 'lucide';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { documentPipSupported, openDocumentPip, trackPlayback } from './youtube-pip';

// dock: video beside the transcript (stacked on narrow pages); theater: full-width video above
// the text; float: a small window pinned to a corner of the page.
export type PlayerMode = 'dock' | 'theater' | 'float';
export type PlayerLayout = 'side' | 'stack' | 'theater' | 'float';
export type FloatCorner = 'br' | 'bl' | 'tr' | 'tl';

export const LAYOUT_EVENT = 'youtube-player-layout';
const SIDE_ENTER = 1000, SIDE_LEAVE = 960; // hysteresis: a new scrollbar must not flip the layout back and forth
const FLOAT_MIN = 240, FLOAT_MAX = 640, FLOAT_DEFAULT = 360;
const MODE_KEY = 'qiaomuYouTubePlayerMode', FLOAT_KEY = 'qiaomuYouTubeFloat';

export const normalizeMode = (value: unknown): PlayerMode => value === 'theater' || value === 'float' ? value : 'dock';
export const normalizeCorner = (value: unknown): FloatCorner => value === 'bl' || value === 'tr' || value === 'tl' ? value : 'br';
// The saved width is a preference; a narrow window shows it smaller without overwriting it.
export const clampFloatWidth = (value: unknown): number => {
	const width = typeof value === 'number' && Number.isFinite(value) ? value : FLOAT_DEFAULT;
	return Math.round(Math.max(FLOAT_MIN, Math.min(FLOAT_MAX, width)));
};
export const visibleFloatWidth = (preferred: number, viewport: number): number => Math.round(Math.max(FLOAT_MIN, Math.min(preferred, viewport * 0.6)));

// A page without the player container (subtitles still loading) behaves like theater.
export function resolveLayout(mode: PlayerMode, articleWidth: number, hasContainer: boolean, current?: PlayerLayout): PlayerLayout {
	if (!hasContainer) return 'theater';
	if (mode !== 'dock') return mode;
	return articleWidth >= SIDE_ENTER || (current === 'side' && articleWidth >= SIDE_LEAVE) ? 'side' : 'stack';
}

// Widest the video may be at 100%: leave room for the transcript beside it, or for text below it.
export function maxPlayerWidth(layout: PlayerLayout, width: number, height: number, bar: number): number {
	const fit = (h: number) => h * 16 / 9;
	const full = fit(height - bar - 124);
	const max = layout === 'side' ? Math.min(width * 0.55, width - 540, full)
		: layout === 'stack' ? Math.min(full, fit(height * 0.46))
		: full;
	return Math.min(width, Math.max(356, max));
}

export const nearestCorner = (centerX: number, centerY: number, viewportWidth: number, viewportHeight: number): FloatCorner =>
	(centerY < viewportHeight / 2 ? 't' : 'b') + (centerX < viewportWidth / 2 ? 'l' : 'r') as FloatCorner;

const CORNERS: FloatCorner[] = ['br', 'bl', 'tl', 'tr'];

// Changes presentation only: the iframe keeps its DOM node and URL when the mode changes.
export function mountPlayerMode(article: HTMLElement): void {
	if (article.dataset.ytModeMounted) { article.dispatchEvent(new CustomEvent(LAYOUT_EVENT)); return; }
	const doc = article.ownerDocument, win = doc.defaultView;
	if (!win) return;
	article.dataset.ytModeMounted = 'true';
	const container = () => article.querySelector<HTMLElement>('.player-container');
	let mode: PlayerMode = 'dock', corner: FloatCorner = 'br', floatWidth = FLOAT_DEFAULT, touched = false;

	const button = (name: string, icon: Parameters<typeof createElement>[0], title: string) => {
		const el = doc.createElement('button'); el.type = 'button'; el.className = `youtube-mode-btn youtube-mode-${name}`;
		el.title = title; el.setAttribute('aria-label', title); el.append(createElement(icon));
		return el;
	};
	const bar = doc.createElement('div'); bar.className = 'youtube-mode-bar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '视频位置');
	const buttons: Record<PlayerMode, HTMLButtonElement> = {
		dock: button('dock', Columns2, '停靠：视频固定在文稿旁（窄屏在文稿上方）'),
		theater: button('theater', RectangleHorizontal, '剧场：视频占满宽度，文稿在下方'),
		float: button('float', PictureInPicture2, '小窗：视频悬浮在页面角落，文稿占满宽度'),
	};
	bar.append(buttons.dock, buttons.theater, buttons.float);
	let pipButton: HTMLButtonElement | undefined;
	if (documentPipSupported(win)) {
		pipButton = button('pip', ExternalLink, '浮出窗口：在浏览器之外置顶播放（会重新加载并回到当前进度）');
		bar.append(pipButton); trackPlayback(article);
	}
	// Overlay of the floating window: drag strip, return-to-dock button and a resize grip.
	const chrome = doc.createElement('div'); chrome.className = 'youtube-float-chrome';
	const strip = doc.createElement('div'); strip.className = 'youtube-float-drag'; strip.tabIndex = 0; strip.setAttribute('role', 'button');
	strip.setAttribute('aria-label', '拖动视频小窗；按回车切换到下一个角落'); strip.title = '拖动到任意位置，松开后吸附到最近的角落';
	const back = button('back', PanelLeft, '回到停靠'); back.classList.add('youtube-float-back');
	const grip = doc.createElement('div'); grip.className = 'youtube-float-resize'; grip.tabIndex = 0; grip.setAttribute('role', 'slider');
	grip.setAttribute('aria-label', '调整小窗大小'); grip.setAttribute('aria-valuemin', String(FLOAT_MIN)); grip.setAttribute('aria-valuemax', String(FLOAT_MAX));
	grip.title = '拖动调整小窗大小；方向键微调';
	chrome.append(strip, back, grip);

	const playerEl = () => article.querySelector<HTMLElement>('.youtube-sized-player');
	const layoutOf = () => article.dataset.ytLayout as PlayerLayout | undefined;
	const mountUi = () => {
		const host = container(); if (!host) return;
		if (bar.parentElement !== host) host.append(bar);
		if (chrome.parentElement !== host) host.append(chrome);
	};
	const paintFloat = () => {
		article.dataset.ytCorner = corner; const shown = visibleFloatWidth(floatWidth, win.innerWidth); article.style.setProperty('--yt-float-width', `${shown}px`);
		grip.setAttribute('aria-valuenow', String(shown)); grip.setAttribute('aria-valuetext', `${shown} 像素宽`);
	};
	const paintButtons = () => {
		(Object.keys(buttons) as PlayerMode[]).forEach(key => buttons[key].setAttribute('aria-pressed', String(key === mode)));
	};
	const applyLayout = () => {
		const width = article.getBoundingClientRect().width;
		const next = resolveLayout(mode, width || 0, !!container(), layoutOf());
		if (next !== layoutOf()) article.dataset.ytLayout = next;
		article.dataset.ytMode = mode; paintButtons(); paintFloat();
		article.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
	};
	// Keep the line being read at the same height when the layout rearranges the page.
	// At the top of the page nothing is being read yet, so show the new layout from its start.
	const keepReadingPosition = (change: () => void, active = win.scrollY > 40) => {
		if (!active) { change(); return; }
		const top = (doc.querySelector('.clip-bar')?.getBoundingClientRect().bottom || 0);
		const anchor = Array.from(article.querySelectorAll<HTMLElement>('.transcript-segment')).find(el => el.getBoundingClientRect().bottom > top + 8);
		const before = anchor?.getBoundingClientRect().top;
		change();
		const after = anchor?.getBoundingClientRect().top;
		if (before !== undefined && after !== undefined && Math.abs(after - before) > 1) win.scrollBy(0, after - before);
	};
	const persist = () => { void setLocalStorage(MODE_KEY, mode).catch(() => {}); void setLocalStorage(FLOAT_KEY, { corner, width: floatWidth }).catch(() => {}); };
	const setMode = (next: PlayerMode) => {
		if (next === mode) return;
		touched = true; mode = next;
		keepReadingPosition(() => { mountUi(); applyLayout(); });
		persist();
	};
	buttons.dock.onclick = () => setMode('dock'); buttons.theater.onclick = () => setMode('theater'); buttons.float.onclick = () => setMode('float');
	back.onclick = () => setMode('dock');
	if (pipButton) pipButton.onclick = () => { const frame = article.querySelector<HTMLIFrameElement>('iframe[src*="youtube.com/embed/"]'); if (frame) void openDocumentPip(article, frame); };

	// Floating window: drag anywhere, snap to the nearest corner on release.
	let drag: { pointerId: number; dx: number; dy: number; moved: boolean } | undefined;
	const rectOfWindow = () => (playerEl() || chrome).getBoundingClientRect();
	strip.onpointerdown = event => {
		if (event.button !== 0) return;
		const rect = rectOfWindow(); if (!rect.width) return;
		event.preventDefault(); strip.focus({ preventScroll: true });
		drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
		try { strip.setPointerCapture(event.pointerId); } catch { /* document listeners cover this */ }
		doc.documentElement.classList.add('youtube-player-resizing');
	};
	const dragMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const rect = rectOfWindow(), vw = win.innerWidth, vh = win.innerHeight;
		const left = Math.max(0, Math.min(vw - rect.width, event.clientX - drag.dx)), top = Math.max(0, Math.min(vh - rect.height, event.clientY - drag.dy));
		drag.moved = true; article.dataset.ytDragging = 'true';
		article.style.setProperty('--yt-float-left', `${left}px`); article.style.setProperty('--yt-float-top', `${top}px`);
	};
	const dragEnd = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const moved = drag.moved; drag = undefined;
		doc.documentElement.classList.remove('youtube-player-resizing');
		if (strip.hasPointerCapture?.(event.pointerId)) strip.releasePointerCapture(event.pointerId);
		if (!moved) return;
		const rect = rectOfWindow();
		corner = nearestCorner(rect.left + rect.width / 2, rect.top + rect.height / 2, win.innerWidth, win.innerHeight);
		delete article.dataset.ytDragging; article.style.removeProperty('--yt-float-left'); article.style.removeProperty('--yt-float-top');
		touched = true; paintFloat(); persist();
	};
	strip.onkeydown = event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault(); corner = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length]; touched = true; paintFloat(); persist();
	};
	// Resize from the inner corner: the window grows away from its anchored corner.
	let sizing: { pointerId: number; x: number; width: number } | undefined;
	const sizeTo = (width: number) => { floatWidth = clampFloatWidth(width); paintFloat(); };
	grip.onpointerdown = event => {
		if (event.button !== 0) return;
		event.preventDefault(); grip.focus({ preventScroll: true });
		sizing = { pointerId: event.pointerId, x: event.clientX, width: rectOfWindow().width || visibleFloatWidth(floatWidth, win.innerWidth) };
		try { grip.setPointerCapture(event.pointerId); } catch { /* document listeners cover this */ }
		doc.documentElement.classList.add('youtube-player-resizing');
	};
	const sizeMove = (event: PointerEvent) => {
		if (!sizing || event.pointerId !== sizing.pointerId) return;
		const dx = event.clientX - sizing.x;
		sizeTo(sizing.width + (corner.endsWith('r') ? -dx : dx));
	};
	const sizeEnd = (event: PointerEvent) => {
		if (!sizing || event.pointerId !== sizing.pointerId) return;
		sizing = undefined; doc.documentElement.classList.remove('youtube-player-resizing');
		if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture(event.pointerId);
		touched = true; persist();
	};
	grip.onkeydown = event => {
		const delta: Record<string, number> = { ArrowRight: 20, ArrowUp: 20, ArrowLeft: -20, ArrowDown: -20 };
		const next = event.key === 'Home' ? FLOAT_MIN : event.key === 'End' ? FLOAT_MAX : delta[event.key] === undefined ? undefined : visibleFloatWidth(floatWidth, win.innerWidth) + delta[event.key];
		if (next === undefined) return;
		event.preventDefault(); touched = true; sizeTo(next); persist();
	};
	doc.addEventListener('pointermove', dragMove); doc.addEventListener('pointermove', sizeMove);
	doc.addEventListener('pointerup', dragEnd); doc.addEventListener('pointercancel', dragEnd);
	doc.addEventListener('pointerup', sizeEnd); doc.addEventListener('pointercancel', sizeEnd);
	strip.onlostpointercapture = dragEnd as unknown as typeof strip.onlostpointercapture; grip.onlostpointercapture = sizeEnd as unknown as typeof grip.onlostpointercapture;

	// Width changes (window, AI panel, outline) can switch between side and stacked layouts; the
	// container appears once subtitles arrive. Neither moves or reloads the player.
	const refresh = () => {
		if (!article.isConnected) { cleanup(); return; }
		mountUi(); applyLayout();
	};
	const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : undefined;
	resizeObserver?.observe(article);
	const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { if (container() && bar.parentElement !== container()) refresh(); }) : undefined;
	mutationObserver?.observe(article, { childList: true });
	win.addEventListener('resize', refresh);
	const cleanup = () => {
		resizeObserver?.disconnect(); mutationObserver?.disconnect(); win.removeEventListener('resize', refresh);
		doc.removeEventListener('pointermove', dragMove); doc.removeEventListener('pointermove', sizeMove);
		doc.removeEventListener('pointerup', dragEnd); doc.removeEventListener('pointercancel', dragEnd);
		doc.removeEventListener('pointerup', sizeEnd); doc.removeEventListener('pointercancel', sizeEnd);
		doc.documentElement.classList.remove('youtube-player-resizing');
	};
	win.addEventListener('pagehide', cleanup, { once: true });
	refresh();
	void Promise.all([getLocalStorage(MODE_KEY), getLocalStorage(FLOAT_KEY)]).then(([savedMode, savedFloat]) => {
		if (touched) return;
		mode = normalizeMode(savedMode);
		const saved = (savedFloat && typeof savedFloat === 'object' ? savedFloat : {}) as { corner?: unknown; width?: unknown };
		corner = normalizeCorner(saved.corner); floatWidth = clampFloatWidth(saved.width);
		keepReadingPosition(() => applyLayout(), false);
	}).catch(() => {});
}
