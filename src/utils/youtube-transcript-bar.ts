import { formatSegments, safeFileName, type PanelSegment } from './youtube-panel-actions';
import { groupSegments } from './youtube-dom-transcript';

// The transcript bar: one strip at the top of the watch page's right column (like other YouTube helper
// extensions), with five tools (subtitles, copy, download, study, settings) and a chevron that opens a
// dropdown with the transcript itself. It does not depend on YouTube's lazily built transcript panel.
export type BarState = 'loading' | 'ready' | 'none';
export interface BarStrings { heading: string; subtitles: string; copy: string; download: string; study: string; settings: string; expand: string; collapse: string; copied: string; empty: string; reload: string; loading: string; ready: string; none: string; more: string; search: string; clear: string; noMatch: string; follow: string; followOff: string; here: string; retry: string }
export interface BarHooks {
	strings: BarStrings;
	title: () => string;
	getSegments: () => Promise<PanelSegment[]>;
	openStudy: () => boolean | void;
	openSettings: () => void;
	retry?: () => void;
	seek: (seconds: number) => void;
	// Current playback time of the page's video, if there is one.
	getTime?: () => number | undefined;
	initialOpen?: boolean;
	onToggle?: (open: boolean) => void;
	initialFollow?: boolean;
	onFollow?: (follow: boolean) => void;
	// Which site the bar sits in: it takes that site's own colours, corners and type.
	theme?: 'youtube' | 'bilibili';
}
export interface TranscriptBar { element: HTMLElement; setState: (state: BarState, segments?: PanelSegment[]) => void; setOpen: (open: boolean) => void; setTime: (seconds: number, afterSeek?: boolean) => void }

