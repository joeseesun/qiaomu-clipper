import { readPanelSegments, type PanelSegment } from './youtube-panel-actions';

// Last resort when the caption files cannot be fetched (YouTube increasingly refuses them without a
// player token): read the lines YouTube itself rendered in its transcript panel. That request is made by
// the page with the viewer's own session, so it keeps working. Runs inside the YouTube tab.
const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
const OPENERS = ['ytd-video-description-transcript-section-renderer button', 'button[aria-label*="transcript" i]', 'button[aria-label*="转写"]', 'button[aria-label*="轉寫"]', 'button[aria-label*="文字起こし"]'];

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function readOpenPanel(doc: Document): PanelSegment[] {
	const panel = doc.querySelector(PANEL);
	return panel ? readPanelSegments(panel) : [];
}

const isExpanded = (doc: Document) => doc.querySelector(PANEL)?.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
const findOpener = (doc: Document): HTMLButtonElement | undefined => {
	for (const selector of OPENERS) {
		const button = Array.from(doc.querySelectorAll<HTMLButtonElement>(selector)).find(candidate => !/关闭|close|hide|隠す|收起/i.test(candidate.getAttribute('aria-label') || ''));
		if (button) return button;
	}
	return undefined;
};

// Expand the transcript panel once, the way a click on "Show transcript" does. False when it is already open or
// the page has no opener yet (it is built lazily, so the caller simply tries again later).
export function openTranscriptPanel(doc: Document): boolean {
	if (isExpanded(doc)) return false;
	const opener = findOpener(doc); if (!opener) return false;
	opener.click(); return true;
}

export const transcriptPanelOpen = (doc: Document): boolean => isExpanded(doc);

// The panel can be open on the "Chapters" tab; then the transcript chip next to it has to be selected.
const TRANSCRIPT_WORDS = /transcript|转写|轉寫|文字起こし|스크립트|transcripción|transcription|транскрип/i;
function selectTranscriptTab(doc: Document): boolean {
	const chips = Array.from(doc.querySelectorAll<HTMLElement>(`${PANEL} chip-view-model button`));
	const chip = chips.find(button => TRANSCRIPT_WORDS.test((button.textContent || '') + (button.getAttribute('aria-label') || ''))) || (chips.length > 1 ? chips[chips.length - 1] : undefined);
	if (!chip || chip.querySelector('[class*="ChipShapeActive"]') || chip.parentElement?.querySelector('[class*="ChipShapeActive"]')) return false;
	chip.click(); return true;
}

// Keeps going until the lines appear or the time is up. The page may still be building its description when
// study mode starts, so a missing opener is waited for rather than treated as "no transcript". An opener is
// clicked once; if the panel is already expanded we only wait, because a second click would close it again.
export async function readYouTubeTranscriptFromDom(doc: Document, open = true, waitMs = 12000, step = 250): Promise<PanelSegment[]> {
	let segments = readOpenPanel(doc);
	if (segments.length || !open) return segments;
	let clicked = false, tabPicked = false;
	for (let waited = 0; waited <= waitMs; waited += step) {
		if (!clicked && !isExpanded(doc)) {
			const opener = findOpener(doc);
			if (opener) { opener.click(); clicked = true; }
		}
		await wait(step); segments = readOpenPanel(doc);
		if (segments.length) return segments;
		if (isExpanded(doc) && waited >= 1500 && !tabPicked) tabPicked = selectTranscriptTab(doc);
	}
	return segments;
}

const seconds = (stamp: string) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Caption lines are only a couple of seconds long. Merge them into paragraphs the way Defuddle does, so the study
// page reads as text rather than as hundreds of one-line rows.
export function groupSegments(segments: PanelSegment[], maxSeconds = 30, sentenceSeconds = 12): PanelSegment[] {
	const groups: PanelSegment[] = []; let start = -1;
	for (const { time, text } of segments) {
		const at = seconds(time), last = groups[groups.length - 1];
		if (last && start >= 0 && at - start < maxSeconds && !(/[.!?。！？]["”)]?$/.test(last.text) && at - start >= sentenceSeconds)) last.text = joinText(last.text, text);
		else { groups.push({ time, text }); start = at; }
	}
	return groups;
}
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const joinText = (a: string, b: string) => CJK.test(a.slice(-1)) && CJK.test(b[0] || '') ? a + b : `${a} ${b}`;

// The same markup Defuddle produces, so the study page treats both sources identically.
export function transcriptHtml(segments: PanelSegment[]): string {
	const lines = groupSegments(segments).map(({ time, text }) => `<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="${seconds(time)}">${escapeHtml(time)}</span></strong> · ${escapeHtml(text)}</p>`);
	return `<div class="youtube transcript">\n<h2>Transcript</h2>\n${lines.join('\n')}\n</div>`;
}
