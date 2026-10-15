// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const api=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('./browser-polyfill',()=>({default:{runtime:{sendMessage:api.send}}}));
import {downloadWithHelper} from './study-download-native';
const options={sourceUrl:'https://www.bilibili.com/video/BV1xx411c7mD/',mediaUrl:'',title:'Test',video:true};
beforeEach(()=>{vi.useFakeTimers();api.send.mockReset();});
afterEach(()=>{vi.useRealTimers();});
it('polls a full export independently of ASR and reveals only the completed job',async()=>{
 const id='a'.repeat(32),progress=vi.fn();api.send.mockResolvedValueOnce({ok:true,id,state:'downloading',progress:20}).mockResolvedValueOnce({ok:true,id,state:'completed',progress:100}).mockResolvedValue({ok:true});
 const pending=downloadWithHelper(options,new AbortController().signal,progress);await vi.advanceTimersByTimeAsync(801);const result=await pending;
 expect(api.send.mock.calls[0][0]).toEqual({action:'qiaomuAsr',payload:{mode:'downloadStart',url:options.sourceUrl,name:'Test',video:true}});expect(progress).toHaveBeenCalledWith(100,100);result.reveal();expect(api.send).toHaveBeenLastCalledWith({action:'qiaomuAsr',payload:{mode:'downloadReveal',jobId:id}});
});
it('cancels even when the click is aborted while the start response is pending',async()=>{
 let reply!:(value:unknown)=>void;api.send.mockImplementationOnce(()=>new Promise(resolve=>reply=resolve)).mockResolvedValue({ok:true});const controller=new AbortController();
 const pending=downloadWithHelper(options,controller.signal,vi.fn());const failed=expect(pending).rejects.toThrow('已取消');controller.abort();reply({ok:true,id:'b'.repeat(32),state:'queued'});await failed;expect(api.send).toHaveBeenLastCalledWith({action:'qiaomuAsr',payload:{mode:'downloadCancel',jobId:'b'.repeat(32)}});
});
it('reports missing and outdated helpers instead of claiming a completed download',async()=>{
 api.send.mockResolvedValue({ok:false,error:'helper-outdated'});await expect(downloadWithHelper(options,new AbortController().signal,vi.fn())).rejects.toThrow('需要更新');
 api.send.mockRejectedValue(new Error('offline'));await expect(downloadWithHelper(options,new AbortController().signal,vi.fn())).rejects.toThrow('没连上本地助手');
});
