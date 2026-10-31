import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Every page in the settings menu must be reachable by clicking it and by its ?section= address.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sections = [...read('../settings.html').matchAll(/<li data-section="([a-z-]+)"/g)].map(m => m[1]);

it('routes every menu entry when it is clicked', () => {
	const ui = read('./settings-section-ui.ts');
	const clickable = ui.slice(ui.indexOf("const li = target.closest('li[data-section]')"));
	for (const section of sections) expect(clickable, section).toContain(`'${section}'`);
});

it('opens every menu entry from its address', () => {
	const settings = read('../core/settings.ts');
	const urls = settings.slice(settings.indexOf('async function handleUrlParameters'));
	for (const section of sections) expect(urls, section).toContain(`'${section}'`);
});

it('has a page for every menu entry', () => {
	const html = read('../settings.html');
	for (const section of sections) expect(html, section).toContain(`id="${section}-section"`);
});
