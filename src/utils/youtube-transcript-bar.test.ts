// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { activeIndexAt, buildTranscriptBar, syncTranscriptBar, type BarHooks } from './youtube-transcript-bar';

const strings = { heading: 'Qiaomu', subtitles: 'Subtitles', copy: 'Copy', download: 'Download', study: 'Study', settings: 'Settings', expand: 'Show', collapse: 'Hide', copied: 'Copied', empty: 'Empty', reload: 'Reload page', loading: 'Loading', ready: 'Ready', none: 'None', more: 'More in study mode', search: 'Search', clear: 'Clear', noMatch: 'No results', follow: 'Following', followOff: 'Not following', here: 'Back to current', retry: 'Retry' };
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
	const many = Array.from({ length: 1700 }, (_, i) => ({ time: `${Math.floor(i * 40 / 60)}:${String(i * 40 % 60).padStart(2, '0')}`, text: `Line ${i}.` }));
	bar.setState('ready', many); expect(bar.element.querySelectorAll('.qiaomu-yt-bar-line')).toHaveLength(1500); expect(bar.element.querySelector('.qiaomu-yt-bar-more')!.textContent).toBe('More in study mode');
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

it('finds the line that is playing with a binary search', () => {
	const starts = [0, 12, 30, 61];
	expect([-1, 0, 11.9, 12, 29, 30, 60.9, 61, 999].map(t => activeIndexAt(starts, t))).toEqual([-1, 0, 0, 1, 1, 2, 2, 3, 3]); expect(activeIndexAt([], 5)).toBe(-1);
});

const longLines = Array.from({ length: 30 }, (_, i) => ({ time: `${Math.floor(i * 40 / 60)}:${String(i * 40 % 60).padStart(2, '0')}`, text: i === 7 ? 'The Allocation of time matters.' : i === 20 ? 'Time is the scarce thing, allocation follows.' : `Line number ${i}.` }));
// jsdom has no layout: give the list a viewport of 300px and every row 50px of height.
function withLayout(bar: ReturnType<typeof make>['bar']) {
	const list = bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-lines')!;
	Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true }); Object.defineProperty(list, 'offsetTop', { value: 0, configurable: true }); list.scrollTo = vi.fn((options: any) => { list.scrollTop = options.top; }) as any;
	Array.from(list.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line')).forEach((row, i) => { Object.defineProperty(row, 'offsetTop', { value: i * 50, configurable: true }); Object.defineProperty(row, 'offsetHeight', { value: 50, configurable: true }); });
	return list;
}

it('filters as you type, marks matches case-insensitively, counts them, and Escape or the clear button restores everything', async () => {
	vi.useFakeTimers(); const { bar } = make({ initialOpen: true }); bar.setState('ready', longLines);
	const input = bar.element.querySelector<HTMLInputElement>('.qiaomu-yt-bar-input')!, rows = () => Array.from(bar.element.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line'));
	const visible = () => rows().filter(row => !row.hidden).length; const total = rows().length;
	input.value = 'ALLOCATION'; input.dispatchEvent(new Event('input')); vi.advanceTimersByTime(150);
	expect(visible()).toBe(2); expect(bar.element.querySelector('.qiaomu-yt-bar-count')!.textContent).toBe('2');
	expect(Array.from(bar.element.querySelectorAll('mark')).map(mark => mark.textContent)).toEqual(['Allocation', 'allocation']);
	input.value = 'nothing like this'; input.dispatchEvent(new Event('input')); vi.advanceTimersByTime(150); expect(visible()).toBe(0); expect(bar.element.querySelector('.qiaomu-yt-bar-count')!.textContent).toBe('No results');
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); vi.advanceTimersByTime(150);
	expect(visible()).toBe(total); expect(bar.element.querySelector('mark')).toBeNull(); expect(input.value).toBe(''); expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-clear')!.hidden).toBe(true);
	input.value = 'line'; input.dispatchEvent(new Event('input')); vi.advanceTimersByTime(150); bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-clear')!.click(); vi.advanceTimersByTime(150); expect(input.value).toBe(''); expect(visible()).toBe(total);
	vi.useRealTimers();
});

it('keeps single-key shortcuts out of the search box so YouTube does not react to typing', () => {
	const { bar } = make({ initialOpen: true }); const input = bar.element.querySelector<HTMLInputElement>('.qiaomu-yt-bar-input')!; const page = vi.fn();
	document.addEventListener('keydown', page); document.addEventListener('keyup', page); for (const type of ['keydown', 'keyup', 'keypress']) input.dispatchEvent(new KeyboardEvent(type, { key: 'k', bubbles: true })); expect(page).not.toHaveBeenCalled();
});

