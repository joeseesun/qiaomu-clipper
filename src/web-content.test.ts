// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const env=vi.hoisted(()=>({store:{} as Record<string,unknown>,listeners:[] as Function[],messages:[] as Function[],get:vi.fn(),send:vi.fn().mockResolvedValue(true)}));
vi.mock('./utils/browser-polyfill',()=>({default:{}}));
vi.mock('./utils/podcast-feed',()=>({webKey:async(url:string)=>'web:'+url.match(/\d+$/)?.[0]?.padStart(12,'0')}));
vi.mock('./utils/asr-client',()=>({registerWebSource:vi.fn()}));
vi.mock('./utils/bar-generation',()=>({createBarGeneration:()=>({reset:vi.fn(),sync:vi.fn(),markGenerated:vi.fn(),actions:{request:vi.fn()}})}));
beforeEach(()=>{
	vi.useFakeTimers();vi.resetModules();document.body.innerHTML='<video></video>';delete window.qiaomuWebLoaded;
	env.store={};env.listeners=[];env.messages=[];env.send.mockClear();env.get.mockImplementation(async(key:string)=>({[key]:env.store[key]}));
	vi.stubGlobal('chrome',{runtime:{sendMessage:env.send,onMessage:{addListener:(fn:Function)=>env.messages.push(fn)}},i18n:{getMessage:()=>''},storage:{local:{get:env.get,set:vi.fn(),remove:vi.fn()},sync:{get:async()=>({general_settings:{}})},onChanged:{addListener:(fn:Function)=>env.listeners.push(fn)}}});
	vi.stubGlobal('location',{href:'https://www.tiktok.com/@maker/video/123'});
	vi.spyOn(HTMLVideoElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:400,bottom:300,width:400,height:300} as DOMRect);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
const flush=async()=>{await vi.advanceTimersByTimeAsync(1000);};
it('mounts one real transcript bar, loads captions, offers study, and clears old captions when SPA item changes',async()=>{
	env.store['qiaomuTranscript2:generated:web:000000000123']={segments:[{time:'0:01',text:'First caption'}]};
	await import('./web-content');await flush();
	expect(document.querySelectorAll('.qiaomu-web-bar')).toHaveLength(1);
	const bar=document.querySelector<HTMLElement>('.qiaomu-yt-bar')!;expect(bar.dataset.state).toBe('ready');bar.querySelector<HTMLButtonElement>('.qiaomu-yt-tool-toggle')!.click();expect(bar.textContent).toContain('First caption');
	const study=Array.from(bar.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='沉浸学习'||b.getAttribute('aria-label')==='Study')!;study.click();expect(env.send).toHaveBeenCalledWith({action:'qiaomuTripleKey',command:'read'});
	vi.stubGlobal('location',{href:'https://www.tiktok.com/@maker/video/456'});await flush();
	expect(document.querySelectorAll('.qiaomu-web-bar')).toHaveLength(1);expect(document.querySelector('.qiaomu-yt-bar')!.textContent).not.toContain('First caption');
	env.listeners[0]({qiaomuStudySites:{newValue:{off:['tiktok']}}},'local');await flush();expect(document.querySelector('.qiaomu-web-bar')).toBeNull();
});
it('never mounts a generic bar on a text-only post or a home feed without an identifiable item',async()=>{
	vi.stubGlobal('location',{href:'https://www.reddit.com/r/test/comments/abc/title'});document.body.innerHTML='<article>Text only</article>';
	await import('./web-content');await flush();expect(document.querySelector('.qiaomu-web-bar')).toBeNull();
	vi.stubGlobal('location',{href:'https://www.tiktok.com/foryou'});document.body.innerHTML='<video></video>';await flush();expect(document.querySelector('.qiaomu-web-bar')).toBeNull();
});

it('uses TED official captions before cached generated text and mounts outside the player',async()=>{
 vi.stubGlobal('location',{href:'https://www.ted.com/talks/example'});
 const data={props:{pageProps:{videoData:{slug:'example',videoPlayerData:{nativeLanguage:'en',languages:[{languageCode:'en',endonym:'English'},{languageCode:'zh-cn',endonym:'中文'}]}},transcriptData:{translation:{language:{internalLanguageCode:'en'},paragraphs:[{cues:[{text:'Official TED subtitle',time:359}]}]}}}}};
 document.body.innerHTML='<main><div class="aspect-video"><video></video></div><h1>Talk</h1></main><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(data)+'</script>';
 env.store['qiaomuTranscript2:generated:web:undefined']={segments:[{time:'0:00',text:'Old generated text'}]};
 await import('./web-content');await flush();
 const host=document.querySelector<HTMLElement>('.qiaomu-web-bar')!;expect(host.classList.contains('is-inline')).toBe(true);expect(host.previousElementSibling).toBe(document.querySelector('.aspect-video'));
 const bar=host.querySelector<HTMLElement>('.qiaomu-yt-bar')!;expect(bar.dataset.state).toBe('ready');bar.querySelector<HTMLButtonElement>('.qiaomu-yt-tool-toggle')!.click();
 expect(bar.textContent).toContain('Official TED subtitle');expect(bar.textContent).not.toContain('Old generated text');expect(bar.querySelector('select')?.querySelectorAll('option')).toHaveLength(2);
});

it.each(['https://x.com/vista8', 'https://x.com/home', 'https://x.com/search?q=video', 'https://x.com/i/lists/123'])('does not mount on X feed %s even with a linked video', async href => {
 vi.stubGlobal('location', {href});
 document.body.innerHTML='<main><article data-testid="tweet"><a href="https://x.com/vista8/status/12345"><time>today</time></a><video></video></article></main>';
 await import('./web-content'); await flush();
 expect(document.querySelector('.qiaomu-x')).toBeNull();
});
it('binds the X detail bar to the matching post and removes it after navigating back to a feed', async () => {
 vi.stubGlobal('location', {href:'https://x.com/vista8/status/45678'});
 document.body.innerHTML='<main><article data-testid="tweet" id="parent"><a href="https://x.com/vista8/status/12345"><time>parent</time></a><video></video></article><article data-testid="tweet" id="detail"><a href="https://x.com/vista8/status/45678"><time>detail</time></a><video></video></article></main>';
 await import('./web-content'); await flush();
 expect(document.querySelector('#detail .qiaomu-x')).not.toBeNull();
 expect(document.querySelector('#parent .qiaomu-x')).toBeNull();
 vi.stubGlobal('location', {href:'https://x.com/vista8'}); await flush();
 expect(document.querySelector('.qiaomu-x')).toBeNull();
});

it('keeps explicit study shortcut media discovery available on an X profile without mounting a toolbar',async()=>{
 vi.stubGlobal('location',{href:'https://x.com/vista8'});
 document.body.innerHTML='<main><article data-testid="tweet"><a href="https://x.com/vista8/status/12345"><time>today</time></a><video></video></article></main>';
 await import('./web-content');await flush();
 const reply=vi.fn();env.messages[0]({action:'qiaomuWebMediaSource'},null,reply);
 expect(reply).toHaveBeenCalledWith(expect.objectContaining({url:'https://x.com/vista8/status/12345'}));
 expect(document.querySelector('.qiaomu-x')).toBeNull();
});

it('places the Xiaohongshu bar inside the current video note and removes it for photos or the feed', async () => {
 const id='6abc2b40000000000a023366',url=`https://www.xiaohongshu.com/explore/${id}`;
 vi.stubGlobal('location',{href:url});
 document.body.innerHTML=`<video id="feed"></video><div class="note-detail-mask" note-id="${id}"><div id="noteContainer" data-type="video"><video></video><div class="interaction-container"><div class="note-scroller"><div class="note-content"><h1 id="detail-title">视频</h1></div><div class="comments-container">评论</div></div></div></div></div>`;
 await import('./web-content');await flush();
 const host=document.querySelector('.qiaomu-web-bar')!;expect(host.parentElement?.className).toBe('note-scroller');expect(host.previousElementSibling?.className).toBe('note-content');
 const reply=vi.fn();env.messages[0]({action:'qiaomuWebMediaSource'},null,reply);expect(reply).toHaveBeenCalledWith(expect.objectContaining({url}));
 document.querySelector('#noteContainer')!.setAttribute('data-type','normal');await flush();expect(document.querySelector('.qiaomu-web-bar')).toBeNull();
 const photoReply=vi.fn();env.messages[0]({action:'qiaomuWebMediaSource'},null,photoReply);expect(photoReply).toHaveBeenCalledWith({url:null,info:undefined});
 vi.stubGlobal('location',{href:'https://www.xiaohongshu.com/explore'});await flush();expect(document.querySelector('.qiaomu-web-bar')).toBeNull();
});
