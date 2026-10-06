import { readPanelSegments, SEGMENT, type PanelSegment } from './youtube-panel-actions';

// Last resort when the caption files cannot be fetched (YouTube increasingly refuses them without a
// player token): read the lines YouTube itself rendered in its transcript panel. That request is made by
// the page with the viewer's own session, so it keeps working. Runs inside the YouTube tab.
// The transcript lives in different panels depending on the YouTube layout ("searchable-transcript", or the newer
// "PAmodern_transcript_view" with its Timeline / Chapters / Transcript tabs). Find it by what it holds, not by id.
const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]';
const EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
export function transcriptPanel(doc: Document): Element | null {
	const holder = doc.querySelector(SEGMENT)?.closest('ytd-engagement-panel-section-list-renderer');
	if (holder) return holder;
	const known = Array.from(doc.querySelectorAll(PANEL));
	return known.find(panel => panel.getAttribute('visibility') === EXPANDED) || known[0] || null;
}
// Where the "show transcript" control lives: a button in the video description, which YouTube only builds once the
// description is expanded, and whose label depends on the interface language ("内容转文字" in Chinese). So the section
// is matched by structure, not by words; labelled buttons elsewhere are only a fallback.
const SECTION = 'ytd-video-description-transcript-section-renderer';
const OPENER_WORDS = /transcript|转写|轉寫|转文字|轉文字|文字起こし|스크립트|transcripci|transkript|транскрип/i;
const CLOSE_WORDS = /关闭|關閉|close|hide|隠す|닫기|收起/i;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Every transcript row on the page, wherever YouTube put them.
export function readOpenPanel(doc: Document): PanelSegment[] {
	return readPanelSegments(doc);
}

const isExpanded = (doc: Document) => Array.from(doc.querySelectorAll(PANEL)).some(panel => panel.getAttribute('visibility') === EXPANDED) || Boolean(doc.querySelector(SEGMENT));
const inClosedPanel = (button: Element) => Boolean(button.closest('ytd-engagement-panel-section-list-renderer:not([visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"])'));
const findOpener = (doc: Document): HTMLButtonElement | undefined => {
	const usable = (button: HTMLButtonElement) => !CLOSE_WORDS.test(button.getAttribute('aria-label') || '') && !inClosedPanel(button) && !button.closest('.qiaomu-yt-bar');
	const inSection = Array.from(doc.querySelectorAll<HTMLButtonElement>(`${SECTION} button`)).find(usable);
	if (inSection) return inSection;
	return Array.from(doc.querySelectorAll<HTMLButtonElement>('button')).find(button => OPENER_WORDS.test(button.getAttribute('aria-label') || '') && usable(button));
};

// The description has to be open for its transcript button to exist. Open it for a moment, and close it again once
// the transcript has been requested so the page layout returns to what the viewer had.
const expander = (doc: Document) => doc.querySelector<HTMLElement>('ytd-watch-metadata ytd-text-inline-expander, #description ytd-text-inline-expander, ytd-text-inline-expander');
let expandAttempts = 0, lastExpandAt = 0, expandedByUs = false;
export const resetOpenAttempts = () => { expandAttempts = 0; lastExpandAt = 0; expandedByUs = false; };
function expandDescription(doc: Document): void {
	// After a page refresh YouTube builds the description late, so one early try is not enough: try again every few
	// seconds (a handful of times) instead of giving up after two quick attempts.
	const now = Date.now();
	const box = expander(doc); if (!box || box.hasAttribute('is-expanded') || expandAttempts >= 8 || now - lastExpandAt < 2500) return;
	const more = box.querySelector<HTMLElement>('#expand'); if (!more) return;
	expandAttempts++; lastExpandAt = now; expandedByUs = true; more.click();
}
function restoreDescription(doc: Document): void {
	if (!expandedByUs) return; expandedByUs = false;
	setTimeout(() => { const box = expander(doc); if (box?.hasAttribute('is-expanded')) box.querySelector<HTMLElement>('#collapse')?.click(); }, 500);
}

