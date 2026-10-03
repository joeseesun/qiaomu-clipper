import { beforeEach, expect, it, vi } from 'vitest';
const env = vi.hoisted(() => ({ data: {} as Record<string, unknown>, send: vi.fn() }));
vi.mock('./browser-polyfill', () => ({default:{runtime:{sendMessage:(...args:unknown[])=>env.send(...args)},storage:{local:{get:async(key:string)=>({[key]:env.data[key]}),set:async(value:Record<string,unknown>)=>Object.assign(env.data,value),remove:async(key:string)=>{delete env.data[key];}}}}}));
import { createLearningDraft, loadLearningDraft, persistLearningDraft, serializeLearningRecord, getDailyTarget, saveLearningRecord, dispatchLearningRecord } from './learning-record';
const source={title:'学习中文🙂',url:'https://example.com/article',kind:'web' as const};
const target={status:'ready' as const,vault:'test-vault',date:'2026-10-03',relativePath:'Daily/2026-10-03.md',targetToken:'a'.repeat(64)};
beforeEach(()=>{env.data={};env.send.mockReset();env.send.mockImplementation(async message=>message.action==='qiaomuLearningDailyTarget'?target:message.action==='qiaomuLearningDispatch'?{status:'dispatched'}:{status:'saved',captureId:message.payload?.captureId,vault:'test-vault',date:target.date,relativePath:target.relativePath});});

it('serializes understanding, quote and explicitly supplied AI independently with safe links',()=>{
 const draft=createLearningDraft({...source,title:'x](javascript:alert(1))<img>',url:'https://www.youtube.com/watch?v=abc12345678',kind:'youtube',timestampSeconds:91},{reflection:'我的 **原话**',quote:'[音乐]\n<script>attack</script>',aiSupplement:'AI 的补充'});const body=serializeLearningRecord(draft);
 expect(body).toContain('t=91');expect(body).toContain('**我的理解**');expect(body).toContain('我的 \\*\\*原话\\*\\*');expect(body).toContain('> &lt;script&gt;attack&lt;/script&gt;');expect(body).toContain('**AI 补充（用户选择加入）**');expect(body).not.toContain('<img>');
});
it('accepts thought-only or quote-only and rejects empty, unsafe URLs, invalid time or huge text',()=>{
 expect(serializeLearningRecord(createLearningDraft({title:'随手记'},{reflection:'想法'}))).toContain('想法');expect(serializeLearningRecord(createLearningDraft(source,{quote:'摘录'}))).toContain('摘录');
 expect(()=>serializeLearningRecord(createLearningDraft(source))).toThrow('空记录');
 for(const url of ['javascript:alert(1)','file:///private/x','https://user:secret@example.com'])expect(()=>serializeLearningRecord(createLearningDraft({...source,url},{quote:'x'}))).toThrow();
 expect(()=>serializeLearningRecord(createLearningDraft({...source,timestampSeconds:-1},{quote:'x'}))).toThrow();
 expect(()=>serializeLearningRecord(createLearningDraft(source,{quote:'x'.repeat(4*1024*1024)}))).toThrow('4 MB');
});
it('keeps edited source metadata under the original page draft key',async()=>{
 const draft=createLearningDraft(source,{reflection:'理解'});draft.source={title:'已删除来源'};await persistLearningDraft(draft,source);
 expect((await loadLearningDraft(source))?.source.title).toBe('已删除来源');expect(await loadLearningDraft(draft.source)).toBeNull();
 const result=await saveLearningRecord(draft,target);expect(result.status).toBe('saved');expect(await loadLearningDraft(source)).toBeNull();
});
it('deduplicates a double click and only a native saved response clears the draft',async()=>{
 const draft=createLearningDraft(source,{quote:'selection'});let done!:(value:unknown)=>void;
 env.send.mockImplementation(async message=>message.action==='qiaomuLearningDailyTarget'?target:new Promise(resolve=>done=resolve));
 const a=saveLearningRecord(draft,target),b=saveLearningRecord(draft,target);expect(a).toBe(b);
 for(let i=0;i<15;i++)await Promise.resolve();done({status:'saved',vault:'test-vault',relativePath:target.relativePath,date:target.date});await a;
 expect(env.send.mock.calls.filter(([m])=>m.action==='qiaomuLearningSave')).toHaveLength(1);expect(await loadLearningDraft(source)).toBeNull();
 expect(env.send.mock.calls.some(([m])=>m.action==='qiaomuSubmitClip')).toBe(false);
});
it('freezes uncertain native payload and blocks URI fallback, then retries with the same ID across midnight',async()=>{
 const draft=createLearningDraft(source,{reflection:'我理解了'});let attempt=0;const payloads:unknown[]=[];
 env.send.mockImplementation(async message=>{if(message.action==='qiaomuLearningDailyTarget')return target;payloads.push(message.payload);return ++attempt===1?{status:'unconfirmed'}:{status:'saved',duplicate:true,relativePath:target.relativePath,vault:'test-vault',date:target.date};});
 expect((await saveLearningRecord(draft,target)).status).toBe('unconfirmed');expect(await loadLearningDraft(source)).not.toBeNull();
 expect((await dispatchLearningRecord(draft,'test-vault')).status).toBe('failed');
 expect((await saveLearningRecord(draft,{...target,date:'2026-10-04',targetToken:'b'.repeat(64)})).status).toBe('saved');expect(payloads[0]).toEqual(payloads[1]);
});
it('does not silently write to a changed date or folder and allows a confirmed new target',async()=>{
 const tomorrow={...target,date:'2026-10-04',targetToken:'b'.repeat(64)};env.send.mockImplementation(async m=>m.action==='qiaomuLearningDailyTarget'?tomorrow:{status:'saved',vault:'test-vault',relativePath:tomorrow.relativePath,date:tomorrow.date});
 const draft=createLearningDraft(source,{quote:'a'});const changed=await saveLearningRecord(draft,target);expect(changed.status).toBe('target-changed');expect(changed.target).toEqual(tomorrow);
 expect(env.send.mock.calls.some(([m])=>m.action==='qiaomuLearningSave')).toBe(false);expect((await saveLearningRecord(draft,tomorrow)).status).toBe('saved');
});
it('URI is explicit, has no path parameter, remains unverified and retains the source draft',async()=>{
 const draft=createLearningDraft(source,{quote:'a'});expect((await dispatchLearningRecord(draft,'')).status).toBe('failed');
 const result=await dispatchLearningRecord(draft,'test-vault');expect(result.status).toBe('dispatched');expect(await loadLearningDraft(source)).not.toBeNull();
 const message=env.send.mock.calls[env.send.mock.calls.length-1][0];expect(message.action).toBe('qiaomuLearningDispatch');const url=new URL(message.url);expect(url.protocol).toBe('obsidian:');expect(url.hostname).toBe('daily');expect(url.searchParams.get('vault')).toBe('test-vault');expect(url.searchParams.has('file')).toBe(false);
});
it('unavailable helper never guesses a vault and transport failure retains the draft',async()=>{
 env.send.mockRejectedValue(new Error('not connected'));expect((await getDailyTarget()).status).toBe('unavailable');const draft=createLearningDraft(source,{quote:'a'});expect((await saveLearningRecord(draft,target)).status).toBe('failed');expect(await loadLearningDraft(source)).not.toBeNull();
});

