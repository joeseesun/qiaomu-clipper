// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./storage-utils', () => ({getLocalStorage:async()=>undefined,setLocalStorage:async()=>{},loadSettings:async()=>{}}));
vi.mock('./i18n', () => ({getMessage:(key:string)=>key}));
import { wireTranscript, unwireTranscript } from './reader-transcript';
import { transcriptHtml } from './youtube-dom-transcript';
afterEach(()=>{const article=document.querySelector('article');if(article)unwireTranscript(article);});
it('seeks timestamp clicks to the exact VTT start and removes old listeners when changing language',()=>{
 vi.stubGlobal('CSS',{});
 document.body.innerHTML='<article><div class="reader-video-wrapper"><video class="reader-video-player"></video></div></article>';
 const article=document.querySelector('article')!,video=article.querySelector('video')!;
 const attach=(text:string,start:number)=>{article.querySelector('.transcript')?.remove();article.insertAdjacentHTML('beforeend',transcriptHtml([{time:'0:03',text,start,end:start+4}],false));wireTranscript(document,article,{pinPlayer:false,autoScroll:false,highlightActiveLine:true},{getStickyOffset:()=>0,scrollTo:()=>{},programmaticScroll:()=>false});};
 attach('Official English',3.863);article.querySelector<HTMLElement>('.timestamp')!.click();expect(video.currentTime).toBe(3.863);
 video.currentTime=41;attach('官方中文',3.863);expect(video.currentTime).toBe(41);
 document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));expect(video.currentTime).toBe(51);
 expect(article.querySelectorAll('.player-toggles')).toHaveLength(1);
 unwireTranscript(article);document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));expect(video.currentTime).toBe(51);
});
it('removes relocated audio toggles when replacing captions and wires the new timestamps once',()=>{
 vi.stubGlobal('CSS',{});
 document.body.innerHTML='<article><div class="reader-video-wrapper"><video class="reader-video-player"></video><div class="qa-tools"></div></div></article>';
 const article=document.querySelector('article')!,video=article.querySelector('video')!;
 const attach=(text:string,start:number)=>{article.querySelector('.transcript')?.remove();article.insertAdjacentHTML('beforeend',transcriptHtml([{time:'0:02',text,start,end:start+3}],false));wireTranscript(document,article,{pinPlayer:false,autoScroll:false,highlightActiveLine:true},{getStickyOffset:()=>0,scrollTo:()=>{},programmaticScroll:()=>false});article.querySelector('.qa-tools')!.append(article.querySelector('.player-toggle-group')!);};
 attach('Old audio',2);video.currentTime=24;video.playbackRate=1.5;attach('New audio',8);
 expect(article.querySelectorAll('.player-toggle-group')).toHaveLength(1);expect(video.currentTime).toBe(24);expect(video.playbackRate).toBe(1.5);
 article.querySelector<HTMLElement>('.timestamp')!.click();expect(video.currentTime).toBe(8);
 document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));expect(video.currentTime).toBe(18);
 unwireTranscript(article);expect(article.querySelectorAll('.player-toggle-group')).toHaveLength(0);
});
