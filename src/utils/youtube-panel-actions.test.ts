// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { buildPanelActions, formatSegments, readPanelSegments, safeFileName, syncPanelActions } from './youtube-panel-actions';

const strings = { copy: 'Copy', download: 'Download', study: 'Study', copied: 'Copied', empty: 'Empty' };
const modern = `<transcript-segment-view-model><div><div><span>13:47</span></div><span class="yt-core-attributed-string">it is a problem before it becomes a</span></div></transcript-segment-view-model>
<transcript-segment-view-model><div><span>1:02:03</span><span>second   line</span></div></transcript-segment-view-model>`;
const classic = '<ytd-transcript-segment-renderer><div class="segment-timestamp">0:05</div><yt-formatted-string class="segment-text">Hello there</yt-formatted-string></ytd-transcript-segment-renderer>';
const panel = (segments: string) => `<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript"><chip-bar-view-model><div class="ytChipBarViewModelChipBarScrollContainer"><div class="chip">Transcript</div></div></chip-bar-view-model><div id="segments">${segments}</div></ytd-engagement-panel-section-list-renderer>`;
beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('reads timestamps and text from both the modern and the classic transcript views', () => {
	document.body.innerHTML = panel(modern + classic);
	expect(readPanelSegments(document)).toEqual([
		{ time: '13:47', text: 'it is a problem before it becomes a' }, { time: '1:02:03', text: 'second line' }, { time: '0:05', text: 'Hello there' },
	]);
	expect(formatSegments(readPanelSegments(document))).toBe('[13:47] it is a problem before it becomes a\n[1:02:03] second line\n[0:05] Hello there');
	document.body.innerHTML = '<transcript-segment-view-model><span>no time here</span></transcript-segment-view-model>'; expect(readPanelSegments(document)).toEqual([]);
});

it('makes safe download names', () => { expect(safeFileName('A/B: C | D - YouTube')).toBe('A B C D'); expect(safeFileName(' - YouTube')).toBe('youtube-transcript'); });

it('copies, downloads and opens the study page, and tells when there is nothing to copy', async () => {
	document.body.innerHTML = panel(modern);
	const write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
	const created = vi.fn(() => 'blob:x'); Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
	const clicked: string[] = []; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
	const openStudy = vi.fn(); const root = document.querySelector<HTMLElement>('ytd-engagement-panel-section-list-renderer')!;
	const group = buildPanelActions(document, root, { strings, openStudy, title: () => 'My video - YouTube' });
	const [copy, download, study] = Array.from(group.querySelectorAll('button'));
	copy.click(); await Promise.resolve(); await Promise.resolve(); expect(write).toHaveBeenCalledWith('[13:47] it is a problem before it becomes a\n[1:02:03] second line'); expect(copy.title).toBe('Copied');
	download.click(); expect(created).toHaveBeenCalled(); expect(clicked).toEqual(['My video.txt']);
	study.click(); expect(openStudy).toHaveBeenCalledTimes(1);
	root.querySelector('#segments')!.innerHTML = ''; copy.click(); download.click(); expect(write).toHaveBeenCalledTimes(1); expect(clicked).toHaveLength(1);
});

it('injects one group into the chip bar and hides it while the transcript has no lines', () => {
	document.body.innerHTML = panel('');
	const make = (panelEl: HTMLElement) => buildPanelActions(document, panelEl, { strings, openStudy: () => {}, title: () => 't' });
	syncPanelActions(document, make); syncPanelActions(document, make);
	const groups = document.querySelectorAll('.qiaomu-yt-actions'); expect(groups).toHaveLength(1); expect((groups[0] as HTMLElement).hidden).toBe(true);
	document.querySelector('#segments')!.innerHTML = modern; syncPanelActions(document, make); expect((groups[0] as HTMLElement).hidden).toBe(false);
	expect(groups[0].parentElement!.className).toContain('ChipBarScrollContainer');
	document.body.innerHTML = '<div>no panel</div>'; syncPanelActions(document, make); expect(document.querySelector('.qiaomu-yt-actions')).toBeNull();
});
