// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { mountStudyMediaFooter } from './study-media-footer';

it('groups bare-player actions below the resize handle without reparenting the iframe',()=>{
	document.body.innerHTML='<article><iframe class="youtube-sized-player"></iframe><div class="youtube-player-resize"></div><div class="youtube-mode-bar"></div></article>';
	const article=document.querySelector('article')!,frame=article.querySelector('iframe')!;
	const footer=mountStudyMediaFooter(article)!;
	expect(frame.parentElement).toBe(article);expect(footer.previousElementSibling?.className).toBe('youtube-player-resize');
	expect(footer.querySelector('.study-media-toolbar > .youtube-mode-bar')).not.toBeNull();
	expect(footer.querySelector('.study-media-actions')).not.toBeNull();
	expect(mountStudyMediaFooter(article)).toBe(footer);expect(article.querySelectorAll('.study-media-footer')).toHaveLength(1);
});
it('returns controls to the pinned card when captions arrive, without losing the download state',()=>{
	document.body.innerHTML='<article><iframe class="youtube-sized-player"></iframe><div class="youtube-mode-bar"></div></article>';
	const article=document.querySelector('article')!,footer=mountStudyMediaFooter(article)!;
	footer.querySelector('.study-media-actions')!.innerHTML='<div class="qiaomu-dl-host"><button>Cancel download</button></div><a class="bilibili-quality-link">HD</a>';
	const download=footer.querySelector('.qiaomu-dl-host');article.insertAdjacentHTML('afterbegin','<div class="player-container"><div class="player-toggles"></div></div>');
	expect(mountStudyMediaFooter(article)).toBeUndefined();expect(article.querySelector('.player-toggles .qiaomu-dl-host')).toBe(download);
	expect(article.querySelector('.player-container > .youtube-mode-bar')).not.toBeNull();expect(article.querySelector('.study-media-footer')).toBeNull();
});
