// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({storage:new Map<string,unknown>(),translate:vi.fn()}));
vi.mock('./clip-preview',()=>({updateClipPreview:vi.fn()}));
vi.mock('./obsidian-note-creator',()=>({generateFrontmatter:async()=>'---\ntitle: Study\n---\n'}));
vi.mock('./storage-utils',()=>({getLocalStorage:async(k:string)=>state.storage.get(k),setLocalStorage:async(k:string,v:unknown)=>{state.storage.set(k,v);}}));
vi.mock('./youtube-translation',()=>({ensureTranscriptTranslation:state.translate}));
import { exportTranscript, mountTranscriptExport, replaceTranscriptExport } from './transcript-export';
import { updateClipPreview, type ClipPreview } from './clip-preview';
beforeEach(()=>{state.storage.clear();state.translate.mockReset();vi.mocked(updateClipPreview).mockClear();});
const setup=()=>{
 document.body.innerHTML='<div id="bar"><button id="clip-bar-clip"></button></div><article><div class="transcript"><h2>Transcript</h2><label class="youtube-translate-toggle"><input type="checkbox"></label><p class="transcript-segment"><strong><span class="timestamp" data-timestamp="3.863">0:03</span></strong> · First source</p><p class="transcript-segment"><strong>0:08</strong> · Second source</p></div></article>';
 const transcript=document.querySelector<HTMLElement>('.transcript')!,segments=Array.from(transcript.querySelectorAll<HTMLElement>('.transcript-segment'));
 const source=exportTranscript(transcript,'https://ted.com/talks/example','original');
 const draft={clip:{url:'https://ted.com/talks/example',title:'Study',markdown:`Description\n\n${source}\n\nAI notes`},local:{requestId:'id',content:'',name:'Study.md',folder:'Clips',vault:'Daily',behavior:'create'},properties:[],transcriptExport:{source,previous:source},native:true,aggregate:false} as ClipPreview;
 const sync=mountTranscriptExport(document.getElementById('bar')!,draft);
 const choose=(mode:string)=>{document.querySelector<HTMLButtonElement>(`.clip-transcript-export [data-value="${mode}"]`)!.click();};
 const complete=()=>segments.forEach((segment,i)=>{segment.dataset.translatedText=['第一段','第二段'][i];segment.dataset.translationReady='true';});
 return {transcript,segments,draft,sync,choose,complete,input:document.querySelector<HTMLInputElement>('input')!};
};
it('defaults to follow manuscript, independent of any player subtitles',async()=>{
 const {draft,sync,complete,input,transcript}=setup();complete();await sync();expect(draft.clip.markdown).not.toContain('第一段');
 input.checked=true;await sync();expect(draft.clip.markdown).toContain('第一段');expect(draft.clip.markdown).toContain('First source');
 expect(transcript.querySelector('.transcript-heading-tools .clip-transcript-export')).not.toBeNull();expect(document.querySelector('#bar .clip-transcript-export')).toBeNull();
 expect(document.querySelector('.clip-transcript-export')?.textContent).toContain('跟随文稿');
});
it('remembers an explicit saving choice without changing the manuscript display or copy/download',async()=>{
 let view=setup();view.complete();view.choose('translated');await view.sync();expect(view.draft.clip.markdown).not.toContain('First source');expect(view.input.checked).toBe(false);
 await view.sync('copy');expect(view.draft.clip.markdown).toContain('First source');expect(view.draft.clip.markdown).not.toContain('第一段');
 view.input.checked=true;await view.sync('download');expect(view.draft.clip.markdown).toContain('First source');expect(view.draft.clip.markdown).toContain('第一段');
 await view.sync();expect(view.draft.clip.markdown).not.toContain('First source');
 view=setup();view.complete();await view.sync();expect(view.draft.clip.markdown).not.toContain('First source');expect(view.input.checked).toBe(false);
});
it('waits for a complete bilingual translation before updating the draft',async()=>{
 const {draft,sync,choose,complete}=setup();choose('bilingual');let release!:()=>void;
 state.translate.mockImplementation(()=>new Promise<void>(resolve=>{release=()=>{complete();resolve();};}));
 const before=draft.clip.markdown,waiting=sync();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(state.translate).toHaveBeenCalledOnce();expect(updateClipPreview).not.toHaveBeenCalled();expect(draft.clip.markdown).toBe(before);
 expect(document.querySelector('.clip-transcript-export [role=status]')?.textContent).toContain('完成后剪藏');
 release();await waiting;expect(draft.clip.markdown).toContain('第一段');expect(draft.clip.markdown).toContain('Second source');expect(draft.local.content).toContain('title: Study');
});
it('stops cancellation, failure and incomplete responses from saving a partial translation',async()=>{
 const {draft,sync,choose}=setup();choose('translated');const before=draft.clip.markdown;
 state.translate.mockRejectedValueOnce(new Error('翻译失败'));await expect(sync()).rejects.toThrow('翻译失败');expect(draft.clip.markdown).toBe(before);expect(updateClipPreview).not.toHaveBeenCalled();
 state.translate.mockResolvedValueOnce(undefined);await expect(sync()).rejects.toThrow('未完成');expect(draft.clip.markdown).toBe(before);
 state.translate.mockImplementation((_track:Element,signal:AbortSignal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('剪藏已取消')))));
 const waiting=sync();await Promise.resolve();await Promise.resolve();document.querySelector<HTMLButtonElement>('.clip-transcript-cancel')!.click();await expect(waiting).rejects.toThrow('已取消');expect(updateClipPreview).not.toHaveBeenCalled();
});
it('saves a Chinese source once without requiring a translation provider',async()=>{
 const {segments,draft,sync,choose}=setup();segments.forEach(segment=>{segment.lastChild!.textContent='已经是中文。';});choose('bilingual');await sync();expect(state.translate).not.toHaveBeenCalled();expect(draft.clip.markdown.match(/已经是中文。/g)).toHaveLength(2);
});
it('keeps translated provider markup inert and exports no live controls',()=>{
 const {transcript,segments}=setup();segments[0].dataset.translatedText='<img src=x onerror=alert(1)>译文';segments[0].dataset.translationReady='true';
 const control=document.createElement('button');control.textContent='Do not export';transcript.append(control);
 const markdown=exportTranscript(transcript,'https://ted.com','bilingual');expect(markdown).not.toContain('Do not export');expect(markdown).not.toContain('剪藏内容');expect(markdown).toContain('\\<img src=x');expect(transcript.querySelector('img')).toBeNull();
});
it('keeps custom templates until translated export is requested, and adds subtitles once',async()=>{
 const {draft,sync,choose,complete}=setup();draft.clip.markdown='Custom metadata only';await sync();expect(draft.clip.markdown).toBe('Custom metadata only');
 complete();choose('bilingual');await sync();await sync();expect(draft.clip.markdown.match(/## 字幕/g)).toHaveLength(1);expect(draft.clip.markdown.match(/第一段/g)).toHaveLength(1);
 expect(replaceTranscriptExport('prefix source suffix','source','next')).toBe('prefix next suffix');
});
it('does not change the draft if persisting its translated version fails',async()=>{
 const {draft,sync,choose,complete}=setup();complete();choose('translated');const before=JSON.stringify(draft);vi.mocked(updateClipPreview).mockRejectedValueOnce(new Error('Conflict'));
 await expect(sync()).rejects.toThrow('Conflict');expect(JSON.stringify(draft)).toBe(before);
});
