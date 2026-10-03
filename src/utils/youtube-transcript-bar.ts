import { formatSegments, safeFileName, type PanelSegment } from './youtube-panel-actions';
import { groupSegments } from './youtube-dom-transcript';

// The transcript bar: one strip at the top of the watch page's right column (like other YouTube helper
// extensions), with five tools (subtitles, copy, download, study, settings) and a chevron that opens a
// dropdown with the transcript itself. It does not depend on YouTube's lazily built transcript panel.
export type BarState = 'loading' | 'ready' | 'none';
export interface BarStrings { heading: string; subtitles: string; copy: string; download: string; study: string; settings: string; expand: string; collapse: string; copied: string; empty: string; reload: string; loading: string; ready: string; none: string; more: string }
export interface BarHooks {
	strings: BarStrings;
	title: () => string;
	getSegments: () => Promise<PanelSegment[]>;
	openStudy: () => boolean | void;
	openSettings: () => void;
	seek: (seconds: number) => void;
	initialOpen?: boolean;
	onToggle?: (open: boolean) => void;
}
export interface TranscriptBar { element: HTMLElement; setState: (state: BarState, segments?: PanelSegment[]) => void; setOpen: (open: boolean) => void }

type Tool = 'subtitles' | 'copy' | 'download' | 'study' | 'settings';
const NS = 'http://www.w3.org/2000/svg';
const SHAPES: Record<Tool | 'chevron', Array<[string, Record<string, string>]>> = {
	subtitles: [['rect', { width: '18', height: '14', x: '3', y: '5', rx: '2', ry: '2' }], ['path', { d: 'M7 15h4M15 15h2M7 11h2M13 11h4' }]],
	copy: [['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }], ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]],
	download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: '12', x2: '12', y1: '15', y2: '3' }]],
	study: [['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }], ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }]],
	settings: [['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
	chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
};
const MAX_ROWS = 400;

function icon(doc: Document, name: keyof typeof SHAPES, size = 20): SVGElement {
	const svg = doc.createElementNS(NS, 'svg');
	for (const [key, value] of Object.entries({ width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
	for (const [tag, attrs] of SHAPES[name]) { const el = doc.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); svg.append(el); }
	return svg;
}

const seconds = (stamp: string) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);

export function buildTranscriptBar(doc: Document, hooks: BarHooks): TranscriptBar {
	const { strings } = hooks;
	const element = doc.createElement('div'); element.className = 'qiaomu-yt-bar'; element.dataset.state = 'loading';
	const head = doc.createElement('div'); head.className = 'qiaomu-yt-bar-head';
	const logo = doc.createElement('span'); logo.className = 'qiaomu-yt-bar-logo'; logo.append(icon(doc, 'study', 18));
	const title = doc.createElement('span'); title.className = 'qiaomu-yt-bar-title'; title.textContent = strings.heading;
	const dot = doc.createElement('span'); dot.className = 'qiaomu-yt-bar-dot'; dot.setAttribute('role', 'img');
	const tools = doc.createElement('span'); tools.className = 'qiaomu-yt-bar-tools'; tools.setAttribute('role', 'toolbar');
	head.append(logo, title, dot, tools);
	const body = doc.createElement('div'); body.className = 'qiaomu-yt-bar-body'; body.hidden = true;
	const status = doc.createElement('p'); status.className = 'qiaomu-yt-bar-status'; status.setAttribute('role', 'status');
	const list = doc.createElement('div'); list.className = 'qiaomu-yt-bar-lines'; list.setAttribute('role', 'list');
	body.append(status, list);
	element.append(head, body);

	const flash = (button: HTMLElement, text: string) => {
		const original = button.title; button.title = text; button.setAttribute('aria-label', text); button.classList.add('is-notice');
		setTimeout(() => { button.title = original; button.setAttribute('aria-label', original); button.classList.remove('is-notice'); }, 1800);
	};
	// YouTube lives in a drag-scrolling layout that can capture the pointer and swallow clicks: keep the press
	// to ourselves and also act on pointer-up; a real click right after is ignored.
	const press = (button: HTMLElement, action: () => void) => {
		let pressed = false, last = 0;
		const fire = () => { const now = Date.now(); if (now - last < 400) return; last = now; action(); };
		for (const type of ['pointerdown', 'mousedown', 'touchstart']) button.addEventListener(type, event => { event.stopPropagation(); if (type === 'pointerdown') pressed = true; });
		button.addEventListener('pointerup', event => { event.stopPropagation(); if (pressed) { pressed = false; fire(); } });
		button.addEventListener('click', event => { event.stopPropagation(); fire(); });
	};
	const tool = (name: Tool | 'toggle', label: string, action: (button: HTMLButtonElement) => void) => {
		const button = doc.createElement('button'); button.type = 'button'; button.className = `qiaomu-yt-tool qiaomu-yt-tool-${name}`;
		button.title = label; button.setAttribute('aria-label', label); button.append(icon(doc, name === 'toggle' ? 'chevron' : name));
		press(button, () => action(button));
		return button;
	};

	let segments: PanelSegment[] = [], state: BarState = 'loading', open = false, rendered = -1;
	const renderLines = () => {
		if (!open || rendered === segments.length) return;
		rendered = segments.length; list.replaceChildren();
		const groups = groupSegments(segments);
		for (const { time, text } of groups.slice(0, MAX_ROWS)) {
			const row = doc.createElement('button'); row.type = 'button'; row.className = 'qiaomu-yt-bar-line'; row.setAttribute('role', 'listitem');
			const stamp = doc.createElement('span'); stamp.className = 'qiaomu-yt-bar-time'; stamp.textContent = time;
			const words = doc.createElement('span'); words.className = 'qiaomu-yt-bar-text'; words.textContent = text;
			row.append(stamp, words); press(row, () => hooks.seek(seconds(time))); list.append(row);
		}
		if (groups.length > MAX_ROWS) { const more = doc.createElement('p'); more.className = 'qiaomu-yt-bar-more'; more.textContent = strings.more; list.append(more); }
	};
	const toggle = tool('toggle', strings.expand, () => setOpen(!open));
	const paint = () => {
		element.dataset.state = state; element.dataset.open = String(open); body.hidden = !open;
		const message = strings[state]; status.textContent = message; dot.title = message; dot.setAttribute('aria-label', message);
		toggle.setAttribute('aria-expanded', String(open)); toggle.title = open ? strings.collapse : strings.expand; toggle.setAttribute('aria-label', toggle.title);
		renderLines();
	};
	function setOpen(next: boolean, persist = true) { if (next === open) { paint(); return; } open = next; if (persist) hooks.onToggle?.(open); rendered = -1; paint(); }

	tools.append(
		tool('subtitles', strings.subtitles, () => { setOpen(true); void hooks.getSegments().then(found => { if (found.length) { segments = found; state = 'ready'; rendered = -1; paint(); } }); }),
		tool('copy', strings.copy, async button => {
			const value = formatSegments(await hooks.getSegments()); if (!value) { flash(button, strings.empty); return; }
			try { await navigator.clipboard.writeText(value); flash(button, strings.copied); } catch { flash(button, strings.empty); }
		}),
		tool('download', strings.download, async button => {
			const value = formatSegments(await hooks.getSegments()); if (!value) { flash(button, strings.empty); return; }
			const url = URL.createObjectURL(new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' }));
			const link = doc.createElement('a'); link.href = url; link.download = `${safeFileName(hooks.title())}.txt`;
			doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
		}),
		tool('study', strings.study, button => { if (hooks.openStudy() === false) flash(button, strings.reload); }),
		tool('settings', strings.settings, () => hooks.openSettings()),
		toggle,
	);
	// Clicking the empty part of the strip also opens and closes it; the tools handle their own presses.
	press(head, () => setOpen(!open));
	if (hooks.initialOpen) setOpen(true, false); else paint();
	return { element, setOpen: next => setOpen(next, false), setState: (next, found) => { state = next; if (found) segments = found; rendered = -1; paint(); } };
}

export const BAR_STYLE = `
ytd-engagement-panel-section-list-renderer[data-qiaomu-auto="1"]{display:none!important}
.qiaomu-yt-bar{box-sizing:border-box;margin-bottom:12px;border:1px solid var(--yt-spec-10-percent-layer,rgba(0,0,0,.12));border-radius:8px;background:var(--yt-spec-base-background,#fff);color:var(--yt-spec-text-primary,#0f0f0f);font:400 14px/20px Roboto,Arial,sans-serif;overflow:hidden}
.qiaomu-yt-bar-head{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 8px 0 12px;cursor:pointer}
.qiaomu-yt-bar-logo{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;border-radius:8px;background:var(--yt-spec-text-primary,#0f0f0f);color:var(--yt-spec-base-background,#fff)}
.qiaomu-yt-bar-title{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.qiaomu-yt-bar-dot{width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--yt-spec-text-disabled,#999)}
.qiaomu-yt-bar[data-state=ready] .qiaomu-yt-bar-dot{background:#2ba640}
.qiaomu-yt-bar[data-state=loading] .qiaomu-yt-bar-dot{background:#f0a400;animation:qiaomu-yt-pulse 1.2s ease-in-out infinite}
@keyframes qiaomu-yt-pulse{50%{opacity:.35}}
.qiaomu-yt-bar-tools{display:inline-flex;align-items:center;gap:0;margin-inline-start:auto;flex:0 0 auto}
.qiaomu-yt-tool{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--yt-spec-text-secondary,#606060);cursor:pointer}
.qiaomu-yt-tool:hover{background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));color:var(--yt-spec-text-primary,#0f0f0f)}
.qiaomu-yt-tool:focus{outline:none}.qiaomu-yt-tool:focus-visible{outline:2px solid var(--yt-spec-call-to-action,#065fd4);outline-offset:-2px}
.qiaomu-yt-tool.is-notice{background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));color:var(--yt-spec-text-primary,#0f0f0f)}
.qiaomu-yt-tool svg{display:block;pointer-events:none}
.qiaomu-yt-tool-toggle svg{transition:transform .15s}
.qiaomu-yt-bar[data-open=true] .qiaomu-yt-tool-toggle svg{transform:rotate(180deg)}
.qiaomu-yt-bar-body{border-top:1px solid var(--yt-spec-10-percent-layer,rgba(0,0,0,.12))}
.qiaomu-yt-bar-body[hidden]{display:none}
.qiaomu-yt-bar-status{margin:0;padding:8px 14px;color:var(--yt-spec-text-secondary,#606060);font-size:12px}
.qiaomu-yt-bar-lines{max-height:340px;overflow-y:auto;padding:0 6px 8px}
.qiaomu-yt-bar-line{display:flex;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.qiaomu-yt-bar-line:hover{background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05))}
.qiaomu-yt-bar-line:focus{outline:none}.qiaomu-yt-bar-line:focus-visible{outline:2px solid var(--yt-spec-call-to-action,#065fd4);outline-offset:-2px}
.qiaomu-yt-bar-time{flex:0 0 auto;min-width:42px;color:var(--yt-spec-call-to-action,#065fd4);font-variant-numeric:tabular-nums}
.qiaomu-yt-bar-text{min-width:0;overflow-wrap:anywhere}
.qiaomu-yt-bar-more{margin:6px 8px 0;color:var(--yt-spec-text-secondary,#606060);font-size:12px}
`;

// Keep the bar as the first thing in the right column of the watch page.
export function syncTranscriptBar(doc: Document, make: () => HTMLElement): HTMLElement | undefined {
	const column = doc.querySelector<HTMLElement>('ytd-watch-flexy #secondary-inner, #secondary-inner');
	if (!column) return undefined;
	let bar = column.querySelector<HTMLElement>(':scope > .qiaomu-yt-bar');
	if (!bar) { bar = make(); column.prepend(bar); } else if (column.firstElementChild !== bar) column.prepend(bar);
	return bar;
}
