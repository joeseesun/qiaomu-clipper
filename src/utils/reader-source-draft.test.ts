import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({saved:{lastSelectedVault:'Daily',qiaomuRssEnabled:false,qiaomuNativeConfigured:true},set:vi.fn(),matched:undefined as any,existing:undefined as any,send:vi.fn().mockResolvedValue({ok:true})}));
const base= {id:'default',path:'{{site}}/Clips',vault:'',behavior:'create',noteNameFormat:'{{title}}',noteContentFormat:'{{content}}',properties:[{name:'title',value:'{{title}}'}]};
vi.mock('../managers/template-manager',()=>({loadTemplates:async()=>[base]}));
vi.mock('./triggers',()=>({initializeTriggers:vi.fn(),findMatchingTemplate:async()=>state.matched}));
vi.mock('./storage-utils',()=>({generalSettings:{defaultTemplateId:'default',vaults:['Fallback']},loadSettings:async()=>{}}));
vi.mock('./browser-polyfill',()=>({default:{tabs:{getCurrent:async()=>({id:5})},storage:{local:{get:async()=>state.saved}},runtime:{sendMessage:(...args:unknown[])=>state.send(...args)}}}));
vi.mock('./clip-preview',()=>({updateClipPreview:state.set,loadClipPreview:async()=>state.existing}));
vi.mock('./content-extractor',()=>({initializePageContent:async(_html:unknown,_selection:unknown,_variables:unknown,_url:unknown,_schema:unknown,_full:unknown,_hl:unknown,title:string)=>({currentVariables:{title,site:'YouTube',content:'[0:12] Actual captions'}})}));
vi.mock('./template-compiler',()=>({compileTemplate:async(_tab:unknown,text:string,variables:Record<string,string>)=>text.replace(/\{\{(\w+)\}\}/g,(_match,key)=>variables[key]||'')}));
vi.mock('./obsidian-note-creator',()=>({generateFrontmatter:async()=> '---\nmetadata\n---\n'}));
import { createReaderSourceDraft } from './reader-source-draft';
beforeEach(()=>{vi.clearAllMocks();state.matched=undefined;state.existing=undefined;state.send.mockResolvedValue({ok:true});});

it('builds the same template-backed editable draft and keeps its identity and RSS choice during caption loading',async()=>{
	const session=await createReaderSourceDraft('https://youtube.com/watch?v=dbqweBCynuI','Initial - YouTube');
	const id=session.draft.local.requestId;expect(session.draft.aggregate).toBe(false);session.draft.aggregate=true;
	await session.populate({title:'Actual',content:'Transcript HTML'});
	expect(session.draft.local).toMatchObject({requestId:id,vault:'Daily',folder:'YouTube/Clips',name:'Actual.md',content:'---\nmetadata\n---\n[0:12] Actual captions'});
	expect(session.draft.properties).toEqual([{name:'title',value:'Actual'}]);expect(session.draft.aggregate).toBe(true);
	expect(state.set).toHaveBeenCalledWith(session.draft);
});

it('honors matched template destinations and never changes an installed native save preference when the helper is offline',async()=>{
	state.matched={...base,vault:'Explicit',path:'Videos',behavior:'append-specific'};state.send.mockRejectedValue(new Error('Offline'));
	const session=await createReaderSourceDraft('https://youtube.com/watch?v=dbqweBCynuI','Video');await session.populate({content:'Transcript HTML'});
	expect(session.draft.local).toMatchObject({vault:'Explicit',folder:'Videos',behavior:'append-specific'});expect(session.draft.native).toBe(true);
});

it('retains inserted AI notes when a selected official caption language repopulates the draft', async()=>{
 const session=await createReaderSourceDraft('https://www.ted.com/talks/example','Study');
 await session.populate({title:'First language',content:'Captions'});
 session.draft.readerAppendix='\n\nAI notes kept across language changes\n';
 await session.populate({title:'Second language',content:'New captions'});
 expect(session.draft.local.content).toContain('AI notes kept across language changes');
 await session.populate({title:'Third language',content:'More captions'});
 expect(session.draft.clip.markdown.match(/AI notes kept/g)).toHaveLength(1);
});

it('reuses the edited draft when returning to a media Read page', async()=>{
	const url='https://x.com/example/status/1';
	state.existing={createdAt:Date.now(),aggregate:false,native:true,mediaReadUrl:'reader.html?study=web&url=x',clip:{url,title:'Edited title',markdown:'Edited notes'},local:{requestId:'draft-1',content:'Edited notes',name:'Edited.md',folder:'Clippings',vault:'Daily',behavior:'create'}};
	const session=await createReaderSourceDraft(url,'Original title',{existingId:'draft-1',mediaReadUrl:'reader.html?study=web&url=x'} as any);
	expect(session.draft).toBe(state.existing);
	await session.populate({title:'Fetched again',content:'Fresh transcript'});
	expect(session.draft.clip).toMatchObject({title:'Edited title',markdown:'Edited notes'});
});