type Tool = 'copy' | 'download' | 'study' | 'settings';
type Extra = 'chevron' | 'search' | 'follow' | 'clear' | 'check';
const NS = 'http://www.w3.org/2000/svg';
const SHAPES: Record<Tool | Extra, Array<[string, Record<string, string>]>> = {
	search: [['circle', { cx: '11', cy: '11', r: '8' }], ['path', { d: 'm21 21-4.3-4.3' }]],
	follow: [['line', { x1: '2', x2: '5', y1: '12', y2: '12' }], ['line', { x1: '19', x2: '22', y1: '12', y2: '12' }], ['line', { x1: '12', x2: '12', y1: '2', y2: '5' }], ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }], ['circle', { cx: '12', cy: '12', r: '7' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
	check: [['path', { d: 'M20 6 9 17l-5-5' }]],
	clear: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
	copy: [['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }], ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]],
	download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: '12', x2: '12', y1: '15', y2: '3' }]],
	study: [['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }], ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }]],
	settings: [['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
	chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
};
const MAX_ROWS = 1500;
const FOLLOW_COOLDOWN = 10000; // the list is the viewer's to scroll freely; after this long without touching it, it returns to the current line

// Index of the last line that has started at time t (-1 before the first one).
export function activeIndexAt(starts: number[], t: number): number {
	let low = 0, high = starts.length - 1, found = -1;
	while (low <= high) { const mid = (low + high) >> 1; if (starts[mid] <= t) { found = mid; low = mid + 1; } else high = mid - 1; }
	return found;
}

function icon(doc: Document, name: keyof typeof SHAPES, size = 20): SVGElement {
	const svg = doc.createElementNS(NS, 'svg');
	for (const [key, value] of Object.entries({ width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
	for (const [tag, attrs] of SHAPES[name]) { const el = doc.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); svg.append(el); }
	return svg;
}

const seconds = (stamp: string) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);

export function buildTranscriptBar(doc: Document, hooks: BarHooks): TranscriptBar {
	const { strings } = hooks;
	const element = doc.createElement('div'); element.className = 'qiaomu-yt-bar'; element.dataset.state = 'loading'; element.dataset.theme = hooks.theme || 'youtube';
	const head = doc.createElement('div'); head.className = 'qiaomu-yt-bar-head';
	const logo = doc.createElement('span'); logo.className = 'qiaomu-yt-bar-logo'; logo.append(icon(doc, 'study', 16));
	const title = doc.createElement('span'); title.className = 'qiaomu-yt-bar-title'; title.textContent = strings.heading;
	const dot = doc.createElement('span'); dot.className = 'qiaomu-yt-bar-dot'; dot.setAttribute('role', 'img');
	const tools = doc.createElement('span'); tools.className = 'qiaomu-yt-bar-tools'; tools.setAttribute('role', 'toolbar');
	head.append(logo, title, dot, tools);
	const body = doc.createElement('div'); body.className = 'qiaomu-yt-bar-body'; body.hidden = true;
	const status = doc.createElement('p'); status.className = 'qiaomu-yt-bar-status'; status.setAttribute('role', 'status');
	// Search and follow controls above the lines.
	const finder = doc.createElement('div'); finder.className = 'qiaomu-yt-bar-finder';
	const searchBox = doc.createElement('label'); searchBox.className = 'qiaomu-yt-bar-search'; searchBox.append(icon(doc, 'search', 16));
	const search = doc.createElement('input'); search.type = 'search'; search.className = 'qiaomu-yt-bar-input'; search.placeholder = strings.search; search.setAttribute('aria-label', strings.search); search.autocomplete = 'off'; search.spellcheck = false;
	const clear = doc.createElement('button'); clear.type = 'button'; clear.className = 'qiaomu-yt-bar-clear'; clear.title = strings.clear; clear.setAttribute('aria-label', strings.clear); clear.hidden = true; clear.append(icon(doc, 'clear', 14));
	const count = doc.createElement('span'); count.className = 'qiaomu-yt-bar-count'; count.setAttribute('aria-live', 'polite');
	searchBox.append(search, count, clear);
	const followButton = doc.createElement('button'); followButton.type = 'button'; followButton.className = 'qiaomu-yt-bar-follow'; followButton.append(icon(doc, 'follow', 16));
	finder.append(searchBox, followButton);
	const listWrap = doc.createElement('div'); listWrap.className = 'qiaomu-yt-bar-listwrap';
	const list = doc.createElement('div'); list.className = 'qiaomu-yt-bar-lines'; list.setAttribute('role', 'list');
	const here = doc.createElement('button'); here.type = 'button'; here.className = 'qiaomu-yt-bar-here'; here.textContent = strings.here; here.hidden = true;
	listWrap.append(list, here);
	const retryButton = doc.createElement('button'); retryButton.type = 'button'; retryButton.className = 'qiaomu-yt-bar-retry'; retryButton.textContent = strings.retry; retryButton.hidden = true;
	const notice = doc.createElement('div'); notice.className = 'qiaomu-yt-bar-notice'; notice.append(status, retryButton);
	body.append(notice, finder, listWrap);
	element.append(head, body);

	// Feedback you can see: a successful copy turns its icon into a check for a moment; the tooltip says what happened.
	const flash = (button: HTMLElement, text: string, done = false) => {
		const original = button.title, shown = button.firstElementChild; button.title = text; button.setAttribute('aria-label', text); button.classList.add('is-notice');
		if (done && shown) button.replaceChildren(icon(doc, 'check', 16));
		setTimeout(() => { button.title = original; button.setAttribute('aria-label', original); button.classList.remove('is-notice'); if (done && shown) button.replaceChildren(shown); }, 1800);
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
	// Quiet icon buttons for the strip, and one labelled button for the main action.
	const tool = (name: Tool | 'toggle', label: string, action: (button: HTMLButtonElement) => void, text = '') => {
		const button = doc.createElement('button'); button.type = 'button'; button.className = `qiaomu-yt-tool qiaomu-yt-tool-${name}`;
		button.title = label; button.setAttribute('aria-label', label);
		if (text) button.append(doc.createTextNode(text)); else button.append(icon(doc, name === 'toggle' ? 'chevron' : name, name === 'toggle' ? 18 : 16));
		press(button, () => action(button));
		return button;
	};

	interface Row { element: HTMLElement; words: HTMLElement; start: number; text: string; match: boolean }
	interface Heading { element: HTMLElement; from: number; to: number }
	let headings: Heading[] = [];
	let segments: PanelSegment[] = [], state: BarState = 'loading', open = false, rendered = -1;
	let rows: Row[] = [], starts: number[] = [], activeIndex = -1, query = '', follow = hooks.initialFollow !== false, lastUserScroll = 0, searchTimer: ReturnType<typeof setTimeout> | undefined;
	let ignoreTimeUntil = 0, lastScroll = { target: -1, at: 0 }, resumeTimer: ReturnType<typeof setTimeout> | undefined;
	let ours = { from: 0, to: 0, until: 0 };
	const win = doc.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => unknown }) | null;
	const HIGHLIGHT = 'qiaomu-yt-line';
	// Our own scrolls are remembered with the stretch they cover. A scroll event that lies on that stretch while it
	// is under way is ours; anything else (wheel, touch, scrollbar drag, keys, inertia) is the viewer's, even if it
	// happens right after an automatic scroll.
	const moveList = (top: number, smooth: boolean) => { ours = { from: list.scrollTop, to: top, until: Date.now() + (smooth ? 1000 : 150) }; list.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' }); };
	const isOurScroll = () => Date.now() <= ours.until && list.scrollTop >= Math.min(ours.from, ours.to) - 2 && list.scrollTop <= Math.max(ours.from, ours.to) + 2;
	const reduced = () => doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

	// Plain text in a row, or the text with every match wrapped in <mark>.
	const paintText = (row: Row) => {
		row.words.replaceChildren();
		if (!query) { row.words.textContent = row.text; return; }
		const lower = row.text.toLowerCase(); let from = 0, at = lower.indexOf(query);
		while (at >= 0) {
			if (at > from) row.words.append(doc.createTextNode(row.text.slice(from, at)));
			const mark = doc.createElement('mark'); mark.className = 'qiaomu-yt-bar-mark'; mark.textContent = row.text.slice(at, at + query.length); row.words.append(mark);
			from = at + query.length; at = lower.indexOf(query, from);
		}
		if (from < row.text.length) row.words.append(doc.createTextNode(row.text.slice(from)));
	};
	const applyFilter = () => {
		let matches = 0;
		for (const row of rows) { row.match = !query || row.text.toLowerCase().includes(query); row.element.hidden = !row.match; if (row.match) { matches++; paintText(row); } }
		// A chapter title stays while any line under it is shown.
		for (const heading of headings) heading.element.hidden = Boolean(query) && !rows.slice(heading.from, heading.to).some(row => row.match);
		count.textContent = query ? (matches ? String(matches) : strings.noMatch) : ''; clear.hidden = !query;
		list.dataset.searching = String(Boolean(query));
	};
	// Keep the current line comfortably in view: only move when it left the middle band, then rest it a third from the top.
	const reveal = (row: Row, force = false) => {
		const top = row.element.offsetTop - list.offsetTop, height = list.clientHeight;
		if (!height || row.element.hidden) return;
		const inBand = top >= list.scrollTop + height * 0.15 && top + row.element.offsetHeight <= list.scrollTop + height * 0.7;
		if (inBand && !force) return;
		const target = Math.max(0, top - height * 0.33), now = Date.now();
		if (Math.abs(target - list.scrollTop) < 2) return; // already there
		if (Math.abs(target - lastScroll.target) < 2 && now - lastScroll.at < 700) return; // a scroll to this line is already under way
		lastScroll = { target, at: now };
		// Small steps glide; a far jump (after a seek) just lands, so the list never sweeps past hundreds of lines.
		moveList(target, !(reduced() || Math.abs(target - list.scrollTop) > height * 2));
	};
	const updateHere = () => {
		const row = rows[activeIndex];
		if (!row || !open || row.element.hidden || !list.clientHeight) { here.hidden = true; return; }
		const top = row.element.offsetTop - list.offsetTop;
		here.hidden = top >= list.scrollTop && top + row.element.offsetHeight <= list.scrollTop + list.clientHeight;
	};
	const setActive = (index: number, scroll: boolean) => {
		if (index !== activeIndex) { rows[activeIndex]?.element.classList.remove('is-active'); rows[activeIndex]?.element.removeAttribute('aria-current'); activeIndex = index; rows[index]?.element.classList.add('is-active'); rows[index]?.element.setAttribute('aria-current', 'true'); }
		const row = rows[index];
		if (scroll && row && follow && open && !query && Date.now() - lastUserScroll > FOLLOW_COOLDOWN) reveal(row);
		updateHere();
	};
	// Right after a jump the video still reports its old position for a moment; ignore that until it has really moved.
	// Mark the phrase being spoken inside the current line (as the study page does), with the CSS Custom Highlight API so
	// the text itself is never rewritten. The position inside the line is estimated from the time until the next line.
	const BOUNDARY = /[,.;:!?，。；：！？、]/;
	const clearProgress = () => win?.CSS?.highlights?.delete(HIGHLIGHT);
	const paintProgress = (t: number) => {
		if (!win?.CSS?.highlights || !win.Highlight) return;
		const row = rows[activeIndex], node = row?.words.firstChild;
		if (!row || query || !node || node.nodeType !== 3 || row.words.childNodes.length !== 1 || !open) { clearProgress(); return; }
		const end = rows[activeIndex + 1]?.start ?? row.start + 8, span = Math.max(1, end - row.start);
		const text = row.text, position = Math.min(text.length - 1, Math.max(0, Math.floor(Math.min(1, Math.max(0, (t - row.start) / span)) * text.length)));
		let from = position; while (from > 0 && !BOUNDARY.test(text[from - 1])) from--;
		let to = position; while (to < text.length && !BOUNDARY.test(text[to])) to++; if (to < text.length) to++;
		while (from < to && /\s/.test(text[from])) from++;
		if (to <= from) { clearProgress(); return; }
		const range = doc.createRange(); range.setStart(node, from); range.setEnd(node, to);
		win.CSS.highlights.set(HIGHLIGHT, new win.Highlight(range));
	};
	const setTime = (t: number, afterSeek = false) => {
		if (afterSeek) ignoreTimeUntil = 0;
		if (!rows.length || !Number.isFinite(t) || Date.now() < ignoreTimeUntil) return;
		setActive(activeIndexAt(starts, t), true); paintProgress(t);
	};
	const renderLines = () => {
		if (!open || rendered === segments.length) return;
		rendered = segments.length; list.replaceChildren(); rows = []; headings = []; activeIndex = -1;
		// One row per caption cue like YouTube's own transcript (a few seconds each), not a long paragraph.
		const groups = groupSegments(segments, 8, 3);
		for (const { time, text, chapter } of groups.slice(0, MAX_ROWS)) {
			if (chapter) { const heading = doc.createElement('div'); heading.className = 'qiaomu-yt-bar-chapter'; heading.setAttribute('role', 'heading'); heading.setAttribute('aria-level', '3'); heading.textContent = chapter; list.append(heading); headings.push({ element: heading, from: rows.length, to: rows.length }); }
			const element = doc.createElement('button'); element.type = 'button'; element.className = 'qiaomu-yt-bar-line'; element.setAttribute('role', 'listitem');
			const stamp = doc.createElement('span'); stamp.className = 'qiaomu-yt-bar-time'; stamp.textContent = time;
			const words = doc.createElement('span'); words.className = 'qiaomu-yt-bar-text';
			element.append(stamp, words);
			const start = seconds(time);
			// The pressed line is already on screen: mark it, jump the video, and leave the list where it is.
			press(element, () => { ignoreTimeUntil = Date.now() + 900; lastUserScroll = 0; clearTimeout(resumeTimer); hooks.seek(start); setActive(activeIndexAt(starts, start), false); paintProgress(start); });
			rows.push({ element, words, start, text, match: true }); list.append(element);
			if (headings.length) headings[headings.length - 1].to = rows.length;
		}
		starts = rows.map(row => row.start);
		if (groups.length > MAX_ROWS) { const more = doc.createElement('p'); more.className = 'qiaomu-yt-bar-more'; more.textContent = strings.more; list.append(more); }
		applyFilter();
		const now = hooks.getTime?.(); if (now !== undefined) setActive(activeIndexAt(starts, now), false);
		// A first look at the list starts at the current line, not at the top.
		const row = rows[activeIndex]; if (row && follow && !query) { const top = Math.max(0, row.element.offsetTop - list.offsetTop - list.clientHeight * 0.33); ours = { from: list.scrollTop, to: top, until: Date.now() + 150 }; list.scrollTop = top; }
		updateHere();
	};
	const toggle = tool('toggle', strings.expand, () => { if (open) setOpen(false); else openAndLoad(); });
	const paint = () => {
		if (!open || state !== 'ready') clearProgress();
		element.dataset.state = state; element.dataset.open = String(open); body.hidden = !open; retryButton.hidden = state !== 'none' || !hooks.retry; notice.hidden = state === 'ready'; finder.hidden = state === 'none' && !segments.length; listWrap.hidden = finder.hidden;
		const message = strings[state]; if (status.textContent !== message) status.textContent = message; dot.title = message; dot.setAttribute('aria-label', message);
		toggle.setAttribute('aria-expanded', String(open)); toggle.title = open ? strings.collapse : strings.expand; toggle.setAttribute('aria-label', toggle.title);
		followButton.setAttribute('aria-pressed', String(follow)); followButton.title = follow ? strings.follow : strings.followOff; followButton.setAttribute('aria-label', followButton.title);
		renderLines();
	};
	function setOpen(next: boolean, persist = true) { if (next === open) { paint(); return; } open = next; if (persist) hooks.onToggle?.(open); rendered = -1; paint(); }

	press(retryButton, () => { state = 'loading'; paint(); hooks.retry?.(); });
	// Search: filter as you type with matches marked; Escape clears. Following pauses while a search is active.
	search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = search.value.trim().toLowerCase(); applyFilter(); updateHere(); if (!query) { const row = rows[activeIndex]; if (row && follow) reveal(row, true); } }, 100); });
	search.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { search.value = ''; search.dispatchEvent(new Event('input')); } });
	for (const type of ['keyup', 'keypress']) search.addEventListener(type, event => event.stopPropagation()); // YouTube listens for single-key shortcuts
	press(clear, () => { search.value = ''; search.dispatchEvent(new Event('input')); search.focus(); });
	press(followButton, () => { follow = !follow; hooks.onFollow?.(follow); paint(); if (follow) { lastUserScroll = 0; const row = rows[activeIndex]; if (row && !query) reveal(row, true); } updateHere(); });
	press(here, () => { lastUserScroll = 0; clearTimeout(resumeTimer); const row = rows[activeIndex]; if (row) reveal(row, true); });
	// The viewer taking over the scroll pauses following for a moment; our own smooth scrolls do not count.
	// Free scrolling. Following pauses on any sign that the viewer is moving the list (wheel, touch, a press on the
	// scrollbar, scroll keys, and any scroll event that is not ours, which also covers dragging the scrollbar and
	// trackpad inertia) and the countdown restarts with every one of them. Once the viewer has stopped for
	// FOLLOW_COOLDOWN the list glides back to the playing line; the button does it at once.
	const resume = () => { lastUserScroll = 0; const row = rows[activeIndex]; if (open && follow && !query && row) reveal(row, true); updateHere(); };
	const touched = () => { lastUserScroll = Date.now(); clearTimeout(resumeTimer); resumeTimer = setTimeout(resume, FOLLOW_COOLDOWN); };
	for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) list.addEventListener(type, touched, { passive: true });
	list.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) touched(); });
	list.addEventListener('scroll', () => { updateHere(); if (!isOurScroll()) touched(); }, { passive: true });
	list.addEventListener('scrollend', () => { ours.until = 0; });

	// Opening the strip also reads the transcript if it has not arrived yet.
	const openAndLoad = () => { setOpen(true); if (state !== 'ready') void hooks.getSegments().then(found => { if (found.length) { segments = found; state = 'ready'; rendered = -1; paint(); } }); };
	tools.append(
		tool('copy', strings.copy, async button => {
			const value = formatSegments(await hooks.getSegments()); if (!value) { flash(button, strings.empty); return; }
			try { await navigator.clipboard.writeText(value); flash(button, strings.copied, true); } catch { flash(button, strings.empty); }
		}),
		tool('download', strings.download, async button => {
			const value = formatSegments(await hooks.getSegments()); if (!value) { flash(button, strings.empty); return; }
			const url = URL.createObjectURL(new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' }));
			const link = doc.createElement('a'); link.href = url; link.download = `${safeFileName(hooks.title())}.txt`;
			doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
		}),
		tool('study', strings.study, button => { if (hooks.openStudy() === false) flash(button, strings.reload); }, strings.study),
		toggle,
	);
	// Settings are rarely needed: they sit at the end of the search row, not in the strip.
	finder.append(tool('settings', strings.settings, () => hooks.openSettings()));
	// Clicking the empty part of the strip also opens and closes it; the tools handle their own presses.
	press(head, () => { if (open) setOpen(false); else openAndLoad(); });
	if (hooks.initialOpen) setOpen(true, false); else paint();
	return { element, setTime, setOpen: next => setOpen(next, false), setState: (next, found) => {
		// Called on every page change: only touch the DOM when something really changed. Rebuilding the list under
		// the viewer's pointer breaks presses and drags, and our own changes would feed the page observer in a loop.
		let changed = false;
		if (next !== state) { state = next; changed = true; }
		if (found && found !== segments && (found.length !== segments.length || found[0] !== segments[0] || found[found.length - 1] !== segments[segments.length - 1])) { segments = found; rendered = -1; changed = true; } else if (found && found !== segments) segments = found;
		if (changed) paint();
	} };
}

