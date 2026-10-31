// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stream: vi.fn(), save: vi.fn(), status: vi.fn() }));
vi.mock('./storage-utils', () => ({ generalSettings: {providers:[]}, getLocalStorage: async () => undefined, setLocalStorage: vi.fn() }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => [{id:'test',name:'Test'}], streamChat: (...args:unknown[]) => state.stream(...args) }));
vi.mock('./chat-history', () => ({ loadConversations: async () => [], saveConversation: (...args:unknown[]) => {state.save(...args); return Promise.resolve();}, deleteConversation: vi.fn() }));
vi.mock('./clip-bar', () => ({ showClipStatus: (...args:unknown[]) => state.status(...args) }));
import { mountClipChat } from './clip-chat';
const flush = async () => {for(let i=0;i<40;i++) await Promise.resolve();};
beforeEach(() => {document.body.innerHTML='';vi.clearAllMocks();state.stream.mockImplementation(async opts=>opts.onDelta('Verified answer'));});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
it('refreshes source before sending, quotes page selection, and reuses existing model settings',async()=>{
 let context={title:'Page A',url:'https://example.com/a',markdown:'Old text'};
 const chat=mountClipChat({getContext:()=>context,prepareContext:async()=>{context={...context,markdown:'Fresh text'};}});
 chat.toggle(true);await flush();chat.quote('Selected sentence');
 const input=document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;input.value='Explain';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();await flush();
 expect(state.stream).toHaveBeenCalledTimes(1);
 const request=state.stream.mock.calls[0][0];expect(request.system).toContain('Fresh text');expect(request.system).not.toContain('Old text');
 expect(request.messages[0].content).toContain('Selected sentence');
 expect(state.save.mock.calls[0][0]).toBe('https://example.com/a');
 expect(document.querySelector('[title=qiaomuChatInsert]')).toBeNull();
});
it('does not send stale context after a page-switch guard rejects; retains the question',async()=>{
 mountClipChat({getContext:()=>({title:'A',url:'https://example.com/a',markdown:'Stale'}),prepareContext:async()=>{throw new Error('Page changed');}}).toggle(true);await flush();
 const input=document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!;input.value='Question to keep';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit();await flush();
 expect(state.stream).not.toHaveBeenCalled();expect(input.value).toBe('Question to keep');expect(state.status).toHaveBeenCalledWith('Page changed');
});
it('offers plain chat without claiming page access on restricted pages',async()=>{
 mountClipChat({getContext:()=>({title:'General',url:'chrome://extensions',markdown:'[No page content]',available:false})}).toggle(true);await flush();
 expect(document.querySelector('.clip-chat-context')!.textContent).not.toContain('qiaomuChatContext');
 expect(document.querySelectorAll('.clip-chat-suggestions button')).toHaveLength(0);
 expect(document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.disabled).toBe(false);
});
it('cancels a pending context refresh when starting a new conversation', async () => {
 let resolve!: () => void;
 mountClipChat({getContext:()=>({title:'A',url:'https://example.com/a',markdown:'A'}),prepareContext:()=>new Promise<void>(r=>{resolve=r;})}).toggle(true);
 await flush();
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value='Old conversation question';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit(); await flush();
 document.querySelector<HTMLButtonElement>('[title=qiaomuChatNew]')!.click();
 resolve(); await flush();
 expect(state.stream).not.toHaveBeenCalled();
});
it('destroys the chat and ignores late model deltas after pagehide', async () => {
 let finish!: () => void;
 state.stream.mockImplementation(() => new Promise<void>(r=>{finish=r;}));
 mountClipChat({getContext:()=>({title:'A',url:'https://example.com/a',markdown:'A'})}).toggle(true); await flush();
 document.querySelector<HTMLTextAreaElement>('.clip-chat-composer textarea')!.value='Explain A';
 document.querySelector<HTMLFormElement>('.clip-chat-composer')!.requestSubmit(); await flush();
 const request=state.stream.mock.calls[0][0];
 window.dispatchEvent(new Event('pagehide'));
 expect(request.signal.aborted).toBe(true);
 request.onDelta('Late answer'); finish(); await flush();
 expect(document.querySelector('.clip-chat')).toBeNull();
 expect(document.querySelector('.clip-ask-pill')).toBeNull();
 expect(JSON.stringify(state.save.mock.calls)).not.toContain('Late answer');
});
