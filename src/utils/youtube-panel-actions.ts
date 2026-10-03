// Actions injected next to the chips ("Chapters", "Transcript") of YouTube's own transcript panel:
// copy / download the transcript with timestamps, and jump into the immersive study page.
// Everything here reads the page DOM only; the study page itself is opened by the background worker.

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

export interface PanelStrings { copy: string; download: string; study: string; copied: string; empty: string }

type Icon = [string, Record<string, string>][];
// lucide: copy, download, book-open (same stroke style as the reader bar).
const ICONS: Record<'copy' | 'download' | 'study', Icon> = {
	copy: [['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }], ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]],
	download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: '12', x2: '12', y1: '15', y2: '3' }]],
	study: [['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }], ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }]],
};

function icon(doc: Document, name: keyof typeof ICONS): SVGElement {
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	for (const [key, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
	for (const [tag, attrs] of ICONS[name]) {
		const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
		for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
		svg.append(el);
	}
	return svg;
}

export interface PanelHooks { strings: PanelStrings; openStudy: () => void; title: () => string }

export function buildPanelActions(doc: Document, panel: ParentNode, hooks: PanelHooks): HTMLElement {
	const group = doc.createElement('div'); group.className = 'qiaomu-yt-actions'; group.setAttribute('role', 'group');
	const chip = (name: keyof typeof ICONS, label: string, onClick: (button: HTMLButtonElement) => void) => {
		const button = doc.createElement('button'); button.type = 'button'; button.className = `qiaomu-yt-chip qiaomu-yt-${name}`;
		button.title = label; button.append(icon(doc, name), doc.createTextNode(label));
		button.addEventListener('click', event => { event.stopPropagation(); onClick(button); });
		return button;
	};
	const flash = (button: HTMLButtonElement, text: string) => {
		const original = button.title; button.title = text; button.setAttribute('aria-label', text); button.classList.add('is-notice');
		setTimeout(() => { button.title = original; button.removeAttribute('aria-label'); button.classList.remove('is-notice'); }, 1600);
	};
	const text = () => formatSegments(readPanelSegments(panel));
	group.append(
		chip('copy', hooks.strings.copy, async button => {
			const value = text(); if (!value) { flash(button, hooks.strings.empty); return; }
			try { await navigator.clipboard.writeText(value); flash(button, hooks.strings.copied); } catch { flash(button, hooks.strings.empty); }
		}),
		chip('download', hooks.strings.download, button => {
			const value = text(); if (!value) { flash(button, hooks.strings.empty); return; }
			const url = URL.createObjectURL(new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' }));
			const link = doc.createElement('a'); link.href = url; link.download = `${safeFileName(hooks.title())}.txt`;
			doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
		}),
		chip('study', hooks.strings.study, () => hooks.openStudy()),
	);
	return group;
}

export const PANEL_STYLE = `
.qiaomu-yt-actions{display:inline-flex;align-items:center;gap:8px;margin-inline-start:8px;flex:0 0 auto}
.qiaomu-yt-actions[hidden]{display:none}
.qiaomu-yt-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:8px;background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));color:var(--yt-spec-text-primary,#0f0f0f);font:500 14px/20px Roboto,Arial,sans-serif;white-space:nowrap;cursor:pointer}
.qiaomu-yt-chip:hover{background:var(--yt-spec-button-chip-background-hover,rgba(0,0,0,.1))}
.qiaomu-yt-chip:focus-visible{outline:2px solid var(--yt-spec-call-to-action,#065fd4);outline-offset:1px}
.qiaomu-yt-chip svg{flex:0 0 auto}
.qiaomu-yt-chip.is-notice{outline:1px solid var(--yt-spec-text-secondary,#606060)}
`;

// Find the chip bar of the transcript panel and keep our group at its end.
export function syncPanelActions(doc: Document, make: (panel: HTMLElement) => HTMLElement): void {
	const panel = doc.querySelector<HTMLElement>('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
	const scroller = panel?.querySelector<HTMLElement>('chip-bar-view-model [class*="ChipBarScrollContainer"]');
	if (!panel || !scroller) return;
	let group = scroller.querySelector<HTMLElement>(':scope > .qiaomu-yt-actions');
	if (!group) { group = make(panel); scroller.append(group); }
	// Only useful while the transcript tab is showing lines.
	group.hidden = readPanelSegments(panel).length === 0;
}
