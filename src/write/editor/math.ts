import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import { askText } from './dom';
import { mathPlugin, MATH_BLOCK_TAG, MATH_INLINE_TAG } from './markdown-plugins';
import { t } from '../../utils/ui-text';

function renderLatex(target: HTMLElement, latex: string, display: boolean): void {
	target.textContent = '';
	if (!latex.trim()) { target.textContent = display ? t('点击输入公式') : '∑'; target.classList.add('empty'); return; }
	target.classList.remove('empty');
	try { katex.render(latex, target, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', trust: false }); }
	catch { target.textContent = latex; }
}

async function editLatex(current: string, display: boolean): Promise<string | undefined> {
	return askText({ title: t('编辑公式'), value: current, multiline: true, mono: true, placeholder: display ? '\\int_0^1 x^2\\,dx = \\tfrac13' : 'E=mc^2', confirm: t('完成'), cancel: t('取消'), note: t('使用 LaTeX 写法，Cmd/Ctrl + Enter 确认') });
}

function mathNode(name: string, display: boolean, tag: string) {
	return Node.create({
		name,
		group: display ? 'block' : 'inline',
		inline: !display,
		atom: true,
		selectable: true,
		draggable: display,
		addAttributes() { return { latex: { default: '', parseHTML: el => el.getAttribute('data-latex') ?? '' } }; },
		parseHTML() { return [{ tag }]; },
		renderHTML({ node, HTMLAttributes }) {
			return [display ? 'div' : 'span', mergeAttributes(HTMLAttributes, { 'data-type': display ? 'math-block' : 'math-inline', 'data-latex': node.attrs.latex }), display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`];
		},
		addStorage() {
			return {
				markdown: {
					serialize(state: any, node: any) {
						if (display) { state.ensureNewLine(); state.write(`$$\n${node.attrs.latex}\n$$`); state.closeBlock(node); }
						else state.write(`$${node.attrs.latex}$`);
					},
					parse: { setup(md: any) { mathPlugin(md); } },
				},
			};
		},
		addNodeView() {
			return ({ node, editor, getPos }) => {
				const dom = document.createElement(display ? 'div' : 'span');
				dom.className = `qw-math ${display ? 'block' : 'inline'}`;
				dom.contentEditable = 'false';
				dom.setAttribute('role', 'button');
				dom.tabIndex = -1;
				dom.title = t('点击编辑公式');
				let latex = node.attrs.latex as string;
				renderLatex(dom, latex, display);
				const open = async () => {
					if (!editor.isEditable) return;
					const result = await editLatex(latex, display);
					const pos = typeof getPos === 'function' ? getPos() : undefined;
					if (result === undefined || pos === undefined) { editor.commands.focus(); return; }
					if (!result.trim()) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
					else editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { latex: result.trim() }); return true; }).run();
				};
				dom.addEventListener('click', event => { event.preventDefault(); void open(); });
				return {
					dom,
					update(updated) {
						if (updated.type.name !== name) return false;
						if (updated.attrs.latex !== latex) { latex = updated.attrs.latex; renderLatex(dom, latex, display); }
						return true;
					},
					ignoreMutation: () => true,
					stopEvent: () => false,
				};
			};
		},
	});
}

export const MathInline = mathNode('mathInline', false, MATH_INLINE_TAG).extend({
	addInputRules() {
		return [new InputRule({
			// $x^2$ typed out becomes a formula; "$5 and $10" does not.
			find: /(?:^|[^\\$])\$([^\s$](?:[^$]*[^\s$])?)\$$/,
			handler: ({ state, range, match }) => {
				const start = range.from + match[0].indexOf('$');
				state.tr.replaceWith(start, range.to, this.type.create({ latex: match[1] }));
			},
		})];
	},
});
export const MathBlock = mathNode('mathBlock', true, MATH_BLOCK_TAG);

