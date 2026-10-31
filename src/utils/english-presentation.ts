import { dictionaryQuery } from './english-dictionary';

// Presentation only: keep every word, punctuation mark and qualification from the
// response. Ambiguous bilingual text stays together; it is never rewritten.
export function appendStudyText(target: HTMLElement, text: string, selected: string): void {
	target.replaceChildren();
	const query = dictionaryQuery(selected);
	if (!query) { target.textContent = text; return; }
	const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+').replace(/'/g, "['’]").replace(/-/g, '[-‐‑]');
	// Allow sentence-initial capitalization without merging US/us or Polish/polish.
	const variants = [query];
	if (query === query.toLocaleLowerCase('en')) variants.push(query[0].toLocaleUpperCase('en') + query.slice(1));
	const boundary = "\\p{L}\\p{M}\\p{N}_'’\\-‐‑";
	const pattern = new RegExp(`(^|[^${boundary}])(${[...new Set(variants)].map(escape).join('|')})(?=$|[^${boundary}])`, 'gu');
	let offset = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index! + match[1].length;
		target.append(document.createTextNode(text.slice(offset, start)));
		const mark = document.createElement('mark'); mark.className = 'study-term'; mark.textContent = match[2]; target.append(mark);
		offset = start + match[2].length;
	}
	target.append(document.createTextNode(text.slice(offset)));
}

export function appendLearningText(target: HTMLElement, text: string, bilingual = false, selected = ''): void {
	const paragraphs = text.split(/\n+/).filter(part => part.trim());
	for (const paragraph of paragraphs) {
		const examples = bilingual ? paragraph.split(/(?<=[。！？])[\t ]*(?=[A-Z](?:[a-z]|[\t ]))/u) : [paragraph];
		for (const example of examples) {
			const pair = bilingual && example.match(/^([\s\S]*?[.!?]["”']?)[\t ]+(?=\p{Script=Han})([\s\S]+)$/u);
			if (pair && !/\p{Script=Han}/u.test(pair[1])) {
				const group = document.createElement('div'); group.className = 'example';
				const en = document.createElement('p'); en.className = 'english'; en.lang = 'en'; appendStudyText(en, pair[1], selected);
				const zh = document.createElement('p'); zh.className = 'example-translation'; zh.lang = 'zh'; zh.textContent = pair[2];
				group.append(en, zh); target.append(group);
			} else {
				const p = document.createElement('p');
				if (bilingual) appendStudyText(p, example, selected); else p.textContent = example;
				target.append(p);
			}
		}
	}
}
