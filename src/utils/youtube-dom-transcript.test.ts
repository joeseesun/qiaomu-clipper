// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { readYouTubeTranscriptFromDom, transcriptHtml } from './youtube-dom-transcript';

const rows = '<transcript-segment-view-model><div><span>0:05</span><span>Hello &amp; welcome</span></div></transcript-segment-view-model><transcript-segment-view-model><div><span>1:02:03</span><span>Later &lt;b&gt;line</span></div></transcript-segment-view-model>';
const panel = (inner = '') => `<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript"><div id="segments-container">${inner}</div></ytd-engagement-panel-section-list-renderer>`;
beforeEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

it('reads the lines YouTube already rendered without touching the page', async () => {
	document.body.innerHTML = panel(rows) + '<button id="open" aria-label="Show transcript">x</button>';
	const click = vi.fn(); document.getElementById('open')!.addEventListener('click', click);
	expect(await readYouTubeTranscriptFromDom(document)).toEqual([{ time: '0:05', text: 'Hello & welcome' }, { time: '1:02:03', text: 'Later <b>line' }]);
	expect(click).not.toHaveBeenCalled();
});

it('opens the transcript panel when it is closed, finds the opener in any language, and gives up quietly', async () => {
	document.body.innerHTML = '<button id="open" aria-label="显示转写文稿">x</button><button aria-label="关闭转写文稿">x</button>';
	document.getElementById('open')!.addEventListener('click', () => { document.body.insertAdjacentHTML('beforeend', panel(rows)); });
	expect((await readYouTubeTranscriptFromDom(document, true, 1000)).map(line => line.time)).toEqual(['0:05', '1:02:03']);
	document.body.innerHTML = '<button aria-label="Show transcript">nothing happens</button>';
	expect(await readYouTubeTranscriptFromDom(document, true, 500)).toEqual([]);
	expect(await readYouTubeTranscriptFromDom(document, false)).toEqual([]);
});

it('builds the same markup Defuddle produces, with escaped text and second offsets', () => {
	const html = transcriptHtml([{ time: '1:02:03', text: '<script>x</script> & "q"' }]);
	expect(html).toContain('<div class="youtube transcript">'); expect(html).toContain('data-timestamp="3723"'); expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;'); expect(html).not.toContain('<script>');
});

it('waits for a late opener, never closes an already open panel, and switches from the Chapters tab', async () => {
	// The page is still building: the opener shows up after a moment and is clicked exactly once.
	document.body.innerHTML = '';
	const opened = vi.fn(); setTimeout(() => { document.body.innerHTML = '<button id="late" aria-label="Show transcript">x</button>'; document.getElementById('late')!.addEventListener('click', () => { opened(); document.body.insertAdjacentHTML('beforeend', panel(rows)); }); }, 400);
	expect((await readYouTubeTranscriptFromDom(document, true, 3000, 50)).length).toBe(2); expect(opened).toHaveBeenCalledTimes(1);
	// Expanded but empty: only wait, do not click the opener again (that would close it).
	const again = vi.fn();
	document.body.innerHTML = '<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"><div id="segments-container"></div></ytd-engagement-panel-section-list-renderer><button id="opener" aria-label="Show transcript">x</button>';
	document.getElementById('opener')!.addEventListener('click', again);
	expect(await readYouTubeTranscriptFromDom(document, true, 400, 50)).toEqual([]); expect(again).not.toHaveBeenCalled();
	// Open on the Chapters tab: the Transcript chip is selected after a moment and the lines appear.
	document.body.innerHTML = '<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"><chip-view-model><button><div class="ytChipShapeActive">Chapters</div></button></chip-view-model><chip-view-model><button id="tab"><div>Transcript</div></button></chip-view-model><div id="segments-container"></div></ytd-engagement-panel-section-list-renderer>';
	document.getElementById('tab')!.addEventListener('click', () => { document.getElementById('segments-container')!.innerHTML = rows; });
	expect((await readYouTubeTranscriptFromDom(document, true, 4000, 50)).length).toBe(2);
});

it('opens the panel once on request, never while it is open, and reports a missing opener without failing', async () => {
	const { openTranscriptPanel, transcriptPanelOpen } = await import('./youtube-dom-transcript');
	document.body.innerHTML = '<p>nothing yet</p>'; expect(openTranscriptPanel(document)).toBe(false);
	document.body.innerHTML = '<button id="o" aria-label="Show transcript">x</button>'; const click = vi.fn(); document.getElementById('o')!.addEventListener('click', click);
	expect(openTranscriptPanel(document)).toBe(true); expect(click).toHaveBeenCalledTimes(1);
	document.body.innerHTML = '<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></ytd-engagement-panel-section-list-renderer><button id="o" aria-label="Show transcript">x</button>';
	const again = vi.fn(); document.getElementById('o')!.addEventListener('click', again);
	expect(transcriptPanelOpen(document)).toBe(true); expect(openTranscriptPanel(document)).toBe(false); expect(again).not.toHaveBeenCalled();
});

