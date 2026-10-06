import browser from './utils/browser-polyfill';

// Bilibili's embedded player has no JavaScript API, so a page that embeds it (the study page) cannot know where playback is.
// This script runs inside that embed, but only when this extension's own page is the one embedding it: it reports the
// video's time to the parent and accepts a seek, so the transcript can follow playback and a jump does not reload the player.
(() => {
	if (window.top === window) return;
	const parent = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
	let ownOrigin = '';
	try { ownOrigin = new URL(browser.runtime.getURL('/')).origin; } catch { return; }
	// Chrome tells an embed who its parent is; where it does not (Firefox), the checks on the messages themselves still hold.
	if (parent && parent !== ownOrigin) return;
	const video = () => document.querySelector<HTMLVideoElement>('video');
	const tell = () => { const v = video(); if (v) window.parent.postMessage({ qiaomuPlayer: 'time', time: v.currentTime, paused: v.paused }, ownOrigin); };
	window.setInterval(tell, 400);
	window.addEventListener('message', event => {
		if (event.source !== window.parent || event.origin !== ownOrigin) return;
		const data = event.data as { qiaomuPlayer?: string; time?: unknown; play?: unknown } | null, v = video();
		if (!v || data?.qiaomuPlayer === undefined) return;
		if (data.qiaomuPlayer === 'seek' && typeof data.time === 'number' && Number.isFinite(data.time)) { v.currentTime = Math.max(0, data.time); if (data.play === true) void v.play().catch(() => {}); tell(); }
		else if (data.qiaomuPlayer === 'toggle') { if (v.paused) void v.play().catch(() => {}); else v.pause(); }
	});
})();
