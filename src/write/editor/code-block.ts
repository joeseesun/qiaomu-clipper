import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import DOMPurify from 'dompurify';
import { common, createLowlight } from 'lowlight';
import { h } from './dom';
import { t } from '../../utils/ui-text';

export const lowlight = createLowlight(common);

export const CODE_LANGUAGES = ['', 'javascript', 'typescript', 'python', 'json', 'bash', 'shell', 'html', 'css', 'sql', 'yaml', 'markdown', 'go', 'rust', 'java', 'c', 'cpp', 'swift', 'kotlin', 'php', 'ruby', 'diff', 'mermaid'];

let mermaidLoaded: Promise<typeof import('mermaid').default> | undefined;
let mermaidCounter = 0;

// htmlLabels are off on purpose: labels become plain SVG text, which survives sanitising and can be turned into a picture.
export async function loadMermaid(theme: 'dark' | 'neutral'): Promise<typeof import('mermaid').default> {
	mermaidLoaded ??= import('mermaid').then(module => module.default);
	const mermaid = await mermaidLoaded;
	mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit', htmlLabels: false, flowchart: { htmlLabels: false }, sequence: { useMaxWidth: true } } as never);
	return mermaid;
}

export async function mermaidToSvg(source: string, theme: 'dark' | 'neutral'): Promise<string> {
	const mermaid = await loadMermaid(theme);
	const { svg } = await mermaid.render(`qw-mermaid-${++mermaidCounter}`, source);
	return svg;
}

async function renderMermaid(source: string, target: HTMLElement): Promise<void> {
	if (!source.trim()) { target.textContent = ''; return; }
	try {
		const svg = await mermaidToSvg(source, window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'neutral');
		target.classList.remove('error');
		target.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'] });
	} catch (error) {
		target.classList.add('error');
		target.textContent = t('图表写法有误：{0}', [String((error as Error)?.message ?? error).split('\n')[0]]);
		document.getElementById(`dqw-mermaid-${mermaidCounter}`)?.remove();
	}
}

export const WriteCodeBlock = CodeBlockLowlight.extend({
	addNodeView() {
		return ({ node, editor, getPos }) => {
			let current = node;
			const select = h('select', { class: 'qw-code-lang', 'aria-label': t('代码语言') });
			for (const language of CODE_LANGUAGES) select.append(h('option', { value: language, text: language || t('纯文本') }));
			const copy = h('button', { type: 'button', class: 'qw-code-copy', text: t('复制') });
			const head = h('div', { class: 'qw-code-head', contentEditable: 'false' }, select, copy);
			const code = h('code');
			const pre = h('pre', {}, code);
			const preview = h('div', { class: 'qw-mermaid', contentEditable: 'false' });
			const dom = h('div', { class: 'qw-code' }, head, pre, preview);
			let timer: number | undefined;
			const sync = () => {
				const language = (current.attrs.language as string | null) ?? '';
				if (!Array.from(select.options).some(option => option.value === language)) select.append(h('option', { value: language, text: language }));
				select.value = language;
				dom.dataset.language = language;
				code.className = language ? `language-${language}` : '';
				preview.hidden = language !== 'mermaid';
				if (language === 'mermaid') { window.clearTimeout(timer); timer = window.setTimeout(() => void renderMermaid(current.textContent, preview), 350); }
			};
			sync();
			select.addEventListener('change', () => {
				const pos = typeof getPos === 'function' ? getPos() : undefined;
				if (pos === undefined) return;
				editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: select.value || null }));
				editor.view.focus();
			});
			copy.addEventListener('click', () => {
				void navigator.clipboard.writeText(current.textContent).then(() => { copy.textContent = t('已复制'); window.setTimeout(() => { copy.textContent = t('复制'); }, 1400); });
			});
			return {
				dom,
				contentDOM: code,
				update(updated) {
					if (updated.type !== current.type) return false;
					current = updated;
					sync();
					return true;
				},
				ignoreMutation: (mutation: MutationRecord | { type: string; target: Node }) => !code.contains(mutation.target) || mutation.target === code && mutation.type === 'attributes',
				destroy() { window.clearTimeout(timer); },
			};
		};
	},
});
