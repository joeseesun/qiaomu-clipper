import { mountEmbeddedPlayerInteraction } from './utils/embedded-player-interaction';
import browser from './utils/browser-polyfill';

export function mountBilibiliPictureClicks(): () => void {
	if (window.top === window) return () => {};
	let origin = '';
	try { const url = new URL(browser.runtime.getURL('/')); origin = `${url.protocol}//${url.host}`; } catch { return () => {}; }
	const ancestor = location.ancestorOrigins?.[0];
	if (ancestor && ancestor !== origin) return () => {};
	let trustedParent = ancestor === origin || document.referrer.startsWith(origin + '/');
	const trust = (event: MessageEvent) => { if (event.source === window.parent && event.origin === origin) trustedParent = true; };
	const click = (event: MouseEvent) => {
		if (!trustedParent || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		const target = event.target instanceof Element ? event.target : null;
		const video = document.querySelector<HTMLVideoElement>('video');
		const surface = target?.closest('video,.bpx-player-video-wrap,.bpx-player-video-perch,.bpx-player-video-poster,.bpx-player-row-dm-wrap,.bpx-player-subtitle-wrap,.bpx-player-play-pause-button');
		if (!video || !surface?.closest('.bpx-player-video-area') || target?.closest('a,button,input,select,textarea,[role="button"],[role="menu"],[contenteditable="true"]')) return;
		// Bilibili redirects picture clicks to its site; keep controls and explicit source links intact.
		event.preventDefault(); event.stopImmediatePropagation();
		if (event.detail < 2) { if (video.paused) void video.play().catch(() => {}); else video.pause(); }
	};
	document.addEventListener('click', click, true); window.addEventListener('message', trust);
	return () => { document.removeEventListener('click', click, true); window.removeEventListener('message', trust); };
}

mountEmbeddedPlayerInteraction('bilibili');
mountBilibiliPictureClicks();
