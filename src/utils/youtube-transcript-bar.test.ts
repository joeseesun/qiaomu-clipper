// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { buildTranscriptBar, syncTranscriptBar, type BarHooks } from './youtube-transcript-bar';

const strings = { heading: 'Qiaomu', subtitles: 'Subtitles', copy: 'Copy', download: 'Download', study: 'Study', settings: 'Settings', expand: 'Show', collapse: 'Hide', copied: 'Copied', empty: 'Empty', reload: 'Reload page', loading: 'Loading', ready: 'Ready', none: 'None', more: 'More in study mode' };
const lines = [['0:05', 'Hello there,'], ['0:09', 'welcome back.'], ['1:02:03', 'Much later']].map(([time, text]) => ({ time, text }));
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const make = (overrides: Partial<BarHooks> = {}) => {
	const hooks: BarHooks = { strings, title: () => 'My video - YouTube', getSegments: vi.fn(async () => lines), openStudy: vi.fn(), openSettings: vi.fn(), seek: vi.fn(), onToggle: vi.fn(), ...overrides };
	const bar = buildTranscriptBar(document, hooks); document.body.append(bar.element);
	const tool = (name: string) => bar.element.querySelector<HTMLButtonElement>(`.qiaomu-yt-tool-${name}`)!;
	return { hooks, bar, tool };
};
beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('is one strip with the five tools and a dropdown chevron, closed at first, with a status dot', () => {
	const { bar, tool } = make();
	expect(Array.from(bar.element.querySelectorAll('.qiaomu-yt-tool')).map(button => button.className.split(' ')[1])).toEqual(['qiaomu-yt-tool-subtitles', 'qiaomu-yt-tool-copy', 'qiaomu-yt-tool-download', 'qiaomu-yt-tool-study', 'qiaomu-yt-tool-settings', 'qiaomu-yt-tool-toggle']);
	expect(bar.element.querySelector('.qiaomu-yt-bar-title')!.textContent).toBe('Qiaomu'); expect(bar.element.dataset.open).toBe('false'); expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-body')!.hidden).toBe(true);
	for (const name of ['subtitles', 'copy', 'download', 'study', 'settings']) { expect(tool(name).title).toBeTruthy(); expect(tool(name).getAttribute('aria-label')).toBe(tool(name).title); }
	expect(bar.element.querySelector('.qiaomu-yt-bar-dot')!.getAttribute('aria-label')).toBe('Loading');
});

it('opens and closes the dropdown from the chevron or the strip, reports it, and starts open when remembered', () => {
	const { hooks, bar, tool } = make();
	tool('toggle').click(); expect(bar.element.dataset.open).toBe('true'); expect(tool('toggle').getAttribute('aria-expanded')).toBe('true'); expect(hooks.onToggle).toHaveBeenLastCalledWith(true);
	bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-head')!.click(); expect(bar.element.dataset.open).toBe('false'); expect(hooks.onToggle).toHaveBeenLastCalledWith(false);
	document.body.innerHTML = ''; const remembered = make({ initialOpen: true, onToggle: vi.fn() }); expect(remembered.bar.element.dataset.open).toBe('true'); expect(remembered.hooks.onToggle).not.toHaveBeenCalled();
});

it('lists the transcript as paragraphs, shows state text, jumps the video when a time is pressed, caps very long transcripts', () => {
	const { hooks, bar, tool } = make({ initialOpen: true });
	bar.setState('ready', lines);
	const rows = Array.from(bar.element.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line'));
	expect(rows.map(row => row.querySelector('.qiaomu-yt-bar-time')!.textContent)).toEqual(['0:05', '1:02:03']); expect(rows[0].textContent).toContain('Hello there, welcome back.');
	expect(bar.element.querySelector('.qiaomu-yt-bar-status')!.textContent).toBe('Ready'); expect(bar.element.dataset.state).toBe('ready');
	rows[1].click(); expect(hooks.seek).toHaveBeenCalledWith(3723);
	const many = Array.from({ length: 600 }, (_, i) => ({ time: `${Math.floor(i * 40 / 60)}:${String(i * 40 % 60).padStart(2, '0')}`, text: `Line ${i}.` }));
	bar.setState('ready', many); expect(bar.element.querySelectorAll('.qiaomu-yt-bar-line')).toHaveLength(400); expect(bar.element.querySelector('.qiaomu-yt-bar-more')!.textContent).toBe('More in study mode');
	void tool;
});

it('copies and downloads what the page has, and says so when there is nothing', async () => {
	const write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
	const created = vi.fn(() => 'blob:x'); Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
	const names: string[] = []; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
	const { hooks, tool } = make();
	tool('copy').click(); await tick(); expect(write).toHaveBeenCalledWith('[0:05] Hello there,\n[0:09] welcome back.\n[1:02:03] Much later'); expect(tool('copy').title).toBe('Copied');
	tool('download').click(); await tick(); expect(names).toEqual(['My video.txt']);
	(hooks.getSegments as any).mockResolvedValue([]); document.body.innerHTML = ''; const empty = make({ getSegments: async () => [] });
	empty.tool('copy').click(); empty.tool('download').click(); await tick(); expect(write).toHaveBeenCalledTimes(1); expect(empty.tool('copy').title).toBe('Empty');
});

it('opens study mode and settings, warns when the page is stale, and loads the transcript from the subtitles button', async () => {
	const { hooks, bar, tool } = make({ getSegments: vi.fn(async () => lines) });
	tool('study').click(); expect(hooks.openStudy).toHaveBeenCalledTimes(1); tool('settings').click(); expect(hooks.openSettings).toHaveBeenCalledTimes(1);
	tool('subtitles').click(); await tick(); expect(bar.element.dataset.open).toBe('true'); expect(bar.element.dataset.state).toBe('ready'); expect(bar.element.querySelectorAll('.qiaomu-yt-bar-line').length).toBeGreaterThan(0);
	document.body.innerHTML = ''; const stale = make({ openStudy: () => false }); stale.tool('study').click(); expect(stale.tool('study').title).toBe('Reload page');
});

it('acts on a press even when the page swallows the click, once, and never lets a press reach the page', () => {
	const { hooks, tool } = make(); const reached = vi.fn(); document.body.addEventListener('pointerdown', reached); document.body.addEventListener('mousedown', reached);
	const fire = (type: string) => tool('study').dispatchEvent(new Event(type, { bubbles: true }));
	fire('pointerdown'); fire('mousedown'); expect(reached).not.toHaveBeenCalled(); fire('pointerup'); expect(hooks.openStudy).toHaveBeenCalledTimes(1);
	tool('study').click(); expect(hooks.openStudy).toHaveBeenCalledTimes(1);
});

it('keeps exactly one bar first in the right column and ignores pages without it', () => {
	document.body.innerHTML = '<ytd-watch-flexy><div id="secondary-inner"><div id="related">related</div></div></ytd-watch-flexy>';
	const build = () => buildTranscriptBar(document, { strings, title: () => 't', getSegments: async () => [], openStudy: () => {}, openSettings: () => {}, seek: () => {} }).element;
	const column = document.querySelector('#secondary-inner')!;
	expect(syncTranscriptBar(document, build)).toBe(column.firstElementChild); syncTranscriptBar(document, build); expect(document.querySelectorAll('.qiaomu-yt-bar')).toHaveLength(1);
	column.append(column.firstElementChild!); expect(syncTranscriptBar(document, build)).toBe(column.firstElementChild);
	document.body.innerHTML = '<div>no right column</div>'; expect(syncTranscriptBar(document, build)).toBeUndefined();
});
