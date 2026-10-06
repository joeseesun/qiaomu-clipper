import { beforeEach, expect, it, vi } from 'vitest';
const tabs=vi.hoisted(()=>vi.fn());
const native=vi.hoisted(()=>vi.fn());
const asrStore=vi.hoisted(()=>({data:{} as Record<string,unknown>}));
vi.mock('./browser-polyfill',()=>({default:{tabs:{create:(...args:unknown[])=>tabs(...args)},runtime:{id:'test-id',getURL:(path:string)=>`chrome-extension://test-id/${path}`,sendNativeMessage:(...args:unknown[])=>native(...args)},storage:{local:{get:async(key:string)=>({[key]:asrStore.data[key]}),set:async(value:Record<string,unknown>)=>{Object.assign(asrStore.data,value);}}}}}));
import { handleLearningNativeMessage } from './local-save';
const sender={id:'test-id',url:'chrome-extension://test-id/reader.html'};
beforeEach(()=>{ native.mockReset(); asrStore.data={}; });
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

it('forwards attachment requests to fixed native actions and never lets the page choose a path',async()=>{
 native.mockResolvedValue({ok:true,items:[]});
 await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'pick'}},sender);
 await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'local',source:'clipboard',names:[{name:'a.mp4',size:5}],path:'/etc/passwd'}},sender);
 await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'discard',ids:['a'.repeat(32),'../x']}},sender);
 const bodies=native.mock.calls.map(([,body])=>body);
 expect(bodies.map(b=>b.action)).toEqual(['attachPick','attachLocal','attachDiscard']);expect(bodies[1]).toMatchObject({source:'clipboard',names:[{name:'a.mp4',size:5}]});
 expect(JSON.stringify(bodies)).not.toContain('passwd');expect(bodies[2].ids).toEqual(['a'.repeat(32)]);
 expect(await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'rm -rf'}},sender)).toMatchObject({ok:false});
 expect(await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'pick'}},{id:'other',url:'x'})).toMatchObject({status:'failed'});
});
it('says to update the helper when it does not know attachments, and when it is offline',async()=>{
 native.mockResolvedValue({ok:false,error:'x'});expect(await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'pick'}},sender)).toMatchObject({ok:false});
 native.mockRejectedValue(new Error('offline'));expect(await handleLearningNativeMessage({action:'qiaomuLearningAttach',payload:{mode:'pick'}},sender)).toMatchObject({ok:false,error:expect.stringContaining('助手')});
});

import { handleAsrMessage } from './local-save';
it('forwards subtitle-generation requests with checked arguments and explains an old or absent helper', async () => {
 native.mockReset(); native.mockResolvedValue({ok:true,ready:true});
 const KEY='bilibili:BV1hM4m1U7rA:20',ID='a'.repeat(32);
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender);
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,language:'zh',force:true}},sender);
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'poll',jobId:ID,since:7}},sender);
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'cancel',jobId:ID}},sender);
 expect(native.mock.calls.map(([,b])=>b)).toEqual([{action:'asrStatus'},{action:'asrStart',videoKey:KEY,language:'zh',force:true},{action:'asrPoll',jobId:ID,since:7},{action:'asrCancel',jobId:ID}]);
 native.mockClear();
 for (const bad of [{mode:'start',videoKey:'https://evil.example/x'},{mode:'start',videoKey:KEY,language:'xx'},{mode:'poll',jobId:'../../x'},{mode:'cancel'},{mode:'rm'},{}]) expect(await handleAsrMessage({action:'qiaomuAsr',payload:bad},sender)).toMatchObject({ok:false,error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},{id:'other'})).toMatchObject({ok:false,error:'refused'});
 expect(handleAsrMessage({action:'qiaomuLearningSave'},sender)).toBeUndefined();
 native.mockResolvedValue({ok:false,error:'不支持的本地操作'}); expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender)).toMatchObject({error:'helper-outdated'});
 native.mockResolvedValue(undefined); expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender)).toMatchObject({error:'helper-outdated'});
 native.mockRejectedValue(new Error('offline')); expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender)).toMatchObject({error:'helper-offline'});
 native.mockResolvedValue({ok:false,error:'missing',missing:['yt-dlp']}); expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY}},sender)).toMatchObject({error:'missing',missing:['yt-dlp']});
});

