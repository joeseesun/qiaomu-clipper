// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./storage-utils', () => ({ getLocalStorage: (...args: unknown[]) => storage.get(...args), setLocalStorage: (...args: unknown[]) => storage.set(...args) }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
import { clampFloatWidth, maxPlayerWidth, mountPlayerMode, nearestCorner, normalizeMode, resolveLayout, visibleFloatWidth } from './youtube-player-mode';
import { mountPlayerSize } from './youtube-player-size';
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const html = '<article><div class="player-container"><iframe src="https://www.youtube.com/embed/dbqweBCynuI?enablejsapi=1"></iframe></div><div class="youtube transcript"><p class="transcript-segment">x</p></div></article>';
beforeEach(() => { Object.assign(window, { innerWidth: 1200, innerHeight: 900 }); document.body.innerHTML = html; document.documentElement.className = ''; vi.clearAllMocks(); storage.get.mockResolvedValue(undefined); storage.set.mockResolvedValue(undefined); });
const setup = (width = 1200) => {
	const article = document.querySelector('article')!; vi.spyOn(article, 'getBoundingClientRect').mockReturnValue({ width, height: 900, top: 0, left: 0, right: width, bottom: 900 } as DOMRect);
	mountPlayerSize(article); mountPlayerMode(article);
	return { article, frame: article.querySelector('iframe')!, click: (name: string) => article.querySelector<HTMLElement>(`.youtube-mode-${name}`)!.click() };
};
function pointer(node: EventTarget, type: string, x: number, y = 0) { const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y }); node.dispatchEvent(event); }

it('picks layouts with hysteresis so a new scrollbar cannot flip them back and forth', () => {
	expect(resolveLayout('dock', 1000, true)).toBe('side'); expect(resolveLayout('dock', 999, true)).toBe('stack');
	expect(resolveLayout('dock', 975, true, 'side')).toBe('side'); expect(resolveLayout('dock', 959, true, 'side')).toBe('stack');
	expect(resolveLayout('theater', 400, true)).toBe('theater'); expect(resolveLayout('float', 400, true)).toBe('float');
	expect(resolveLayout('dock', 1600, false)).toBe('theater');
});

it('leaves room for the transcript beside the video and for the text under it', () => {
	expect(maxPlayerWidth('side', 1196, 900, 56)).toBe(656); expect(maxPlayerWidth('side', 1000, 900, 56)).toBe(460);
	expect(maxPlayerWidth('stack', 800, 900, 56)).toBeCloseTo(736, 0); expect(maxPlayerWidth('theater', 2000, 900, 56)).toBeCloseTo(1280, 0);
	expect(maxPlayerWidth('theater', 300, 900, 56)).toBe(300);
	expect(maxPlayerWidth('theater', 2000, 900, 56, true)).toBeCloseTo(880, 0); // pinned in theater: 55% of the height, so the text keeps room
	expect(maxPlayerWidth('theater', 2000, 900, 56, false)).toBeCloseTo(1280, 0);
});

it('validates stored preferences and keeps a wide-screen width when the window is narrow', () => {
	expect(normalizeMode('float')).toBe('float'); expect(normalizeMode('x')).toBe('dock'); expect(clampFloatWidth(9999)).toBe(640); expect(clampFloatWidth('a')).toBe(360);
	expect(visibleFloatWidth(500, 600)).toBe(360); expect(visibleFloatWidth(500, 2000)).toBe(500);
	expect(nearestCorner(100, 100, 1000, 800)).toBe('tl'); expect(nearestCorner(900, 700, 1000, 800)).toBe('br'); expect(nearestCorner(100, 700, 1000, 800)).toBe('bl'); expect(nearestCorner(900, 100, 1000, 800)).toBe('tr');
});

it('switches layouts by attributes only, keeping the same iframe node and URL, and remembers the choice', async () => {
	const { article, frame, click } = setup(); await flush(); const src = frame.src, parent = frame.parentElement;
	expect(article.dataset.ytLayout).toBe('side'); expect(article.querySelectorAll('.youtube-mode-bar')).toHaveLength(1);
	click('theater'); expect(article.dataset.ytLayout).toBe('theater');
	click('float'); expect(article.dataset.ytLayout).toBe('float'); expect(article.dataset.ytCorner).toBe('br');
	click('dock'); expect(article.dataset.ytLayout).toBe('side');
	expect(frame.src).toBe(src); expect(frame.parentElement).toBe(parent); expect(article.querySelector('iframe')).toBe(frame);
	expect(storage.set).toHaveBeenCalledWith('qiaomuYouTubePlayerMode', 'float');
	expect(article.querySelector('.youtube-mode-dock')!.getAttribute('aria-pressed')).toBe('true');
});

