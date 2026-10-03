import { marked } from 'marked';
import { getMessage } from './i18n';
import { mountSidebarToggle } from './sidebar-toggle';

export function markdownHeadings(markdown: string): { text: string; depth: number; offset: number }[] {
	let offset = 0;
	const headings: {text: string; depth: number; offset: number}[] = [];
	for (const token of marked.lexer(markdown)) {
		if (token.type === 'heading') headings.push({text: token.text, depth: token.depth, offset});
		offset += token.raw.length;
	}
	return headings;
}

function revealHeading(textarea: HTMLTextAreaElement, offset: number) {
	textarea.focus(); textarea.setSelectionRange(offset, offset);
	const style = getComputedStyle(textarea);
	const mirror = textarea.ownerDocument.createElement('div');
	mirror.style.cssText = 'position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
	for (const key of ['font', 'line-height', 'letter-spacing', 'padding', 'tab-size']) mirror.style.setProperty(key, style.getPropertyValue(key));
	mirror.style.width = `${textarea.clientWidth}px`;
	mirror.textContent = textarea.value.slice(0, offset);
	const marker = textarea.ownerDocument.createElement('span'); marker.textContent = '#'; mirror.append(marker);
	textarea.ownerDocument.body.append(mirror);
	textarea.scrollTop = Math.max(0, marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top - textarea.clientHeight / 3);
	mirror.remove();
}

export function mountEditorOutline(sidebar: HTMLElement, textarea: HTMLTextAreaElement, hasProperties: boolean): void {
	const doc = sidebar.ownerDocument;
	const toc = doc.createElement('nav'); toc.className = 'ce-toc'; toc.setAttribute('aria-label', getMessage('qiaomuToc'));
	sidebar.prepend(toc); mountSidebarToggle(sidebar, 'qiaomuEditorTocCollapsed');
	const render = () => {
		const headings = markdownHeadings(textarea.value);
		toc.replaceChildren();
		if (headings.length) {
			const title = doc.createElement('h2'); title.textContent = getMessage('qiaomuToc'); toc.append(title);
			for (const heading of headings) {
				const button = doc.createElement('button'); button.type = 'button'; button.textContent = heading.text;
				button.style.paddingInlineStart = `${8 + (heading.depth - 1) * 12}px`;
				button.onclick = () => revealHeading(textarea, heading.offset); toc.append(button);
			}
		}
		toc.hidden = !headings.length; sidebar.hidden = !hasProperties && !headings.length;
	};
	let timer: ReturnType<typeof setTimeout>;
	textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 200); });
	render();
}
