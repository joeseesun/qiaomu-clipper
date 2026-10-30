// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('the actual main-world dispatcher rejects a second task, scopes cancellation and reuses its listener on reinjection', async () => {
 const listeners=new Set<(event:any)=>void>(),messages:any[]=[];let finish!:()=>void;
 const flow=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const window:any={fixtureFlow:flow,addEventListener:(_type:string,fn:any)=>listeners.add(fn),removeEventListener:(_type:string,fn:any)=>listeners.delete(fn),
  postMessage:(data:any)=>messages.push(data)};
 let script=readFileSync('src/x-publish/main-world.js','utf8');
 script=script.replace('async function runFlow(payload) {','async function originalRunFlow(payload) {').replace('  const onMessage = (event) => {','  const runFlow = window.fixtureFlow;\n  const onMessage = (event) => {');
 const context={window,console:{log:()=>{}},setTimeout,clearTimeout};
 runInNewContext(script,context);runInNewContext(script,context);expect(listeners.size).toBe(1);
 const send=(data:any)=>listeners.forEach(fn=>fn({source:window,data:{source:'qiaomu-write-x-v2',...data}}));
 send({kind:'run',runId:'one',payload:{}});send({kind:'run',runId:'two',payload:{}});
 expect(flow).toHaveBeenCalledTimes(1);expect(messages.find(item=>item.kind==='error')).toMatchObject({runId:'two',code:'busy'});
 const before=messages.length;send({kind:'cancel',runId:'two'});expect(messages).toHaveLength(before);
 send({kind:'cancel',runId:'one'});expect(messages[messages.length-1]).toMatchObject({kind:'progress',runId:'one'});
 finish();for(let i=0;i<10;i++)await Promise.resolve();expect(window.__qiaomuWriteXMainV2.busy()).toBe(false);
 send({kind:'run',runId:'three',payload:{}});expect(flow).toHaveBeenCalledTimes(2);finish();
 for(let i=0;i<10;i++)await Promise.resolve();window.__qiaomuWriteXMainV2.dispose();expect(listeners.size).toBe(0);
});
