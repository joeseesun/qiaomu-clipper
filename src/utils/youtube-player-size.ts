import { getLocalStorage, setLocalStorage } from './storage-utils';
import { getMessage } from './i18n';

export const normalizePlayerSize = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(35, Math.min(100, Math.round(value))) : 100;

// Change geometry only: never move, replace or reload the live player.
export function mountPlayerSize(article: HTMLElement): void {
	const selector = '.reader-video-wrapper, iframe[src*="youtube.com/embed/"], a[href*="youtube.com/watch"]';
	const player = article.querySelector<HTMLElement>(selector);
	if (!player) return;
	const doc = article.ownerDocument;
	doc.documentElement.classList.add('youtube-study');
	let control = article.querySelector<HTMLElement>('.youtube-size-control');
	function applySize(size: number) {
		const current = article.querySelector<HTMLElement>(selector);
		current?.classList.add('youtube-sized-player');
		current?.style.setProperty('--youtube-player-width', `${size}%`);
		current?.style.setProperty('--youtube-player-scale', String(size / 100));
		article.style.setProperty('--youtube-player-scale', String(size / 100));
	}
	if (control) {
		applySize(normalizePlayerSize(Number(control.querySelector<HTMLInputElement>('input')?.value)));
		const handle = article.querySelector<HTMLElement>('.youtube-player-resize');
		if (handle && handle.previousElementSibling !== player) player.after(handle);
		const container = player.closest('.player-container');
		if (container && control.previousElementSibling !== container) container.after(control);
		return;
	}
	control = doc.createElement('label'); control.className = 'youtube-size-control';
	const label = doc.createElement('span'); label.textContent = getMessage('qiaomuVideoSize');
	const input = doc.createElement('input'); input.type = 'range'; input.min = '35'; input.max = '100'; input.step = '1'; input.value = '100';
	input.setAttribute('aria-label', getMessage('qiaomuVideoSize'));
	const output = doc.createElement('output'); output.value = '100%';
	if (!player.id) player.id = `youtube-player-${Math.random().toString(36).slice(2, 10)}`;
	input.setAttribute('aria-controls', player.id);
	const hint = doc.createElement('span'); hint.className = 'youtube-size-hint'; hint.textContent = '100% = 当前可用区域最大尺寸';
	control.append(label, input, output, hint);
	(player.closest('.player-container') || player).after(control);

	const handle = doc.createElement('div'); handle.className = 'youtube-player-resize';
	handle.tabIndex = 0; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-orientation', 'horizontal');
	handle.setAttribute('aria-label', '拖动调整视频尺寸'); handle.setAttribute('aria-valuemin', '35'); handle.setAttribute('aria-valuemax', '100');
	handle.setAttribute('aria-controls', player.id);
	handle.title = '拖动调整视频尺寸；方向键调整，Home 最小，End 最大';
	player.after(handle);
	let preferredSize = 100, minimum = 35;
	const update = () => {
		const size = Math.max(minimum, preferredSize); input.min = String(minimum); input.value = String(size); handle.setAttribute('aria-valuemin', String(minimum)); applySize(size); output.value = `${size}%`;
		const text = `${size}%，相对于当前可用区域最大尺寸`;
		input.setAttribute('aria-valuetext', text); handle.setAttribute('aria-valuenow', String(size)); handle.setAttribute('aria-valuetext', text);
	};
	let touched = false;
	const commit = () => { void setLocalStorage('qiaomuYouTubePlayerSize', preferredSize).catch(() => {}); };
	input.oninput = () => { const requested = normalizePlayerSize(Number(input.value)); touched = true; adapt(); preferredSize = Math.max(minimum, requested); update(); };
	input.onchange = commit;
	handle.onkeydown = event => {
		const delta: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
		if (!(event.key in delta) && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault(); touched = true; adapt();
		preferredSize = event.key === 'Home' ? minimum : event.key === 'End' ? 100 : Math.max(minimum, normalizePlayerSize(Number(input.value) + delta[event.key] * (event.shiftKey ? 5 : 1)));
		update(); commit();
	};
	let drag: { pointerId: number; x: number; y: number; size: number; maxWidth: number } | undefined;
	const finish = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag = undefined; doc.documentElement.classList.remove('youtube-player-resizing'); commit();
		if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
	};
	handle.onpointerdown = event => {
		if (event.button !== 0) return;
		adapt();
		const current = article.querySelector<HTMLElement>(selector);
		const size = Number(input.value); const width = current?.getBoundingClientRect().width || 0;
		if (!width) return;
		event.preventDefault(); touched = true; handle.focus({ preventScroll: true });
		drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, size, maxWidth: width / (size / 100) };
		handle.setPointerCapture(event.pointerId); doc.documentElement.classList.add('youtube-player-resizing');
	};
	handle.onpointermove = event => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.x, dy = (event.clientY - drag.y) * 16 / 9;
		// A horizontal drag changes the centered width; a vertical drag changes height.
		const change = Math.abs(dx * 2) > Math.abs(dy) ? dx * 2 : dy;
		preferredSize = Math.max(minimum, normalizePlayerSize(drag.size + change / drag.maxWidth * 100)); update();
	};
	handle.onpointerup = finish; handle.onpointercancel = finish; handle.onlostpointercapture = finish;
	// A narrow viewport clamps presentation, without overwriting the saved wide-screen choice.
	const adapt = () => {
		if (!article.isConnected) {
			observer?.disconnect(); doc.defaultView?.removeEventListener('resize', adapt);
			doc.documentElement.classList.remove('youtube-player-resizing');
			if (!doc.querySelector('.youtube-sized-player')) doc.documentElement.classList.remove('youtube-study');
			return;
		}
		const width = article.getBoundingClientRect().width;
		if (!width) return;
		const maxWidth = Math.min(width, Math.max(356, ((doc.defaultView?.innerHeight || 900) - 180) * 16 / 9));
		const next = Math.min(100, Math.max(35, Math.ceil(356 / maxWidth * 100)));
		if (next !== minimum) { minimum = next; update(); }
	};
	const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(adapt) : undefined;
	observer?.observe(article); doc.defaultView?.addEventListener('resize', adapt);
	doc.defaultView?.addEventListener('pagehide', () => { observer?.disconnect(); doc.defaultView?.removeEventListener('resize', adapt); }, { once: true });
	update(); adapt();
	void getLocalStorage('qiaomuYouTubePlayerSize').then(saved => { if (!touched) { preferredSize = normalizePlayerSize(saved); update(); } }).catch(() => {});
}
