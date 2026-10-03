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
