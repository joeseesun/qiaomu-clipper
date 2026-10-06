// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { pauseVideoForStudy } from './study-playback';
import { videoStudyPath } from './video-source';
beforeEach(() => { document.body.innerHTML = '<video></video>'; });
it('captures the playback position and state before pausing the source', () => {
	const video = document.querySelector('video')!; video.currentTime = 83.7;
	Object.defineProperty(video, 'paused', { value: false, configurable: true });
	video.pause = vi.fn(() => { Object.defineProperty(video, 'paused', { value: true }); });
	expect(pauseVideoForStudy()).toEqual({ timestamp: 83.7, autoplay: true });
	expect(video.pause).toHaveBeenCalledOnce(); expect(video.paused).toBe(true);
});
it('preserves an already paused state and refuses ad timestamps', () => {
	const video = document.querySelector('video')!; video.pause = vi.fn(); video.currentTime = 90;
	expect(pauseVideoForStudy()).toEqual({ timestamp: 90, autoplay: false });
	document.body.insertAdjacentHTML('beforeend', '<div class="html5-video-player ad-showing"></div>');
	expect(pauseVideoForStudy()).toBeNull();
});
it('encodes Bilibili part, timestamp and play state without accepting invalid times', () => {
	const url = 'https://www.bilibili.com/video/BV1GJ411x7h7/?p=2';
	expect(videoStudyPath(url, 4, '', 83.7, true)).toContain('&t=83&autoplay=1');
	expect(videoStudyPath(url, 4, '', NaN)).not.toContain('&t=');
	expect(videoStudyPath(url, 4, '', -5)).not.toContain('&t=');
});
