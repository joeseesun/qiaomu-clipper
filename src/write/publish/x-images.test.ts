// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { toXFile } from './x';
import { fetchRemoteImage } from '../images';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('rejects an empty image before creating an X upload task',async()=>{
 await expect(toXFile(new Blob([],{type:'image/png'}),'empty.png')).rejects.toThrow('图片文件为空');
});
it('bounds a stalled source download and clears its timer',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',(_url:string,{signal}:{signal:AbortSignal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));}));
 const result=expect(fetchRemoteImage('https://fixture/image.png')).rejects.toMatchObject({name:'AbortError'});
 await vi.advanceTimersByTimeAsync(25000);await result;expect(vi.getTimerCount()).toBe(0);
});
it('stops an in-flight source download immediately when the user stops',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',(_url:string,{signal}:{signal:AbortSignal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));}));
 const controller=new AbortController();const result=expect(fetchRemoteImage('https://fixture/image.png',controller.signal)).rejects.toMatchObject({name:'AbortError'});
 controller.abort();await result;expect(vi.getTimerCount()).toBe(0);
});
it('preserves MP4 bytes and MIME without sending a video through image redraw',async()=>{
 const {Blob:NodeBlob}=await import('node:buffer');
 const out=await toXFile(new NodeBlob(['sample mp4 bytes'],{type:'video/mp4'}) as Blob,'demo.mp4');
 expect(out).toMatchObject({mime:'video/mp4',fileName:'demo.mp4',base64:'c2FtcGxlIG1wNCBieXRlcw=='});
});
it('rejects oversized GIFs without silently losing their animation',async()=>{
 const {Blob:NodeBlob}=await import('node:buffer');
 await expect(toXFile(new NodeBlob([new Uint8Array(16*1024*1024)],{type:'image/gif'}) as Blob,'animated.gif')).rejects.toThrow(/GIF/);
});
it('downloads an MP4 through the bounded media reader and retains its bytes for native X upload',async()=>{
 const {Blob:NodeBlob}=await import('node:buffer');vi.stubGlobal('Blob',NodeBlob);
 vi.stubGlobal('fetch',async()=>new Response('mp4 payload',{headers:{'Content-Type':'video/mp4'}}));
 const {fetchRemoteMedia}=await import('../images');const blob=await fetchRemoteMedia('https://fixture/clip.mp4');
 expect(await toXFile(blob,'clip.mp4')).toMatchObject({mime:'video/mp4',base64:'bXA0IHBheWxvYWQ='});
});
it('rejects an oversized remote MP4 before reading its body',async()=>{
 const read=vi.fn();vi.stubGlobal('fetch',async()=>({ok:true,headers:new Headers({'Content-Length':String(33*1024*1024)}),blob:read}));
 const {fetchRemoteMedia}=await import('../images');
 await expect(fetchRemoteMedia('https://fixture/large.mp4')).rejects.toThrow('32MB');expect(read).not.toHaveBeenCalled();
});
