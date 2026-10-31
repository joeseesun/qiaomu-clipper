import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({ search:vi.fn(), images:vi.fn(), download:vi.fn(), source:{key:'image-secret',proxy:''}, web:{enabled:true,provider:'deepseek',keys:{deepseek:'web-secret',brave:''}} }));
vi.mock('./browser-polyfill',()=>({default:{runtime:{id:'own-id'}}}));
vi.mock('./web-search',()=>({loadWebSearch:async()=>state.web,saveWebSearch:vi.fn(),selectedSearchProvider:()=> 'deepseek',searchWeb:(...a:any[])=>state.search(...a),fetchSearchPage:vi.fn()}));
vi.mock('./image-library-sources',()=>({loadUnsplashSource:async()=>state.source,searchUnsplash:(...a:any[])=>state.images(...a),unsplashDownloadUrl:(...a:any[])=>state.download(...a)}));
import { executeChatTool, handleChatToolPort } from './chat-tools-background';
beforeEach(()=>{vi.clearAllMocks();state.source={key:'image-secret',proxy:''};state.images.mockResolvedValue([]);});afterEach(()=>vi.unstubAllGlobals());
it('reports capabilities without credentials and sends configured keys only to adapters',async()=>{
 const signal=new AbortController().signal;
 const caps=await executeChatTool({type:'capabilities'},signal);expect(caps).toMatchObject({web:true,images:true,fetch:true});expect(JSON.stringify(caps)).not.toContain('secret');
 await executeChatTool({type:'search_images',query:'landscape scenery'},signal);expect(state.images.mock.calls[0]).toEqual([state.source,'landscape scenery',1,signal,expect.objectContaining({count:4})]);
 await executeChatTool({type:'search_web',query:'news'},signal);expect(state.search.mock.calls[0]).toEqual(['news',state.web,signal]);
});
it('refuses Chinese queries, invalid URL tools and missing image configuration before network work',async()=>{
 const signal=new AbortController().signal;
 await expect(executeChatTool({type:'search_images',query:'风景图'},signal)).rejects.toThrow('english-image-query-required');
 await expect(executeChatTool({type:'read_web',url:'http://localhost/'},signal)).rejects.toThrow('invalid-tool');
 state.source.key='';await expect(executeChatTool({type:'search_images',query:'landscape'},signal)).rejects.toThrow('unsplash-unconfigured');expect(state.images).not.toHaveBeenCalled();
});
function port(sender:any){let message:any,disconnect:any;return {name:'qiaomu-chat-tool',sender,postMessage:vi.fn(),disconnect:vi.fn(),onMessage:{addListener:(f:any)=>message=f},onDisconnect:{addListener:(f:any)=>disconnect=f},send:(v:any)=>message(v),close:()=>disconnect()};}
it('rejects foreign and incognito senders',()=>{
 for(const sender of [{id:'foreign'},{id:'own-id',tab:{incognito:true}}]){const p=port(sender);handleChatToolPort(p as any);expect(p.disconnect).toHaveBeenCalled();}
});
it('disconnect aborts the owned request, suppresses late results and executes a port only once',async()=>{
 let finish!:(v:any)=>void;state.images.mockImplementation(()=>new Promise(resolve=>finish=resolve));const p=port({id:'own-id'});handleChatToolPort(p as any);
 const work=p.send({type:'search_images',query:'mountains'});await Promise.resolve();await Promise.resolve();expect(state.images).toHaveBeenCalledTimes(1);
 await p.send({type:'search_images',query:'other'});p.close();expect(state.images.mock.calls[0][3].aborted).toBe(true);finish([]);await work;expect(p.postMessage).not.toHaveBeenCalled();
});
