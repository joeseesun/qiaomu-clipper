// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import DOMPurify from 'dompurify';
import { CaptionQueue, mountPlayerCaptions, parseCaptionTranslations, readPlayerCues } from './player-captions';
import { transcriptHtml } from './youtube-dom-transcript';
import { parseCaptions } from './youtube-captions';
const state=vi.hoisted(()=>({stream:vi.fn(),storage:new Map<string,unknown>(),models:[{id:'test',name:'Test'}]}));
vi.mock('./chat-llm',()=>({enabledChatModels:()=>state.models,streamChat:state.stream}));
vi.mock('./storage-utils',()=>({loadSettings:async()=>{},getLocalStorage:async(k:string)=>state.storage.get(k),setLocalStorage:async(k:string,v:unknown)=>{state.storage.set(k,v);}}));
const flush=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setTimeout(r,0));};
const cues=[{start:0,end:2,text:'Hello'},{start:5,end:8,text:'Goodbye'},{start:100,end:104,text:'Later'}];
let cleanup=()=>{};
beforeEach(()=>{document.body.innerHTML='';state.stream.mockReset();state.storage.clear();state.models=[{id:'test',name:'Test'}];vi.stubGlobal('crypto',webcrypto);vi.spyOn(window,'requestAnimationFrame').mockReturnValue(1);vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});});
afterEach(()=>{cleanup();cleanup=()=>{};vi.restoreAllMocks();vi.unstubAllGlobals();});
it('preserves ungrouped precise cues through sanitized reading paragraphs',()=>{
 const holder=document.createElement('div');holder.innerHTML=DOMPurify.sanitize(transcriptHtml(cues.map(c=>({...c,time:'0:00'}))));
 const transcript=holder.querySelector<HTMLElement>('.transcript')!;
 expect(transcript.querySelectorAll('.transcript-segment').length).toBeLessThan(3);
 expect(readPlayerCues(transcript)).toEqual(cues);
 const parsed=parseCaptions(JSON.stringify({events:[{tStartMs:1250,dDurationMs:1850,segs:[{utf8:'Hi'}]}]}));
 expect(parsed[0]).toMatchObject({start:1.25,end:3.1});
});
it('rejects duplicate or foreign translated IDs and renders no model HTML',()=>{
 expect(()=>parseCaptionTranslations('[{"id":0,"text":"a"},{"id":0,"text":"b"}]',[0,1])).toThrow();
 expect(()=>parseCaptionTranslations('[{"id":99,"text":"a"}]',[0])).toThrow();
 expect(parseCaptionTranslations('[{"id":0,"text":"<img onerror=x>"}]',[0]).get(0)).toBe('<img onerror=x>');
});
it('seeks immediately, aborts stale work, and expires subtitles in gaps',async()=>{
 const pending:Array<{ids:number[],signal:AbortSignal,resolve:(x:Map<number,string>)=>void}>=[];
 const q=new CaptionQueue(cues,(ids,signal)=>new Promise(resolve=>pending.push({ids,signal,resolve})),()=>{});
 q.clock(1);q.start();expect(pending[0].ids).toEqual([0,1]);
 q.clock(101);expect(pending[0].signal.aborted).toBe(true);expect(pending[1].ids).toEqual([2]);
 pending[0].resolve(new Map([[0,'旧字幕']]));pending[1].resolve(new Map([[2,'新字幕']]));await flush();
 expect(q.translations.has(0)).toBe(false);expect(q.translations.get(2)).toBe('新字幕');
 q.clock(105);expect(q.current()).toBe(-1);q.stop();
});
it('widens lookahead for double speed and reuses translated cues',async()=>{
 const translate=vi.fn(async(ids:number[])=>new Map(ids.map(i=>[i,'中文'])));
 const q=new CaptionQueue([{start:50,end:54,text:'Far away'}],translate,()=>{});
 q.clock(0,1);q.start();expect(translate).not.toHaveBeenCalled();q.clock(0,2);await flush();expect(translate).toHaveBeenCalledOnce();q.stop();q.start();await flush();expect(translate).toHaveBeenCalledOnce();q.stop();
});
function setup(kind:'youtube'|'bilibili'|'native'){
 document.body.innerHTML=`<article><div class="player-container">${kind==='native'?'<div class="reader-video-wrapper"><video class="reader-video-player"></video></div>':`<iframe src="${kind==='youtube'?'https://www.youtube.com/embed/test?enablejsapi=1':'https://player.bilibili.com/player.html?bvid=test'}"></iframe>`}<div class="player-toggle-group"></div></div>${transcriptHtml(cues.map(c=>({...c,time:'0:00'})))}</article>`;
 const article=document.querySelector('article')!,transcript=article.querySelector<HTMLElement>('.transcript')!,controls=article.querySelector<HTMLElement>('.player-toggle-group')!;
 state.stream.mockImplementation(async({messages}:any)=>JSON.stringify(JSON.parse(messages[0].content).map((x:any)=>({id:x.id,text:x.id===0?'你好':'稍后再见'}))));
 cleanup=mountPlayerCaptions(article,transcript,controls);
 const clock=(time:number,origin?:string)=>{const frame=article.querySelector('iframe');if(frame)window.dispatchEvent(new MessageEvent('message',{origin:origin||new URL(frame.src).origin,source:frame.contentWindow,data:kind==='youtube'?{info:{currentTime:time,playbackRate:1}}:{qiaomuPlayer:'time',time,rate:1}}));else{const video=article.querySelector('video')!;video.currentTime=time;video.dispatchEvent(new Event('timeupdate'));}};
 return {article,clock,toggle:controls.querySelector<HTMLButtonElement>('button')!,line:article.querySelector<HTMLElement>('.q-caption-text')!};
}
it.each(['youtube','bilibili','native'] as const)('shows Chinese on %s and clears it during silence',async kind=>{
 const {clock,toggle,line,article}=setup(kind);clock(1);toggle.click();await flush();expect(line.textContent).toBe('你好');expect(line.hidden).toBe(false);
 clock(3);expect(line.hidden).toBe(true);clock(6);expect(line.textContent).toBe('稍后再见');
 const container=article.querySelector<HTMLElement>('.player-container')!;container.requestFullscreen=vi.fn(async()=>{});article.querySelector<HTMLButtonElement>('[aria-label="带字幕全屏"]')!.click();expect(container.requestFullscreen).toHaveBeenCalledOnce();expect(container.contains(line)).toBe(true);
 toggle.click();expect(article.querySelector<HTMLElement>('.q-caption-overlay')!.hidden).toBe(true);
});
it('ignores forged cross-origin clocks and late results after cleanup',async()=>{
 const {clock,toggle,line}=setup('bilibili');clock(1,'https://evil.example');toggle.click();await flush();expect(state.stream).not.toHaveBeenCalled();
 let release!:(s:string)=>void;state.stream.mockImplementation(()=>new Promise(r=>release=r));clock(1);await flush();cleanup();release('[{"id":0,"text":"stale"},{"id":1,"text":"stale"}]');await flush();expect(line.textContent).not.toBe('stale');expect(document.querySelector('.q-caption-overlay')).toBeNull();
});
it('keeps caption controls compact and text contrasting under reader styles',()=>{
 const {article}=setup('native');expect(getComputedStyle(article.querySelector('.q-caption-controls button')!).width).toBe('auto');expect(getComputedStyle(article.querySelector('.q-caption-text')!).color).toBe('rgb(255, 255, 255)');
});

