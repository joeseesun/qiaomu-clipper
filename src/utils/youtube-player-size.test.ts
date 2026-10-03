// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./storage-utils', () => ({ getLocalStorage: (...args: unknown[]) => storage.get(...args), setLocalStorage: (...args: unknown[]) => storage.set(...args) }));
vi.mock('./i18n', () => ({ getMessage: () => '视频尺寸' }));
import { mountPlayerSize } from './youtube-player-size';
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => { document.body.innerHTML = '<article><div class="player-container"><iframe src="https://www.youtube.com/embed/dbqweBCynuI"></iframe></div></article>'; document.documentElement.className = ''; vi.clearAllMocks(); storage.get.mockResolvedValue(undefined); storage.set.mockResolvedValue(undefined); });
const setup = () => { const article = document.querySelector('article')!; mountPlayerSize(article); return { article, frame: article.querySelector('iframe')!, handle: article.querySelector<HTMLElement>('.youtube-player-resize')!, slider: { get value() { return article.querySelector('.youtube-player-resize')!.getAttribute('aria-valuenow')!; } } }; };
function pointer(node: HTMLElement, type: string, x: number, y = 0) { const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y }); node.dispatchEvent(event); }

it('supports keyboard resizing with matching accessible values and persisted preference without moving the player', async () => {
	const { article, frame, handle, slider } = setup(); await flush(); const parent = frame.parentElement, src = frame.src;
	handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
	expect(slider.value).toBe('35'); expect(handle.getAttribute('aria-valuenow')).toBe('35');
	handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(slider.value).toBe('36');
	handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); expect(slider.value).toBe('100');
	expect(storage.set).toHaveBeenLastCalledWith('qiaomuYouTubePlayerSize', 100);
	expect(frame.parentElement).toBe(parent); expect(frame.src).toBe(src); expect(article.querySelector('iframe')).toBe(frame);
	expect(handle.getAttribute('aria-valuetext')).toContain('当前可用区域');
});

it('captures a drag, resizes continuously, commits once and cleans up a canceled pointer', async () => {
	storage.get.mockResolvedValue(60); const { frame, handle, slider } = setup(); await flush();
	vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ width: 600 } as DOMRect);
	handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn(() => true); handle.releasePointerCapture = vi.fn();
	pointer(handle, 'pointerdown', 300); pointer(handle, 'pointermove', 400);
	expect(slider.value).toBe('80'); expect(document.documentElement.classList.contains('youtube-player-resizing')).toBe(true); expect(storage.set).not.toHaveBeenCalled();
	pointer(handle, 'pointercancel', 400); expect(storage.set).toHaveBeenCalledTimes(1); expect(storage.set).toHaveBeenCalledWith('qiaomuYouTubePlayerSize', 80);
	expect(document.documentElement.classList.contains('youtube-player-resizing')).toBe(false); expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
});

it('does not let a delayed saved size undo a keyboard change and mounts only one handle', async () => {
	let done!: (value: number) => void; storage.get.mockReturnValue(new Promise(resolve => { done = resolve; }));
	const { article, handle, slider } = setup(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })); done(90); await flush();
	expect(slider.value).toBe('35'); mountPlayerSize(article); expect(article.querySelectorAll('.youtube-player-resize')).toHaveLength(1);
});

it('clamps narrow-screen presentation to the minimum embed size without overwriting the saved wide-screen choice', async () => {
	let resized!: () => void;
	vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
	storage.get.mockResolvedValue(60); let width = 1000;
	const article = document.querySelector('article')!; vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => ({ width } as DOMRect));
	const { slider, handle } = setup(); await flush(); expect(slider.value).toBe('60');
	width = 358; resized(); expect(slider.value).toBe('100'); expect(handle.getAttribute('aria-valuemin')).toBe('100');
	expect(storage.set).not.toHaveBeenCalled(); width = 1000; resized(); expect(slider.value).toBe('60');
	vi.unstubAllGlobals();
});

it('keeps the handle with late transcript wrapping without moving or reloading the iframe', async () => {
	const { article, frame, handle } = setup(); await flush();
	const container = document.createElement('div'); container.className = 'player-container'; frame.before(container); container.append(frame);
	mountPlayerSize(article); expect(handle.parentElement).toBe(container); expect(article.querySelector('iframe')).toBe(frame);
	expect(article.querySelectorAll('.youtube-player-resize')).toHaveLength(1);
});

it('cleans up study layout after the article is removed for ordinary reader navigation', async () => {
	let resized!: () => void; const disconnect = vi.fn();
	vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
	const { article } = setup(); article.remove(); resized();
	expect(document.documentElement.classList.contains('youtube-study')).toBe(false); expect(disconnect).toHaveBeenCalled();
	vi.unstubAllGlobals();
});


it('keeps dragging when pointer capture is unavailable and the pointer crosses the frame', async () => {
	const {frame,handle}=setup(); await flush();
	vi.spyOn(frame,'getBoundingClientRect').mockReturnValue({width:1000} as DOMRect);
	handle.setPointerCapture=vi.fn(()=>{throw new Error('capture unavailable');});
	pointer(handle,'pointerdown',500,600);
	pointer(document.body,'pointermove',500,500);
	expect(Number(handle.getAttribute('aria-valuenow'))).toBeLessThan(100);
	pointer(document.body,'pointerup',500,500);
	expect(document.documentElement.classList.contains('youtube-player-resizing')).toBe(false);
	expect(storage.set).toHaveBeenCalledTimes(1);
});

it('sizes the actual iframe rather than a preceding ordinary video link', async () => {
	const article=document.querySelector('article')!;
	const link=document.createElement('a');link.href='https://www.youtube.com/watch?v=dbqweBCynuI';article.prepend(link);
	const {frame,handle}=setup(); await flush();
	handle.dispatchEvent(new KeyboardEvent('keydown',{key:'Home'}));
	expect(frame.classList.contains('youtube-sized-player')).toBe(true);
	expect(link.classList.contains('youtube-sized-player')).toBe(false);
});
