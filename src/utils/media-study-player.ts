import { mountPlayerMode } from './youtube-player-mode';
import { mountPlayerSize } from './youtube-player-size';

export const isVideoFile = (file: Pick<File, 'name' | 'type'>): boolean => file.type.startsWith('video/') || /\.(mp4|mkv|mov|m4v|webm)$/i.test(file.name);

// Native videos use exactly the same dock/theater/floating layout as the embed readers.
// Create the container before captions arrive, so player controls never depend on recognition.
export function mountMediaStudyPlayer(article: HTMLElement, before: HTMLElement, src: string, video: boolean, poster?: string, audioUrl?: string): HTMLVideoElement {
	const doc = article.ownerDocument;
	article.dataset.audioStudy = String(!video);
	doc.documentElement.classList.toggle('qiaomu-audio-page', !video);
	const wrapper = doc.createElement('div'); wrapper.className = 'reader-video-wrapper' + (video ? '' : ' is-audio');
	const player = doc.createElement('video'); player.className = 'reader-video-player'; player.controls = video; player.preload = 'metadata'; player.playsInline = true; player.src = src;
	if (poster && video) player.poster = poster;
	wrapper.append(player);
	if (video && audioUrl) {
		const audio = doc.createElement('audio'); audio.src = audioUrl; audio.preload = 'metadata'; audio.hidden = true; wrapper.append(audio);
		const sync = () => { if (Math.abs(audio.currentTime - player.currentTime) > .25) audio.currentTime = player.currentTime; };
		player.addEventListener('play', () => { sync(); void audio.play().catch(() => { player.pause(); }); });
		for (const event of ['pause', 'ended', 'waiting']) player.addEventListener(event, () => audio.pause());
		player.addEventListener('playing', () => { sync(); void audio.play().catch(() => player.pause()); });
		for (const event of ['seeked', 'timeupdate']) player.addEventListener(event, sync);
		player.addEventListener('ratechange', () => { audio.playbackRate = player.playbackRate; });
		player.addEventListener('volumechange', () => { audio.volume = player.volume; audio.muted = player.muted; });
		const observer = new MutationObserver(() => { if (!player.isConnected) { audio.pause(); observer.disconnect(); } });
		observer.observe(article, { childList: true, subtree: true });
	}
	if (video) {
		const container = doc.createElement('div'); container.className = 'player-container'; container.append(wrapper); before.before(container);
		mountPlayerSize(article); mountPlayerMode(article);
	} else before.before(wrapper);
	return player;
}
