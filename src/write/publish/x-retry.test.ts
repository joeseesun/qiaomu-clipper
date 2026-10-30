// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const driver=vi.hoisted(()=>({open:vi.fn(),inject:vi.fn(),connect:vi.fn()}));
vi.mock('../../x-publish/driver',()=>({openComposeTab:driver.open,injectEngine:driver.inject,connect:driver.connect}));
vi.mock('../../utils/browser-polyfill',()=>({default:{tabs:{update:vi.fn()}}}));
vi.mock('../articles',()=>({recordPublish:vi.fn()}));
import { publishToX } from './x';
import type { PublishRequest } from './types';
const ports:any[]=[];
function port() {
 const received:any[]=[],listeners:((m:any)=>void)[]=[],disconnected:(()=>void)[]=[];
 const p={received,disconnect:vi.fn(()=>disconnected.forEach(fn=>fn())),onMessage:{addListener:(fn:any)=>listeners.push(fn)},onDisconnect:{addListener:(fn:any)=>disconnected.push(fn)},
 postMessage:(m:any)=>{received.push(m);if(m.type==='run')queueMicrotask(()=>listeners.forEach(fn=>fn({type:'error',error:'fixture upload stalled'})));},send:(m:any)=>listeners.forEach(fn=>fn(m))};ports.push(p);return p;
}
const button=(text:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(b=>b.textContent===text)!;
const request=()=>({article:{id:'fixture',title:'Fixture',markdown:'Original text',coverImageId:''},markdown:'Original text',onRecorded:vi.fn()} as unknown as PublishRequest);
beforeEach(()=>{ports.length=0;document.body.innerHTML='';vi.clearAllMocks();HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};driver.open.mockResolvedValue(42);driver.inject.mockResolvedValue(undefined);driver.connect.mockImplementation(async()=>port());});
afterEach(()=>{button('关闭')?.click();});
it('does not inject or start writing when stopped while opening the X tab',async()=>{
 let finish!:(id:number)=>void;driver.open.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
 const task=publishToX(request());await vi.waitFor(()=>expect(driver.open).toHaveBeenCalledOnce());button('停止').click();finish(42);await task;
 expect(driver.inject).not.toHaveBeenCalled();expect(driver.connect).not.toHaveBeenCalled();expect(button('重新写入')).toBeTruthy();
});
it('offers a one-click fresh-draft retry after failure and retires the previous connection',async()=>{
 await publishToX(request());expect(button('重新写入')).toBeTruthy();expect(document.querySelector('dialog')?.textContent).toContain('新草稿');
 button('重新写入').click();await vi.waitFor(()=>expect(driver.open).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(ports.length).toBe(2));
 expect(ports[0].disconnect).toHaveBeenCalledOnce();expect(ports[1].received.find((m:any)=>m.type==='run')).toMatchObject({forceNew:true});expect(document.querySelectorAll('dialog')).toHaveLength(1);
 await vi.waitFor(()=>expect(button('重新写入')).toBeTruthy());
});
it('allows the X-page recovery card to request a retry through the still-open owner connection',async()=>{
 await publishToX(request());expect(ports[0].disconnect).not.toHaveBeenCalled();ports[0].send({type:'retry-request'});
 await vi.waitFor(()=>expect(driver.open).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(button('重新写入')).toBeTruthy());
});
it('offers resume for a saved checkpoint and targets the original tab without creating a fresh draft',async()=>{
 const first=port();first.postMessage=(m:any)=>{first.received.push(m);if(m.type==='run')queueMicrotask(()=>first.send({type:'error',error:'stalled',recovery:{completed:20,total:25}}));};driver.connect.mockResolvedValueOnce(first);
 await publishToX(request());expect(button('继续剩余')).toBeTruthy();button('继续剩余').click();
 await vi.waitFor(()=>expect(driver.connect).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(button('重新写入')).toBeTruthy());
 expect(driver.open).toHaveBeenCalledOnce();const next=ports[ports.length-1];expect(next.received.find((m:any)=>m.type==='run')).toMatchObject({resume:true});expect(driver.inject.mock.calls[1][0]).toBe(42);
});
