// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { SPEEDS, clock, mountAudioControls } from './audio-controls';

const labels = { play: 'Play', pause: 'Pause', back: 'Back', forward: 'Forward', speed: 'Speed', seek: 'Seek' };
const make = () => {
	const media = document.createElement('video'); let paused = true;
	Object.defineProperty(media, 'duration', { value: 100, configurable: true }); Object.defineProperty(media, 'paused', { get: () => paused, configurable: true });
	media.play = vi.fn(async () => { paused = false; media.dispatchEvent(new Event('play')); }); media.pause = vi.fn(() => { paused = true; media.dispatchEvent(new Event('pause')); });
	document.body.append(media); return { media, root: mountAudioControls(document, media, labels) };
};
const q = <T extends HTMLElement>(root: HTMLElement, selector: string) => root.querySelector<T>(selector)!;
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

it('writes times as the listener reads them', () => { expect([0, 9, 65, 3599, 3723, 9258.9, -1, NaN].map(clock)).toEqual(['0:00', '0:09', '1:05', '59:59', '1:02:03', '2:34:18', '0:00', '0:00']); });

it('plays and pauses from one button that says which it will do, and shows the time and the length', async () => {
	const { media, root } = make(); const play = q<HTMLButtonElement>(root, '.qa-play');
	expect(play.getAttribute('aria-label')).toBe('Play'); expect(q(root, '.qa-total').textContent).toBe('1:40'); expect(q(root, '.qa-time').textContent).toBe('0:00');
	play.click(); await Promise.resolve(); expect(media.play).toHaveBeenCalled(); expect(play.getAttribute('aria-label')).toBe('Pause'); expect(play.querySelector('rect')).not.toBeNull();
	media.currentTime = 42; media.dispatchEvent(new Event('timeupdate')); expect(q(root, '.qa-time').textContent).toBe('0:42'); expect(q<HTMLInputElement>(root, '.qa-seek').value).toBe('42'); expect(q<HTMLInputElement>(root, '.qa-seek').style.getPropertyValue('--p')).toBe('42%');
	play.click(); expect(media.pause).toHaveBeenCalled(); expect(play.getAttribute('aria-label')).toBe('Play'); expect(play.querySelector('path')).not.toBeNull();
});

it('seeks from the timeline: the thumb is the viewer\'s while dragging, and the position is set when let go', () => {
	const { media, root } = make(); const seek = q<HTMLInputElement>(root, '.qa-seek'); media.currentTime = 10; media.dispatchEvent(new Event('timeupdate'));
	seek.value = '70'; seek.dispatchEvent(new Event('input')); expect(q(root, '.qa-time').textContent).toBe('1:10'); expect(media.currentTime).toBe(10); // not yet
	media.currentTime = 11; media.dispatchEvent(new Event('timeupdate')); expect(seek.value).toBe('70'); // playback does not pull the thumb back while dragging
	seek.dispatchEvent(new Event('change')); expect(media.currentTime).toBe(70);
});

it('jumps back 15 and forward 30 seconds, within the audio', () => {
	const { media, root } = make(); const [back, forward] = Array.from(root.querySelectorAll<HTMLButtonElement>('.qa-skip'));
	media.currentTime = 40; back.click(); expect(media.currentTime).toBe(25); forward.click(); expect(media.currentTime).toBe(55);
	media.currentTime = 5; back.click(); expect(media.currentTime).toBe(0); media.currentTime = 90; forward.click(); expect(media.currentTime).toBe(100);
});

it('chooses the speed from a small menu, closes it again, and remembers the choice', () => {
	const { media, root } = make(); const chip = q<HTMLButtonElement>(root, '.qa-chip'), menu = q(root, '.qa-menu');
	expect(chip.textContent).toBe('1×'); expect(menu.hidden).toBe(true); chip.click(); expect(menu.hidden).toBe(false); expect(chip.getAttribute('aria-expanded')).toBe('true');
	expect(Array.from(menu.querySelectorAll('button')).map(b => b.textContent)).toEqual(SPEEDS.map(s => `${s}×`)); expect(Array.from(menu.querySelectorAll('button')).map(b => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
	menu.querySelector<HTMLButtonElement>('[data-rate="1.5"]')!.click(); expect([chip.textContent, media.playbackRate, menu.hidden]).toEqual(['1.5×', 1.5, true]); expect(localStorage.getItem('qiaomuAudioRate')).toBe('1.5');
	expect(make().media.playbackRate).toBe(1.5);
	chip.click(); document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(menu.hidden).toBe(true); // a press elsewhere closes it
	chip.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(menu.hidden).toBe(true);
});

it('follows a speed changed with the browser\'s own means, and starts a new source at the remembered speed', () => {
	const { media, root } = make(); media.playbackRate = 1.75; media.dispatchEvent(new Event('ratechange'));
	expect(q(root, '.qa-chip').textContent).toBe('1.75×'); expect(localStorage.getItem('qiaomuAudioRate')).toBe('1.75'); expect(media.defaultPlaybackRate).toBe(1.75);
});
