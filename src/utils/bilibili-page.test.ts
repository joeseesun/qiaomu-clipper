// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { pageSettled } from './bilibili-page';

it('is not settled until the page has loaded and its player exists', () => {
	document.body.innerHTML = '<div id="app"><div class="right-container"></div></div>';
	expect(pageSettled(document)).toBe(false); // no player yet: the app has not taken the server-rendered page over
	document.body.innerHTML += '<div class="bpx-player-container"></div>';
	expect(['complete', 'interactive', 'loading']).toContain(document.readyState);
	expect(pageSettled(document)).toBe(document.readyState === 'complete');
	const loading = Object.create(document, { readyState: { value: 'loading' } }) as Document;
	expect(pageSettled(loading)).toBe(false);
});