it('marks only the panel we opened for hiding, and gives it back once the viewer closes it', async () => {
	const { markAutoOpenedPanel, releaseAutoPanel, AUTO_PANEL_ATTRIBUTE } = await import('./youtube-dom-transcript');
	const make = (visibility: string) => `<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="${visibility}"></ytd-engagement-panel-section-list-renderer>`;
	const panel = () => document.querySelector('ytd-engagement-panel-section-list-renderer')!;
	document.body.innerHTML = make('ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
	releaseAutoPanel(document); expect(panel().hasAttribute(AUTO_PANEL_ATTRIBUTE)).toBe(false); // never marked: left alone
	markAutoOpenedPanel(document, true); expect(panel().getAttribute(AUTO_PANEL_ATTRIBUTE)).toBe('1');
	releaseAutoPanel(document); expect(panel().hasAttribute(AUTO_PANEL_ATTRIBUTE)).toBe(true); // still open: stays hidden
	panel().setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); releaseAutoPanel(document); expect(panel().hasAttribute(AUTO_PANEL_ATTRIBUTE)).toBe(false);
	markAutoOpenedPanel(document, true); markAutoOpenedPanel(document, false); expect(panel().hasAttribute(AUTO_PANEL_ATTRIBUTE)).toBe(false);
	document.body.innerHTML = ''; expect(() => markAutoOpenedPanel(document, true)).not.toThrow();
});

it('opens the transcript from the description in any interface language: expands the description first, matches the section by structure, and closes it again', async () => {
	const { openTranscriptPanel, resetOpenAttempts } = await import('./youtube-dom-transcript');
	vi.useFakeTimers(); resetOpenAttempts();
	// Chinese interface: the button is labelled "内容转文字" and only exists once the description is expanded.
	document.body.innerHTML = '<ytd-watch-metadata><ytd-text-inline-expander id="box"><button id="expand">more</button><button id="collapse">less</button></ytd-text-inline-expander></ytd-watch-metadata><ytd-video-description-transcript-section-renderer id="sec"></ytd-video-description-transcript-section-renderer>';
	const box = document.getElementById('box')!, collapsed = vi.fn(), opened = vi.fn();
	document.getElementById('expand')!.addEventListener('click', () => { box.setAttribute('is-expanded', ''); document.getElementById('sec')!.innerHTML = '<button aria-label="内容转文字" id="show">内容转文字</button>'; document.getElementById('show')!.addEventListener('click', opened); });
	document.getElementById('collapse')!.addEventListener('click', () => { collapsed(); box.removeAttribute('is-expanded'); });
	expect(openTranscriptPanel(document)).toBe(false); expect(box.hasAttribute('is-expanded')).toBe(true); // first the description opens
	expect(openTranscriptPanel(document)).toBe(true); expect(opened).toHaveBeenCalledTimes(1);
	vi.advanceTimersByTime(600); expect(collapsed).toHaveBeenCalledTimes(1); expect(box.hasAttribute('is-expanded')).toBe(false); // and goes back to how the viewer had it
	vi.useRealTimers();
});

it('never clicks a transcript button inside a panel that is not open, and retries expanding every few seconds, a handful of times', async () => {
	const { openTranscriptPanel, resetOpenAttempts } = await import('./youtube-dom-transcript');
	vi.useFakeTimers(); vi.setSystemTime(2000000); resetOpenAttempts();
	document.body.innerHTML = '<ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"><ytd-engagement-panel-title-header-renderer><button aria-label="转写文稿" id="ghost">转写文稿</button></ytd-engagement-panel-title-header-renderer></ytd-engagement-panel-section-list-renderer><ytd-text-inline-expander id="box"><button id="expand">more</button></ytd-text-inline-expander>';
	const ghost = vi.fn(), expand = vi.fn(); document.getElementById('ghost')!.addEventListener('click', ghost); document.getElementById('expand')!.addEventListener('click', expand);
	for (let i = 0; i < 5; i++) expect(openTranscriptPanel(document)).toBe(false);
	expect(expand).toHaveBeenCalledTimes(1); // five quick tries are one real attempt
	for (let i = 0; i < 20; i++) { vi.setSystemTime(Date.now() + 2600); openTranscriptPanel(document); }
	expect(expand).toHaveBeenCalledTimes(8); // a page that is slow to build its description gets several chances, not unlimited ones
	expect(ghost).not.toHaveBeenCalled();
	vi.useRealTimers();
});