it('times out uncertain native saves without discarding the stable request or falling back to URI',async()=>{
 vi.useFakeTimers();const draft=createLearningDraft(source,{quote:'selection'});
 env.send.mockImplementation(async m=>m.action==='qiaomuLearningDailyTarget'?target:new Promise(()=>{}));
 const job=saveLearningRecord(draft,target);for(let i=0;i<20;i++)await Promise.resolve();await vi.advanceTimersByTimeAsync(30001);
 expect((await job).status).toBe('unconfirmed');expect(await loadLearningDraft(source)).not.toBeNull();expect(env.send.mock.calls.some(([m])=>m.action==='openObsidianUrl')).toBe(false);vi.useRealTimers();
});

it('does not erase a newer source draft or edits made after submitting a record',async()=>{
 const old=createLearningDraft(source,{reflection:'original'});let done!:(v:unknown)=>void;
 env.send.mockImplementation(async m=>m.action==='qiaomuLearningDailyTarget'?target:new Promise(resolve=>done=resolve));
 const job=saveLearningRecord(old,target);for(let i=0;i<30;i++)await Promise.resolve();
 const changed={...old,reflection:'later edit'};await persistLearningDraft(changed,source);
 done({status:'saved',vault:'test-vault',relativePath:target.relativePath,date:target.date});expect((await job).status).toBe('saved');
 const retained=await loadLearningDraft(source);expect(retained?.reflection).toBe('later edit');expect(retained?.captureId).not.toBe(old.captureId);
});
it('does not claim a native saved packet without an actual target receipt is confirmed',async()=>{
 const draft=createLearningDraft(source,{quote:'q'});env.send.mockImplementation(async m=>m.action==='qiaomuLearningDailyTarget'?target:{status:'saved'});
 expect((await saveLearningRecord(draft,target)).status).toBe('unconfirmed');expect(await loadLearningDraft(source)).not.toBeNull();
});
it('does not dispatch the same URI twice or automatically send native after an unverified URI',async()=>{
 const draft=createLearningDraft(source,{quote:'q'});expect((await dispatchLearningRecord(draft,'test-vault')).status).toBe('dispatched');expect((await dispatchLearningRecord(draft,'test-vault')).status).toBe('dispatched');
 expect((await saveLearningRecord(draft,target)).status).toBe('dispatched');expect(env.send.mock.calls.filter(([m])=>m.action==='qiaomuLearningDispatch')).toHaveLength(1);expect(env.send.mock.calls.some(([m])=>m.action==='qiaomuLearningSave')).toBe(false);
});
it('retains a different capture created by another tab while the submitted capture completes',async()=>{
 const old=createLearningDraft(source,{quote:'old'});let done!:(v:unknown)=>void;
 env.send.mockImplementation(async m=>m.action==='qiaomuLearningDailyTarget'?target:new Promise(resolve=>done=resolve));
 const job=saveLearningRecord(old,target);for(let i=0;i<30;i++)await Promise.resolve();const newer=createLearningDraft(source,{reflection:'new'});await persistLearningDraft(newer);
 done({status:'saved',vault:target.vault,relativePath:target.relativePath,date:target.date});await job;expect((await loadLearningDraft(source))?.captureId).toBe(newer.captureId);
});
it('retains an unknown URI response as uncertain so retry cannot duplicate dispatch',async()=>{
 const draft=createLearningDraft(source,{quote:'q'});env.send.mockResolvedValue({});
 expect((await dispatchLearningRecord(draft,'test-vault')).status).toBe('unconfirmed');expect((await dispatchLearningRecord(draft,'test-vault')).status).toBe('unconfirmed');expect(env.send).toHaveBeenCalledTimes(1);
});
