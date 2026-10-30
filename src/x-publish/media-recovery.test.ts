import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const engine = readFileSync(process.env.QIAOMU_X_ENGINE_FIXTURE || 'src/x-publish/main-world.js','utf8');
it('does not report a pending media block as an uploaded image, and stops at one bounded deadline', async () => {
 let now=0; const state={}, draft={props:{editorState:{getCurrentContent:()=>state}}};
 const begin=engine.indexOf('  async function uploadImageAtMarker('), end=engine.indexOf('  function replaceMarkerText(',begin);
 const args={ Date:{now:()=>now},throwIfCancelled:()=>{},placeSelectionAtMarker:()=>({blockKey:'marker',offset:0,length:6,exact:true}),sleep:async(ms:number)=>{now+=ms;},
  existingMediaEntities:()=>new Set(),requestPreparedFile:async()=>({base64:'YQ=='}),base64ToFile:()=>({type:'image/png',size:1}),findOnFilesAdded:()=>()=>{},
  MEDIA_UPLOAD_BASE_TIMEOUT_MS:90000,MEDIA_UPLOAD_MAX_TIMEOUT_MS:150000,MEDIA_UPLOAD_PER_ITEM_TIMEOUT_MS:2500,MEDIA_UPLOAD_PROGRESS_HEARTBEAT_MS:15000,
  MEDIA_UPLOAD_PENDING_READY_MS:20000,MEDIA_UPLOAD_PENDING_STABLE_MS:5000,MEDIA_UPLOAD_TIMEOUT_ERROR:'timeout',progress:vi.fn(),findDraftStateNode:()=>draft,
  observeNativeMediaUpload:()=>({status:()=>null,dispose:()=>{}}),findNewMediaUpload:()=>({entityKey:'pending',blockKey:'image',mediaId:null,state:'pending'}),canUsePendingMediaUpload:()=>true };
 const upload=new Function(...Object.keys(args),engine.slice(begin,end)+';return uploadImageAtMarker;')(...Object.values(args));
 const result=await upload(draft,{marker:'one',op:{file:{}}},new Set(),{index:6,total:25});
 expect(result.ok).toBe(false);expect(result.timeout).toBe(true);expect(result.pendingEntity).toBe(true);expect(now).toBeLessThan(91000);
});

