// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({stream:vi.fn(), models:[{id:'model',name:'Model'}]}));
vi.mock('./chat-llm', () => ({enabledChatModels:()=>state.models, streamChat:(...args:unknown[])=>state.stream(...args)}));
vi.mock('./storage-utils', () => ({loadSettings:async()=>{},getLocalStorage:async()=> 'model'}));
vi.mock('./i18n', () => ({getMessage:(key:string)=>key}));
import { translationBatches, parseTranslation, mountTranslation } from './youtube-translation';
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function setup(texts=['English source','Another segment']) {
	document.body.innerHTML='<article><div class="toolbar"><span role="status"></span></div><div class="youtube transcript"></div></article>';
	const article=document.querySelector('article')!;
	for(const text of texts){const segment=document.createElement('p'); segment.className='transcript-segment'; const strong=document.createElement('strong');strong.textContent='0:12';segment.append(strong,document.createTextNode(text));article.querySelector('.transcript')!.append(segment);}
	mountTranslation(article,article.querySelector('.toolbar')!,article.querySelector('[role=status]')!);
	return {article, input:article.querySelector<HTMLInputElement>('input')!};
}
const response=(options:{messages:{content:string}[]})=>JSON.stringify(JSON.parse(options.messages[0].content).map(({id,text}:{id:number,text:string})=>({id,text:`中文 ${text}`})));
beforeEach(()=>{vi.clearAllMocks();state.models=[{id:'model',name:'Model'}];state.stream.mockImplementation(async options=>response(options));});

it('bounds requests and rejects missing, duplicate or unknown segment identifiers',()=>{
	const batches=translationBatches(['a'.repeat(12000),...Array(20).fill('Text')]);
	expect(batches.every(batch=>batch.length<=8&&batch.reduce((size,item)=>size+item.text.length,0)<=5500)).toBe(true);
	expect(batches.flat().filter(part=>part.segment===0).map(part=>part.text).join('')).toBe('a'.repeat(12000));
	const batch=[{id:0,segment:0,text:'A'},{id:1,segment:1,text:'B'}];
	expect(()=>parseTranslation('[{"id":0,"text":"甲"}]',batch)).toThrow();
	expect(()=>parseTranslation('[{"id":0,"text":"甲"},{"id":0,"text":"乙"}]',batch)).toThrow();
	expect(parseTranslation('```json\n[{"id":1,"text":"乙"},{"id":0,"text":"甲"}]\n```',batch).get(0)).toBe('甲');
});

it('preserves source and timestamps, renders plain text, and reuses translated paragraphs after toggling',async()=>{
	const {article,input}=setup();input.click();await flush();
	expect(article.querySelectorAll('.transcript-translation')).toHaveLength(2);
	expect(article.querySelector('strong')!.textContent).toBe('0:12');
	expect(article.querySelector('.transcript-segment')!.childNodes[1].textContent).toBe('English source');
	input.click();expect(article.querySelector<HTMLElement>('.transcript-translation')!.hidden).toBe(true);
	input.click();await flush();expect(state.stream).toHaveBeenCalledTimes(1);
	expect(article.querySelector<HTMLElement>('.transcript-translation')!.hidden).toBe(false);
});

it('aborts when switched off and ignores a provider response arriving after cancellation',async()=>{
	let resolve!:(text:string)=>void;let options!:Parameters<typeof response>[0]&{signal:AbortSignal};
	state.stream.mockImplementation(value=>{options=value;return new Promise(done=>{resolve=done;});});
	const {article,input}=setup();input.click();await flush();input.click();
	expect(options.signal.aborted).toBe(true);resolve(response(options));await flush();
	expect(article.querySelector('.transcript-translation')).toBeNull();
});

it('retries only failed batches while preserving completed paragraphs',async()=>{
	state.stream.mockImplementationOnce(async options=>response(options)).mockRejectedValueOnce(new Error('Offline'));
	const {article,input}=setup(Array(10).fill('Text'));input.click();await flush();
	expect(article.querySelectorAll('.transcript-translation')).toHaveLength(8);
	const retry=article.querySelector<HTMLButtonElement>('.youtube-translation-retry')!;expect(retry.hidden).toBe(false);retry.click();await flush();
	expect(article.querySelectorAll('.transcript-translation')).toHaveLength(10);
	expect(JSON.parse(state.stream.mock.calls[2][0].messages[0].content)).toHaveLength(2);
});

it('keeps Chinese source unchanged and explains missing model configuration',async()=>{
	state.stream.mockImplementation(async options=>JSON.stringify(JSON.parse(options.messages[0].content)));
	let view=setup(['已经是中文']);view.input.click();await flush();expect(view.article.querySelector('.transcript-translation')).toBeNull();
	state.models=[];view=setup();view.input.click();await flush();expect(view.article.querySelector('[role=status]')!.textContent).toContain('qiaomuTranslationNoModel');
});
