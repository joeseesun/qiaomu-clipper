// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stream: vi.fn(), read: vi.fn(), save: vi.fn(), markdown:'', fetched:0 }));
vi.mock('./storage-utils', () => ({ generalSettings:{ providers:[], models:[] },getLocalStorage:async()=>undefined,setLocalStorage:vi.fn() }));
vi.mock('./i18n', () => ({getMessage:(key:string)=>key}));
vi.mock('./chat-llm', () => ({enabledChatModels:()=>[{id:'test',name:'Test'}],streamChat:(...args:unknown[])=>state.stream(...args)}));
vi.mock('./chat-history',()=>({loadConversations:async()=>[],saveConversation:(...args:unknown[])=>state.save(...args),deleteConversation:vi.fn()}));
vi.mock('./clip-bar',()=>({showClipStatus:vi.fn()}));
vi.mock('./chat-images', async importOriginal => {
 const original = await importOriginal<any>();
 return {...original,ChatImageSession:class {clear(){} read(...args:unknown[]){return state.read(...args);}}};
});
import { mountClipChat } from './clip-chat';
import { setUiLanguage } from './ui-text';
const flush = async () => { for(let i=0;i<50;i++) await Promise.resolve(); };
async function mount(){ mountClipChat({getContext:()=>({title:'Article',url:'https://site.test/note',markdown:state.markdown}),onInsert:vi.fn()}).toggle(true); await flush(); }
async function send(text='Explain'){ const input=document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;input.value=text;document.querySelector('form.clip-chat-composer')!.dispatchEvent(new Event('submit',{cancelable:true}));await flush(); }
beforeEach(()=>{
 document.body.innerHTML='<article><img src="https://site.test/a.png"><img src="https://site.test/b.png"></article>';
 state.markdown='![A](https://site.test/a.png)\n![B](https://site.test/b.png)';vi.resetAllMocks();state.save.mockResolvedValue(undefined);setUiLanguage('zh_CN');
 state.read.mockImplementation(async (images:any[],_url:string,_signal:AbortSignal,progress:Function)=>{progress(images.length,0);return {images:images.map(i=>({label:`图 ${i.index}`,dataUrl:'data:image/png;base64,YQ=='})),ready:images.map(i=>i.index),failed:[]};});
 state.stream.mockImplementation(async (options:any)=>{options.onDelta('Answer');return 'Answer';});
});
afterEach(()=>{setUiLanguage(undefined);vi.restoreAllMocks();});

it('opens without reading/uploading, then sends actual images with a question and saves no image bytes', async()=>{
 await mount(); expect(state.read).not.toHaveBeenCalled();expect(state.stream).not.toHaveBeenCalled();
 expect(document.querySelector('.clip-chat-images summary')?.textContent).toBe('图片 2/2');
 await send();
 expect(state.stream.mock.calls[0][0].messages[0].images).toHaveLength(2);
 expect(document.querySelector('.clip-chat-image-status')?.textContent).toContain('已读取 2/2');
 expect(JSON.stringify(state.save.mock.calls)).not.toContain('base64');
 expect(state.save.mock.calls[0][2].messages[0].imageNumbers).toEqual([1,2]);
});

it('asks about one image and keeps that scope on follow-up, while Text only performs no new image read',async()=>{
 await mount(); document.querySelector<HTMLButtonElement>('[aria-label="问图 2"]')!.click(); await send();
 expect(state.read.mock.calls[0][0].map((i:any)=>i.index)).toEqual([2]);
 await send('More details');expect(state.read.mock.calls[1][0].map((i:any)=>i.index)).toEqual([2]);
 expect(state.stream.mock.calls[1][0].messages[2].images[0].label).toBe('图 2');
 Array.from(document.querySelectorAll<HTMLButtonElement>('.clip-chat-image-tools button')).find(b=>b.textContent==='仅正文')!.click();
 await send('Text');expect(state.read).toHaveBeenCalledTimes(2);
 expect(state.stream.mock.calls[2][0].messages.every((m:any)=>!m.images)).toBe(true);
 expect(state.stream.mock.calls[2][0].system).toContain('未提供图片数据');
});

it('exposes missing images to both reader and model and stops if all fail',async()=>{
 await mount(); state.read.mockResolvedValueOnce({images:[{label:'图 2',dataUrl:'data:image/png;base64,YQ=='}],ready:[2],failed:[1]});
 await send();expect(state.stream.mock.calls[0][0].system).toContain('未取得图：1');expect(document.querySelector('.clip-chat-image-status')?.textContent).toContain('未读取：图 1');
 state.read.mockResolvedValueOnce({images:[],ready:[],failed:[1,2]});await send('Try again');
 expect(state.stream).toHaveBeenCalledTimes(1);expect(document.querySelector('.is-error')?.textContent).toContain('未能读取');
 expect(document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value).toBe('Try again');
});

it('does not let a canceled image read pollute a new conversation',async()=>{
 await mount();let resolve!:(value:unknown)=>void;
 state.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await send();document.querySelector<HTMLButtonElement>('[aria-label=qiaomuChatNew]')!.click();
 resolve({images:[{label:'图 1',dataUrl:'data:image/png;base64,YQ=='}],ready:[1],failed:[]});await flush();
 expect(state.stream).not.toHaveBeenCalled();expect(document.querySelectorAll('.clip-chat-message')).toHaveLength(0);
 await send('New');expect(state.stream).toHaveBeenCalledTimes(1);expect(state.stream.mock.calls[0][0].messages).toHaveLength(1);
});
