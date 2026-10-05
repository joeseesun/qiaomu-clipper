// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const env=vi.hoisted(()=>({store:{} as Record<string,unknown>,listeners:[] as Function[],get:vi.fn(),send:vi.fn().mockResolvedValue(true)}));
vi.mock('./utils/browser-polyfill',()=>({default:{}}));
vi.mock('./utils/podcast-feed',()=>({webKey:async(url:string)=>'web:'+url.match(/\d+$/)?.[0]?.padStart(12,'0')}));
vi.mock('./utils/asr-client',()=>({registerWebSource:vi.fn()}));
vi.mock('./utils/bar-generation',()=>({createBarGeneration:()=>({reset:vi.fn(),sync:vi.fn(),markGenerated:vi.fn(),actions:{request:vi.fn()}})}));
beforeEach(()=>{
	vi.useFakeTimers();vi.resetModules();document.body.innerHTML='<video></video>';delete window.qiaomuWebLoaded;
	env.store={};env.listeners=[];env.send.mockClear();env.get.mockImplementation(async(key:string)=>({[key]:env.store[key]}));
	vi.stubGlobal('chrome',{runtime:{sendMessage:env.send,onMessage:{addListener:vi.fn()}},i18n:{getMessage:()=>''},storage:{local:{get:env.get,set:vi.fn(),remove:vi.fn()},sync:{get:async()=>({general_settings:{}})},onChanged:{addListener:(fn:Function)=>env.listeners.push(fn)}}});
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
