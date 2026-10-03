// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { mountTranscriptSearch } from './transcript-search';

const strings = { placeholder: 'Search', clear: 'Clear', noMatch: 'None' };
const html = `<div class="youtube transcript"><h2>Transcript</h2><h3>Intro</h3>
<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="0">0:00</span></strong><span class="transcript-segment-text">Hello and welcome to the show</span></p>
<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="9">0:09</span></strong><span class="transcript-segment-text">The ALLOCATION of time <span class="transcript-translation">时间的分配</span></span></p>
<h3>Part two</h3>
<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="30">0:30</span></strong><span class="transcript-segment-text">Allocation again, and allocation once more</span></p></div>`;
let highlights: Map<string, any>;
beforeEach(() => {
	document.body.innerHTML = html; vi.useFakeTimers();
	highlights = new Map(); (window as any).CSS = { highlights }; (window as any).Highlight = class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } };
});
const setup = () => {
	const transcript = document.querySelector<HTMLElement>('.transcript')!, segments = Array.from(transcript.querySelectorAll<HTMLElement>('.transcript-segment'));
	const changed = vi.fn(); const search = mountTranscriptSearch(document, transcript, segments, strings, changed);
	const input = search.element.querySelector<HTMLInputElement>('input')!;
	const type = (value: string) => { input.value = value; input.dispatchEvent(new Event('input')); vi.advanceTimersByTime(150); };
	return { transcript, segments, search, input, type, changed };
};

it('puts the box above the first line and filters lines and empty chapter titles as you type', () => {
	const { transcript, segments, search, type, changed } = setup();
	expect(segments[0].previousElementSibling).toBe(search.element); expect(search.active()).toBe(false);
	type('allocation'); expect(search.active()).toBe(true); expect(segments.map(segment => segment.hidden)).toEqual([true, false, false]);
	const titles = Array.from(transcript.querySelectorAll<HTMLElement>('h3')); expect(titles.map(title => title.hidden)).toEqual([false, false]);
	type('again'); expect(titles.map(title => title.hidden)).toEqual([true, false]); // "Intro" has no match left
	type('allocation'); expect(search.element.querySelector('.transcript-search-count')!.textContent).toBe('2'); expect(changed).toHaveBeenCalled();
});

it('marks every match with the highlight API without rewriting the text, including the translation', () => {
	const { segments, type } = setup(); const before = segments.map(segment => segment.innerHTML);
	type('allocation'); const ranges = highlights.get('transcript-search').ranges as Range[];
	expect(ranges.map(range => range.toString())).toEqual(['ALLOCATION', 'Allocation', 'allocation']); expect(segments.map(segment => segment.innerHTML)).toEqual(before);
	type('分配'); expect((highlights.get('transcript-search').ranges as Range[]).map(range => range.toString())).toEqual(['分配']);
	type('00:00'); expect(highlights.has('transcript-search')).toBe(false); // nothing matches (timestamps are not searched)
});

it('says when nothing matches, and Escape or the clear button restores every line and title', () => {
	const { transcript, segments, search, input, type } = setup();
	type('zzz'); expect(search.element.querySelector('.transcript-search-count')!.textContent).toBe('None'); expect(segments.every(segment => segment.hidden)).toBe(true);
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	expect(segments.some(segment => segment.hidden)).toBe(false); expect(Array.from(transcript.querySelectorAll('h3')).some(title => (title as HTMLElement).hidden)).toBe(false); expect(input.value).toBe(''); expect(search.active()).toBe(false);
	type('welcome'); search.element.querySelector<HTMLElement>('.transcript-search-clear')!.click(); expect(segments.some(segment => segment.hidden)).toBe(false);
	type('show'); search.clear(); expect(search.active()).toBe(false);
});

it('still filters where the highlight API does not exist', () => {
	delete (window as any).CSS; delete (window as any).Highlight; const { segments, type } = setup();
	expect(() => type('welcome')).not.toThrow(); expect(segments.map(segment => segment.hidden)).toEqual([false, true, true]);
});