it('passes only a known browser name for a borrowed login', async () => {
 native.mockReset(); native.mockResolvedValue({ok:true});
 const KEY='youtube:dbqweBCynuI';
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,cookies:'chrome'}},sender);
 expect(native.mock.calls[0][1]).toMatchObject({action:'asrStart',cookies:'chrome'}); native.mockClear();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY}},sender); expect('cookies' in native.mock.calls[0][1]).toBe(false); native.mockClear();
 for (const bad of ['/etc/passwd','chrome; rm -rf ~','Chrome','', 'chrome:Profile 1']) expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,cookies:bad}},sender)).toMatchObject({error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
});

const cloudSettings={mode:'cloud',provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3-ASR-1.7B',apiKey:'sk-secret',protocol:'openai-transcriptions'};
it('adds the viewer\'s cloud service to a status check and a job, from the background, and says which service it is',async()=>{
 asrStore.data.qiaomuAsrSettings=cloudSettings;native.mockResolvedValue({ok:true,ready:true,engine:'cloud'});
 const status=await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender) as any;
 expect(native.mock.calls[0][1]).toEqual({action:'asrStatus',cloud:true});expect(status).toMatchObject({ok:true,mode:'cloud',cloudLabel:'硅基流动'});expect(JSON.stringify(native.mock.calls[0][1])).not.toContain('sk-secret'); // a status check never carries the key
 native.mockClear();await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI',language:'en'}},sender);
 expect(native.mock.calls[0][1]).toMatchObject({action:'asrStart',videoKey:'youtube:dbqweBCynuI',language:'en',cloudKey:'sk-secret',cloud:{protocol:'openai-transcriptions',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3-ASR-1.7B',timestamps:'none',label:'硅基流动'}});
 expect(JSON.stringify(native.mock.calls[0][1].cloud)).not.toContain('sk-secret'); // the key is its own field, never inside the description of the service
});
it('uses the local Whisper unless the viewer chose a cloud service, and does not guess a half-filled one',async()=>{
 native.mockResolvedValue({ok:true,ready:true});
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender)).toMatchObject({mode:'local'});expect(native.mock.calls[0][1]).toEqual({action:'asrStatus'});
 asrStore.data.qiaomuAsrSettings={...cloudSettings,apiKey:''};native.mockClear();
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender)).toEqual({ok:false,error:'cloud-not-configured'});expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender)).toEqual({ok:false,error:'cloud-not-configured'});expect(native).not.toHaveBeenCalled();
 asrStore.data.qiaomuAsrSettings={...cloudSettings,mode:'local'};await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender);expect('cloud' in native.mock.calls[0][1]).toBe(false); // a saved key does nothing while the mode is local
});
it('lets only the extension\'s own page try a key, with a checked description of the service',async()=>{
 native.mockResolvedValue({ok:true,ms:420});const cloud={protocol:'chat-audio',baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.5-asr',timestamps:'none'};const page={id:'test-id',url:'chrome-extension://test-id/settings.html'};
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',cloud,apiKey:' sk-form '}},page)).toMatchObject({ok:true});expect(native.mock.calls[0][1]).toEqual({action:'asrCloudTest',cloud,cloudKey:'sk-form'});native.mockClear();
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',cloud,apiKey:'sk'}},{id:'test-id',url:'https://www.youtube.com/watch?v=x'})).toMatchObject({error:'bad-request'}); // a content script on a web page may not
 for(const bad of [{cloud:{...cloud,baseUrl:'http://evil.example.com'},apiKey:'sk'},{cloud:{...cloud,protocol:'x'},apiKey:'sk'},{cloud:{...cloud,model:'a b'},apiKey:'sk'},{cloud,apiKey:''},{cloud,apiKey:5},{cloud:undefined,apiKey:'sk'}]) expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',...bad as object}},page)).toMatchObject({error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
});

it('reports a recognition service on this computer as such, and passes a piece length only when the service has one',async()=>{
 asrStore.data.qiaomuAsrSettings={mode:'cloud',provider:'custom',baseUrl:'http://127.0.0.1:8000/v1',model:'whisper-1',apiKey:'none',protocol:'openai-transcriptions'};native.mockResolvedValue({ok:true,ready:true});
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status'}},sender)).toMatchObject({mode:'cloud',cloudLabel:'本机服务',cloudLocal:true});
 asrStore.data.qiaomuAsrSettings={mode:'cloud',provider:'glm',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-asr-2512',apiKey:'k',protocol:'openai-transcriptions'};native.mockClear();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender);expect(native.mock.calls[0][1].cloud).toMatchObject({maxChunkSeconds:28,chunkSeconds:18});
 const page={id:'test-id',url:'chrome-extension://test-id/settings.html'};native.mockClear();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',cloud:{protocol:'doubao-flash',baseUrl:'https://openspeech.bytedance.com/api/v3',model:'bigmodel',timestamps:'none'},apiKey:'k'}},page);expect(native.mock.calls[0][1].cloud.protocol).toBe('doubao-flash');
 native.mockClear();expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',cloud:{protocol:'chat-audio',baseUrl:'https://a.example.com/v1',model:'m',maxChunkSeconds:5000},apiKey:'k'}},page)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
});

it('sends a placeholder key for a service on this computer that needs none, and only for one on this computer',async()=>{
 asrStore.data.qiaomuAsrSettings={mode:'cloud',provider:'local',baseUrl:'http://127.0.0.1:8765/v1',model:'Qwen/Qwen3-ASR-0.6B',apiKey:'',protocol:'openai-transcriptions'};native.mockResolvedValue({ok:true});
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender);expect(native.mock.calls[0][1]).toMatchObject({cloudKey:'none',cloud:{label:'本机服务'}});
 const page={id:'test-id',url:'chrome-extension://test-id/settings.html'};native.mockClear();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',cloud:{protocol:'openai-transcriptions',baseUrl:'http://127.0.0.1:8765/v1',model:'m',timestamps:'none'},apiKey:''}},page);expect(native.mock.calls[0][1].cloudKey).toBe('none');native.mockClear();
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'test',cloud:{protocol:'openai-transcriptions',baseUrl:'https://api.example.com/v1',model:'m',timestamps:'none'},apiKey:''}},page)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
});

