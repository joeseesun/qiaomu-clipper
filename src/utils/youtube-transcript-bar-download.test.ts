// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { buildTranscriptBar, BAR_STYLE, type BarHooks } from './youtube-transcript-bar';
import { downloadStrings, type DownloadPref } from './caption-download';

const strings = { heading: 'Qiaomu', subtitles: 'Subtitles', copy: 'Copy', download: 'Download', study: 'Study', settings: 'Settings', expand: 'Show', collapse: 'Hide', copied: 'Copied', empty: 'Empty', reload: 'Reload page', loading: 'Loading', ready: 'Ready', none: 'None', more: 'More', search: 'Search', clear: 'Clear', noMatch: 'No results', follow: 'Following', followOff: 'Not following', here: 'Back', retry: 'Retry' };
const lines = [{ time: '0:05', text: 'Hello there,', start: 5 }, { time: '0:09', text: 'welcome back.', start: 9 }];
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let pref: DownloadPref, saved: Array<{ name: string; blob: Blob }>;
const make = (overrides: Partial<BarHooks> = {}) => {
	const bar = buildTranscriptBar(document, { strings, title: () => 'My video - YouTube', getSegments: async () => lines, openStudy: () => {}, openSettings: () => {}, seek: () => {}, download: { strings: downloadStrings((_k, _zh, en) => en), preference: () => pref, url: () => 'https://example.test/v' }, ...overrides });
	document.body.append(bar.element);
	const button = bar.element.querySelector<HTMLButtonElement>('.qiaomu-yt-tool-download')!, menu = bar.element.querySelector<HTMLElement>('[role=menu]')!;
	const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role=menuitem]'));
	return { bar, button, menu, items };
};
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
beforeEach(() => {
	document.body.innerHTML = ''; vi.restoreAllMocks(); pref = 'ask'; saved = [];
	let now = 0; vi.spyOn(Date, 'now').mockImplementation(() => now += 1000); // presses closer than 400ms are one press
	Object.assign(URL, { createObjectURL: (blob: Blob) => { saved.push({ name: '', blob }); return 'blob:x'; }, revokeObjectURL: vi.fn() });
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved[saved.length - 1].name = this.download; });
});

it('opens a menu of four formats under the icon, default first and marked, with notes on the right', () => {
	const { button, menu, items } = make();
	expect(menu.hidden).toBe(true); expect(button.getAttribute('aria-haspopup')).toBe('menu'); expect(button.getAttribute('aria-expanded')).toBe('false');
	button.click(); expect(menu.hidden).toBe(false); expect(button.getAttribute('aria-expanded')).toBe('true'); expect(menu.getAttribute('aria-label')).toBe('Download subtitles');
	expect(items().map(item => item.dataset.format)).toEqual(['md', 'srt', 'vtt', 'txt']);
	expect(items()[0].querySelector('.qiaomu-yt-bar-menumark')!.textContent).toBe('Default'); expect(menu.querySelectorAll('.qiaomu-yt-bar-menumark')).toHaveLength(1);
	expect(items()[1].querySelector('.qiaomu-yt-bar-menuname')!.textContent).toBe('SRT subtitles'); expect(items()[1].querySelector('.qiaomu-yt-bar-menuext')!.textContent).toBe('.srt');
	expect(items()[1].querySelector('.qiaomu-yt-bar-menunote')!.textContent).toBe('Timed, ready for a video player');
	expect(document.activeElement).toBe(items()[0]); expect(menu.parentElement).toBe(button.parentElement);
});

it('downloads the chosen format, closes the menu and says it is done', async () => {
	const { button, menu, items } = make();
	button.click(); items()[1].click(); await tick();
	expect(menu.hidden).toBe(true); expect(saved).toHaveLength(1); expect(saved[0].name).toBe('My video.srt'); expect(saved[0].blob.type).toBe('application/x-subrip;charset=utf-8');
	expect(await saved[0].blob.text()).toBe('1\n00:00:05,000 --> 00:00:09,000\nHello there,\n\n2\n00:00:09,000 --> 00:00:12,000\nwelcome back.\n');
	expect(button.title).toBe('Downloaded'); expect(button.classList.contains('is-notice')).toBe(true);
	button.click(); items()[0].click(); await tick(); expect(saved[1].name).toBe('My video.md'); expect(await saved[1].blob.text()).toContain('# My video\n\n<https://example.test/v>\n\n- [0:05] Hello there,');
});