function recovery() {
 const state={getBlockMap:()=>new Map()},draft={props:{editorState:{getCurrentContent:()=>state}}};
 const replace=vi.fn(),relocate=vi.fn().mockReturnValue({moved:1}),cleanup=vi.fn().mockReturnValue(2),post=vi.fn();
 const upload=vi.fn().mockResolvedValueOnce({ok:true,entityKey:'image-1',blockKey:'image-1',mediaId:'123',markerBlock:'marker-1'}).mockResolvedValue({ok:false,error:'Upload stalled',timeout:true});
 const args={cancelRequested:false,findDraftStateNode:()=>draft,articleIdFromUrl:()=> '42',requestPreparedFile:async()=>({base64:'YQ=='}),
  applyTitleMetadata:async()=>{},applyTitleGraphqlMetadata:async()=>{},throwIfCancelled:()=>{},progress:vi.fn(),ensureDraftCharacterSample:async()=>draft,
  writeDraftBlocks:()=>({ok:true}),waitForDraftMarkers:async()=>draft,sleep:async()=>{},articleTextBlocks:()=>['Original article'],assertArticleTextPreserved:vi.fn(),
  uploadImageAtMarker:upload,uploadMatchesCover:()=>false,imageOperationKind:()=> 'image',replaceMarkerText:replace,relocateImages:relocate,cleanupMarkers:cleanup,post,
  console:{warn:()=>{}},LOG:'fixture'};
 const begin=engine.indexOf('  async function runFlow('),end=engine.indexOf('  const onMessage =',begin);
 const run=new Function(...Object.keys(args),engine.slice(begin,end)+';return runFlow;')(...Object.values(args));
 const plan=[1,2,3].map(index=>({marker:`marker-${index}`,op:{type:'image',file:{token:`marker-${index}`},fallbackText:`![original](https://fixture/image-${index}.png)`}}));
 return {run,plan,replace,relocate,cleanup,post,upload};
}
it('stops at the first failed upload, retains completed images and replaces remaining placeholders with source links',async()=>{
 const f=recovery();await expect(f.run({plan:f.plan,markerPrefix:'fixture',blocks:[]})).rejects.toThrow('Media 2/3: Upload stalled');
 expect(f.upload).toHaveBeenCalledTimes(2);expect(f.relocate).toHaveBeenCalledWith(expect.anything(),[expect.objectContaining({marker:'marker-1'})],expect.any(Set));
 expect(f.replace.mock.calls.map(call=>call.slice(1))).toEqual([['marker-2','![original](https://fixture/image-2.png)'],['marker-3','![original](https://fixture/image-3.png)']]);
 expect(f.cleanup).toHaveBeenCalledTimes(1);expect(f.post).not.toHaveBeenCalledWith('done',expect.anything());
});
it('bounds a stalled metadata request so it cannot keep the import locked forever',async()=>{
 vi.useFakeTimers();
 try {
  const cancels=new Set<()=>void>();
  const fetch=vi.fn((_url:string,{signal}:{signal:AbortSignal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  const begin=engine.indexOf('  async function xGraphql('),end=engine.indexOf('  function updateTitleGraphql(',begin);
  const args={fetch,AbortController,setTimeout,clearTimeout,pendingNetworkCancels:cancels,GRAPHQL_FEATURES:{},csrfToken:()=> 'fixture',X_BEARER_TOKEN:'fixture'};
  const request=new Function(...Object.keys(args),engine.slice(begin,end)+';return xGraphql;')(...Object.values(args));
  const result=expect(request('fixture','title',{})).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(25000);await result;expect(cancels.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 } finally { vi.useRealTimers(); }
});

it('continues after native GIF/video processing succeeds, with no duplicate upload and hooks disposed',async()=>{
 let now=0,polls=0;const state={},draft={props:{editorState:{getCurrentContent:()=>state}}},dispose=vi.fn(),add=vi.fn();
 const begin=engine.indexOf('  async function uploadImageAtMarker('),end=engine.indexOf('  function replaceMarkerText(',begin);
 const args={Date:{now:()=>now},throwIfCancelled:()=>{},placeSelectionAtMarker:()=>({blockKey:'marker',offset:0,length:6,exact:true}),sleep:async(ms:number)=>{now+=ms;},existingMediaEntities:()=>new Set(),requestPreparedFile:async()=>({base64:'YQ=='}),base64ToFile:()=>({type:'image/gif',size:1}),findOnFilesAdded:()=>add,observeNativeMediaUpload:()=>({status:()=>++polls<3?{state:'processing',progress:60}:{state:'ready',mediaId:'2112743253263155200'},dispose}),MEDIA_UPLOAD_BASE_TIMEOUT_MS:90000,MEDIA_UPLOAD_PROGRESS_HEARTBEAT_MS:15000,MEDIA_UPLOAD_TIMEOUT_ERROR:'timeout',progress:vi.fn(),findDraftStateNode:()=>draft,findNewMediaUpload:()=>({entityKey:'new',blockKey:'video-block',state:'pending',mediaId:null})};
 const upload=new Function(...Object.keys(args),engine.slice(begin,end)+';return uploadImageAtMarker;')(...Object.values(args));
 const result=await upload(draft,{marker:'gif'},new Set(),{index:22,total:25});
 expect(result).toMatchObject({ok:true,blockKey:'video-block',mediaId:'2112743253263155200'});expect(add).toHaveBeenCalledOnce();expect(dispose).toHaveBeenCalledOnce();expect(polls).toBe(3);
});
