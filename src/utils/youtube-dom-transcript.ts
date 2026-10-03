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

export async function readYouTubeTranscriptFromDom(doc: Document, open = true, waitMs = 7000): Promise<PanelSegment[]> {
	let segments = readOpenPanel(doc);
	if (segments.length || !open) return segments;
	for (const selector of OPENERS) {
		const button = Array.from(doc.querySelectorAll<HTMLButtonElement>(selector)).find(candidate => !/关闭|close|hide|隠す|收起/i.test(candidate.getAttribute('aria-label') || ''));
		if (!button) continue;
		button.click();
		for (let waited = 0; waited < waitMs; waited += 250) { await wait(250); segments = readOpenPanel(doc); if (segments.length) return segments; }
	}
	return segments;
}

const seconds = (stamp: string) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The same markup Defuddle produces, so the study page treats both sources identically.
export function transcriptHtml(segments: PanelSegment[]): string {
	const lines = segments.map(({ time, text }) => `<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="${seconds(time)}">${escapeHtml(time)}</span></strong> · ${escapeHtml(text)}</p>`);
	return `<div class="youtube transcript">\n<h2>Transcript</h2>\n${lines.join('\n')}\n</div>`;
}
