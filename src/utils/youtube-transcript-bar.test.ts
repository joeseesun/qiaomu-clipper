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

it('is one calm strip: copy, download, one labelled study button and a chevron, closed at first, with a status dot', () => {
	const { bar, tool } = make();
	expect(Array.from(bar.element.querySelectorAll('.qiaomu-yt-bar-head .qiaomu-yt-tool')).map(button => button.className.split(' ')[1])).toEqual(['qiaomu-yt-tool-copy', 'qiaomu-yt-tool-download', 'qiaomu-yt-tool-study', 'qiaomu-yt-tool-toggle']);
	expect(bar.element.querySelector('.qiaomu-yt-bar-head .qiaomu-yt-tool-settings')).toBeNull(); expect(bar.element.querySelector('.qiaomu-yt-bar-finder .qiaomu-yt-tool-settings')).not.toBeNull(); // settings sit with the search row
	expect(tool('study').textContent).toBe('Study'); expect(bar.element.dataset.theme).toBe('youtube');
	expect(bar.element.querySelector('.qiaomu-yt-bar-title')!.textContent).toBe('Qiaomu'); expect(bar.element.dataset.open).toBe('false'); expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-body')!.hidden).toBe(true);
	for (const name of ['copy', 'download', 'study', 'settings']) { expect(tool(name).title).toBeTruthy(); expect(tool(name).getAttribute('aria-label')).toBe(tool(name).title); }
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

it('opens study mode and settings, warns when the page is stale, and loads the transcript when the strip is opened', async () => {
	const { hooks, bar, tool } = make({ getSegments: vi.fn(async () => lines) });
	tool('study').click(); expect(hooks.openStudy).toHaveBeenCalledTimes(1); tool('settings').click(); expect(hooks.openSettings).toHaveBeenCalledTimes(1);
	tool('toggle').click(); await tick(); expect(bar.element.dataset.open).toBe('true'); expect(bar.element.dataset.state).toBe('ready'); expect(bar.element.querySelectorAll('.qiaomu-yt-bar-line').length).toBeGreaterThan(0);
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

it('can mount in another site\'s right column and leaves a YouTube-shaped page alone when asked for that column', () => {
	document.body.innerHTML = '<div class="right-container"><div class="right-container-inner"><div class="up-panel-container">up</div></div></div><div id="secondary-inner"></div>';
	const build = () => buildTranscriptBar(document, { strings, title: () => 't', getSegments: async () => [], openStudy: () => {}, openSettings: () => {}, seek: () => {} }).element;
	const column = document.querySelector('.right-container-inner')!;
	expect(syncTranscriptBar(document, build, '.right-container-inner')).toBe(column.firstElementChild);
	column.append(column.firstElementChild!); syncTranscriptBar(document, build, '.right-container-inner');
	expect(column.firstElementChild!.className).toContain('qiaomu-yt-bar'); expect(document.querySelectorAll('.qiaomu-yt-bar')).toHaveLength(1); expect(document.querySelector('#secondary-inner')!.children).toHaveLength(0);
});

it('can sit right after a given block of the column (under the author) and stays there', () => {
	document.body.innerHTML = '<div class="right-container-inner"><div class="up-panel-container">up</div><div class="danmaku">danmaku</div></div>';
	const build = () => buildTranscriptBar(document, { strings, title: () => 't', getSegments: async () => [], openStudy: () => {}, openSettings: () => {}, seek: () => {} }).element;
	const column = document.querySelector('.right-container-inner')!;
	const bar = syncTranscriptBar(document, build, '.right-container-inner', '.up-panel-container')!;
	expect(Array.from(column.children).map(c => c.className.split(' ')[0])).toEqual(['up-panel-container', 'qiaomu-yt-bar', 'danmaku']);
	column.prepend(document.createElement('section')); syncTranscriptBar(document, build, '.right-container-inner', '.up-panel-container');
	expect(document.querySelectorAll('.qiaomu-yt-bar')).toHaveLength(1); expect(document.querySelector('.up-panel-container')!.nextElementSibling).toBe(bar);
	document.querySelector('.up-panel-container')!.remove(); syncTranscriptBar(document, build, '.right-container-inner', '.up-panel-container');
	expect(column.firstElementChild).toBe(bar); // no author block: falls back to the top of the column
});

it('shows a check on a successful copy for a moment and then the copy icon again', async () => {
	vi.useFakeTimers(); try {
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
		const { tool } = make(); const button = tool('copy'), before = button.firstElementChild!;
		button.click(); await vi.advanceTimersByTimeAsync(10);
		expect(button.classList.contains('is-notice')).toBe(true); expect(button.firstElementChild).not.toBe(before); expect(button.querySelector('path')!.getAttribute('d')).toBe('M20 6 9 17l-5-5');
		await vi.advanceTimersByTimeAsync(1900); expect(button.firstElementChild).toBe(before); expect(button.classList.contains('is-notice')).toBe(false); expect(button.title).toBe('Copy');
	} finally { vi.useRealTimers(); }
});

it('takes the site\'s own skin when asked, and a Bilibili bar says so for the stylesheet', () => {
	const { bar } = make({ theme: 'bilibili' }); expect(bar.element.dataset.theme).toBe('bilibili');
});

it('opening the strip from its empty part also reads a transcript that has not arrived', async () => {
	const { hooks, bar } = make({ getSegments: vi.fn(async () => lines) });
	bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-head')!.click(); await tick();
	expect(hooks.getSegments).toHaveBeenCalled(); expect(bar.element.dataset.state).toBe('ready'); expect(bar.element.querySelectorAll('.qiaomu-yt-bar-line').length).toBeGreaterThan(0);
});

const genStrings = { dlgTitle: 'Generate subtitles', dlgSub: 'Choose how to turn speech into subtitles.', rememberHint: 'Skip this dialog next time', confirmAsk: 'Choose how to recognise it', startCloud: 'Upload audio and start', addService: '+ Add a service', remember: 'Start straight away next time', regenerate: 'Regenerate', generatedVia: 'Generated by {via}', confirmInstall: 'Needs {name} ({size}).', installStart: 'Install and start', installing: 'Installing', installFailed: 'Install failed', engineLabel: 'Engine', offer: 'Generate subtitles', checking: 'Checking…', confirm: 'Runs on this Mac.', confirmModel: 'Downloads a model first.', start: 'Start', cancel: 'Cancel', running: 'Generating', modelDownloading: 'Downloading model', failed: 'Failed', retry: 'Retry', languageAuto: 'Detect', languageLabel: 'Spoken language', needsLogin: 'Needs your browser login', loginRetry: 'Retry with login', generated: 'Generated locally', setupHelper: '安装或更新本地助手', setupRecognition: '配置语音识别', setupOffline: 'Helper offline', setupOutdated: 'Update helper', setupMissing: 'Install tools', setupBusy: 'Busy', setupCloud: 'Set up the cloud service', confirmCloud: 'Audio goes to {service}.', confirmLocalService: 'Stays here, handled by a local service.', copyCommand: 'Copy command', copied: 'Copied', recheck: 'Check again' };
const dlg = () => document.querySelector<HTMLElement>('.qiaomu-dlg')!;
const dlgPrimary = () => dlg().querySelector<HTMLButtonElement>('.qiaomu-dlg-btn.is-primary')!;
const dlgCancel = () => dlg().querySelector<HTMLButtonElement>('.qiaomu-dlg-btn:not(.is-primary)')!;
const withGeneration = () => { const actions = { request: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), confirmWithLogin: vi.fn() }; const made = make({ generation: { strings: genStrings, actions } }); return { ...made, actions }; };
const gen = (bar: { element: HTMLElement }) => bar.element.querySelector<HTMLElement>('.qiaomu-yt-gen')!;
const genButtons = (bar: { element: HTMLElement }) => Array.from(bar.element.querySelectorAll<HTMLButtonElement>('.qiaomu-yt-gen-button'));

it('offers to generate subtitles only when the video has none, and asks the page to check the helper first', () => {
	const { bar, actions } = withGeneration();
	expect(gen(bar).hidden).toBe(true); bar.setState('ready', lines); expect(gen(bar).hidden).toBe(true);
	bar.setState('none', []); expect(gen(bar).hidden).toBe(false); expect(genButtons(bar).map(b => b.textContent)).toEqual(['Generate subtitles']);
	genButtons(bar)[0].click(); expect(actions.request).toHaveBeenCalledTimes(1);
	const plain = make(); plain.bar.setState('none', []); expect(plain.bar.element.querySelector('.qiaomu-yt-gen')).toBeNull(); // no generation hooks: nothing offered
});

it('walks the generation flow: checking, confirm with the model note, running with progress and cancel, then a generated note', () => {
	const { bar, actions } = withGeneration(); bar.setState('none', []);
	bar.setGeneration({ kind: 'checking' }); expect(gen(bar).textContent).toContain('Checking'); expect(genButtons(bar)).toHaveLength(0);
	bar.setGeneration({ kind: 'confirm', modelDownload: true }); expect(dlg().textContent).toContain('Generate subtitles'); expect(gen(bar).hidden).toBe(true); // the decision is a dialog above the page
	dlgPrimary().click(); expect(actions.confirm).toHaveBeenCalledTimes(1);
	dlgCancel().click(); expect(document.querySelector('.qiaomu-dlg')).toBeNull(); expect(genButtons(bar).map(b => b.textContent)).toEqual(['Generate subtitles']); // cancel goes back to the offer
	bar.setGeneration({ kind: 'confirm', modelDownload: false }); bar.setGeneration({ kind: 'running', stage: 's', progress: 1, modelDownload: false }); expect(document.querySelector('.qiaomu-dlg')).toBeNull(); // moving on closes it
	bar.setState('generating', lines); bar.setGeneration({ kind: 'running', stage: 's', progress: 40, processedSec: 750, totalSec: 2462, modelDownload: false });
	expect(bar.element.dataset.state).toBe('generating'); expect(gen(bar).textContent).toContain('Generating · 12:30 / 41:02'); expect(gen(bar).querySelector<HTMLElement>('.qiaomu-yt-gen-meter i')!.style.width).toBe('40%');
	expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-finder')!.hidden).toBe(false); // lines already generated can be read and searched
	expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-retry')!.hidden).toBe(true);
	genButtons(bar)[0].click(); expect(actions.cancel).toHaveBeenCalledTimes(1);
	bar.setGeneration({ kind: 'running', stage: 'm', progress: 18, modelDownload: true }); expect(gen(bar).textContent).toContain('Downloading model'); expect(gen(bar).querySelector<HTMLElement>('.qiaomu-yt-gen-meter')!.hidden).toBe(true);
	bar.setState('ready', lines); bar.setGeneration({ kind: 'generated' });
	expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-notice')!.hidden).toBe(false); expect(gen(bar).textContent).toBe('Generated locally'); expect(genButtons(bar)).toHaveLength(0);
	bar.setGeneration(null); expect(bar.element.querySelector<HTMLElement>('.qiaomu-yt-bar-notice')!.hidden).toBe(true);
});

it('explains what is missing with a copyable command, and a failed run offers a retry', async () => {
	const write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
	const { bar, actions } = withGeneration(); bar.setState('none', []);
	bar.setGeneration({ kind: 'setup', reason: 'missing', hints: ['brew install yt-dlp ffmpeg', 'uv tool install mlx-whisper'] });
	expect(gen(bar).textContent).toContain('Install tools'); expect(gen(bar).querySelector('.qiaomu-yt-gen-code')!.textContent).toBe('brew install yt-dlp ffmpeg\nuv tool install mlx-whisper');
	genButtons(bar)[0].click(); await tick(); expect(write).toHaveBeenCalledWith('brew install yt-dlp ffmpeg\nuv tool install mlx-whisper'); expect(genButtons(bar)[0].textContent).toBe('Copied');
	genButtons(bar)[1].click(); expect(actions.request).toHaveBeenCalledTimes(1);
	bar.setGeneration({ kind: 'setup', reason: 'helper-offline', hints: [] }); expect(gen(bar).textContent).toContain('Helper offline'); expect(gen(bar).querySelector<HTMLElement>('.qiaomu-yt-gen-code')!.hidden).toBe(true);
	bar.setGeneration({ kind: 'failed', error: 'Video unavailable' }); expect(gen(bar).textContent).toContain('Failed：Video unavailable'); genButtons(bar)[0].click(); expect(actions.request).toHaveBeenCalledTimes(2);
});

it('explains a login wall in plain words and only borrows the browser login after an explicit press', () => {
	const { bar, actions } = withGeneration(); bar.setState('none', []);
	bar.setGeneration({ kind: 'failed', error: 'x', code: 'needs-cookies' });
	expect(gen(bar).textContent).toContain('Needs your browser login'); expect(genButtons(bar).map(b => b.textContent)).toEqual(['Retry with login', 'Cancel']); expect(actions.confirmWithLogin).not.toHaveBeenCalled();
	genButtons(bar)[0].click(); expect(actions.confirmWithLogin).toHaveBeenCalledTimes(1);
	genButtons(bar)[1].click(); expect(genButtons(bar).map(b => b.textContent)).toEqual(['Generate subtitles']);
});

it('lets the viewer pick the subtitle language when the video offers more than one, and tells the page', () => {
	const onLanguage = vi.fn(); const { bar } = make({ onLanguage }); const select = bar.element.querySelector<HTMLSelectElement>('.qiaomu-yt-bar-lang')!;
	expect(select.hidden).toBe(true); // nothing to choose yet
	bar.setLanguages([{ id: 'en-auto', label: 'English (auto)' }], 'en-auto'); expect(select.hidden).toBe(true); // a single language needs no choice
	bar.setLanguages([{ id: 'zh-Hans', label: '中文' }, { id: 'en-auto', label: 'English (auto)' }], 'en-auto');
	expect(select.hidden).toBe(false); expect(Array.from(select.options).map(o => o.textContent)).toEqual(['中文', 'English (auto)']); expect(select.value).toBe('en-auto');
	select.value = 'zh-Hans'; select.dispatchEvent(new Event('change')); expect(onLanguage).toHaveBeenCalledWith('zh-Hans');
	const before = select.options[0]; bar.setLanguages([{ id: 'zh-Hans', label: '中文' }, { id: 'en-auto', label: 'English (auto)' }], 'zh-Hans'); expect(select.options[0]).toBe(before); expect(select.value).toBe('zh-Hans'); // same list: not rebuilt
	bar.setLanguages([], undefined); expect(select.hidden).toBe(true);
});

it('lets the viewer say which language is spoken before generating, and passes it on (automatic detection by default)', () => {
	const { bar, actions } = withGeneration(); bar.setState('none', []); bar.setGeneration({ kind: 'confirm', modelDownload: false });
	const picker = dlg().querySelector<HTMLSelectElement>('.qiaomu-dlg-select')!;
	expect(picker.value).toBe('auto'); expect(Array.from(picker.options).map(o => o.value).slice(0, 3)).toEqual(['auto', 'zh', 'en']);
	dlgPrimary().click(); expect(actions.confirm).toHaveBeenLastCalledWith('auto');
	document.querySelectorAll('.qiaomu-dlg-wrap').forEach(n => n.remove());
	const second = withGeneration(); second.bar.setState('none', []); second.bar.setGeneration({ kind: 'confirm', modelDownload: false });
	const chosen = dlg().querySelector<HTMLSelectElement>('.qiaomu-dlg-select')!; chosen.value = 'en'; chosen.dispatchEvent(new Event('change'));
	dlgPrimary().click(); expect(second.actions.confirm).toHaveBeenLastCalledWith('en');
});

it('says on the button that the audio is uploaded when a cloud service is chosen, and not when the service runs on this computer', () => {
	const { bar } = withGeneration(); bar.setState('none', []);
	bar.setGeneration({ kind: 'confirm', modelDownload: true, cloud: '硅基流动' }); expect(dlgPrimary().textContent).toBe('Upload audio and start');
	bar.setGeneration({ kind: 'confirm', modelDownload: false, cloud: '本机服务', localService: true }); expect(dlgPrimary().textContent).toBe('Start'); // it stays here
	bar.setGeneration({ kind: 'setup', reason: 'cloud-not-configured', hints: [] }); expect(document.querySelector('.qiaomu-dlg')).toBeNull(); expect(gen(bar).textContent).toContain('Set up the cloud service'); expect(gen(bar).querySelector<HTMLElement>('.qiaomu-yt-gen-code')!.hidden).toBe(true);
});

it('lists the ways to make subtitles with their notes in the dialog, switches by pressing one, and offers to add a cloud service', () => {
	const { bar, actions } = withGeneration(); const choose = vi.fn(), addService = vi.fn(); Object.assign(actions, { choose, addService }); bar.setState('none', []);
	bar.setGeneration({ kind: 'confirm', modelDownload: false, selected: 'local:mlx', choices: [{ value: 'local:mlx', kind: 'local', label: 'Whisper', note: 'On this computer' }, { value: 'cloud:a', kind: 'cloud', label: 'Cloud A', note: 'Uploads the audio' }] });
	const rows = Array.from(dlg().querySelectorAll<HTMLElement>('.qiaomu-dlg-choice')); expect(rows.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false']); expect(rows[1].textContent).toContain('Uploads the audio');
	expect(dlgPrimary().textContent).toBe('Start'); rows[1].click(); expect(choose).toHaveBeenCalledWith('cloud:a'); expect(rows.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true']); expect(dlgPrimary().textContent).toBe('Upload audio and start'); // at once, before the page answers
	choose.mockClear(); rows[1].click(); expect(choose).not.toHaveBeenCalled(); // already the selected one
	dlg().querySelector<HTMLElement>('.qiaomu-dlg-link')!.click(); expect(addService).toHaveBeenCalled();
	const remember = dlg().querySelector<HTMLElement>('.qiaomu-dlg-switch')!; expect(remember.getAttribute('aria-checked')).toBe('true');
	dlgPrimary().click(); expect(actions.confirm).toHaveBeenLastCalledWith('auto', true);
	remember.click(); expect(remember.getAttribute('aria-checked')).toBe('false'); dlgPrimary().click(); expect(actions.confirm).toHaveBeenLastCalledWith('auto', false);
	bar.setGeneration({ kind: 'confirm', modelDownload: false, install: { name: 'Qwen3-ASR', sizeMb: 1300 } });
	expect(dlg().textContent).toContain('Needs Qwen3-ASR (1.3 GB).'); expect(dlgPrimary().textContent).toBe('Install and start');
	bar.setGeneration({ kind: 'installing', stage: 'pip', progress: 40 }); expect(gen(bar).textContent).toContain('Installing：pip'); expect(genButtons(bar).map(b => b.textContent)).toEqual(['Cancel']);
	bar.setGeneration({ kind: 'failed', error: 'no space', code: 'install' }); expect(gen(bar).textContent).toContain('Install failed：no space');
	bar.setGeneration({ kind: 'running', stage: '', progress: 5, totalSec: 100, processedSec: 10, modelDownload: false, via: 'Qwen3 · local' }); expect(gen(bar).textContent).toContain('Qwen3 · local');
	const regenerate = vi.fn(); Object.assign(actions, { regenerate }); bar.setGeneration({ kind: 'generated', via: 'Qwen3 · local' });
	expect(gen(bar).textContent).toContain('Generated by Qwen3 · local'); genButtons(bar)[0].click(); expect(regenerate).toHaveBeenCalled();
});

it('closes the dialog with Escape or a click outside it, keeps the page\'s key handlers out of it, and remembers the choices when it is opened again', () => {
	const { bar, actions } = withGeneration(); bar.setState('none', []); const seen = vi.fn(); document.addEventListener('keydown', seen);
	bar.setGeneration({ kind: 'confirm', modelDownload: false }); dlg().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); expect(seen).not.toHaveBeenCalled(); document.removeEventListener('keydown', seen);
	dlg().closest('.qiaomu-dlg-wrap')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(document.querySelector('.qiaomu-dlg')).toBeNull(); expect(actions.confirm).not.toHaveBeenCalled();
	bar.setGeneration(null); bar.setGeneration({ kind: 'confirm', modelDownload: false }); document.querySelector<HTMLElement>('.qiaomu-dlg-scrim')!.click(); expect(document.querySelector('.qiaomu-dlg')).toBeNull();
	const picker = () => document.querySelector<HTMLSelectElement>('.qiaomu-dlg-select')!; bar.setGeneration(null); bar.setGeneration({ kind: 'confirm', modelDownload: false }); picker().value = 'ja'; picker().dispatchEvent(new Event('change'));
	bar.setGeneration({ kind: 'confirm', modelDownload: true }); expect(picker().value).toBe('ja'); // the language stays chosen while the dialog is refreshed
});
