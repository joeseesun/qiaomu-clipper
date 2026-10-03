import { getLocalStorage, setLocalStorage } from './storage-utils';
import { getMessage } from './i18n';

export const normalizePlayerSize = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(35, Math.min(100, Math.round(value))) : 100;

export function mountPlayerSize(article: HTMLElement): void {
	const player = article.querySelector<HTMLElement>('.reader-video-wrapper, iframe[src*="youtube.com/embed/"], a[href*="youtube.com/watch"]');
	if (!player) return;
	const doc = article.ownerDocument;
	let control = article.querySelector<HTMLElement>('.youtube-size-control');
	if (control) { const size = Number(control.querySelector<HTMLInputElement>('input')?.value) || 100; applySize(size); return; }
	control = doc.createElement('label'); control.className = 'youtube-size-control';
	const label = doc.createElement('span'); label.textContent = getMessage('qiaomuVideoSize');
	const input = doc.createElement('input'); input.type = 'range'; input.min = '35'; input.max = '100'; input.step = '5'; input.value = '100';
	const output = doc.createElement('output'); output.value = '100%';
	control.append(label, input, output);
	(player.closest('.player-container') || player).after(control);
	function applySize(size: number) {
		const current = article.querySelector<HTMLElement>('.reader-video-wrapper, iframe[src*="youtube.com/embed/"], a[href*="youtube.com/watch"]');
		current?.classList.add('youtube-sized-player');
		current?.style.setProperty('--youtube-player-width', `${size}%`);
	}
	const update = () => { const size = normalizePlayerSize(Number(input.value)); applySize(size); output.value = `${size}%`; input.setAttribute('aria-valuetext', output.value); };
	let touched = false;
	input.oninput = () => { touched = true; update(); };
	input.onchange = () => { void setLocalStorage('qiaomuYouTubePlayerSize', Number(input.value)).catch(() => {}); };
	update();
	void getLocalStorage('qiaomuYouTubePlayerSize').then(saved => { if (!touched) { input.value = String(normalizePlayerSize(saved)); update(); } }).catch(() => {});
}
