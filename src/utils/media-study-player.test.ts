// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./storage-utils', () => ({ getLocalStorage: vi.fn().mockResolvedValue(undefined), setLocalStorage: vi.fn().mockResolvedValue(undefined) }));
import { isVideoFile, mountMediaStudyPlayer } from './media-study-player';
beforeEach(() => {document.body.innerHTML='<article><div id="captions"></div></article>';document.documentElement.className='qiaomu-audio-page';});
it('shows the video and all layout controls before any subtitles, preserving the playing node when switching modes', () => {
	const article=document.querySelector('article')!, before=document.querySelector<HTMLElement>('#captions')!;
	const pip=vi.fn().mockResolvedValue({}); Object.defineProperty(HTMLVideoElement.prototype,'requestPictureInPicture',{configurable:true,value:pip});
	const video=mountMediaStudyPlayer(article,before,'https://video.example/test.mp4',true,'https://video.example/poster.jpg');
	expect(article.dataset.audioStudy).toBe('false');expect(document.documentElement.classList.contains('qiaomu-audio-page')).toBe(false);expect(video.controls).toBe(true);expect(video.parentElement!.classList.contains('is-audio')).toBe(false);
	for(const mode of ['theater','float','dock']) {article.querySelector<HTMLButtonElement>(`.youtube-mode-${mode}`)!.click();expect(article.querySelector('video')).toBe(video);expect(video.src).toBe('https://video.example/test.mp4');}
	article.querySelector<HTMLButtonElement>('.youtube-mode-pip')!.click();expect(pip).toHaveBeenCalledOnce();
});
it('keeps audio in the audio layout without video controls, while classifying local video files correctly', () => {
	const article=document.querySelector('article')!, video=mountMediaStudyPlayer(article,document.querySelector('#captions')!,'https://sound.example/test.mp3',false);
	expect(article.dataset.audioStudy).toBe('true');expect(video.controls).toBe(false);expect(video.parentElement!.classList.contains('is-audio')).toBe(true);expect(article.querySelector('.youtube-mode-bar')).toBeNull();
	for(const name of ['test.mp4','test.MOV','test.webm'])expect(isVideoFile({name,type:''})).toBe(true);
	expect(isVideoFile({name:'unknown',type:'video/mp4'})).toBe(true);expect(isVideoFile({name:'sound.mp3',type:'audio/mpeg'})).toBe(false);
});