it('follows playback: highlights the current line, scrolls only when it leaves the middle band, and pauses for a moment after the viewer scrolls', () => {
	vi.useFakeTimers(); vi.setSystemTime(100000);
	const { bar } = make({ initialOpen: true }); bar.setState('ready', longLines); const list = withLayout(bar); const rows = Array.from(list.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line'));
	bar.setTime(1); expect(rows[0].classList.contains('is-active')).toBe(true); expect(rows[0].getAttribute('aria-current')).toBe('true');
	bar.setTime(125); expect(list.scrollTo).not.toHaveBeenCalled(); // 2:00 sits in the middle band already
	bar.setTime(405); const index = rows.findIndex(row => row.classList.contains('is-active')); expect(rows[index].querySelector('.qiaomu-yt-bar-time')!.textContent).toBe('6:40'); expect(rows.filter(row => row.classList.contains('is-active'))).toHaveLength(1);
	expect((list.scrollTo as any)).toHaveBeenCalledWith({ top: 10 * 50 - 300 * 0.33, behavior: 'smooth' } as any);
	(list.scrollTo as any).mockClear(); bar.setTime(410); expect(list.scrollTo).not.toHaveBeenCalled(); // same line: nothing to do
	list.dispatchEvent(new Event('wheel')); bar.setTime(1000); expect(list.scrollTo).not.toHaveBeenCalled(); // the viewer is in charge
	vi.setSystemTime(100000 + 5000); bar.setTime(1100); expect(list.scrollTo).not.toHaveBeenCalled(); // still in charge for the full ten seconds
	vi.setSystemTime(100000 + 11000); bar.setTime(1100); expect(list.scrollTo).toHaveBeenCalled();
	vi.useRealTimers();
});

it('can stop following, offers a way back to the current line, and does not scroll while searching', () => {
	vi.useFakeTimers(); vi.setSystemTime(200000);
	const { hooks, bar } = make({ initialOpen: true, initialFollow: true, onFollow: vi.fn() }); bar.setState('ready', longLines); const list = withLayout(bar);
	const follow = bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-follow')!, here = bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-here')!;
	expect(follow.getAttribute('aria-pressed')).toBe('true'); follow.click(); expect(follow.getAttribute('aria-pressed')).toBe('false'); expect(hooks.onFollow).toHaveBeenLastCalledWith(false);
	bar.setTime(900); expect(list.scrollTo).not.toHaveBeenCalled(); expect(here.hidden).toBe(false); // off screen and not following: a button brings it back
	here.click(); expect(list.scrollTo).toHaveBeenCalledTimes(1);
	vi.setSystemTime(201000); follow.click(); expect(follow.getAttribute('aria-pressed')).toBe('true');
	const input = bar.element.querySelector<HTMLInputElement>('.qiaomu-yt-bar-input')!; input.value = 'line'; input.dispatchEvent(new Event('input')); vi.advanceTimersByTime(150); (list.scrollTo as any).mockClear();
	vi.setSystemTime(300000); bar.setTime(1500); expect(list.scrollTo).not.toHaveBeenCalled();
	vi.useRealTimers();
});

