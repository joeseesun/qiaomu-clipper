// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./browser-polyfill', () => ({ default: { runtime: { getURL: (p: string) => 'chrome-extension://fixture/' + p }, storage: { local: { set: vi.fn(), get: vi.fn() } } } }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./clip-preview', () => ({ saveClipPreview: vi.fn(), patchClipPreview: vi.fn() }));
vi.mock('./clipboard-utils', () => ({ copyToClipboard: vi.fn() }));

import * as clipBar from './clip-bar';
const { createClipBar, autoHideBar } = clipBar;

const draft: any = { aggregate: true, local: { content: '', name: 'a.md' }, clip: { title: 'a' } };
beforeEach(() => { document.body.innerHTML = ''; });

it('shows an icon on copy, download and clip', () => {
	const bar = createClipBar({ mode: 'read', id: '1', draft, title: document.createElement('span') });
	for (const id of ['clip-bar-copy', 'clip-bar-download', 'clip-bar-clip']) {
		expect(bar.querySelector(`#${id} svg`), id).not.toBeNull();
	}
});

it('returns media drafts to their video Read page instead of the plain preview', () => {
	const media = { ...draft, mediaReadUrl: 'reader.html?study=web&url=https%3A%2F%2Fx.com%2Fpost' };
	expect((clipBar as any).clipPageFor?.('read', 'draft-1', media)).toBe('chrome-extension://fixture/reader.html?study=web&url=https%3A%2F%2Fx.com%2Fpost&resume=draft-1');
	expect((clipBar as any).clipPageFor?.('edit', 'draft-1', media)).toBe('chrome-extension://fixture/editor.html?id=draft-1');
	expect((clipBar as any).clipPageFor?.('read', 'draft-1', draft)).toBe('chrome-extension://fixture/reader.html?preview=draft-1');
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

it('uses rescue content for copy and download without depending on a failing persistence sync', async()=>{
 const sync=vi.fn().mockRejectedValue(Error('quota')),getExport=vi.fn().mockResolvedValue({content:'Pending rescue text',name:'Rescued.md'});
 const bar=createClipBar({mode:'edit',id:'rescue',draft,title:document.createElement('input'),sync,getExport});
 const clipboard=await import('./clipboard-utils');bar.querySelector<HTMLButtonElement>('#clip-bar-copy')!.click();await vi.waitFor(()=>expect(clipboard.copyToClipboard).toHaveBeenCalledWith('Pending rescue text'));expect(sync).not.toHaveBeenCalled();
});


it('tracks wrapped bar height without losing the hidden-bar offset behavior', () => {
 document.documentElement.style.removeProperty('--clip-bar-measured-height');
 const bar = document.createElement('header'); bar.className = 'clip-bar'; document.body.append(bar);
 let height = 96, resized!: () => void, frame!: FrameRequestCallback;
 vi.spyOn(bar,'getBoundingClientRect').mockImplementation(()=>({height} as DOMRect));
 const disconnect = vi.fn();
 vi.stubGlobal('ResizeObserver',class { constructor(callback:()=>void){resized=callback;} observe(){} disconnect=disconnect; });
 vi.stubGlobal('requestAnimationFrame',vi.fn((callback:FrameRequestCallback)=>{frame=callback;return 456;}));
 vi.stubGlobal('cancelAnimationFrame',vi.fn());
 autoHideBar(bar);
 expect(document.documentElement.style.getPropertyValue('--clip-bar-measured-height')).toBe('96px');
 height=144; resized(); frame(0);
 expect(document.documentElement.style.getPropertyValue('--clip-bar-measured-height')).toBe('144px');
 window.dispatchEvent(new Event('pagehide')); expect(disconnect).toHaveBeenCalled();
 bar.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('keeps copy beside clip and puts secondary actions in the right-hand menu', () => {
	const daily = document.createElement('button'); daily.className = 'learning-note-entry';
	const bar = createClipBar({ mode: 'read', id: 'menu', draft, title: document.createElement('span'), dailyNoteButton: daily });
	document.body.append(bar);
	expect(bar.querySelector('#clip-bar-copy')?.parentElement?.className).toBe('clip-bar-actions');
	expect(bar.querySelector('#clip-bar-clip')?.nextElementSibling?.id).toBe('clip-bar-more');
	const menu = bar.querySelector<HTMLElement>('.clip-more-menu')!;
	expect(menu.hidden).toBe(true);
	for (const id of ['clip-bar-write', 'clip-bar-daily', 'clip-bar-download', 'clip-bar-settings']) expect(menu.querySelector(`#${id}`)).not.toBeNull();
	expect(menu.querySelector('input.switch')).not.toBeNull();
	bar.querySelector<HTMLButtonElement>('#clip-bar-more')!.click();
	expect(menu.hidden).toBe(false); expect(document.activeElement?.id).toBe('clip-bar-write');
	document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	expect(document.activeElement).toBe(daily);
	document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	expect(menu.hidden).toBe(true); expect(document.activeElement?.id).toBe('clip-bar-more');
});

it('keeps an open action menu visible during scrolling and guards repeated article clicks', async () => {
	let resolve!: () => void;
	const onWrite = vi.fn(() => new Promise<void>(done => { resolve = done; }));
	const bar = createClipBar({ mode: 'read', id: 'write', draft, title: document.createElement('span'), onWrite });
	document.body.append(bar); autoHideBar(bar);
	bar.querySelector<HTMLButtonElement>('#clip-bar-more')!.click();
	const area = document.body.appendChild(document.createElement('textarea'));
	area.scrollTop = 0; area.dispatchEvent(new Event('scroll'));
	area.scrollTop = 300; area.dispatchEvent(new Event('scroll'));
	expect(bar.classList.contains('is-hidden')).toBe(false);
	const write = bar.querySelector<HTMLButtonElement>('#clip-bar-write')!;
	write.click(); write.click(); expect(onWrite).toHaveBeenCalledTimes(1);
	resolve(); await vi.waitFor(() => expect(write.disabled).toBe(false));
});

it('prevents clipping with the old sharing choice while an RSS toggle is being saved', async () => {
	const { patchClipPreview } = await import('./clip-preview');
	let finish!: () => void;
	vi.mocked(patchClipPreview).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
	const data = { ...draft, aggregate: true };
	const bar = createClipBar({ mode: 'read', id: 'rss', draft: data, title: document.createElement('span') });
	const rss = bar.querySelector<HTMLInputElement>('input.switch')!, clip = bar.querySelector<HTMLButtonElement>('#clip-bar-clip')!;
	rss.checked = false; rss.dispatchEvent(new Event('change'));
	expect(clip.disabled).toBe(true);
	finish(); await vi.waitFor(() => expect(clip.disabled).toBe(false)); expect(data.aggregate).toBe(false);
});
