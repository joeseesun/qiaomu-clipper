import { beforeEach, expect, it, vi } from 'vitest';
const env = vi.hoisted(() => ({ data: {} as Record<string, unknown>, send: vi.fn() }));
vi.mock('./browser-polyfill', () => ({default:{runtime:{sendMessage:(...args:unknown[])=>env.send(...args)},storage:{local:{get:async(key:string)=>({[key]:env.data[key]}),set:async(value:Record<string,unknown>)=>Object.assign(env.data,value),remove:async(key:string)=>{delete env.data[key];}}}}}));
import { createLearningDraft, loadLearningDraft, persistLearningDraft, serializeLearningRecord, getDailyTarget, saveLearningRecord, dispatchLearningRecord, attachmentMarker, attachmentName, addAttachments, pickAttachments, discardAttachments } from './learning-record';
const source={title:'学习中文🙂',url:'https://example.com/article',kind:'web' as const};
const target={status:'ready' as const,vault:'test-vault',date:'2026-10-03',relativePath:'Daily/2026-10-03.md',targetToken:'a'.repeat(64)};
beforeEach(()=>{env.data={};env.send.mockReset();env.send.mockImplementation(async message=>message.action==='qiaomuLearningDailyTarget'?target:message.action==='qiaomuLearningDispatch'?{status:'dispatched'}:{status:'saved',captureId:message.payload?.captureId,vault:'test-vault',date:target.date,relativePath:target.relativePath});});

