// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

vi.mock('./browser-polyfill', () => ({ default: { runtime: { getURL: (p: string) => 'chrome-extension://fixture/' + p }, storage: { local: { set: vi.fn(), get: vi.fn() } } } }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./clip-preview', () => ({ saveClipPreview: vi.fn(), patchClipPreview: vi.fn() }));
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
