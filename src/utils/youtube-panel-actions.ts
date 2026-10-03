// Shared helpers for the YouTube transcript: read the lines YouTube rendered, format them with timestamps, name files.
// DOM only; the study page itself is opened by the background worker.

const TIME = /^(?:\d+:)?\d{1,2}:\d{2}$/;
const SEGMENT = 'transcript-segment-view-model, ytd-transcript-segment-renderer';

export interface PanelSegment { time: string; text: string }

// Works for both the current "modern" transcript view and the classic renderer: take the first
// line that looks like a timestamp, the remaining visible lines are the caption text.
export function readPanelSegments(root: ParentNode): PanelSegment[] {
	const result: PanelSegment[] = [];
	for (const node of Array.from(root.querySelectorAll<HTMLElement>(SEGMENT))) {
		// One line per leaf element: independent of innerText, which differs between browsers and jsdom.
		const leaves = Array.from(node.querySelectorAll<HTMLElement>('*')).filter(el => el.childElementCount === 0 && !el.hidden);
		const lines = (leaves.length ? leaves : [node]).map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
		const at = lines.findIndex(line => TIME.test(line));
		if (at < 0) continue;
		const text = lines.filter((_, index) => index !== at).join(' ').replace(/\s+/g, ' ').trim();
		if (text) result.push({ time: lines[at], text });
	}
	return result;
}

export const formatSegments = (segments: PanelSegment[]): string => segments.map(({ time, text }) => `[${time}] ${text}`).join('\n');

export const safeFileName = (title: string): string =>
	(title.replace(/\s*-\s*YouTube$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)) || 'youtube-transcript';
