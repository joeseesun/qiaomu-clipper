// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

vi.mock('./browser-polyfill', () => ({ default: { runtime: { getURL: (p: string) => p }, storage: { local: { set: vi.fn(), get: vi.fn() } } } }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./clip-preview', () => ({ saveClipPreview: vi.fn(), updateClipPreview: vi.fn() }));
vi.mock('./clipboard-utils', () => ({ copyToClipboard: vi.fn() }));

import * as clipBar from './clip-bar';
const { createClipBar, autoHideBar } = clipBar;

const draft: any = { aggregate: true, local: { content: '', name: 'a.md' }, clip: { title: 'a' } };

it('shows an icon on copy, download and clip', () => {
	const bar = createClipBar({ mode: 'read', id: '1', draft, title: document.createElement('span') });
	for (const id of ['clip-bar-copy', 'clip-bar-download', 'clip-bar-clip']) {
		expect(bar.querySelector(`#${id} svg`), id).not.toBeNull();
	}
});

it('returns media drafts to their video Read page instead of the plain preview', () => {
	const media = { ...draft, mediaReadUrl: 'reader.html?study=web&url=https%3A%2F%2Fx.com%2Fpost' };
	expect((clipBar as any).clipPageFor?.('read', 'draft-1', media)).toBe('reader.html?study=web&url=https%3A%2F%2Fx.com%2Fpost&draft=draft-1');
	expect((clipBar as any).clipPageFor?.('edit', 'draft-1', media)).toBe('editor.html?id=draft-1');
	expect((clipBar as any).clipPageFor?.('read', 'draft-1', draft)).toBe('reader.html?preview=draft-1');
});

it('hides on scroll down and returns on scroll up, including element scrollers', () => {
	vi.useFakeTimers();
	const bar = createClipBar({ mode: 'edit', id: '1', draft, title: document.createElement('input') });
	document.body.append(bar);
	autoHideBar(bar);
	const area = document.body.appendChild(document.createElement('textarea'));
	const scrollTo = (top: number) => { area.scrollTop = top; area.dispatchEvent(new Event('scroll')); };
	scrollTo(0); scrollTo(120);
	expect(bar.classList.contains('is-hidden')).toBe(true);
	scrollTo(60); // layout shake right after the transition is ignored
	expect(bar.classList.contains('is-hidden')).toBe(true);
	vi.advanceTimersByTime(500);
	scrollTo(20);
	expect(bar.classList.contains('is-hidden')).toBe(false);
	vi.useRealTimers();
});

it('ignores scrolling inside the chat panel', () => {
	const bar = createClipBar({ mode: 'edit', id: '1', draft, title: document.createElement('input') });
	document.body.append(bar);
	autoHideBar(bar);
	const panel = document.body.appendChild(document.createElement('aside'));
	panel.className = 'clip-chat';
	const list = panel.appendChild(document.createElement('div'));
	list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
	list.scrollTop = 300; list.dispatchEvent(new Event('scroll'));
	expect(bar.classList.contains('is-hidden')).toBe(false);
});
