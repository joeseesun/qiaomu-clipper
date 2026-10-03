// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountLearningNotes, learningSelection, learningTimestamp, LearningNotes } from './learning-composer';
import { createLearningDraft, LearningSource } from './learning-record';
const target = {status:'ready' as const,vault:'Fixture',date:'2026-10-03',relativePath:'Daily/2026-10-03.md',targetToken:'token'};
let notes: LearningNotes;
let source: LearningSource;
let stored: Record<string, any>;
let services: any;
const input=(label:string)=>document.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
const change=(label:string,text:string)=>{input(label).value=text;input(label).dispatchEvent(new Event('input',{bubbles:true}));};
const tick=async()=>{for(let i=0;i<20;i++) await Promise.resolve();};
const click=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!.click();
const select=(selector:string)=>{const node=document.querySelector(selector)!;const range=document.createRange();range.selectNodeContents(node);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);};
beforeEach(()=>{
 document.body.innerHTML='<article><p id="selected">Selected only</p><p>Unselected secret body</p><div class="transcript-segment"><span class="timestamp" data-timestamp="95">1:35</span><p id="subtitle">New subtitle</p></div><iframe src="https://www.youtube.com/embed/abcdefghijk?enablejsapi=1"></iframe></article><aside id="outside">Outside</aside>';
 source={title:'Original',url:'https://example.com/article'};stored={};
 services={createLearningDraft,loadLearningDraft:vi.fn(async(s:LearningSource)=>stored[s.url||'thought']||null),persistLearningDraft:vi.fn(async(d:any,s:LearningSource)=>{stored[s.url||'thought']=structuredClone(d);}),getDailyTarget:vi.fn(async()=>target),saveLearningRecord:vi.fn(async(d:any,t:any)=>{delete stored[d.originSource.url];return {...t,status:'saved',captureId:d.captureId};}),dispatchLearningRecord:vi.fn(async()=>({status:'dispatched'}))};
 notes=mountLearningNotes({doc:document,getSource:()=>source,getHighlights:()=>['<mark>Saved highlight</mark>'],services});document.body.prepend(notes.button);
});
afterEach(()=>{notes.dispose();document.getSelection()?.removeAllRanges();vi.restoreAllMocks();});
it('focuses understanding, shows resolved target, accepts quote only and rejects empty',async()=>{
 await notes.open();expect(document.activeElement).toBe(input('我的理解'));expect(document.querySelector('.learning-target')!.textContent).toContain('Daily/2026-10-03.md');expect(document.querySelector<HTMLButtonElement>('.learning-primary')!.disabled).toBe(true);
 change('原文摘录','Only quote');expect(document.querySelector<HTMLButtonElement>('.learning-primary')!.disabled).toBe(false);click('.learning-primary');await tick();expect(services.saveLearningRecord).toHaveBeenCalledOnce();expect(services.saveLearningRecord.mock.calls[0][0].reflection).toBe('');expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);expect(document.querySelector('.learning-save-notice')!.textContent).toContain('已写入');
});
it('waits for a slow close write before immediately restoring without losing text',async()=>{
 await notes.open();let done!:()=>void;services.persistLearningDraft.mockImplementationOnce((d:any,s:LearningSource)=>new Promise<void>(resolve=>{done=()=>{stored[s.url!]=structuredClone(d);resolve();};}));change('我的理解','Latest unsaved words');await tick();click('[aria-label="关闭并保留草稿"]');const reopened=notes.open();await tick();expect(input('我的理解').disabled).toBe(true);done();await reopened;expect(input('我的理解').value).toBe('Latest unsaved words');
});
it('keeps per-source drafts, clears old readable fields while loading, uses fresh original SPA source',async()=>{
 await notes.open({quote:'A'});change('我的理解','A notes');click('[aria-label="关闭并保留草稿"]');await tick();source={title:'B',url:'https://example.com/b'};const job=notes.open();expect(input('我的理解').value).toBe('');expect(input('原文摘录').value).toBe('');await job;change('我的理解','B notes');click('.learning-primary');await tick();expect(services.saveLearningRecord.mock.calls[0][0].source.url).toBe(source.url);source={title:'A',url:'https://example.com/article'};await notes.open();expect(input('我的理解').value).toBe('A notes');
});
it('edits metadata without changing draft origin and preserves inputs on Escape',async()=>{
 await notes.open({quote:'Quote'});change('来源链接','https://edited.example.com');change('我的理解','Understanding');input('我的理解').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();expect(stored[source.url!].originSource.url).toBe(source.url);expect(stored[source.url!].source.url).toBe('https://edited.example.com');await notes.open();expect(input('我的理解').value).toBe('Understanding');
});
it('separates explicit AI supplement, leaves understanding intact, allows removing AI',async()=>{
 await notes.open({quote:'Quote'});change('我的理解','Mine');await notes.open({aiSupplement:'Chosen existing answer'});expect(input('我的理解').value).toBe('Mine');expect(input('AI 补充').value).toBe('Chosen existing answer');Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='移除 AI 补充')!.click();expect(input('AI 补充').value).toBe('');expect(input('我的理解').value).toBe('Mine');
});
it('requires a second explicit save after target changes and prevents saving during target refresh',async()=>{
 await notes.open({quote:'Quote'});const tomorrow={...target,date:'2026-10-04',relativePath:'Daily/2026-10-04.md'};services.saveLearningRecord.mockResolvedValueOnce({status:'target-changed',target:tomorrow,error:'日期变化，请确认'});click('.learning-primary');await tick();expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);expect(document.querySelector('.learning-target')!.textContent).toContain('2026-10-04');expect(services.saveLearningRecord).toHaveBeenCalledOnce();click('.learning-primary');await tick();expect(services.saveLearningRecord.mock.calls[1][1]).toEqual(tomorrow);
});
it('disables native save when unavailable, requires explicit URI vault, never labels dispatched as saved',async()=>{
 services.getDailyTarget.mockResolvedValue({status:'unavailable',error:'not connected'});await notes.open({quote:'Quote'});expect(document.querySelector<HTMLButtonElement>('.learning-primary')!.disabled).toBe(true);const dispatch=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='发送到 Obsidian（未验证）')!;expect(dispatch.disabled).toBe(true);change('Obsidian 库名','Named vault');dispatch.click();await tick();expect(services.dispatchLearningRecord.mock.calls[0][1]).toBe('Named vault');expect(document.querySelector('.learning-status')!.textContent).toContain('实际写入未验证');expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);expect(services.saveLearningRecord).not.toHaveBeenCalled();
});
it('keeps uncertain drafts and deduplicates local shortcut/double save while busy',async()=>{
 await notes.open({quote:'Quote'});let resolve!:(v:any)=>void;services.saveLearningRecord.mockImplementationOnce(()=>new Promise(r=>resolve=r));input('我的理解').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));click('.learning-primary');await tick();expect(services.saveLearningRecord).toHaveBeenCalledOnce();resolve({status:'unconfirmed',error:'Possibly written'});await tick();expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);expect(stored[source.url!].quote).toBe('Quote');
});
it('offers saved highlights only after expansion and copies only the chosen highlight',async()=>{
 await notes.open();const details=Array.from(document.querySelectorAll('details')).find(d=>d.firstElementChild!.textContent==='从已有高亮选择摘录')!;expect(details.querySelector('button')).toBeNull();details.open=true;details.dispatchEvent(new Event('toggle'));click('.learning-highlight-choice');await tick();expect(input('原文摘录').value).toBe('Saved highlight');expect(input('原文摘录').value).not.toContain('Unselected secret');
});
it('replaces restored subtitle quote and timestamp together only on explicit choice, iframe unchanged',async()=>{
 source={title:'Video',url:'https://www.youtube.com/watch?v=abcdefghijk',kind:'youtube'};stored[source.url!]=createLearningDraft({...source,timestampSeconds:10},{quote:'Old quote'});const frame=document.querySelector('iframe')!,src=frame.src;select('#subtitle');await notes.open({quote:'New subtitle'});expect(input('原文摘录').value).toBe('Old quote');expect(input('视频时间（秒）').value).toBe('10');const replace=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='改用本次选中的摘录')!;replace.click();expect(input('视频时间（秒）').value).toBe('95');expect(input('原文摘录').value).toBe('New subtitle');expect(document.querySelector('iframe')).toBe(frame);expect(frame.src).toBe(src);
});
it('rejects outside selection and absent time rather than fabricating zero',()=>{
 select('#selected');expect(learningSelection(document)).toBe('Selected only');expect(learningTimestamp(document)).toBeUndefined();select('#outside');expect(learningSelection(document)).toBe('');select('#subtitle');expect(learningTimestamp(document)).toBe(95);document.getSelection()!.removeAllRanges();expect(learningTimestamp(document)).toBeUndefined();
});
it('guards Ctrl+Enter while resolving a new target and recovers when resolution fails',async()=>{
 await notes.open({quote:'Quote'});let finish!:(v:any)=>void;services.getDailyTarget.mockImplementationOnce(()=>new Promise(r=>finish=r));Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='重新确认目标')!.click();change('我的理解','Still editing');input('我的理解').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));await tick();expect(services.saveLearningRecord).not.toHaveBeenCalled();expect(document.querySelector<HTMLButtonElement>('.learning-primary')!.disabled).toBe(true);finish(target);await tick();expect(document.querySelector<HTMLButtonElement>('.learning-primary')!.disabled).toBe(false);
});
it('clears a subtitle timestamp when explicitly selecting a highlight without time metadata',async()=>{
 source={title:'Video',url:'https://www.youtube.com/watch?v=abcdefghijk'};select('#subtitle');await notes.open({quote:'Subtitle'});expect(input('视频时间（秒）').value).toBe('95');const details=Array.from(document.querySelectorAll('details')).find(d=>d.firstElementChild!.textContent==='从已有高亮选择摘录')!;details.open=true;details.dispatchEvent(new Event('toggle'));click('.learning-highlight-choice');expect(input('视频时间（秒）').value).toBe('');
});
