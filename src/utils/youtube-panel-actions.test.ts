// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { formatSegments, readPanelSegments, safeFileName } from './youtube-panel-actions';

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
