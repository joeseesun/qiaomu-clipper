// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { formatBilingualSegments, formatSegments, readPanelSegments, safeFileName, spokenToSeconds } from './youtube-panel-actions';

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

it('formats bilingual downloads with source first and translation second', () => {
	const lines = [{ time: '0:01', text: 'Hello' }, { time: '0:04', text: 'World', chapter: 'Part' }];
	expect(formatBilingualSegments(lines, new Map([[0, '你好'], [1, '世界']]))).toBe('[0:01] Hello\n你好\n\n## Part\n[0:04] World\n世界');
});

it('reads the hidden spoken timestamps as finer timing instead of text: each one opens a shorter line', () => {
	document.body.innerHTML = `<transcript-segment-view-model>
		<div class="ytwTranscriptSegmentViewModelTimestamp">2:15</div>
		<div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">2分钟15秒钟</div>
		<span class="yt-core-attributed-string">young I I uh I didn't really know </span>
		<span class="ytwSomethingA11yLabel">2分钟23秒钟</span>
		<span class="yt-core-attributed-string">what I was going to do</span>
		<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">2分钟30秒钟</span>
		<span style="display:none">hidden words</span>
		<span class="visually-hidden">2分钟39秒钟</span>
	</transcript-segment-view-model>`;
	expect(readPanelSegments(document)).toEqual([{ time: '2:15', text: "young I I uh I didn't really know" }, { time: '2:23', text: 'what I was going to do' }]);
	// the same row with the labels removed is one line, as before
	document.body.querySelectorAll('[class*="A11y"], .visually-hidden, [style]').forEach(node => node.remove());
	expect(readPanelSegments(document)).toEqual([{ time: '2:15', text: "young I I uh I didn't really know what I was going to do" }]);
});

it('turns a spoken time into seconds in the viewer\'s language, and refuses what it does not understand', () => {
	for (const [label, seconds] of [['1分钟43秒钟', 103], ['2分钟', 120], ['43秒钟', 43], ['1小时2分钟3秒钟', 3723], ['1分43秒', 103], ['1 minute, 43 seconds', 103], ['1 hour, 2 minutes, 3 seconds', 3723], ['2 minutes', 120], ['1時間2分3秒', 3723], ['1分 43秒', 103]] as const) expect(spokenToSeconds(label)).toBe(seconds);
	expect(spokenToSeconds('hello there')).toBeNull(); expect(spokenToSeconds('12 apples')).toBeNull(); expect(spokenToSeconds('')).toBeNull();
});

it('does not take a spoken-time label for the row\'s timestamp when the visible one is missing', () => {
	document.body.innerHTML = '<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">1分钟43秒钟</div><span>no visible time</span></transcript-segment-view-model>';
	expect(readPanelSegments(document)).toEqual([]);
});