const modernLayout = `<ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
<chip-bar-view-model><chip-view-model><button><div>时间轴</div></button></chip-view-model><chip-view-model><button><div>章节</div></button></chip-view-model><chip-view-model><button id="tab"><div class="ytChipShapeActive">转写文稿</div></button></chip-view-model></chip-bar-view-model>
<input aria-label="搜索转写内容">
<div id="rows"><transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">7:56</div><span class="yt-core-attributed-string">good people should not work this hard</span></transcript-segment-view-model>
<timeline-chapter-view-model><h3>第 7 章：SpaceX early failures</h3></timeline-chapter-view-model>
<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">8:04</div><span class="yt-core-attributed-string">hurts my brain and my heart</span></transcript-segment-view-model></div></ytd-engagement-panel-section-list-renderer>`;

it('reads the lines of the newer layout, whatever the panel is called, and attaches chapter titles to the line they open', async () => {
	const { readOpenPanel, transcriptPanel, readYouTubeTranscriptFromDom } = await import('./youtube-dom-transcript');
	document.body.innerHTML = modernLayout;
	expect(readOpenPanel(document)).toEqual([{ time: '7:56', text: 'good people should not work this hard' }, { time: '8:04', text: 'hurts my brain and my heart', chapter: '第 7 章：SpaceX early failures' }]);
	expect(transcriptPanel(document)!.getAttribute('target-id')).toBe('PAmodern_transcript_view');
	expect((await readYouTubeTranscriptFromDom(document, false)).length).toBe(2);
	document.body.innerHTML = '<ytd-engagement-panel-section-list-renderer target-id="some-future-id"><div id="x"></div></ytd-engagement-panel-section-list-renderer>' + modernLayout.replace('PAmodern_transcript_view', 'another-new-id');
	expect(readOpenPanel(document)).toHaveLength(2); expect(transcriptPanel(document)!.getAttribute('target-id')).toBe('another-new-id'); // found by what it holds
});

it('still finds rows if YouTube renames the row element, by their timestamp cell', async () => {
	const { readOpenPanel } = await import('./youtube-dom-transcript');
	document.body.innerHTML = '<div><div class="ytwTranscriptSegmentViewModelRow"><div class="ytwTranscriptSegmentViewModelTimestamp">1:05</div><span>Renamed row</span></div><div class="ytwTranscriptSegmentViewModelRow"><div class="ytwTranscriptSegmentViewModelTimestamp">1:09</div><span>Another</span></div></div>';
	expect(readOpenPanel(document)).toEqual([{ time: '1:05', text: 'Renamed row' }, { time: '1:09', text: 'Another' }]);
});

it('hides and releases the panel that holds the lines, and picks the Transcript tab among three', async () => {
	const { markAutoOpenedPanel, releaseAutoPanel, AUTO_PANEL_ATTRIBUTE, readYouTubeTranscriptFromDom } = await import('./youtube-dom-transcript');
	document.body.innerHTML = modernLayout; const panel = document.querySelector('ytd-engagement-panel-section-list-renderer')!;
	markAutoOpenedPanel(document, true); expect(panel.hasAttribute(AUTO_PANEL_ATTRIBUTE)).toBe(true);
	panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); releaseAutoPanel(document); expect(panel.hasAttribute(AUTO_PANEL_ATTRIBUTE)).toBe(false);
	document.body.innerHTML = modernLayout.replace(/<transcript-segment-view-model>[\s\S]*?<\/transcript-segment-view-model>/g, '').replace('class="ytChipShapeActive"', '');
	document.getElementById('tab')!.addEventListener('click', () => { document.getElementById('rows')!.insertAdjacentHTML('beforeend', '<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">0:03</div><span>after tab</span></transcript-segment-view-model>'); });
	expect((await readYouTubeTranscriptFromDom(document, true, 5000, 50)).map(line => line.text)).toEqual(['after tab']);
});

it('keeps chapters through grouping, the study-page markup and a copy', async () => {
	const { groupSegments, transcriptHtml } = await import('./youtube-dom-transcript'); const { formatSegments } = await import('./youtube-panel-actions');
	const lines = [{ time: '0:00', text: 'one,' }, { time: '0:03', text: 'two.' }, { time: '0:06', text: 'three', chapter: 'Part two' }, { time: '0:09', text: 'four' }];
	expect(groupSegments(lines)).toEqual([{ time: '0:00', text: 'one, two.' }, { time: '0:06', text: 'three four', chapter: 'Part two' }]); // a chapter is never merged into the line before it
	const html = transcriptHtml(lines); expect(html).toContain('<h3>Part two</h3>\n<p class="transcript-segment">'); expect(html.indexOf('<h3>')).toBeGreaterThan(html.indexOf('one, two.'));
	expect(formatSegments(lines)).toBe('[0:00] one,\n[0:03] two.\n\n## Part two\n[0:06] three\n[0:09] four');
	expect(transcriptHtml([{ time: '0:00', text: 'x', chapter: '<b>&' }])).toContain('<h3>&lt;b&gt;&amp;</h3>');
});
