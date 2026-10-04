import { PLAYER_SELECTOR } from './video-source';
import { getLocalStorage, setLocalStorage } from './storage-utils';
import { LAYOUT_EVENT, maxPlayerWidth, type PlayerLayout } from './youtube-player-mode';

export const normalizePlayerSize = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(35, Math.min(100, Math.round(value))) : 100;

// Change geometry only: never move, replace or reload the live player.
export function mountPlayerSize(article: HTMLElement): void {
	const findPlayer = () => article.querySelector<HTMLElement>('.reader-video-wrapper') || article.querySelector<HTMLElement>(PLAYER_SELECTOR) || article.querySelector<HTMLElement>('a[href*="youtube.com/watch"]');
	const found = findPlayer();
	if (!found) return;
	const player: HTMLElement = found;
	const doc = article.ownerDocument;
	doc.documentElement.classList.add('youtube-study');
	const existing = article.querySelector<HTMLElement>('.youtube-player-resize');
	if (existing) { applySize(Number(existing.getAttribute('aria-valuenow')) || 100); if (existing.previousElementSibling !== player) player.after(existing); return; }
	function applySize(size: number) {
		const current = findPlayer();
		current?.classList.add('youtube-sized-player');
		current?.style.setProperty('--youtube-player-scale', String(size / 100));
		article.style.setProperty('--youtube-player-scale', String(size / 100));
	}
	if (!player.id) player.id = `youtube-player-${Math.random().toString(36).slice(2, 10)}`;
	const handle = doc.createElement('div'); handle.className = 'youtube-player-resize';
	handle.tabIndex = 0; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-orientation', 'horizontal');
	handle.setAttribute('aria-label', '拖动调整视频尺寸'); handle.setAttribute('aria-valuemin', '35'); handle.setAttribute('aria-valuemax', '100');
	handle.setAttribute('aria-controls', player.id);
	handle.title = '向上拖动缩小，向下拖动放大；方向键微调，Home 最小，End 最大';
	player.after(handle);
	const layoutOf = (): PlayerLayout => (article.dataset.ytLayout as PlayerLayout | undefined) || 'theater';
	let preferredSize = 100, minimum = 35;
	let displayedSize = 100;
	const update = () => {
		displayedSize = Math.max(minimum, preferredSize); applySize(displayedSize);
		handle.setAttribute('aria-valuemin', String(minimum));
		handle.setAttribute('aria-valuenow', String(displayedSize));
		handle.setAttribute('aria-valuetext', `${displayedSize}%，相对于当前可用区域最大尺寸${minimum === 100 ? '；当前窗口已达最小可用尺寸' : ''}`);
	};
	let touched = false;
	const commit = () => { void setLocalStorage('qiaomuYouTubePlayerSize', preferredSize).catch(() => {}); };
	handle.onkeydown = event => {
		const delta: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
		if (!(event.key in delta) && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault(); adapt();
		const next = event.key === 'Home' ? minimum : event.key === 'End' ? 100 : Math.max(minimum, normalizePlayerSize(displayedSize + delta[event.key] * (event.shiftKey && event.key.startsWith('Arrow') ? 5 : 1)));
		if (next === displayedSize) return;
		touched = true; preferredSize = next; update(); commit();
	};
	let drag: { pointerId: number; x: number; y: number; size: number; maxWidth: number; changed: boolean } | undefined;
	const finish = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const changed = drag.changed; drag = undefined; doc.documentElement.classList.remove('youtube-player-resizing'); if (changed) commit();
		if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
	};
	handle.onpointerdown = event => {
		if (event.button !== 0) return;
		adapt();
		const current = findPlayer();
		const size = displayedSize; const width = current?.getBoundingClientRect().width || 0;
		if (!width) return;
		event.preventDefault();
		drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, size, maxWidth: width / (size / 100), changed: false };
		try { handle.setPointerCapture(event.pointerId); } catch { /* Document listeners also cover environments without pointer capture. */ }
		doc.documentElement.classList.add('youtube-player-resizing');
	};
	const move = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.x, dy = (event.clientY - drag.y) * 16 / 9;
		// Beside the transcript the handle is a divider on the video's right edge: dragging it is a plain
		// horizontal resize. Otherwise a horizontal drag changes the centered width, a vertical one the height.
		const change = layoutOf() === 'side' ? dx : Math.abs(dx * 2) > Math.abs(dy) ? dx * 2 : dy;
		const next = Math.max(minimum, normalizePlayerSize(drag.size + change / drag.maxWidth * 100));
		if (next === displayedSize) return;
		touched = true; drag.changed = true; preferredSize = next; update();
	};
	// Listen on the document as well: a rapid drag can cross the video or the moving edge.
	doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', finish); doc.addEventListener('pointercancel', finish);
	handle.onlostpointercapture = finish;
	const cleanup = () => {
		observer?.disconnect(); doc.defaultView?.removeEventListener('resize', adapt); article.removeEventListener(LAYOUT_EVENT, adapt);
		doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', finish); doc.removeEventListener('pointercancel', finish);
		drag = undefined; doc.documentElement.classList.remove('youtube-player-resizing');
	};
	// A narrow viewport clamps presentation, without overwriting the saved wide-screen choice.
	const adapt = () => {
		if (!article.isConnected) {
			cleanup();
			if (!doc.querySelector('.youtube-sized-player')) { doc.documentElement.classList.remove('youtube-study'); doc.documentElement.style.removeProperty('--youtube-bar-height'); }
			return;
		}
		const barHeight = Math.max(56, doc.querySelector('.clip-bar')?.getBoundingClientRect().height || 0);
		doc.documentElement.style.setProperty('--youtube-bar-height', `${barHeight}px`);
		const width = article.getBoundingClientRect().width;
		if (!width) return;
		const maxWidth = maxPlayerWidth(layoutOf(), width, doc.defaultView?.innerHeight || 900, barHeight, Boolean(article.querySelector('.player-container.pin-player')));
		// CSS multiplies this by the chosen scale, so the video and its layout column share one number.
		article.style.setProperty('--youtube-player-max', `${Math.round(maxWidth)}px`);
		const next = Math.min(100, Math.max(35, Math.ceil(356 / maxWidth * 100)));
		if (next !== minimum) { minimum = next; update(); }
	};
	const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(adapt) : undefined;
	observer?.observe(article);
	const bar = doc.querySelector('.clip-bar'); if (bar) observer?.observe(bar);
	doc.defaultView?.addEventListener('resize', adapt); article.addEventListener(LAYOUT_EVENT, adapt);
	doc.defaultView?.addEventListener('pagehide', cleanup, { once: true });
	update(); adapt();
	void getLocalStorage('qiaomuYouTubePlayerSize').then(saved => { if (!touched) { preferredSize = normalizePlayerSize(saved); update(); } }).catch(() => {});
}