const multi={mode:'cloud',engine:'auto',active:'b',profiles:[{id:'a',provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3-ASR-1.7B',apiKey:'sk-a',protocol:'openai-transcriptions'},{id:'b',provider:'glm',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-asr-2512',apiKey:'sk-b',protocol:'openai-transcriptions'}]};
it('uses the active one of several saved services, lets a page switch between them by id, and never reveals a key',async()=>{
 asrStore.data.qiaomuAsrSettings=multi;native.mockReset();native.mockResolvedValue({ok:true,ready:true});
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender);
 expect(native.mock.calls[0][1]).toMatchObject({cloudKey:'sk-b',cloud:{label:'智谱'}});native.mockClear();
 const switched=await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',profile:'a'}},sender) as any;
 expect(native.mock.calls[0][1]).toEqual({action:'asrStatus',cloud:true});expect((asrStore.data.qiaomuAsrSettings as any).active).toBe('a');
 expect(switched.choices).toEqual({mode:'cloud',engine:'auto',auto:false,active:'a',profiles:[{id:'a',label:'硅基流动',local:false,configured:true},{id:'b',label:'智谱',local:false,configured:true}]});
 expect(JSON.stringify(switched)).not.toContain('sk-');
 native.mockClear();expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',profile:'nope'}},sender)).toMatchObject({error:'bad-request'});expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose'}},sender)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
});
it('saves a local engine choice and passes it to the helper, leaving "auto" to the helper',async()=>{
 asrStore.data.qiaomuAsrSettings={mode:'cloud',engine:'auto',profiles:[],active:''};native.mockReset();native.mockResolvedValue({ok:true,ready:true,local:[]});
 const picked=await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',engine:'mlx-qwen3'}},sender) as any;
 expect(picked.choices).toMatchObject({mode:'local',engine:'mlx-qwen3'});expect(native.mock.calls[0][1]).toEqual({action:'asrStatus',engine:'mlx-qwen3'});
 native.mockClear();await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender);expect(native.mock.calls[0][1]).toMatchObject({action:'asrStart',engine:'mlx-qwen3'});
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',engine:'auto'}},sender);native.mockClear();await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI'}},sender);expect('engine' in native.mock.calls[0][1]).toBe(false);
 native.mockClear();expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',engine:'rm -rf'}},sender)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
});
it('forwards an install only for a listed engine, polls it by id, and lets only the settings page uninstall',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const ID='c'.repeat(32),page={id:'test-id',url:'https://www.youtube.com/watch?v=x'};
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'install',engine:'mlx-qwen3'}},page);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'install',engine:'base'}},page);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'installPoll',jobId:ID}},page);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'installCancel',jobId:ID}},page);
 expect(native.mock.calls.map(([,b])=>b)).toEqual([{action:'asrInstall',engine:'mlx-qwen3'},{action:'asrInstall',engine:'base'},{action:'asrInstallPoll',jobId:ID},{action:'asrInstallCancel',jobId:ID}]);native.mockClear();
 for(const bad of [{mode:'install',engine:'evil-package'},{mode:'install'},{mode:'uninstall',engine:'base'},{mode:'installPoll',jobId:'../x'}]) expect(await handleAsrMessage({action:'qiaomuAsr',payload:bad},page)).toMatchObject({ok:false,error:expect.stringMatching(/bad-request|refused/)});
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'uninstall',engine:'mlx'}},page)).toMatchObject({error:'refused'});expect(native).not.toHaveBeenCalled();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'uninstall',engine:'mlx',model:true}},sender);expect(native.mock.calls[0][1]).toEqual({action:'asrUninstall',engine:'mlx',model:true});
});