it('starts at the current line when opened late, using the page\'s playback time, and a press on a line jumps and highlights it at once', () => {
	const { hooks, bar } = make({ getTime: () => 125, initialOpen: false }); bar.setState('ready', longLines); bar.setOpen(true);
	const rows = Array.from(bar.element.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line')); expect(rows.find(row => row.classList.contains('is-active'))!.querySelector('.qiaomu-yt-bar-time')!.textContent).toBe('2:00');
	rows[10].click(); expect(hooks.seek).toHaveBeenCalledWith(400); expect(rows[10].classList.contains('is-active')).toBe(true);
});

it('says nothing cryptic when no transcript was found: a plain message and a retry that starts over', () => {
	const retry = vi.fn(); const { bar } = make({ retry, initialOpen: true }); bar.setState('none');
	const button = bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-retry')!;
	expect(button.hidden).toBe(false); expect(bar.element.querySelector('.qiaomu-yt-bar-status')!.textContent).toBe('None'); expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-finder')!.hidden).toBe(true);
	button.click(); expect(retry).toHaveBeenCalledTimes(1); expect(bar.element.dataset.state).toBe('loading'); expect(button.hidden).toBe(true);
	bar.setState('ready', lines); expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-finder')!.hidden).toBe(false);
});

it('does not move the list when a line is pressed, and ignores the old position the video still reports right after the jump', () => {
	vi.useFakeTimers(); vi.setSystemTime(500000);
	const { hooks, bar } = make({ initialOpen: true }); bar.setState('ready', longLines); const list = withLayout(bar); const rows = Array.from(list.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line'));
	bar.setTime(1); (list.scrollTo as any).mockClear();
	rows[12].click(); expect(hooks.seek).toHaveBeenCalledWith(480); expect(rows[12].classList.contains('is-active')).toBe(true); expect(list.scrollTo).not.toHaveBeenCalled();
	bar.setTime(2); expect(rows[12].classList.contains('is-active')).toBe(true); // the stale position is ignored
	bar.setTime(481, true); expect(rows[12].classList.contains('is-active')).toBe(true); // "seeked" reports where the video really is
	vi.setSystemTime(502000); bar.setTime(1); expect(rows[0].classList.contains('is-active')).toBe(true); // and time updates count again later
	vi.useRealTimers();
});

it('does not restart a smooth scroll that is already heading to the same line, and lands far jumps at once', () => {
	vi.useFakeTimers(); vi.setSystemTime(700000);
	const { bar } = make({ initialOpen: true }); bar.setState('ready', longLines); const list = withLayout(bar);
	(list.scrollTo as any).mockImplementation(() => {}); // pretend the glide has not arrived yet
	bar.setTime(405); bar.setTime(406); bar.setTime(407); expect(list.scrollTo).toHaveBeenCalledTimes(1); expect((list.scrollTo as any).mock.calls[0][0].behavior).toBe('smooth');
	vi.setSystemTime(701000); bar.setTime(1100); expect((list.scrollTo as any).mock.calls.at(-1)[0].behavior).toBe('auto'); // 25 lines away: lands at once
	vi.useRealTimers();
});

it('lets the viewer scroll freely, and after ten quiet seconds glides back to the playing line by itself', () => {
	vi.useFakeTimers(); vi.setSystemTime(900000);
	const { bar } = make({ initialOpen: true }); bar.setState('ready', longLines); const list = withLayout(bar); const rows = Array.from(list.querySelectorAll<HTMLElement>('.qiaomu-yt-bar-line'));
	bar.setTime(405); (list.scrollTo as any).mockClear();
	list.dispatchEvent(new Event('wheel')); list.scrollTop = 1200; // the viewer browses far away
	vi.advanceTimersByTime(9000); list.dispatchEvent(new Event('wheel')); // another touch restarts the countdown
	vi.advanceTimersByTime(9000); expect(list.scrollTo).not.toHaveBeenCalled(); bar.setTime(410); expect(list.scrollTo).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1500); expect(list.scrollTo).toHaveBeenCalledTimes(1); expect((list.scrollTo as any).mock.calls[0][0].top).toBeCloseTo(10 * 50 - 300 * 0.33, 0); // back at the playing line without waiting for the next one
	expect(rows[10].classList.contains('is-active')).toBe(true);
	vi.useRealTimers();
});

it('does not pull the list back when following is off', () => {
	vi.useFakeTimers(); vi.setSystemTime(950000);
	const { bar } = make({ initialOpen: true, initialFollow: false }); bar.setState('ready', longLines); const list = withLayout(bar); bar.setTime(405);
	list.dispatchEvent(new Event('wheel')); vi.advanceTimersByTime(11000); expect(list.scrollTo).not.toHaveBeenCalled();
	vi.useRealTimers();
});

it('counts any scroll that is not one of ours as the viewer\'s (scrollbar drag, inertia, keys, touch), even right after an automatic scroll', () => {
	vi.useFakeTimers(); vi.setSystemTime(1200000);
	const { bar } = make({ initialOpen: true }); bar.setState('ready', longLines); const list = withLayout(bar);
	bar.setTime(405); // our own scroll: from 0 towards 401
	expect(list.scrollTo).toHaveBeenCalledTimes(1);
	list.scrollTop = 200; list.dispatchEvent(new Event('scroll')); // on the stretch of our scroll: ours, ignored
	(list.scrollTo as any).mockClear(); bar.setTime(500); expect(list.scrollTo).toHaveBeenCalledTimes(1); // following carries on
	list.scrollTop = 1400; list.dispatchEvent(new Event('scroll')); // far off our stretch, a fraction of a second later: the viewer's
	(list.scrollTo as any).mockClear(); vi.advanceTimersByTime(300); bar.setTime(560); expect(list.scrollTo).not.toHaveBeenCalled();
	vi.advanceTimersByTime(10100); expect(list.scrollTo).toHaveBeenCalledTimes(1); // ten quiet seconds later it is back at the playing line
	vi.useRealTimers();
});

it('treats touch moves and scroll keys inside the list as the viewer\'s, but ignores other keys, and our own placement on opening', () => {
	vi.useFakeTimers(); vi.setSystemTime(1300000);
	const { bar } = make({ getTime: () => 405, initialOpen: false }); bar.setState('ready', longLines); bar.setOpen(true); const list = withLayout(bar);
	list.dispatchEvent(new Event('scroll')); (list.scrollTo as any).mockClear(); bar.setTime(900); expect(list.scrollTo).toHaveBeenCalledTimes(1); // the opening placement did not pause following
	for (const make of [() => new Event('touchmove'), () => new KeyboardEvent('keydown', { key: 'PageDown' }), () => new KeyboardEvent('keydown', { key: ' ' })]) {
		(list.scrollTo as any).mockClear(); vi.setSystemTime(Date.now() + 20000); list.dispatchEvent(make()); bar.setTime(1000 + Math.random()); expect(list.scrollTo).not.toHaveBeenCalled();
		vi.advanceTimersByTime(10100);
	}
	(list.scrollTo as any).mockClear(); vi.setSystemTime(Date.now() + 20000); list.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); bar.setTime(1500); expect(list.scrollTo).toHaveBeenCalled(); // an unrelated key does not pause it
	vi.useRealTimers();
});

