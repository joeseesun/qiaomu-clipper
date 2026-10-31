// Code whitespace is data, unlike whitespace in prose. Keep a local snapshot
// across Defuddle's cleanup and Turndown's document-wide normalization.
export interface CodeBlock { token: string; text: string; language: string; inTable: boolean }

function languageOf(element: Element): string {
	const value = element.getAttribute('data-language') || element.getAttribute('data-lang')
		|| element.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] || '';
	return /^[\w#+.-]+$/.test(value) ? value : '';
}

function codeText(element: Element): string {
	const copy = element.cloneNode(true) as Element;
	copy.querySelectorAll('button, .line-numbers-rows, .linenumber, .lineno, .cm-gutters, [aria-hidden="true"]').forEach(node => node.remove());
	const lines = Array.from(copy.children);
	if (lines.length && lines.every(line => line.matches('.cm-line, .line, [data-line], .ec-line'))) {
		return lines.map(line => line.childNodes.length === 1 && line.firstChild?.nodeName === 'BR' ? '' : textWithBreaks(line)).join('\n');
	}
	return textWithBreaks(copy);
}

function textWithBreaks(node: Node): string {
	if (node.nodeType === 3) return node.nodeValue || '';
	if (node.nodeName === 'BR') return '\n';
	return Array.from(node.childNodes).map(textWithBreaks).join('');
}

export function escapeCode(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Keep payload whitespace out of Markdown's list/table normalization. Numeric
// entities are decoded back to the exact text by the sanitized HTML renderer.
function inlineCodeHtml(text: string, language: string): string {
	const code = escapeCode(text).replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')
		.replace(/\|/g, '&#124;').replace(/`/g, '&#96;');
	return `<pre><code${language ? ` class="language-${language}"` : ''}>${code}</code></pre>`;
}

// Match Defuddle's whitespace/CJK word counting when removing temporary
// markers, so the transport mechanism does not inflate article statistics.
export function countHtmlWords(html: string): number {
	const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#\d+;|&\w+;/g, ' ');
	const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
	return (text.match(cjk)?.length || 0) + text.replace(cjk, ' ').split(/[\x00-\x20]+/).filter(Boolean).length;
}

/** Work only on a clone. Recognize semantic blocks, never infer code from prose. */
export function protectCodeBlocks(doc: Document, source?: Document): CodeBlock[] {
	const records: CodeBlock[] = [];
	let prefix: string;
	do { prefix = `QCCode${Math.random().toString(36).slice(2)}X`; } while (doc.documentElement.textContent?.includes(prefix));
	// Live computed styles are optional; detached/server documents still support
	// standard pre/code and explicit code-block/editor markup.
	const liveCodes = source ? Array.from(source.querySelectorAll('code')) : [];
	const styledCodes = new Set<Element>(Array.from(doc.querySelectorAll('code')).filter((_, index) => {
		const live = liveCodes[index];
		if (!live || !source?.defaultView?.getComputedStyle) return false;
		try {
			const style = source.defaultView.getComputedStyle(live);
			return /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace) && /^(block|inline-block)$/.test(style.display);
		} catch { return false; } // A server DOM may borrow globals from another realm.
	}));
	const candidates = Array.from(doc.querySelectorAll('pre, [data-code-block="true"], code'));
	for (const block of candidates) {
		if (!block.parentNode || !doc.documentElement.contains(block)) continue;
		if (block.tagName === 'CODE' && (!styledCodes.has(block) || block.closest('pre, [data-code-block="true"]'))) continue;
		if (block.querySelector('.cm-gap')) continue; // Virtualized, incomplete editor: do not invent omitted lines.
		const content = block.querySelector('.cm-content') || block.querySelector('[data-code-block-source] code') || block.querySelector('code') || block;
		if (block.hasAttribute('data-code-block') && content === block) continue;
		// Multiple independent code cells need the upstream highlighter adapter.
		if (block.tagName === 'PRE' && block.querySelectorAll('code').length > 1) continue;
		const text = codeText(content);
		const language = languageOf(content) || languageOf(block);
		const token = `${prefix}${records.length}Z`;
		records.push({ token, text, language, inTable: !!block.closest('table') });
		const pre = doc.createElement('pre');
		// Keep visibility/scoring attributes; a hidden code example must not be
		// made visible by normalization. Defuddle still sanitizes these normally.
		for (const attribute of Array.from(block.attributes)) pre.setAttribute(attribute.name, attribute.value);
		const code = doc.createElement('code');
		if (language) code.setAttribute('data-lang', language);
		// Retain the payload during article scoring; restore its exact text later.
		code.textContent = `${token}START${text}${token}END`;
		pre.appendChild(code);
		block.replaceWith(pre);
	}
	return records;
}

export function restoreCodeHtml(html: string, records: CodeBlock[]): string {
	for (const { token, text } of records) {
		html = html.replace(new RegExp(`${token}START[\\s\\S]*?${token}END`, 'g'), () => escapeCode(text));
	}
	return html;
}

/** Restore after all prose transformations, using a fence longer than the payload. */
export function restoreCodeMarkdown(markdown: string, records: CodeBlock[]): string {
	for (const { token, text, language, inTable } of records) {
		// Defuddle retains complex tables as HTML rather than pipe tables.
		markdown = markdown.replace(new RegExp('(<code\\b[^>]*>)' + token + '(?=</code>)', 'g'), (_, opening: string) => opening + escapeCode(text));
		if (inTable) {
			// Pipe tables cannot contain fenced blocks. Inline HTML retains the
			// code's newlines without introducing physical table rows or delimiters.
			markdown = markdown.replace(new RegExp('```[^`\\n]*?' + token + ' *```', 'g'), () => inlineCodeHtml(text, language));
		}
		const fence = '`'.repeat(Array.from(text.matchAll(/`+/g)).reduce((length, match) => Math.max(length, match[0].length + 1), 3));
		const pattern = new RegExp('(^[^\\n]*?)```[^\\n]*\\n([ \\t>]*?)' + token + '\\n([ \\t>]*?)```(?=\\n|$)', 'gm');
		markdown = markdown.replace(pattern, (_, opening: string, body: string, closing: string) => {
			// Marked expands tabs while parsing list items, before fenced-code
			// tokenization. Preserve tab-sensitive code (e.g. Makefile recipes)
			// as one HTML line in nested contexts, with the existing list prefix.
			if (text.includes('\t') && (opening || body || closing)) {
				return opening + inlineCodeHtml(text.endsWith('\n') ? text : text + '\n', language);
			}
			// Turndown uses a tab even for a three-column ordered-list marker.
			// CommonMark treats that as an extra code column. Align with the marker.
			const list = opening.match(/^([ \t>]*)(?:\d+[.)]|[-+*]) +$/);
			if (list) body = closing = list[1] + ' '.repeat(opening.length - list[1].length);
			const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
			return opening + fence + language + '\n' + lines.map(line => body + line).join('\n') + '\n' + closing + fence;
		});
	}
	return markdown;
}