it('restores the saved mode, but never over a click made before storage answered', async () => {
	storage.get.mockImplementation(async (key: string) => key === 'qiaomuYouTubePlayerMode' ? 'float' : { corner: 'tl', width: 480 });
	const first = setup(); await flush(); expect(first.article.dataset.ytLayout).toBe('float'); expect(first.article.dataset.ytCorner).toBe('tl');
	expect(first.article.style.getPropertyValue('--yt-float-width')).toBe('480px');
	document.body.innerHTML = html; let done!: (v: string) => void; storage.get.mockReturnValue(new Promise(r => { done = r; }));
	const second = setup(); second.click('theater'); done('float'); await flush(); expect(second.article.dataset.ytLayout).toBe('theater');
});

it('falls back to stacked layout on narrow pages and tells the size module the max video width', async () => {
	const { article } = setup(800); await flush();
	expect(article.dataset.ytLayout).toBe('stack'); expect(article.style.getPropertyValue('--youtube-player-max')).toBe('736px');
	document.body.innerHTML = html; expect(setup(1500).article.style.getPropertyValue('--youtube-player-max')).toBe('825px');
});

	it('shows controls before subtitles and adopts them when the player container appears', async () => {
		document.body.innerHTML = '<article><iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe></article>';
		const article = document.querySelector('article')!; vi.spyOn(article, 'getBoundingClientRect').mockReturnValue({ width: 1500 } as DOMRect);
		mountPlayerMode(article); await flush(); expect(article.dataset.ytLayout).toBe('theater'); expect(article.querySelector('.youtube-mode-bar')).not.toBeNull();
		const frame = article.querySelector('iframe')!, container = document.createElement('div'); container.className = 'player-container'; frame.before(container); container.append(frame);
		await flush(); await new Promise(r => setTimeout(r, 0));
		expect(container.querySelector('.youtube-mode-bar')).not.toBeNull(); expect(article.dataset.ytLayout).toBe('side');
	});

it('drags the floating window and snaps to the nearest corner, resizes it and cleans up a canceled drag', async () => {
	const { article, frame, click } = setup(); await flush(); click('float');
	vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left: 700, top: 500, width: 360, height: 202, right: 1060, bottom: 702 } as DOMRect);
	Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
	const strip = article.querySelector<HTMLElement>('.youtube-float-drag')!; strip.setPointerCapture = vi.fn(); strip.hasPointerCapture = vi.fn(() => false);
	pointer(strip, 'pointerdown', 710, 510); pointer(document, 'pointermove', 40, 30);
	expect(article.dataset.ytDragging).toBe('true'); expect(document.documentElement.classList.contains('youtube-player-resizing')).toBe(true);
	vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left: 30, top: 20, width: 360, height: 202 } as DOMRect);
	pointer(document, 'pointerup', 40, 30);
	expect(article.dataset.ytCorner).toBe('tl'); expect(article.dataset.ytDragging).toBeUndefined(); expect(document.documentElement.classList.contains('youtube-player-resizing')).toBe(false);
	expect(storage.set).toHaveBeenCalledWith('qiaomuYouTubeFloat', { corner: 'tl', width: 360 });
	const grip = article.querySelector<HTMLElement>('.youtube-float-resize')!; grip.setPointerCapture = vi.fn();
	pointer(grip, 'pointerdown', 400); pointer(document, 'pointermove', 460); pointer(document, 'pointercancel', 460);
	expect(article.style.getPropertyValue('--yt-float-width')).toBe('420px');
	grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); expect(grip.getAttribute('aria-valuenow')).toBe('640');
	const dragStrip = article.querySelector<HTMLElement>('.youtube-float-drag')!; dragStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(article.dataset.ytCorner).toBe('tr'); // tl -> next corner
});

it('only offers the pop-out window where Document Picture-in-Picture exists', async () => {
	const { article } = setup(); expect(article.querySelector('.youtube-mode-pip')).toBeNull();
	document.body.innerHTML = html; (window as any).documentPictureInPicture = { requestWindow: vi.fn() };
	const again = setup(); expect(again.article.querySelector('.youtube-mode-pip')).not.toBeNull(); delete (window as any).documentPictureInPicture;
});
