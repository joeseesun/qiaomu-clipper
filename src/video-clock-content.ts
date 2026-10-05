// The embedded player owns the media clock, including buffering, seeks and ads.
// Only our extension page can request it; no page audio or credentials are sent.
const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
window.addEventListener('message', event => {
	if (window.parent === window || event.source !== window.parent || event.origin !== extensionOrigin) return;
	if (event.data?.type !== 'qiaomu-whisper-clock' || typeof event.data.session !== 'string') return;
	const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, .bpx-player-video-wrap video, video');
	window.parent.postMessage({
		type: 'qiaomu-whisper-clock-result',
		session: event.data.session,
		time: video?.currentTime,
		rate: video?.playbackRate,
		playing: Boolean(video && !video.paused && !video.ended && !video.seeking && video.readyState >= 3
			&& !document.querySelector('.html5-video-player.ad-showing')),
	}, extensionOrigin);
});
