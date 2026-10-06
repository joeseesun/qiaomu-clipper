import { formatClock } from './youtube-innertube-transcript';

// Shared helpers for the YouTube transcript: read the lines YouTube rendered, format them with timestamps, name files.
// DOM only; the study page itself is opened by the background worker.

const TIME = /^(?:\d+:)?\d{1,2}:\d{2}$/;
export const SEGMENT = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
// If YouTube renames the row element, its timestamp cell is still recognisable by class.
const STAMP = '[class*="TranscriptSegmentViewModelTimestamp"]:not([class*="A11y"]), .segment-timestamp';
const CHAPTER = 'timeline-chapter-view-model, ytd-transcript-section-header-renderer';
// Rows and chapter headings in page order.
const rowsIn = (root: ParentNode): HTMLElement[] => {
	const rows = Array.from(root.querySelectorAll<HTMLElement>(`${SEGMENT}, ${CHAPTER}`)); if (rows.some(row => row.matches(SEGMENT))) return rows;
	const found = new Set<HTMLElement>();
	for (const stamp of Array.from(root.querySelectorAll<HTMLElement>(STAMP))) { const row = stamp.closest<HTMLElement>('[class*="TranscriptSegment"]:not([class*="Timestamp"])') || stamp.parentElement?.parentElement; if (row) found.add(row); }
	return Array.from(found);
};

// `chapter` is the title of a chapter that begins at this line (YouTube shows it as a heading above the row).
export interface PanelSegment { time: string; text: string; chapter?: string; start?: number; end?: number }

// Works for both the current "modern" transcript view and the classic renderer: take the first
// line that looks like a timestamp, the remaining visible lines are the caption text.
// YouTube puts a spoken version of every timestamp into each row for screen readers ("1分钟43秒钟"), several times
// inside one line. It is invisible on the page but present in the text, so it must not be read as caption text.
const SCREEN_READER_ONLY = /a11y|sr-only|visually-?hidden|screen-?reader/i;
function hiddenFromEyes(el: Element, row: Element): boolean {
	const win = el.ownerDocument.defaultView;
	for (let node: Element | null = el; node && node !== row.parentElement; node = node.parentElement) {
		if (SCREEN_READER_ONLY.test(node.getAttribute('class') || '')) return true;
		const style = win?.getComputedStyle(node);
		if (!style) continue;
		const clipped = /rect\(0(px)?,? ?0(px)?,? ?0(px)?,? ?0(px)?\)/.test(style.clip) || /inset\(50%\)/.test(style.clipPath);
		const dot = style.position === 'absolute' && parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1;
		if (clipped || dot || style.display === 'none') return true;
		if (node === row) break;
	}
	return false;
}

// The spoken timestamps hold finer timing than the row itself: one row covers about half a minute of speech, and each
// hidden label marks where the next stretch of words begins. The labels are in the viewer's language, so read the
// numbers together with the unit words ("1分钟43秒钟", "1 minute, 43 seconds", "1分43秒").
const UNIT_HOUR = /小时|小時|時間|시간|hours?|hrs?|heures?|horas?|stunden?|часов?|часа?/i;
const UNIT_MINUTE = /分钟|分鐘|分間|分|분|minutes?|mins?|minutos?|minuten?|минут/i;
const UNIT_SECOND = /秒|초|seconds?|secs?|secondes?|segundos?|sekunden?|секунд/i;
export function spokenToSeconds(label: string): number | null {
	let total = 0, found = false;
	for (const match of label.matchAll(/(\d+)\s*([^\d\s,，、.]*)/g)) {
		const amount = Number(match[1]), unit = match[2];
		if (UNIT_HOUR.test(unit)) total += amount * 3600; else if (UNIT_MINUTE.test(unit)) total += amount * 60; else if (UNIT_SECOND.test(unit)) total += amount; else return null;
		found = true;
	}
	return found ? total : null;
}

export function readPanelSegments(root: ParentNode): PanelSegment[] {
	const result: PanelSegment[] = []; let chapter: string | undefined;
	for (const node of rowsIn(root)) {
		// One entry per leaf element: independent of innerText, which differs between browsers and jsdom.
		const leaves = Array.from(node.querySelectorAll<HTMLElement>('*')).filter(el => el.childElementCount === 0 && !el.hidden);
		const entries = (leaves.length ? leaves : [node]).map(el => ({ text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), quiet: hiddenFromEyes(el, node) })).filter(entry => entry.text);
		if (node.matches(CHAPTER)) { chapter = entries.find(entry => !entry.quiet)?.text || chapter; continue; }
		const stamp = entries.find(entry => !entry.quiet && TIME.test(entry.text)); if (!stamp) continue;
		// Words are collected between spoken-time markers; every marker opens a new, finer line.
		const chunks: Array<{ time: string; words: string[] }> = [{ time: stamp.text, words: [] }];
		for (const entry of entries) {
			if (entry === stamp) continue;
			if (entry.quiet) {
				const seconds = spokenToSeconds(entry.text); if (seconds === null) continue;
				const time = formatClock(seconds * 1000), last = chunks[chunks.length - 1];
				if (last.words.length) chunks.push({ time, words: [] }); else last.time = time;
				continue;
			}
			chunks[chunks.length - 1].words.push(entry.text);
		}
		for (const chunk of chunks) {
			const text = chunk.words.join(' ').replace(/\s+/g, ' ').trim(); if (!text) continue;
			result.push({ time: chunk.time, text, ...(chapter ? { chapter } : {}) }); chapter = undefined;
		}
	}
	return result;
}

export const formatSegments = (segments: PanelSegment[]): string => segments.map(({ time, text, chapter }) => `${chapter ? `\n## ${chapter}\n` : ''}[${time}] ${text}`).join('\n').trim();

export const safeFileName = (title: string): string =>
	(title.replace(/\s*-\s*YouTube$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)) || 'youtube-transcript';
