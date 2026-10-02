import { expect, it } from 'vitest';
import { Marked } from 'marked';
import { highlightExtension } from './marked-highlight';

const md = new Marked({ extensions: [highlightExtension] });

it('renders ==text== as a mark, including links inside', () => {
	expect(md.parseInline('==hello [link](https://a.com/?x=1) world==')).toBe('<mark>hello <a href="https://a.com/?x=1">link</a> world</mark>');
	expect(md.parseInline('a == b and c == d')).not.toContain('<mark>');
});
