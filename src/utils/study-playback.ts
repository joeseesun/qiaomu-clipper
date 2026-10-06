export interface StudyPlayback { timestamp: number; autoplay: boolean }

// Self-contained so the background can run the same capture in the page's world.
export function pauseVideoForStudy(): StudyPlayback | null {
	if (document.querySelector('.html5-video-player.ad-showing')) return null;
	const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, .bpx-player-video-wrap video, video');
	if (!video || !Number.isFinite(video.currentTime) || video.currentTime < 0) return null;
	const playback = { timestamp: video.currentTime, autoplay: !video.paused && !video.ended };
	video.pause();
	return playback;
}