it('takes a chosen file from the extension\'s own pages only, in checked pieces',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const page={id:'test-id',url:'https://www.xiaoyuzhoufm.com/episode/x'},ID='d'.repeat(32);
 for(const mode of ['uploadStart','uploadChunk','uploadFinish']) expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode,name:'a.mp3',size:5,uploadId:ID,index:0,data:'AAAA'}},page)).toMatchObject({error:'refused'});
 expect(native).not.toHaveBeenCalled();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'uploadStart',name:'a.mp3',size:5}},sender);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'uploadChunk',uploadId:ID,index:0,data:'AAAA'}},sender);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'uploadFinish',uploadId:ID}},sender);
 expect(native.mock.calls.map(([,b])=>b)).toEqual([{action:'asrUploadStart',name:'a.mp3',size:5},{action:'asrUploadChunk',uploadId:ID,index:0,data:'AAAA'},{action:'asrUploadFinish',uploadId:ID}]);native.mockClear();
 for(const bad of [{mode:'uploadStart',name:5,size:5},{mode:'uploadStart',name:'a.mp3',size:'5'},{mode:'uploadChunk',uploadId:'../x',index:0,data:'AA'},{mode:'uploadChunk',uploadId:ID,index:-1.5,data:'AA'},{mode:'uploadChunk',uploadId:ID,index:0,data:'A'.repeat(7*1024*1024)},{mode:'uploadFinish',uploadId:'nope'}]) expect(await handleAsrMessage({action:'qiaomuAsr',payload:bad as never},sender)).toMatchObject({error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
 const KEY='xiaoyuzhou:'+'a'.repeat(24);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY}},sender);await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'file:'+'b'.repeat(32)}},sender);expect(native).toHaveBeenCalledTimes(2);native.mockClear();
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'xiaoyuzhou:short'}},sender)).toMatchObject({error:'bad-request'});
});

it('applies the way of recognising chosen for the video\'s own site, and saves a choice made on a video page for that site only',async()=>{
 asrStore.data.qiaomuAsrSettings={...multi,mode:'local',routes:{bilibili:'cloud:b'}};native.mockReset();native.mockResolvedValue({ok:true,ready:true});
 const YT='youtube:dbqweBCynuI',BV='bilibili:BV1hM4m1U7rA:20';
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:YT}},sender);expect('cloud' in native.mock.calls[0][1]).toBe(false); // YouTube follows the default (local)
 native.mockClear();await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:BV}},sender);expect(native.mock.calls[0][1]).toMatchObject({cloudKey:'sk-b',cloud:{label:'智谱'}}); // Bilibili has its own
 native.mockClear();const status=await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status',videoKey:BV}},sender) as any;expect(status.choices).toMatchObject({mode:'cloud',active:'b'});
 const onYoutube=await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',profile:'a',videoKey:YT}},sender) as any;
 expect((asrStore.data.qiaomuAsrSettings as any).routes).toEqual({bilibili:'cloud:b',youtube:'cloud:a'});expect((asrStore.data.qiaomuAsrSettings as any).mode).toBe('local'); // the default is untouched
 expect(onYoutube.choices).toMatchObject({mode:'cloud',active:'a'});
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'choose',engine:'mlx'}},sender);expect((asrStore.data.qiaomuAsrSettings as any).engine).toBe('mlx'); // no video: the default changes
 native.mockClear();expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'status',videoKey:'https://evil.example/x'}},sender)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
});