// Expand the transcript panel once, the way a click on "Show transcript" does. False when it is already open or
// the page has no opener yet (it is built lazily, so the caller simply tries again later).
export function openTranscriptPanel(doc: Document): boolean {
	if (isExpanded(doc)) return false;
	const opener = findOpener(doc);
	if (!opener) { expandDescription(doc); return false; }
	opener.click(); restoreDescription(doc); return true;
}

export const transcriptPanelOpen = (doc: Document): boolean => isExpanded(doc);

// YouTube's own panel is redundant next to our bar, but its rendered lines are still our fallback source, so it is
// hidden rather than closed. Only a panel that we opened is marked, never one the viewer opened themselves.
export const AUTO_PANEL_ATTRIBUTE = 'data-qiaomu-auto';
export function markAutoOpenedPanel(doc: Document, hide: boolean): void {
	const panel = transcriptPanel(doc); if (!panel) return;
	if (hide) panel.setAttribute(AUTO_PANEL_ATTRIBUTE, '1'); else panel.removeAttribute(AUTO_PANEL_ATTRIBUTE);
}
// The viewer closed it (or reopened it themselves): stop hiding it.
export function releaseAutoPanel(doc: Document): void {
	const panel = doc.querySelector('[' + AUTO_PANEL_ATTRIBUTE + ']');
	if (panel && panel.getAttribute('visibility') !== EXPANDED) panel.removeAttribute(AUTO_PANEL_ATTRIBUTE);
}

// The panel can be open on the "Chapters" tab; then the transcript chip next to it has to be selected.
const TRANSCRIPT_WORDS = /transcript|转写|轉寫|文字起こし|스크립트|transcripción|transcription|транскрип/i;
function selectTranscriptTab(doc: Document): boolean {
	const scope = transcriptPanel(doc);
	const chips = Array.from(scope?.querySelectorAll<HTMLElement>('chip-view-model button') || []);
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
		if (!clicked && !isExpanded(doc) && openTranscriptPanel(doc)) clicked = true;
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
	for (const { time, text, chapter, start: preciseStart, end } of segments) {
		const at = preciseStart ?? seconds(time), last = groups[groups.length - 1];
		if (last && !chapter && start >= 0 && at - start < maxSeconds && !(/[.!?。！？]["”)]?$/.test(last.text) && at - start >= sentenceSeconds)) { last.text = joinText(last.text, text); if (end !== undefined) last.end = end; }
		else { groups.push({ time, text, ...(chapter ? { chapter } : {}), ...(preciseStart !== undefined ? { start: preciseStart } : {}), ...(end !== undefined ? { end } : {}) }); start = at; }
	}
	return groups;
}
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const joinText = (a: string, b: string) => CJK.test(a.slice(-1)) && CJK.test(b[0] || '') ? a + b : `${a} ${b}`;

// The same markup Defuddle produces, so the study page treats both sources identically.
export function transcriptHtml(segments: PanelSegment[], languageOrGroup?: string | boolean, platform = 'youtube'): string {
	const language = typeof languageOrGroup === 'string' ? languageOrGroup : undefined;
	const lines = (languageOrGroup === false ? segments : groupSegments(segments)).map(({ time, text, chapter, start, end }) => `${chapter ? `<h3>${escapeHtml(chapter)}</h3>\n` : ''}<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="${start ?? seconds(time)}"${end !== undefined ? ` data-end="${end}"` : ''}>${escapeHtml(time)}</span></strong> · ${escapeHtml(text)}</p>`);
	return `<div class="${platform === 'bilibili' ? 'bilibili' : 'youtube'} transcript"${language ? ` data-source-language="${escapeHtml(language)}"` : ''}>\n<h2>Transcript</h2>\n${lines.join('\n')}\n</div>`;
}
