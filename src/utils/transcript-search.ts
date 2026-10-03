// Search inside a study-page transcript: filter lines as you type and mark the matches. Marking uses the CSS
// Custom Highlight API, like the playback highlight, so the text nodes (and the bilingual blocks that depend on
// them) are never rewritten.
export interface TranscriptSearch { element: HTMLElement; active: () => boolean; clear: () => void }

export interface SearchStrings { placeholder: string; clear: string; noMatch: string }

const HIGHLIGHT_NAME = 'transcript-search';

function textNodes(root: Element): Text[] {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest('strong') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
	const nodes: Text[] = []; let node: Node | null;
	while ((node = walker.nextNode())) nodes.push(node as Text);
	return nodes;
}

export function mountTranscriptSearch(doc: Document, transcript: HTMLElement, segments: HTMLElement[], strings: SearchStrings, onChange?: () => void): TranscriptSearch {
	const win = doc.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => unknown }) | null;
	const element = doc.createElement('div'); element.className = 'transcript-search'; element.setAttribute('role', 'search');
	const input = doc.createElement('input'); input.type = 'search'; input.className = 'transcript-search-input'; input.placeholder = strings.placeholder; input.setAttribute('aria-label', strings.placeholder); input.autocomplete = 'off'; input.spellcheck = false;
	const count = doc.createElement('span'); count.className = 'transcript-search-count'; count.setAttribute('aria-live', 'polite');
	const clearButton = doc.createElement('button'); clearButton.type = 'button'; clearButton.className = 'transcript-search-clear'; clearButton.hidden = true; clearButton.title = strings.clear; clearButton.setAttribute('aria-label', strings.clear); clearButton.textContent = '×';
	element.append(input, count, clearButton);
	segments[0] ? segments[0].before(element) : transcript.append(element);
	const headings = Array.from(transcript.children).filter(child => /^H[3-6]$/.test(child.tagName)) as HTMLElement[];

	let query = '', timer: ReturnType<typeof setTimeout> | undefined;
	const apply = () => {
		const ranges: Range[] = []; let matches = 0;
		for (const segment of segments) {
			let hit = !query;
			if (query) for (const node of textNodes(segment)) {
				const lower = (node.textContent || '').toLowerCase(); let at = lower.indexOf(query);
				while (at >= 0) { hit = true; const range = doc.createRange(); range.setStart(node, at); range.setEnd(node, at + query.length); ranges.push(range); at = lower.indexOf(query, at + query.length); }
			}
			segment.hidden = !hit; if (hit && query) matches++;
		}
		// A chapter title stays only while some line under it is shown.
		for (const heading of headings) {
			let next = heading.nextElementSibling, shown = !query;
			while (next && !/^H[2-6]$/.test(next.tagName) && !shown) { if (next.classList.contains('transcript-segment') && !(next as HTMLElement).hidden) shown = true; next = next.nextElementSibling; }
			heading.hidden = !shown;
		}
		if (win?.CSS?.highlights && win.Highlight) { if (ranges.length) win.CSS.highlights.set(HIGHLIGHT_NAME, new win.Highlight(...ranges)); else win.CSS.highlights.delete(HIGHLIGHT_NAME); }
		count.textContent = query ? (matches ? String(matches) : strings.noMatch) : ''; clearButton.hidden = !query;
		element.dataset.searching = String(Boolean(query));
		onChange?.();
	};
	const run = () => { query = input.value.trim().toLowerCase(); apply(); };
	input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 100); });
	input.addEventListener('keydown', event => { if (event.key === 'Escape') { input.value = ''; clearTimeout(timer); run(); } });
	clearButton.addEventListener('click', () => { input.value = ''; clearTimeout(timer); run(); input.focus(); });
	return { element, active: () => Boolean(query), clear: () => { input.value = ''; clearTimeout(timer); run(); } };
}
