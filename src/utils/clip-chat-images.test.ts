// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stream: vi.fn(), read: vi.fn(), save: vi.fn(), markdown:'' }));
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
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));setUiLanguage(undefined);vi.restoreAllMocks();});

it('keeps one upload entry and no page-image selector even when the article has images', async()=>{
 await mount();
 expect(document.querySelector('.clip-chat-images')).toBeNull();
 expect(document.querySelector('.clip-chat-image-tools')).toBeNull();
 expect(document.querySelectorAll('.clip-chat-composer .clip-chat-attach')).toHaveLength(1);
 expect(document.querySelector('.clip-chat-composer')?.textContent).not.toMatch(/全部图片|仅正文|图片 2\/2/);
 const picker=document.querySelector<HTMLInputElement>('.clip-chat-file-input')!;
 const open=vi.spyOn(picker,'click').mockImplementation(()=>{});
 document.querySelector<HTMLButtonElement>('.clip-chat-attach')!.click();
 expect(open).toHaveBeenCalledOnce();
 expect(state.read).not.toHaveBeenCalled(); expect(state.stream).not.toHaveBeenCalled();
});

it('sends text without fetching or attaching page images and without claiming the model has seen them',async()=>{
 await mount(); await send();
 const request=state.stream.mock.calls[0][0];
 expect(state.read).not.toHaveBeenCalled();
 expect(request.messages.every((m:any)=>!m.images?.length)).toBe(true);
 expect(request.system).toContain('原网页图片未自动提供');
 expect(state.save.mock.calls[0][2].messages[0].imageNumbers).toBeUndefined();
 expect(JSON.stringify(state.save.mock.calls)).not.toContain('base64');
});

it('does not let unavailable page images block ordinary chat',async()=>{
 state.read.mockRejectedValue(new Error('Page images unavailable'));
 await mount(); await send();
 expect(state.stream).toHaveBeenCalledOnce(); expect(state.read).not.toHaveBeenCalled();
 expect(document.querySelector('.is-error')).toBeNull();
 expect(document.querySelector('.is-assistant')?.textContent).toContain('Answer');
});

it('keeps page images out of later questions after the page content changes',async()=>{
 await mount(); await send();
 state.markdown='Updated article ![C](https://site.test/c.png)'; await send('Follow up');
 expect(state.stream).toHaveBeenCalledTimes(2); expect(state.read).not.toHaveBeenCalled();
 expect(state.stream.mock.calls[1][0].messages.every((m:any)=>!m.images?.length)).toBe(true);
 expect(document.querySelector('.clip-chat-images')).toBeNull();
});

it('previews selection inside the composer, removes it and sends only the next selected quote', async () => {
 state.markdown = 'Article text';
 const chat = mountClipChat({getContext:()=>({title:'Article',url:'https://site.test/note',markdown:state.markdown}),getSelection:async()=> 'Quoted passage'});
 chat.toggle(true); await flush();
 document.querySelector<HTMLButtonElement>('[aria-label="引用选中文字"]')!.click(); await flush();
 expect(document.querySelector('.clip-chat-composer .clip-chat-quote')?.textContent).toContain('Quoted passage');
 document.querySelector<HTMLButtonElement>('.clip-chat-quote button')!.click(); await send('First');
 expect(state.stream.mock.calls[0][0].messages[0].content).not.toContain('Quoted passage');
 document.querySelector<HTMLButtonElement>('[aria-label="引用选中文字"]')!.click(); await flush(); await send('Second');
 expect(state.stream.mock.calls[1][0].messages[2].content).toContain('Quoted passage'); chat.destroy();
});
