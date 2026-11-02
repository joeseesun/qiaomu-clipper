import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
const engine=readFileSync('src/x-publish/main-world.js','utf8');
const helpers=engine.slice(engine.indexOf('  function existingMediaEntities('),engine.indexOf('  function placeSelectionAtMarker('))+engine.slice(engine.indexOf('  function recoverySignature('),engine.indexOf('  async function runFlow('));
function block(text:string,type='unstyled',entity='') {return {getText:()=>text,getType:()=>type,getCharacterList:()=>({get:()=>({getEntity:()=>entity}),toJS:()=>[],forEach:()=>{}}),findEntityRanges:(_test:any,visit:any)=>{if(entity)visit(0)}};}
class Blocks {constructor(public values:Map<string,any>){}get(key:string){return this.values.get(key)}set(key:string,value:any){return new Blocks(new Map([...this.values,[key,value]]))}forEach(fn:any){this.values.forEach(fn)}has(key:string){return this.values.has(key)}}
function fixture() {
 const mediaId='2112743253263155200';
 let blocks=new Blocks(new Map([['text',block('Original article')],['uploaded',block(' ','atomic','one')],['remaining',block('![original](https://fixture/two.png)')]]));
 const content={getBlockMap:()=>blocks,getEntity:()=>({getType:()=> 'MEDIA',getData:()=>({media_id_string:mediaId})}),set:(_key:string,next:Blocks)=>{blocks=next;return content}};
 const api=new Function(helpers+';return {validateRecovery,recoverySignature,restoreRecoveryMarkers};')();
 const op1={marker:'first',op:{type:'image',file:{token:'media-0'}}},op2={marker:'second',op:{type:'image',file:{token:'media-1'}}};
 const checkpoint={payload:{sourceMarkdown:'source',plan:[op1,op2],blocks:[],markerPrefix:'fixture'},articleId:'42',uploads:[{marker:'first',blockKey:'uploaded',entityKey:'one',mediaId}],protectedAtomicBlocks:new Set(['uploaded']),signature:api.recoverySignature(content),inflight:null,fallbacks:[{key:'remaining',original:block('second'),text:'![original](https://fixture/two.png)'}],expectedArticleText:['Originalarticle'],summary:{imgOk:1,imgFail:1,atomicFail:0,imageErrors:[],cover:{requested:false}}};
 return {api,checkpoint,content,blocks,change:()=>blocks.values.set('text',block('Edited article')),late:()=>blocks.values.set('late',block(' ','atomic','late')),mediaId};
}
it('keeps confirmed uploads and validates the exact draft/source before any resume write',()=>{
 const f=fixture();expect(f.api.validateRecovery(f.checkpoint,'source','42',f.content).completed).toHaveLength(1);
 expect(()=>f.api.validateRecovery(f.checkpoint,'other source','42',f.content)).toThrow('matching upload checkpoint');
 expect(()=>f.api.validateRecovery(f.checkpoint,'source','43',f.content)).toThrow('matching upload checkpoint');
 f.change();expect(()=>f.api.validateRecovery(f.checkpoint,'source','42',f.content)).toThrow('edited');
});
it('does not blindly re-upload a handed-off image when its status is unknown or processing',()=>{
 const f=fixture();f.checkpoint.inflight={handedOff:true,before:{blockKeys:new Set(['uploaded'])},operation:f.checkpoint.payload.plan[1]} as any;
 expect(()=>f.api.validateRecovery(f.checkpoint,'source','42',f.content)).toThrow('uncertain');
});
it('recognizes a late completed current media and skips it, rather than uploading it twice',()=>{
 const f=fixture();f.late();f.checkpoint.inflight={handedOff:true,blockKey:'late',before:{blockKeys:new Set(['uploaded'])},operation:f.checkpoint.payload.plan[1],native:{state:'ready',mediaId:f.mediaId},location:{markerBlock:'remaining'}} as any;
 expect(f.api.validateRecovery(f.checkpoint,'source','42',f.content).resolved).toMatchObject({marker:'second',blockKey:'late',state:'ready'});
});
it('the real resume flow uploads only remaining operations without rewriting the body or metadata',async()=>{
 const f=fixture();let state:any={getCurrentContent:()=>f.content};state.constructor={push:(_state:any)=>state};
 const draft={props:{editorState:state,onChange:(next:any)=>{draft.props.editorState=next}}};
 const write=vi.fn(),metadata=vi.fn(),upload=vi.fn().mockResolvedValue({ok:true,blockKey:'next',entityKey:'next',mediaId:'2112743253263155201',markerBlock:'remaining'}),post=vi.fn();
 const args={...f.api,recovery:f.checkpoint,cancelRequested:false,findDraftStateNode:()=>draft,articleIdFromUrl:()=> '42',throwIfCancelled:()=>{},requestPreparedFile:vi.fn(),applyTitleMetadata:metadata,applyTitleGraphqlMetadata:metadata,writeDraftBlocks:write,progress:vi.fn(),uploadImageAtMarker:upload,assertArticleTextPreserved:vi.fn(),assertImportedMedia:vi.fn(),uploadMatchesCover:()=>false,applyCoverMetadata:vi.fn(),sleep:async()=>{},relocateImages:()=>({moved:1}),cleanupMarkers:()=>0,kickRender:()=>{},post,console:{warn:()=>{}},LOG:'fixture'};
 const code=engine.slice(engine.indexOf('  async function runFlow('),engine.indexOf('  const onMessage ='));
 const run=new Function(...Object.keys(args),code+';return runFlow;')(...Object.values(args));
 await run({resume:true,sourceMarkdown:'source'});
 expect(upload).toHaveBeenCalledOnce();expect(upload.mock.calls[0][1].marker).toBe('second');expect(write).not.toHaveBeenCalled();expect(metadata).not.toHaveBeenCalled();expect(post).toHaveBeenCalledWith('done',expect.anything());
 expect(f.content.getBlockMap().get('text').getText()).toBe('Original article');
});

it('refuses to resume if an already uploaded image has been deleted',()=>{
 const f=fixture();f.blocks.values.delete('uploaded');
 expect(()=>f.api.validateRecovery(f.checkpoint,'source','42',f.content)).toThrow('removed or changed');
});
it('refuses extra manually inserted media instead of treating it as a completed upload',()=>{
 const f=fixture();f.late();
 expect(()=>f.api.validateRecovery(f.checkpoint,'source','42',f.content)).toThrow('draft media changed');
});
it('waits for pending media and permits retry only when that exact item is confirmed failed',()=>{
 const f=fixture();f.late();
 f.content.getEntity=()=>({getType:()=> 'MEDIA',getData:()=>({media_id_string:f.mediaId,processing_info:{state:'in_progress'}})});
 f.checkpoint.inflight={handedOff:true,blockKey:'late',before:{blockKeys:new Set(['uploaded'])},operation:f.checkpoint.payload.plan[1]} as any;
 expect(()=>f.api.validateRecovery(f.checkpoint,'source','42',f.content)).toThrow('still processing');
 (f.checkpoint.inflight as any).failed=true;
 expect(f.api.validateRecovery(f.checkpoint,'source','42',f.content).failedBlockKey).toBe('late');
});
