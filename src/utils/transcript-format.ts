// Remove only background music cues, not arbitrary brackets (technical notation,
// citations and meaningful stage directions must survive).
export function withoutMusicCues(text: string): string {
	return text.replace(/[\[【（(]\s*(?:music|background music|instrumental(?: music)?|音乐|音樂|背景音乐|背景音樂)\s*[\]】）)]/gi, (_cue: string, offset: number, source: string) => /[\u3400-\u9fff]/.test(source[offset - 1] || '') && /[\u3400-\u9fff]/.test(source[offset + _cue.length] || '') ? '' : ' ')
		.replace(/[♪♫]+/g, '').replace(/[^\S\n]+/g, ' ').trim();
}

// Exact slices of the original: concatenating these blocks recovers the source.
// Aim for two sentences / about 60 words while respecting request size limits.
export function sourceParagraphs(text: string): string[] {
	const result: string[] = [];
	const boundaries = /[.!?。！？]["'”’）)]*(?:\s+|$)/g;
	let start = 0; let sentences = 0;
	for (const match of text.matchAll(boundaries)) {
		const end = match.index! + match[0].length;
		const prefix = text.slice(start, end).trimEnd();
		if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)|\b[A-Z])\.$/.test(prefix)) continue;
		sentences++;
		if (sentences >= 2 || end - start >= 360) { result.push(text.slice(start, end)); start = end; sentences = 0; }
	}
	if (start < text.length) result.push(text.slice(start));
	return result.flatMap(block => {
		const chunks: string[] = [];
		while (block.length > 3500) {
			const space = block.lastIndexOf(' ', 3500);
			const end = space > 2000 ? space + 1 : 3500;
			chunks.push(block.slice(0, end)); block = block.slice(end);
		}
		if (block) chunks.push(block);
		return chunks;
	});
}

export function translationParagraphs(text: string): string[] {
	const cleaned = withoutMusicCues(text).replace(/\r\n?/g, '\n');
	// Respect semantic paragraph breaks supplied by the model. A single newline
	// inside a sentence is wrapping, not a new paragraph.
	return cleaned.split(/\n\s*\n/).map(part => part.replace(/\n/g, ' ').trim()).filter(Boolean);
}

export function renderBilingualBlocks(source: HTMLElement, blocks: { original: string; translation: string }[]): void {
	const doc = source.ownerDocument;
	source.classList.add('transcript-bilingual');
	const nodes = blocks.map(block => {
		const pair = doc.createElement('div'); pair.className = 'transcript-bilingual-block';
		const original = doc.createElement('div'); original.className = 'transcript-source-part'; original.textContent = block.original;
		pair.append(original);
		const paragraphs = translationParagraphs(block.translation);
		if (paragraphs.length && paragraphs.join('').replace(/\s/g, '') !== withoutMusicCues(block.original).replace(/\s/g, '')) {
			const translated = doc.createElement('div'); translated.className = 'transcript-translation'; translated.lang = 'zh-CN';
			for (const text of paragraphs) { const paragraph = doc.createElement('p'); paragraph.textContent = text; translated.append(paragraph); }
			pair.append(translated);
		}
		return pair;
	});
	source.replaceChildren(...nodes);
}

// Playback progress and caret seeking count source characters only, even when
// translations and multiple source blocks are nested inside the text wrapper.
export function sourceTextNodes(root: Element): Text[] {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: node => node.parentElement?.closest('.transcript-translation') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	});
	const nodes: Text[] = []; let node: Node | null;
	while ((node = walker.nextNode())) nodes.push(node as Text);
	return nodes;
}