it('uses the newer cue when source caption intervals overlap',()=>{
 const q=new CaptionQueue([{start:0,end:8,text:'Old'},{start:4,end:6,text:'New'}],async()=>new Map(),()=>{});
 q.clock(5);expect(q.current()).toBe(1);
});
it('offers remembered original-only subtitles without requesting a translation',async()=>{
 state.storage.set('qiaomuPlayerCaptionMode','original');
 const {clock,toggle,article}=setup('native');await flush();clock(1);toggle.click();await flush();
 expect(article.querySelector('.q-caption-original')?.textContent).toBe('Hello');expect(state.stream).not.toHaveBeenCalled();
});
it('starts in bilingual mode and keeps the source visible while Chinese is pending',async()=>{
 state.stream.mockImplementation(()=>new Promise(()=>{}));
 const {clock,toggle,article}=setup('native');clock(1);toggle.click();await flush();
 expect(article.querySelector<HTMLElement>('.q-caption-original')?.hidden).toBe(false);
 expect(article.querySelector('.q-caption-original')?.textContent).toBe('Hello');
 expect(article.querySelector('[aria-label="字幕显示方式"]')).not.toBeNull();
});
it('renders an already Chinese track once without needing a model',async()=>{
 state.models=[];const {article,clock}=setup('native');cleanup();
 const track=article.querySelector<HTMLElement>('[data-player-cues]')!;track.dataset.playerCues=JSON.stringify([{start:0,end:3,text:'这是中文字幕。'}]);
 cleanup=mountPlayerCaptions(article,article.querySelector('.transcript')!,article.querySelector('.player-toggle-group')!);
 clock(1);article.querySelector<HTMLButtonElement>('.q-caption-controls button')!.click();await flush();
 expect(article.querySelector('.q-caption-text')?.textContent).toBe('这是中文字幕。');expect(state.stream).not.toHaveBeenCalled();
});
it('switches modes without changing the transcript or duplicating completed translations',async()=>{
 const {article,clock,toggle}=setup('native');const before=article.querySelector('.transcript')!.innerHTML;clock(1);toggle.click();await flush();
 expect(article.querySelector('.q-caption-original')?.textContent).toBe('Hello');expect(article.querySelector('.q-caption-text')?.textContent).toBe('你好');const calls=state.stream.mock.calls.length;
 article.querySelector<HTMLButtonElement>('.q-caption-menu [data-value="translated"]')!.click();await flush();expect(article.querySelector<HTMLElement>('.q-caption-original')!.hidden).toBe(true);expect(state.stream.mock.calls).toHaveLength(calls);
 article.querySelector<HTMLButtonElement>('.q-caption-menu [data-value="original"]')!.click();await flush();expect(article.querySelector<HTMLElement>('.q-caption-text')!.hidden).toBe(true);expect(article.querySelector<HTMLElement>('.q-caption-original')!.hidden).toBe(false);expect(state.storage.get('qiaomuPlayerCaptionMode')).toBe('original');
 article.querySelector<HTMLButtonElement>('.q-caption-menu [data-value="off"]')!.click();expect(article.querySelector<HTMLElement>('.q-caption-overlay')!.hidden).toBe(true);expect(article.querySelector('.transcript')!.innerHTML).toBe(before);
});

