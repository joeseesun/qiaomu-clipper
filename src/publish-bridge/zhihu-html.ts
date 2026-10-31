const SCHEME = 'qp-asset://';

export function assetSources(html: string): string[] {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return Array.from(new Set(Array.from(doc.querySelectorAll('img')).map(image => image.getAttribute('src') ?? '').filter(src => src.startsWith(SCHEME))));
}

function wrapTable(table: HTMLTableElement, doc: Document): void {
	const body = doc.createElement('tbody');
	for (const row of Array.from(table.querySelectorAll('tr'))) {
		if (row.parentElement?.tagName.toLowerCase() === 'thead') {
			for (const cell of Array.from(row.children)) {
				if (cell.tagName.toLowerCase() !== 'td') continue;
				const header = doc.createElement('th');
				header.innerHTML = cell.innerHTML;
				cell.replaceWith(header);
			}
		}
		body.append(row);
	}
	const next = doc.createElement('table');
	for (const [name, value] of [['data-draft-node', 'block'], ['data-draft-type', 'table'], ['data-size', 'normal'], ['data-row-style', 'normal']]) next.setAttribute(name, value!);
	next.append(body);
	(table.closest('figure') ?? table).replaceWith(next);
}

const BLOCK = new Set(['p', 'div', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tbody', 'thead', 'tr', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr']);
const isBlock = (node: Node | null): boolean => !!node && node.nodeType === 1 && BLOCK.has((node as Element).tagName.toLowerCase());

/**
 * Zhihu turns every stray newline between tags into an empty paragraph, and every <p> inside a list item or quote into
 * another block, which is what makes imported articles look double spaced. Take them all out so one Markdown paragraph
 * is exactly one Zhihu paragraph.
 */
function compact(doc: Document): void {
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	const texts: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
	for (const text of texts) {
		if (text.parentElement?.closest('pre')) continue;
		const value = text.data;
		if (!value.trim() && (isBlock(text.previousSibling) || isBlock(text.nextSibling) || !text.previousSibling || !text.nextSibling)) { text.remove(); continue; }
		text.data = value.replace(/[ \t]*\n[ \t]*/g, ' ');
	}
	for (const paragraph of Array.from(doc.querySelectorAll('li > p, td > p, th > p'))) {
		if (paragraph.previousSibling) paragraph.before(doc.createElement('br'));
		paragraph.replaceWith(...Array.from(paragraph.childNodes));
	}
	for (const wrapper of Array.from(doc.querySelectorAll('div'))) {
		if (Array.from(wrapper.children).some(child => isBlock(child))) wrapper.replaceWith(...Array.from(wrapper.childNodes));
		else { const paragraph = doc.createElement('p'); paragraph.innerHTML = wrapper.innerHTML; wrapper.replaceWith(paragraph); }
	}
	for (const br of Array.from(doc.querySelectorAll('p > br:last-child'))) br.remove();
	for (const paragraph of Array.from(doc.querySelectorAll('p'))) {
		if (!paragraph.textContent?.replace(/[\s\u00a0]/g, '') && !paragraph.querySelector('img, figure, br')) paragraph.remove();
		else if (!paragraph.textContent?.replace(/[\s\u00a0]/g, '') && !paragraph.querySelector('img, figure')) paragraph.remove();
	}
}

/**
 * Obsidian's rendered article → the HTML Zhihu's editor accepts. `urls` maps `qp-asset://id` to the address Zhihu gave the uploaded picture.
 * Zhihu only has two heading levels, wraps pictures in <figure>, writes code blocks as <pre lang> and uses its own table markup.
 */
export function toZhihuHtml(html: string, urls: ReadonlyMap<string, string>): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	doc.querySelectorAll('script, style, link, iframe').forEach(node => node.remove());
	for (const code of Array.from(doc.querySelectorAll('pre > code'))) {
		const language = /language-([\w+-]+)/.exec(code.getAttribute('class') ?? '')?.[1];
		if (language) code.parentElement!.setAttribute('lang', language);
	}
	for (const heading of Array.from(doc.querySelectorAll('h1, h4, h5, h6'))) {
		const next = doc.createElement(heading.tagName.toLowerCase() === 'h1' ? 'h2' : 'h3');
		next.innerHTML = heading.innerHTML;
		heading.replaceWith(next);
	}
	for (const image of Array.from(doc.querySelectorAll('img'))) {
		const url = urls.get(image.getAttribute('src') ?? '');
		if (!url) { (image.closest('figure') ?? image).remove(); continue; }
		image.setAttribute('src', url);
		image.removeAttribute('width'); image.removeAttribute('height'); image.removeAttribute('srcset');
		if (!image.closest('figure')) { const figure = doc.createElement('figure'); image.replaceWith(figure); figure.append(image); }
	}
	for (const table of Array.from(doc.querySelectorAll('table'))) wrapTable(table as HTMLTableElement, doc);
	for (const node of Array.from(doc.body.querySelectorAll('*'))) {
		node.removeAttribute('style'); node.removeAttribute('id');
		node.removeAttribute('class');
		for (const attribute of Array.from(node.attributes)) if (/^data-(?!draft)/.test(attribute.name)) node.removeAttribute(attribute.name);
	}
	compact(doc);
	return doc.body.innerHTML;
}
