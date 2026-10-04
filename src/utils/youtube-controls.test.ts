// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
vi.mock('./storage-utils',()=>({getLocalStorage:async()=>undefined,setLocalStorage:async()=>{},loadSettings:async()=>{}}));
vi.mock('./i18n',()=>({getMessage:(key:string)=>key}));
vi.mock('./clip-chat',()=>({mountClipChat:()=>({toggle:()=>true})}));
import {mountPlayerSize} from './youtube-player-size';
import {wireTranscript} from './reader-transcript';
import {mountYouTubeStudy} from './youtube-study';
it('connects late subtitles to the original handle and iframe without nesting containers or rewriting its URL',async()=>{
 vi.stubGlobal('CSS',{});
 document.body.innerHTML='<article><div class="player-container"><iframe src="https://www.youtube.com/embed/dbqweBCynuI?enablejsapi=1"></iframe></div></article>';
 const article=document.querySelector('article')!,frame=article.querySelector('iframe')!,src=frame.src;
 mountPlayerSize(article);const handle=article.querySelector('.youtube-player-resize');
 article.insertAdjacentHTML('beforeend','<div class="youtube transcript"><p class="transcript-segment"><strong><span class="timestamp" data-timestamp="12">0:12</span></strong>Original passage.</p></div>');
 const settings={pinPlayer:true,autoScroll:false,highlightActiveLine:true}; const scroll={getStickyOffset:()=>56,scrollTo:()=>{},programmaticScroll:()=>false};
 wireTranscript(document,article,settings,scroll); await mountYouTubeStudy(document,article,'Video','https://www.youtube.com/watch?v=dbqweBCynuI',{toggle:()=>true});
 wireTranscript(document,article,settings,scroll);
 expect(article.querySelectorAll('.player-container')).toHaveLength(1); expect(article.querySelectorAll('.player-toggle-group')).toHaveLength(1);
 expect(article.querySelector('.youtube-player-resize')).toBe(handle);expect(handle?.previousElementSibling).toBe(frame);
 expect(article.querySelector('iframe')).toBe(frame);expect(frame.src).toBe(src);
 expect(article.querySelector('.player-toggle-group')!.lastElementChild?.className).toContain('youtube-translate-toggle');
 expect(Array.from(article.querySelectorAll('.player-toggle')).map(toggle => (toggle as HTMLElement).dataset.toggle || 'translate')).toEqual(['pin', 'follow', 'translate']); // translation stays last, pin and follow sit to its left
 expect(article.querySelector('.youtube-size-control,.youtube-study-toolbar')).toBeNull();
 const post=vi.spyOn(frame.contentWindow!,'postMessage'); const grip=handle as HTMLElement;
 grip.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',code:'Home',bubbles:true}));const size=Number(grip.getAttribute('aria-valuenow'));
 grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));
 expect(Number(grip.getAttribute('aria-valuenow'))).toBe(size+1);expect(post).not.toHaveBeenCalled();
 const shortcut=new KeyboardEvent('keyup',{key:' ',code:'Space',ctrlKey:true,bubbles:true,cancelable:true});document.body.dispatchEvent(shortcut);expect(shortcut.defaultPrevented).toBe(false);
 article.remove();vi.unstubAllGlobals();
});

it('restores the pin-video and follow-subtitles switches, remembers them through the settings callback, and acts on them', () => {
	vi.stubGlobal('CSS', {});
	document.body.innerHTML = '<article><div class="player-container"><iframe src="https://www.youtube.com/embed/dbqweBCynuI?enablejsapi=1"></iframe></div><div class="youtube transcript"><p class="transcript-segment"><strong><span class="timestamp" data-timestamp="12">0:12</span></strong>Line.</p></div></article>';
	const article = document.querySelector('article')!; const changes: Array<[string, boolean]> = [];
	wireTranscript(document, article, { pinPlayer: true, autoScroll: false, highlightActiveLine: true }, { getStickyOffset: () => 0, scrollTo: () => {}, programmaticScroll: () => false }, (key, value) => changes.push([key, value]));
	const pin = article.querySelector<HTMLInputElement>('[data-toggle="pin"] input')!, follow = article.querySelector<HTMLInputElement>('[data-toggle="follow"] input')!, container = article.querySelector('.player-container')!;
	expect(pin.checked).toBe(true); expect(follow.checked).toBe(false); expect(container.classList.contains('pin-player')).toBe(true);
	pin.checked = false; pin.dispatchEvent(new Event('change')); expect(container.classList.contains('pin-player')).toBe(false);
	follow.checked = true; follow.dispatchEvent(new Event('change'));
	expect(changes).toEqual([['pinPlayer', false], ['autoScroll', true]]);
	vi.unstubAllGlobals();
});