it('lets only the extension\'s own pages start a podcast episode from a feed, with an https feed address, and passes the address on',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const KEY='rss:'+'a'.repeat(12)+':'+'b'.repeat(16),page={id:'test-id',url:'https://www.youtube.com/x'},feed='https://f.example.com/feed';
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,rss:{feed,guid:'g1'}}},page)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
 for(const bad of [undefined,{feed,guid:5},{feed:'http://f.example.com/feed',guid:'g'},{feed:'https://'+'a'.repeat(700),guid:'g'},{feed,guid:'g'.repeat(900)}]) expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,rss:bad as never}},sender)).toMatchObject({error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,rss:{feed,guid:'g1'}}},sender);expect(native.mock.calls[0][1]).toMatchObject({action:'asrStart',videoKey:KEY,rss:{feed,guid:'g1'}});
 native.mockClear();await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:'youtube:dbqweBCynuI',rss:{feed,guid:'g1'}}},sender);expect('rss' in native.mock.calls[0][1]).toBe(false); // only an rss key carries a feed
});

it('lets only the extension\'s own pages start or probe an address on another site, and only over https',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const KEY='web:'+'a'.repeat(12),page={id:'test-id',url:'https://vimeo.com/1'},url='https://vimeo.com/123456';
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'probe',url}},page)).toMatchObject({error:'refused'});expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,web:{url}}},page)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
 for(const bad of [{mode:'probe'},{mode:'probe',url:'http://vimeo.com/1'},{mode:'probe',url:'https://'+'a'.repeat(1600)},{mode:'start',videoKey:KEY},{mode:'start',videoKey:KEY,web:{url:'http://vimeo.com/1'}},{mode:'start',videoKey:KEY,web:{url:5}}]) expect(await handleAsrMessage({action:'qiaomuAsr',payload:bad as never},sender)).toMatchObject({error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'probe',url}},sender);expect(native.mock.calls[0][1]).toEqual({action:'asrProbe',url});
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,web:{url}}},sender);expect(native.mock.calls[1][1]).toMatchObject({action:'asrStart',videoKey:KEY,web:{url}});
});

it('lets a post on X start a job for its own address from the bar on that post, and for no other address',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const post='https://x.com/jack/status/1790000000000000000',other='https://x.com/jack/status/1790000000000000001',KEY='web:'+'a'.repeat(12);
 const onPost={id:'test-id',url:post+'?s=20'},onHome={id:'test-id',url:'https://x.com/home'},elsewhere={id:'test-id',url:'https://example.com/a'};
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,web:{url:post}}},onPost);expect(native.mock.calls[0][1]).toMatchObject({action:'asrStart',videoKey:KEY,web:{url:post}});
 native.mockClear();for(const [page,url] of [[onPost,other],[onHome,post],[elsewhere,post],[elsewhere,'https://example.com/a'],[onPost,'http://x.com/jack/status/1790000000000000000']] as const) expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,web:{url}}},page)).toMatchObject({error:'bad-request'});
 expect(native).not.toHaveBeenCalled();
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'probe',url:post}},onPost)).toMatchObject({error:'refused'}); // the bar needs no probe, and a page may not use it
});

it('passes explicit probe browser selection and rejects invalid values',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const url='https://www.douyin.com/video/123';
 expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'probe',url,cookies:'chrome;bad'}},sender)).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'probe',url,cookies:'chrome'}},sender);expect(native.mock.calls[0][1]).toEqual({action:'asrProbe',url,cookies:'chrome'});
});
it('allows supported-site bars to generate only their current detail item',async()=>{
 native.mockReset();native.mockResolvedValue({ok:true});const url='https://www.douyin.com/video/123',KEY='web:'+'a'.repeat(12);
 await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,web:{url}}},{id:'test-id',url});expect(native.mock.calls[0][1]).toMatchObject({action:'asrStart',web:{url}});
 native.mockClear();expect(await handleAsrMessage({action:'qiaomuAsr',payload:{mode:'start',videoKey:KEY,web:{url}}},{id:'test-id',url:'https://www.douyin.com/video/456'})).toMatchObject({error:'bad-request'});expect(native).not.toHaveBeenCalled();
});
