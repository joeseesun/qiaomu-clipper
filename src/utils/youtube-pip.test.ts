// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { documentPipSupported, openDocumentPip, trackPlayback } from './youtube-pip';

const html = '<article><div class="player-container"><iframe style="width: 50%" src="https://www.youtube.com/embed/dbqweBCynuI?enablejsapi=1&origin=x"></iframe></div></article>';
function fakePip() {
	const doc = document.implementation.createHTMLDocument('pip'); const listeners: Record<string, Function[]> = {};
	return { document: doc, close: vi.fn(() => (listeners.pagehide || []).forEach(fn => fn())), addEventListener: (type: string, fn: Function) => { (listeners[type] ||= []).push(fn); }, removeEventListener: vi.fn(), emit: (type: string, event?: unknown) => (listeners[type] || []).forEach(fn => fn(event)) };
}
beforeEach(() => { document.body.innerHTML = html; delete (window as any).documentPictureInPicture; });

it('detects support only when the API exists', () => {
	expect(documentPipSupported(window)).toBe(false);
	(window as any).documentPictureInPicture = { requestWindow: vi.fn() }; expect(documentPipSupported(window)).toBe(true);
});

it('moves the player into the pop-out window resuming at the reported time, and brings it back on close', async () => {
	const article = document.querySelector('article')!, frame = article.querySelector('iframe')!, container = frame.parentElement!;
	trackPlayback(article);
	window.dispatchEvent(Object.assign(new MessageEvent('message', { data: JSON.stringify({ info: { currentTime: 83.7, playerState: 1 } }), source: frame.contentWindow as MessageEventSource })));
	const pip = fakePip(); (window as any).documentPictureInPicture = { requestWindow: vi.fn(async () => pip) };
	await openDocumentPip(article, frame);
	expect(pip.document.body.contains(frame)).toBe(true); expect(container.querySelector('.youtube-pip-placeholder')).not.toBeNull();
	const url = new URL(frame.src); expect(url.searchParams.get('start')).toBe('83'); expect(url.searchParams.get('autoplay')).toBe('1'); expect(url.searchParams.get('enablejsapi')).toBe('1');
	// A time report from the pop-out window reaches the page's own listener.
	const seen = vi.fn(); window.addEventListener('message', seen);
	pip.emit('message', { data: '{"info":{"currentTime":90}}', origin: 'https://www.youtube.com', source: null }); expect(seen).toHaveBeenCalled();
	pip.close();
	expect(container.contains(frame)).toBe(true); expect(container.querySelector('.youtube-pip-placeholder')).toBeNull(); expect(frame.getAttribute('style')).toBe('width: 50%');
	expect(new URL(frame.src).searchParams.get('start')).toBe('83');
});

it('leaves the page untouched when the browser refuses the window', async () => {
	const article = document.querySelector('article')!, frame = article.querySelector('iframe')!;
	(window as any).documentPictureInPicture = { requestWindow: vi.fn(async () => { throw new Error('denied'); }) };
	await openDocumentPip(article, frame); expect(article.contains(frame)).toBe(true); expect(article.querySelector('.youtube-pip-placeholder')).toBeNull();
});