it('writes one compact entry: time + source + clickable video time, the user\'s own Markdown intact, untrusted text neutralised',()=>{
 const draft=createLearningDraft({...source,title:'x](javascript:alert(1))<img>',url:'https://www.youtube.com/watch?v=abc12345678',kind:'youtube',timestampSeconds:3725.9},{reflection:'我的 **原话** [[链接]] #标签',quote:'[音乐]\n<script>attack</script> ![[secret]]',aiSupplement:'AI 的补充'});const body=serializeLearningRecord(draft);
 const [head,...rest]=body.split('\n\n');
 expect(head).toMatch(/^#### \d\d:\d\d · \[x\\\]\(javascript:alert\(1\)\)img\]\(https:\/\/www\.youtube\.com\/watch\?v=abc12345678&t=3725\) · \[1:02:05\]\(https:\/\/www\.youtube\.com\/watch\?v=abc12345678&t=3725\)$/);
 expect(rest[0]).toBe('我的 **原话** [[链接]] #标签');
 expect(rest[1]).toBe('> [!quote] 原文摘录\n> [音乐]\n> &lt;script>attack&lt;/script> !\\[\\[secret]]');
 expect(rest[2]).toBe('> [!info] AI 补充（我选择加入）\n> AI 的补充');expect(body).not.toContain('<img>');expect(body).not.toContain('<script>');
});
it('links Bilibili times, labels a plain thought and formats short clocks',()=>{
 const video=serializeLearningRecord(createLearningDraft({title:'B 站',url:'https://www.bilibili.com/video/BV1cSec6tEux/?p=2',timestampSeconds:75},{reflection:'x'}));
 expect(video).toContain('[1:15](https://www.bilibili.com/video/BV1cSec6tEux/?p=2&t=75)');
 expect(serializeLearningRecord(createLearningDraft({title:''},{reflection:'想法'}))).toMatch(/^#### \d\d:\d\d · 随手记\n\n想法$/);
 expect(serializeLearningRecord(createLearningDraft({title:'网页',url:'https://example.com/a',timestampSeconds:9},{reflection:'x'}))).not.toContain('t=9');
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
it('omits the quote and the source link/time from the entry on request, keeps them otherwise',()=>{
 const draft=createLearningDraft({title:'Video',url:'https://www.youtube.com/watch?v=abc12345678',kind:'youtube',timestampSeconds:75},{reflection:'mine',quote:'quoted words'});
 const full=serializeLearningRecord(draft);expect(full).toContain('quoted words');expect(full).toContain('[Video]');
 const bare=serializeLearningRecord({...draft,omit:{quote:true,source:true}});expect(bare).not.toContain('quoted words');expect(bare).not.toContain('youtube');expect(bare.split('\n')[0]).toMatch(/^#### \d\d:\d\d$/);expect(bare).toContain('mine');
 expect(()=>serializeLearningRecord({...draft,reflection:'',omit:{quote:true}})).toThrow();
});
it('shortens a very long source title in the diary link but keeps the full address',()=>{
 const body=serializeLearningRecord(createLearningDraft({title:'长'.repeat(200),url:'https://example.com/a'},{reflection:'x'}));const head=body.split('\n')[0];
 expect(head).toContain('…');expect(head.length).toBeLessThan(110);expect(head).toContain('https://example.com/a');
});
it('ignores zero-width padding in a source title and falls back to the host when nothing visible is left',()=>{
 const pad='\u200b\u2060\u200d\ufeff'.repeat(40);
 const a=serializeLearningRecord(createLearningDraft({title:pad+'手册标题',url:'https://example.com/a'},{reflection:'x'})).split('\n')[0];expect(a).toContain('[手册标题]');
 const b=serializeLearningRecord(createLearningDraft({title:pad,url:'https://example.com/a'},{reflection:'x'})).split('\n')[0];expect(b).toContain('[example.com]');
});

const id1='a'.repeat(32), id2='b'.repeat(32);
const withFiles=(...ids:string[])=>({...createLearningDraft(source,{reflection:'想法'}),attachments:ids.map(id=>({id,name:id.slice(0,3)+'.png',size:10,kind:'image' as const}))});
it('lists each attachment as a marker the helper replaces with the real link, and accepts an attachment-only note',()=>{
 const body=serializeLearningRecord(withFiles(id1,id2));
 expect(body.endsWith(`想法\n\n${attachmentMarker(id1)}\n\n${attachmentMarker(id2)}`)).toBe(true);
 expect(serializeLearningRecord({...createLearningDraft({title:'随手记'}),attachments:withFiles(id1).attachments})).toContain(attachmentMarker(id1));
 expect(()=>serializeLearningRecord(createLearningDraft(source))).toThrow('空记录');
 expect(()=>serializeLearningRecord(withFiles('../../etc'))).toThrow('附件');expect(()=>serializeLearningRecord(withFiles(id1,id1))).toThrow('附件');
 expect(()=>serializeLearningRecord(withFiles(...Array.from({length:21},(_,i)=>String(i).padStart(32,'0'))))).toThrow('附件');
});
it('sends the attachment ids with the frozen entry, and keeps files added after submitting for the next draft',async()=>{
 const draft=withFiles(id1);await persistLearningDraft(draft);let finish!:(v:unknown)=>void;
 env.send.mockImplementation(message=>message.action==='qiaomuLearningSave'?new Promise(resolve=>{finish=()=>resolve({status:'saved',vault:'test-vault',date:'2026-10-03',relativePath:'Daily/2026-10-03.md'});}):Promise.resolve(target));
 const job=saveLearningRecord(draft,target);for(let i=0;i<30;i++)await Promise.resolve();
 expect(env.send.mock.calls.find(([m])=>m.action==='qiaomuLearningSave')![0].payload).toMatchObject({attachments:[id1]});
 await persistLearningDraft({...withFiles(id1,id2),captureId:draft.captureId});finish(undefined);await job;
 const next=await loadLearningDraft(source);expect(next?.attachments?.map(a=>a.id)).toEqual([id2]);expect(next?.captureId).not.toBe(draft.captureId);
});
it('does not send a note with attachments through the URI path',async()=>{
 const draft=withFiles(id1);await persistLearningDraft(draft);
 expect(await dispatchLearningRecord(draft,'vault')).toMatchObject({status:'failed',error:expect.stringContaining('附件')});expect(env.send).not.toHaveBeenCalled();
});
it('names a pasted screenshot like Obsidian does and leaves real names alone',()=>{
 const at=new Date(2026,9,4,9,5,7);
 expect(attachmentName(new File(['x'],'image.png',{type:'image/png'}),0,at)).toBe('Pasted image 20261004-090507.png');
 expect(attachmentName(new File(['x'],'image.jpeg',{type:'image/jpeg'}),1,at)).toBe('Pasted image 20261004-090507-2.jpg');
 expect(attachmentName(new File(['x'],'报告.pdf'),0,at)).toBe('报告.pdf');
});
it('sends small files as bytes and finds a large one again through the helper instead of reading it',async()=>{
 const small=new File(['hello'],'note.txt'),big=new File(['x'],'movie.mp4'),stranger=new File(['x'],'other.zip');Object.defineProperty(big,'size',{value:50*1024*1024});Object.defineProperty(stranger,'size',{value:9*1024*1024});
 env.send.mockImplementation(async message=>{
  const {mode,name}=message.payload;
  if(mode==='bytes')return {ok:true,items:[{id:id1,name,size:5,kind:'other'}]};
  return {ok:true,items:[{id:id2,name:'movie.mp4',size:50*1024*1024,kind:'video',origName:'movie.mp4',origSize:50*1024*1024}]};
 });
 const result=await addAttachments([small,big,stranger],'clipboard');
 expect(result.items.map(i=>i.id)).toEqual([id1,id2]);expect(result.items.every(i=>!('origName' in i))).toBe(true);expect(result.errors).toHaveLength(1);expect(result.errors[0]).toContain('other.zip');
 const calls=env.send.mock.calls.map(([m])=>m.payload);expect(calls.find(c=>c.mode==='local')).toMatchObject({source:'clipboard',names:[{name:'movie.mp4'},{name:'other.zip'}]});
 expect(calls.find(c=>c.mode==='bytes')).toMatchObject({name:'note.txt',data:btoa('hello')});expect(JSON.stringify(calls)).not.toContain('"x"');
 await addAttachments([small],'finder');expect(env.send.mock.calls.filter(([m])=>m.payload.mode==='local')).toHaveLength(1); // a small drop never asks Finder
});
it('reports a missing helper and a cancelled picker without throwing',async()=>{
 env.send.mockRejectedValue(new Error('no helper'));expect(await pickAttachments()).toMatchObject({items:[],errors:[expect.stringContaining('助手')]});
 env.send.mockResolvedValue({ok:false,cancelled:true});expect(await pickAttachments()).toMatchObject({cancelled:true,items:[]});
 env.send.mockClear();discardAttachments([]);expect(env.send).not.toHaveBeenCalled();discardAttachments([id1]);expect(env.send.mock.calls[0][0].payload).toEqual({mode:'discard',ids:[id1]});
});
