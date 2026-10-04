import { beforeEach, expect, it, vi } from 'vitest';
const tabs=vi.hoisted(()=>vi.fn());
const native=vi.hoisted(()=>vi.fn());
vi.mock('./browser-polyfill',()=>({default:{tabs:{create:(...args:unknown[])=>tabs(...args)},runtime:{id:'test-id',getURL:(path:string)=>`chrome-extension://test-id/${path}`,sendNativeMessage:(...args:unknown[])=>native(...args)}}}));
import { handleLearningNativeMessage } from './local-save';
const sender={id:'test-id',url:'chrome-extension://test-id/reader.html'};
beforeEach(()=>{ native.mockReset(); });
it('rejects other extensions, malformed IDs and unrelated requests without native writes',async()=>{
 expect(await handleLearningNativeMessage({action:'qiaomuLearningDailyTarget'},{id:'other-extension',url:'chrome-extension://other-extension/x.html'})).toMatchObject({status:'failed'});
 expect(await handleLearningNativeMessage({action:'qiaomuLearningSave',payload:{captureId:'../bad'}},sender)).toMatchObject({status:'failed'});
 expect(handleLearningNativeMessage({action:'qiaomuSubmitClip'},sender)).toBeUndefined();expect(native).not.toHaveBeenCalled();
});
it('accepts this extension\'s own quick-note card running inside an ordinary page',async()=>{
 native.mockResolvedValue({status:'ready',vault:'v'});expect(await handleLearningNativeMessage({action:'qiaomuLearningDailyTarget'},{id:'test-id',url:'https://example.com/page'})).toMatchObject({status:'ready'});
});
it('maps old or missing helper responses to an unverified target',async()=>{
 native.mockResolvedValue({ok:false,error:'unknown action'});expect(await handleLearningNativeMessage({action:'qiaomuLearningDailyTarget'},sender)).toMatchObject({status:'unavailable'});
 native.mockRejectedValue(new Error('offline'));expect(await handleLearningNativeMessage({action:'qiaomuLearningDailyTarget'},sender)).toMatchObject({status:'unavailable'});
});
it('deduplicates native requests and preserves uncertainty without a URI or RSS fallback',async()=>{
 let done!:(v:unknown)=>void;native.mockReturnValue(new Promise(resolve=>done=resolve));const request={action:'qiaomuLearningSave',payload:{captureId:'record-123456',content:'thought'}};
 const a=handleLearningNativeMessage(request,sender),b=handleLearningNativeMessage(request,sender);expect(a).toBe(b);await Promise.resolve();expect(native).toHaveBeenCalledTimes(1);
 done({status:'saved'});expect(await a).toMatchObject({status:'saved'});
 native.mockRejectedValue(new Error('response lost'));expect(await handleLearningNativeMessage(request,sender)).toMatchObject({status:'unconfirmed'});
 expect(native.mock.calls.every(([name,body])=>name==='ai.qiaomu.clipper'&&body.action==='saveLearning')).toBe(true);
});
it('dispatches only a safe daily URI in a background tab, never updating the video tab',async()=>{
 tabs.mockResolvedValue({id:9});const url='obsidian://daily?'+new URLSearchParams({vault:'test-vault',append:'true',content:'entry'});
 expect(await handleLearningNativeMessage({action:'qiaomuLearningDispatch',url},sender)).toMatchObject({status:'dispatched'});expect(tabs).toHaveBeenCalledWith({url,active:false});
 expect(await handleLearningNativeMessage({action:'qiaomuLearningDispatch',url:url+'&file=../bad'},sender)).toMatchObject({status:'failed'});
 expect(await handleLearningNativeMessage({action:'qiaomuLearningDispatch',url:'javascript:alert(1)'},sender)).toMatchObject({status:'failed'});
});
it('maps synchronous native transport errors to an uncertain save without fallback',async()=>{
 native.mockImplementation(()=>{throw new Error('sync transport error');});
 expect(await handleLearningNativeMessage({action:'qiaomuLearningSave',payload:{captureId:'record-123456',content:'thought'}},sender)).toMatchObject({status:'unconfirmed'});
});