it('leaves the list alone when the page reports the same transcript again: no rebuilt rows, presses survive', () => {
	const { hooks, bar } = make({ initialOpen: true }); bar.setState('ready', longLines);
	const list = bar.element.querySelector('.qiaomu-yt-bar-lines')!, before = Array.from(list.children);
	const mutations = vi.fn(); const watcher = new MutationObserver(mutations); watcher.observe(bar.element, { childList: true, subtree: true, characterData: true });
	for (let i = 0; i < 20; i++) bar.setState('ready', longLines); // what the page watcher does on every change
	bar.setState('ready', [...longLines]); // an identical copy is no change either
	expect(Array.from(list.children).every((row, i) => row === before[i])).toBe(true); expect(watcher.takeRecords()).toHaveLength(0);
	const row = list.querySelector<HTMLElement>('.qiaomu-yt-bar-line')!; row.dispatchEvent(new Event('pointerdown', { bubbles: true })); bar.setState('ready', longLines); row.dispatchEvent(new Event('pointerup', { bubbles: true }));
	expect(hooks.seek).toHaveBeenCalledTimes(1); // the row pressed is still the row released
	bar.setState('ready', longLines.slice(0, 10)); expect(list.children[0]).not.toBe(before[0]); // a real change does rebuild
	watcher.disconnect();
});

it('marks the phrase being spoken in the current line, moves it with the time, and never touches the text', () => {
	const highlights = new Map<string, any>(); (window as any).CSS = { highlights }; (window as any).Highlight = class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } };
	const spoken = [{ time: '0:00', text: 'First clause, second clause, and a third one.' }, { time: '0:20', text: 'Next line' }];
	const { bar } = make({ initialOpen: true }); bar.setState('ready', spoken);
	const marked = () => (highlights.get('qiaomu-yt-line')?.ranges as Range[] | undefined)?.map(range => range.toString());
	bar.setTime(1); expect(marked()).toEqual(['First clause,']);
	bar.setTime(10); expect(marked()).toEqual([' second clause,'.trim()]);
	bar.setTime(19); expect(marked()).toEqual(['and a third one.']);
	expect(bar.element.querySelector('.qiaomu-yt-bar-line.is-active .qiaomu-yt-bar-text')!.textContent).toBe(spoken[0].text);
	bar.setTime(25); expect(marked()).toEqual(['Next line']);
	bar.setOpen(false); expect(highlights.has('qiaomu-yt-line')).toBe(false);
	delete (window as any).CSS; delete (window as any).Highlight; expect(() => bar.setOpen(true)).not.toThrow();
});
