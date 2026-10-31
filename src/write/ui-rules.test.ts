import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The rules in CLAUDE.md that broke before, checked against the writer's own styles.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const writer = read('../styles/write.scss') + read('../styles/_write-shared.scss');
const list = read('../styles/write-list.scss');

it('keeps svg icons visible on every surface of the writer', () => {
	expect(writer).toMatch(/svg \{ mix-blend-mode: normal !important; \}/);
	expect(list).toMatch(/svg \{[^}]*mix-blend-mode: normal/);
});

it('scopes every button so the app\'s global button rules and their :hover lose', () => {
	for (const css of [writer, list]) {
		const unscoped = css.split('\n').filter(line => /^(\.[a-z-]*(btn|tool|handle-btn)[a-z-]*|button\.[a-z-]+)\s*\{/.test(line));
		expect(unscoped).toEqual([]);
	}
	expect(writer).toContain('html button.qw-btn:not(.qw-x)');
	expect(writer).toContain('&:hover { background: var(--background-modifier-hover); box-shadow: none; }');
	expect(list).toContain('html button.write-btn:not(.write-x)');
});

it('gives the stationary top bar and the floating menus a solid background', () => {
	expect(writer).toMatch(/\.qw-top \{[^}]*flex: 0 0 var\(--qw-top\)[^}]*background: var\(--background-primary\)/);
	for (const rule of ['.qw-menu', '.qw-bubble', '.qw-ai-panel', 'dialog.qw-dialog']) {
		const match = writer.match(new RegExp(`${rule.replace('.', '\\.')} \\{[^\\n]*`));
		expect(match?.[0], rule).toMatch(/background: var\(--background-primary\)/);
	}
});

it('makes buttons look like buttons: a filled shape, a primary ink fill, a hover', () => {
	expect(writer).toMatch(/html button\.qw-btn\.qw-btn-primary:not\(\.qw-x\) \{ background: var\(--text-normal\); color: var\(--background-primary\);/);
	expect(writer).toMatch(/html button\.qw-btn:not\(\.qw-x\)[^{]*\{[^}]*background: var\(--qw-soft\)/);
});

it('uses one soft focus ring: no stacked or solid 2px outlines on controls', () => {
	expect(writer).not.toMatch(/outline: 2px solid[^;]*;\s*outline-offset: 2px;\s*border-radius: 6px;\s*\}\s*\.qw-title/);
	expect(writer).not.toMatch(/:focus-visible \{ outline: 2px/);
});

it('puts the article list rows in a div[role=button], not a styled button', () => {
	const manager = read('../managers/write-settings.ts');
	expect(manager).toContain("role: view === 'active' ? 'button' : undefined");
});

it('gives the AI drawer a solid background and scopes its controls', () => {
	expect(writer).toMatch(/\.qw-chat \{[^\n]*background: var\(--background-primary\)/);
	expect(writer).toContain('html button.qw-chat-send:not(.qw-x)');
	expect(writer).toContain('html & button.qw-prop-apply:not(.qw-x)');
	// the send box is a field: one soft ring on focus, no stacked outline
	expect(writer).toContain('border-color: var(--field-focus-border); box-shadow: var(--field-focus-ring)');
});

it('shares dialogs with the settings page, which does not load write.css', () => {
	expect(list).toContain("@import 'write-shared'");
	expect(writer).toContain("@import 'write-shared'");
});

it('never nests an `html button.x` selector inside a parent rule (it would compile to `.parent html button`, which matches nothing)', () => {
	for (const [name, css] of [['write.scss', writer], ['write-list.scss', list]]) expect(css.split('\n').filter(line => /^\s+html button\./.test(line)), name).toEqual([]);
});
