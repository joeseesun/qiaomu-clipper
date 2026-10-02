import type { TokenizerAndRendererExtension } from 'marked';

// Obsidian highlight syntax: ==text== renders as <mark>.
export const highlightExtension: TokenizerAndRendererExtension = {
	name: 'highlight',
	level: 'inline',
	start(src: string) { return src.indexOf('=='); },
	tokenizer(src: string) {
		const match = /^==(?=\S)([\s\S]+?)(?<=\S)==/.exec(src);
		if (!match) return undefined;
		return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
	},
	renderer(token) {
		return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
	},
};