it('works from the keyboard: arrows move, Enter downloads, Escape and outside clicks close', async () => {
	const { button, menu, items } = make();
	button.click(); key(items()[0], 'ArrowDown'); expect(document.activeElement).toBe(items()[1]); key(items()[1], 'ArrowUp'); key(items()[0], 'ArrowUp'); expect(document.activeElement).toBe(items()[3]);
	key(items()[3], 'ArrowDown'); expect(document.activeElement).toBe(items()[0]); key(items()[0], 'End'); expect(document.activeElement).toBe(items()[3]); key(items()[3], 'Home'); expect(document.activeElement).toBe(items()[0]);
	key(items()[2], 'Enter'); await tick(); expect(saved[0].name).toBe('My video.vtt'); expect(menu.hidden).toBe(true);
	button.click(); const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); items()[0].dispatchEvent(escape); expect(menu.hidden).toBe(true); expect(document.activeElement).toBe(button);
	button.click(); expect(menu.hidden).toBe(false); document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(menu.hidden).toBe(true);
	button.click(); menu.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(menu.hidden).toBe(false); button.click(); expect(menu.hidden).toBe(true);
});

it('keeps single-key shortcuts of the page away from the menu', () => {
	const { button, items } = make(); const reached = vi.fn(); document.body.addEventListener('keydown', reached); button.click();
	key(items()[0], 'k'); key(items()[0], 'ArrowDown'); expect(reached).not.toHaveBeenCalled();
});

it('with a fixed format a click downloads at once and right-click opens the menu with that format first', async () => {
	pref = 'vtt'; const { button, menu, items } = make();
	button.dispatchEvent(new Event('pointerenter')); expect(button.title).toBe('Download VTT (right-click for other formats)'); expect(button.getAttribute('aria-label')).toBe(button.title);
	button.click(); await tick(); expect(menu.hidden).toBe(true); expect(saved[0].name).toBe('My video.vtt'); expect(await saved[0].blob.text()).toMatch(/^WEBVTT/);
	const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); button.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
	expect(menu.hidden).toBe(false); expect(items().map(item => item.dataset.format)).toEqual(['vtt', 'md', 'srt', 'txt']); expect(items()[0].querySelector('.qiaomu-yt-bar-menumark')).not.toBeNull();
	// the setting changing later takes effect without rebuilding the bar
	items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 1900)); pref = 'ask'; button.dispatchEvent(new Event('pointerenter')); expect(button.title).toBe('Download');
	button.click(); expect(menu.hidden).toBe(false);
});

it('says so when there is nothing to download and saves no file', async () => {
	const { button, menu, items } = make({ getSegments: async () => [] });
	button.click(); items()[0].click(); await tick(); expect(saved).toHaveLength(0); expect(button.title).toBe('Empty'); expect(menu.hidden).toBe(true);
	pref = 'srt'; button.click(); await tick(); expect(saved).toHaveLength(0);
});

it('without the download hook the icon still saves plain text in one click, and right-click stays native', async () => {
	const { button, bar } = make({ download: undefined });
	button.click(); await tick(); expect(saved[0].name).toBe('My video.txt'); expect(await saved[0].blob.text()).toBe('[0:05] Hello there,\n[0:09] welcome back.\n');
	const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); button.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); expect(bar.element.querySelector('[role=menu]')!.hasAttribute('hidden')).toBe(true);
});

it('styles the menu as a solid, bordered panel with its own hover, focus ring and no side stripe', () => {
	const style = document.createElement('style'); style.textContent = BAR_STYLE; document.head.append(style);
	const { button, menu, items } = make(); button.click();
	const panel = getComputedStyle(menu), row = getComputedStyle(items()[0]);
	expect(panel.position).toBe('absolute'); expect(panel.display).not.toBe('none'); // jsdom does not resolve custom properties, so the fill is checked in the source and the tokens below
	expect(row.cursor).toBe('pointer'); expect(row.display).toBe('flex');
	const css = BAR_STYLE.slice(BAR_STYLE.indexOf('.qiaomu-yt-bar-menu{'), BAR_STYLE.indexOf('.qiaomu-yt-tool-study'));
	expect(css).toMatch(/\.qiaomu-yt-bar-menuitem:hover[^{]*\{background:var\(--qm-hover\)/); expect(css).toMatch(/focus-visible\{outline:2px solid var\(--qm-accent\)/); expect(css).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/); expect(css).toMatch(/background:var\(--qm-bg\)/);
	for (const token of BAR_STYLE.match(/--qm-bg:[^;}]+/g)!) expect(token).not.toMatch(/rgba|transparent|hsla/); // every theme's panel fill is opaque
});
