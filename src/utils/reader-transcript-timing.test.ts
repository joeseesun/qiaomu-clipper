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


it('updates the shared heading backdrop on nested scrolling and removes it on teardown', async () => {
 const { transcriptHeadingTools } = await import('./transcript-heading');
 document.body.innerHTML='<article><div class="reader-video-wrapper"><video class="reader-video-player"></video></div><div class="transcript youtube"><h2>Transcript</h2><div class="transcript-segment"><span class="timestamp" data-timestamp="8"><strong>0:08</strong></span> · hello</div></div></article>';
 const article=document.querySelector('article')!, transcript=article.querySelector<HTMLElement>('.transcript')!;
 const row=transcriptHeadingTools(transcript).parentElement!; let top=300;
 vi.spyOn(transcript,'getBoundingClientRect').mockImplementation(()=>({top} as DOMRect));
 vi.spyOn(row,'getBoundingClientRect').mockReturnValue({top:56} as DOMRect); row.style.top='56px';
 let frame:FrameRequestCallback|undefined;
 const raf=vi.fn((callback:FrameRequestCallback)=>{frame=callback;return 123;}); vi.stubGlobal('requestAnimationFrame',raf);
 const cancel=vi.fn(); vi.stubGlobal('cancelAnimationFrame',cancel);
 wireTranscript(document,article,{pinPlayer:false,autoScroll:false,highlightActiveLine:true},{getStickyOffset:()=>56,scrollTo:vi.fn(),programmaticScroll:()=>false});
 expect(transcript.style.getPropertyValue('--transcript-heading-cover')).toBe('0px');
 top=40; transcript.dispatchEvent(new Event('scroll')); transcript.dispatchEvent(new Event('scroll'));
 expect(raf).toHaveBeenCalledTimes(1); frame!(0);
 expect(transcript.style.getPropertyValue('--transcript-heading-cover')).toBe('16px');
 transcript.dispatchEvent(new Event('scroll')); unwireTranscript(article);
 expect(cancel).toHaveBeenCalledWith(123); expect(transcript.style.getPropertyValue('--transcript-heading-cover')).toBe('');
 const calls=raf.mock.calls.length; transcript.dispatchEvent(new Event('scroll')); expect(raf).toHaveBeenCalledTimes(calls);
 vi.restoreAllMocks(); vi.unstubAllGlobals();
});


it('wires the shared video subtitle tools for native media while keeping audio in its own layout', async () => {
 const { mountMediaStudyPlayer } = await import('./media-study-player');
 vi.stubGlobal('CSS', {});
 for (const picture of [true, false]) {
  document.body.innerHTML = '<article><div id="content"></div></article>';
  const article = document.querySelector('article')!, holder = document.querySelector<HTMLElement>('#content')!;
  const video = mountMediaStudyPlayer(article, holder, 'https://media.example/lecture.mp4', picture);
  article.insertAdjacentHTML('beforeend', transcriptHtml([{time:'0:02',start:2,end:6,text:'Native media subtitle'}], false));
  wireTranscript(document, article, {pinPlayer:false,autoScroll:false,highlightActiveLine:true}, {getStickyOffset:()=>0,scrollTo:()=>{},programmaticScroll:()=>false});
  expect(article.querySelectorAll('.q-caption-controls')).toHaveLength(picture ? 1 : 0);
  expect(article.querySelectorAll('.q-caption-overlay')).toHaveLength(picture ? 1 : 0);
  if (picture) {
   expect(article.querySelector('[aria-label="播放器中文字幕"]')).not.toBeNull();
   expect(article.querySelector('[aria-label="带字幕全屏"]')).not.toBeNull();
   expect(article.querySelector('.q-caption-controls')?.textContent).toContain('1×');
   expect(article.querySelector('.q-caption-drag')).not.toBeNull();
  }
  video.currentTime=20; document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));
  expect(video.currentTime).toBe(30); expect(article.querySelector('video')).toBe(video);
  unwireTranscript(article);
 }
 vi.unstubAllGlobals();
});