it('keeps Doubao word timing through generated lines, cache and sanitized grouped transcript',async()=>{
 const {toLines}=await import('./subtitle-generation');
 const {createTranscriptCache}=await import('./youtube-transcript-cache');
 const words=[{start:10.123,end:10.5,text:'你'},{start:10.8,end:11.234,text:'好'}];
 const lines=toLines([{start:10.123,end:12,text:'你好！',words}]);
 const data:Record<string,any>={};const cache=createTranscriptCache({get:async()=>data,set:async v=>{Object.assign(data,v);},remove:async()=>{}});
 const key='generated:youtube:abcdefghijk';await cache.write(key,lines);
 const holder=document.createElement('div');holder.innerHTML=DOMPurify.sanitize(transcriptHtml((await cache.read(key))!));
 expect(readPlayerCues(holder.querySelector('.transcript')!)[0].words).toEqual(words);
});
it.each(['youtube','bilibili','native'] as const)('highlights measured Chinese words on %s and rewinds them on seek',async kind=>{
 state.models=[];const {article,clock}=setup(kind);cleanup();
 const words=[{start:0,end:.8,text:'你'},{start:1,end:2,text:'好'}];
 article.querySelector<HTMLElement>('[data-player-cues]')!.dataset.playerCues=JSON.stringify([{start:0,end:3,text:'你好！',words}]);
 cleanup=mountPlayerCaptions(article,article.querySelector('.transcript')!,article.querySelector('.player-toggle-group')!);
 clock(1.5);article.querySelector<HTMLButtonElement>('.q-caption-controls button')!.click();await flush();
 const line=article.querySelector<HTMLElement>('.q-caption-text')!;const spans=line.querySelectorAll<HTMLElement>('.q-caption-word');
 expect(line.textContent).toBe('你好！');expect(spans).toHaveLength(2);expect(spans[1].dataset.active).toBe('true');expect(getComputedStyle(spans[1]).color).toBe('rgb(255, 224, 102)');
 clock(.3);expect(spans[0].dataset.active).toBe('true');expect(spans[1].dataset.sung).toBe('false');
 clock(4);expect(line.hidden).toBe(true);expect(state.stream).not.toHaveBeenCalled();
});
it('highlights the original only and does not invent timings for its translation',async()=>{
 const {article,clock}=setup('native');cleanup();
 article.querySelector<HTMLElement>('[data-player-cues]')!.dataset.playerCues=JSON.stringify([{start:0,end:2,text:'Hello world!',words:[{start:0,end:.8,text:'Hello'},{start:1,end:2,text:'world'}]}]);
 cleanup=mountPlayerCaptions(article,article.querySelector('.transcript')!,article.querySelector('.player-toggle-group')!);
 clock(1.5);article.querySelector<HTMLButtonElement>('.q-caption-controls button')!.click();await flush();
 expect(article.querySelectorAll('.q-caption-original .q-caption-word')).toHaveLength(2);
 expect(article.querySelectorAll('.q-caption-text .q-caption-word')).toHaveLength(0);
});