export const BAR_STYLE = `
::highlight(qiaomu-yt-line){background-color:rgba(6,95,212,.2);color:inherit}
ytd-engagement-panel-section-list-renderer[data-qiaomu-auto="1"]{display:none!important}
/* One component, two skins. Colours, corners and type come from the page it sits in (YouTube's --yt-spec-* tokens, Bilibili's own
   --text/--bg tokens), so it follows their light and dark themes and looks like part of the page. */
.qiaomu-yt-bar{--qm-fg:var(--yt-spec-text-primary,#0f0f0f);--qm-fg2:var(--yt-spec-text-secondary,#606060);--qm-bg:var(--yt-spec-base-background,#fff);--qm-line:var(--yt-spec-10-percent-layer,rgba(0,0,0,.1));--qm-hover:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));--qm-field:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));--qm-accent:var(--yt-spec-call-to-action,#065fd4);--qm-head:transparent;--qm-card:var(--qm-bg);--qm-frame:1px solid var(--qm-line);--qm-radius:12px;--qm-font:Roboto,Arial,sans-serif;--qm-size:14px;--qm-margin:0 0 12px;--qm-gap:0}
.qiaomu-yt-bar[data-theme=bilibili]{--qm-fg:var(--text1,#18191c);--qm-fg2:var(--text2,#61666d);--qm-bg:var(--bg1,#fff);--qm-line:var(--line_regular,#e3e5e7);--qm-hover:var(--bg2,#f6f7f8);--qm-field:var(--bg3,#f1f2f3);--qm-accent:var(--brand_blue,#00aeec);--qm-head:var(--bg3,#f1f2f3);--qm-card:transparent;--qm-frame:0 none;--qm-radius:6px;--qm-font:inherit;--qm-size:13px;--qm-margin:12px 0;--qm-gap:6px}
.qiaomu-yt-bar{box-sizing:border-box;margin:var(--qm-margin);border:var(--qm-frame);border-radius:var(--qm-radius);background:var(--qm-card);color:var(--qm-fg);font:400 var(--qm-size)/20px var(--qm-font);pointer-events:auto;position:relative}
.qiaomu-yt-bar button{font-family:inherit}
.qiaomu-yt-bar-head{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 6px 0 14px;border-radius:calc(var(--qm-radius) - 1px);background:var(--qm-head);cursor:pointer}
.qiaomu-yt-bar[data-theme=bilibili] .qiaomu-yt-bar-head{border-radius:var(--qm-radius)}
.qiaomu-yt-bar[data-open=true]:not([data-theme=bilibili]) .qiaomu-yt-bar-head{border-end-start-radius:0;border-end-end-radius:0}
.qiaomu-yt-bar-logo{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:var(--qm-fg2)}
.qiaomu-yt-bar-title{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.qiaomu-yt-bar-dot{width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:var(--qm-fg2);opacity:.45}
.qiaomu-yt-bar[data-state=ready] .qiaomu-yt-bar-dot{background:#2ba640;opacity:1}
.qiaomu-yt-bar[data-state=loading] .qiaomu-yt-bar-dot{background:#f0a400;opacity:1;animation:qiaomu-yt-pulse 1.2s ease-in-out infinite}
@keyframes qiaomu-yt-pulse{50%{opacity:.35}}
.qiaomu-yt-bar-tools{display:inline-flex;align-items:center;gap:2px;margin-inline-start:auto;flex:0 0 auto}
.qiaomu-yt-tool{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;box-shadow:none;color:var(--qm-fg2);cursor:pointer}
.qiaomu-yt-tool:hover{background:rgba(127,127,127,.16);color:var(--qm-fg)}
.qiaomu-yt-tool.is-notice{color:var(--qm-accent)}
.qiaomu-yt-tool:focus{outline:none}.qiaomu-yt-tool:focus-visible{outline:2px solid var(--qm-accent);outline-offset:-2px}
.qiaomu-yt-tool svg{display:block;pointer-events:none}
.qiaomu-yt-tool-study{width:auto;margin-inline-start:4px;padding:0 10px;color:var(--qm-fg);font-size:13px;font-weight:500;white-space:nowrap}
.qiaomu-yt-bar-finder .qiaomu-yt-tool{opacity:.65}.qiaomu-yt-bar-finder .qiaomu-yt-tool:hover{opacity:1}
.qiaomu-yt-tool-toggle svg{transition:transform .15s}
.qiaomu-yt-bar[data-open=true] .qiaomu-yt-tool-toggle svg{transform:rotate(180deg)}
.qiaomu-yt-bar-body{padding-top:var(--qm-gap)}
.qiaomu-yt-bar:not([data-theme=bilibili]) .qiaomu-yt-bar-body{border-top:1px solid var(--qm-line)}
.qiaomu-yt-bar-body[hidden],.qiaomu-yt-bar-notice[hidden]{display:none}
.qiaomu-yt-bar-notice{display:flex;align-items:center;gap:8px;padding:10px 14px}
.qiaomu-yt-bar-status{flex:1 1 auto;margin:0;color:var(--qm-fg2);font-size:12px;line-height:18px}
.qiaomu-yt-bar-retry{flex:0 0 auto;height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;box-shadow:none;color:var(--qm-accent);font-size:13px;font-weight:500;line-height:28px;cursor:pointer}
.qiaomu-yt-bar-retry:hover{background:var(--qm-hover)}
.qiaomu-yt-bar-retry[hidden],.qiaomu-yt-bar-finder[hidden],.qiaomu-yt-bar-listwrap[hidden]{display:none}
.qiaomu-yt-bar-finder{display:flex;align-items:center;gap:6px;padding:12px 10px 8px 14px}
.qiaomu-yt-bar-search{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;height:32px;padding:0 10px;border-radius:8px;background:var(--qm-field);color:var(--qm-fg2)}
.qiaomu-yt-bar-search:focus-within{box-shadow:inset 0 0 0 1.5px var(--qm-accent)}
.qiaomu-yt-bar-search svg{flex:0 0 auto}
.qiaomu-yt-bar-input{flex:1 1 auto;min-width:0;height:100%;padding:0;border:0;outline:0;background:transparent;box-shadow:none;color:var(--qm-fg);font:inherit}
.qiaomu-yt-bar-input::placeholder{color:var(--qm-fg2);opacity:.8}
.qiaomu-yt-bar-input::-webkit-search-cancel-button{display:none}
.qiaomu-yt-bar-count{flex:0 0 auto;font-size:12px;font-variant-numeric:tabular-nums}
.qiaomu-yt-bar-clear,.qiaomu-yt-bar-follow{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;padding:0;border:0;background:transparent;box-shadow:none;color:var(--qm-fg2);cursor:pointer}
.qiaomu-yt-bar-clear{width:20px;height:20px;border-radius:10px}.qiaomu-yt-bar-clear[hidden]{display:none}
.qiaomu-yt-bar-follow{width:30px;height:30px;border-radius:6px;opacity:.65}
.qiaomu-yt-bar-follow[aria-pressed=true]{color:var(--qm-accent);opacity:1}
.qiaomu-yt-bar-clear:hover,.qiaomu-yt-bar-follow:hover{background:rgba(127,127,127,.16);color:var(--qm-fg);opacity:1}
.qiaomu-yt-bar-follow[aria-pressed=true]:hover{color:var(--qm-accent)}
.qiaomu-yt-bar-clear:focus,.qiaomu-yt-bar-follow:focus{outline:none}.qiaomu-yt-bar-clear:focus-visible,.qiaomu-yt-bar-follow:focus-visible{outline:2px solid var(--qm-accent);outline-offset:-2px}
.qiaomu-yt-bar-clear svg,.qiaomu-yt-bar-follow svg{display:block;pointer-events:none}
.qiaomu-yt-bar-listwrap{position:relative}
.qiaomu-yt-bar-lines{position:relative;max-height:min(60vh,520px);overflow-y:auto;padding:0 0 8px;overscroll-behavior:contain}
.qiaomu-yt-bar-here{position:absolute;inset-inline:0;bottom:12px;margin:0 auto;width:max-content;max-width:90%;padding:0 14px;height:28px;border:1px solid var(--qm-line);border-radius:14px;background:var(--qm-bg);color:var(--qm-fg);font-size:12px;font-weight:500;line-height:26px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.16)}
.qiaomu-yt-bar-here[hidden]{display:none}
.qiaomu-yt-bar-mark{padding:0;border-radius:2px;background:rgba(255,208,0,.45);color:inherit}
/* The current line is marked by type alone: full contrast and weight while the others step back. */
.qiaomu-yt-bar-lines[data-searching=false]:has(.is-active) .qiaomu-yt-bar-line:not(.is-active) .qiaomu-yt-bar-text{color:var(--qm-fg2)}
.qiaomu-yt-bar-line.is-active .qiaomu-yt-bar-text{font-weight:500}
.qiaomu-yt-bar-line.is-active .qiaomu-yt-bar-time{color:var(--qm-accent);font-weight:500}
.qiaomu-yt-bar-chapter{padding:14px 14px 4px;color:var(--qm-fg);font-size:15px;font-weight:500;line-height:22px}
.qiaomu-yt-bar-chapter[hidden],.qiaomu-yt-bar-line[hidden]{display:none}
.qiaomu-yt-bar-line{display:flex;align-items:flex-start;gap:10px;width:100%;padding:7px 14px;border:0;border-radius:0;background:transparent;box-shadow:none;color:inherit;font:inherit;text-align:start;cursor:pointer}
.qiaomu-yt-bar-line:hover{background:var(--qm-hover)}
.qiaomu-yt-bar-line:focus{outline:none}.qiaomu-yt-bar-line:focus-visible{outline:2px solid var(--qm-accent);outline-offset:-2px}
.qiaomu-yt-bar-time{flex:0 0 auto;min-width:3.2em;color:var(--qm-fg2);font-size:12px;font-variant-numeric:tabular-nums}
.qiaomu-yt-bar-text{min-width:0;overflow-wrap:anywhere}
.qiaomu-yt-bar-more{margin:6px 14px 0;color:var(--qm-fg2);font-size:12px}
`;

// Keep the bar as the first thing in the right column of the watch page, or right after `afterSelector` inside it.
export function syncTranscriptBar(doc: Document, make: () => HTMLElement, columnSelector = 'ytd-watch-flexy #secondary-inner, #secondary-inner', afterSelector?: string): HTMLElement | undefined {
	const column = doc.querySelector<HTMLElement>(columnSelector);
	if (!column) return undefined;
	const anchor = afterSelector ? column.querySelector<HTMLElement>(':scope > ' + afterSelector) : null;
	let bar = column.querySelector<HTMLElement>(':scope > .qiaomu-yt-bar');
	if (!bar) bar = make();
	if (anchor) { if (anchor.nextElementSibling !== bar) anchor.after(bar); }
	else if (column.firstElementChild !== bar) column.prepend(bar);
	return bar;
}
