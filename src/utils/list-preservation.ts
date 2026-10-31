/** Keep prose-introduced lists out of Defuddle 0.19's blog metadata heuristic. */
export function protectArticleLists(doc: Document): string[] {
	const markers: string[] = [];
	let prefix: string;
	do { prefix = `QCList${Math.random().toString(36).slice(2)}X`; } while (doc.documentElement.textContent?.includes(prefix));
	for (const list of Array.from(doc.querySelectorAll('article ul, article ol, main ul, main ol, [role="main"] ul, [role="main"] ol'))) {
		if (list.closest('nav, aside, header, footer, [role="navigation"]')) continue;
		const paragraph = list.previousElementSibling;
		if (!paragraph?.matches('p') || !paragraph.textContent?.trim()) continue;
		let heading = paragraph.previousElementSibling;
		while (heading && !heading.matches('h1, h2, h3, h4, h5, h6')) heading = heading.previousElementSibling;
		// A section heading and explanatory paragraph distinguish body lists
		// from author/date/tag lists near an article's title or footer.
		if (!heading?.matches('h2, h3, h4, h5, h6')) continue;
		const item = Array.from(list.children).find(child => child.tagName === 'LI');
		if (!item) continue;
		const marker = `${prefix}${markers.length}Z keep article list contents in their original reading order.`;
		markers.push(marker);
		// Upstream recognizes prose length and punctuation as content instead
		// of short metadata or breadcrumb labels. Remove this marker afterward.
		// Keep the actual list in its sanitization and URL-resolution pipeline.
		item.appendChild(doc.createTextNode(marker));
	}
	return markers;
}

export function restoreArticleLists(html: string, markers: string[]): string {
	for (const marker of markers) html = html.split(marker).join('');
	return html;
}
