// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({stream:vi.fn(), models:[{id:'model',name:'Model'}]}));
vi.mock('./chat-llm', () => ({enabledChatModels:()=>state.models, streamChat:(...args:unknown[])=>state.stream(...args)}));
vi.mock('./storage-utils', () => ({loadSettings:async()=>{},getLocalStorage:async()=> 'model'}));
vi.mock('./i18n', () => ({getMessage:(key:string)=>key}));
import { translationBatches, parseTranslation, mountTranslation, TRANSLATION_SYSTEM } from './youtube-translation';
import { transcriptText } from './youtube-study';
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
	expect(article.querySelector('.transcript-source-part')!.textContent).toBe('English source');
	expect(transcriptText(article)).toBe('[0:12] English source\n[0:12] Another segment');
	input.click();expect(article.querySelector('.transcript-translation')).toBeNull();
	expect(article.querySelector('.transcript-segment-text')!.textContent).toBe('English source');
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


it('cleans music cues, passes neighboring context and renders short bilingual passages without losing the raw transcript', async () => {
	const original = 'There was a guy [music] I met in Thailand. He worked for Tony Robbins. He said, "Why not me? I will be that guy." And I thought that was a good frame.';
	state.stream.mockImplementation(async options => JSON.stringify(JSON.parse(options.messages[0].content).map((part: {id:number}) => ({id: part.id, text:'我在泰国认识一个人[音乐]。他曾为托尼·罗宾斯工作。\n\n“为什么不能是我？”'}))));
	const { article, input } = setup([original]);
	const before = transcriptText(article); input.click(); await flush();
	const options = state.stream.mock.calls[0][0];
	const request = JSON.parse(options.messages[0].content);
	expect(request.length).toBeGreaterThan(1);
	expect(request.every((part:{text:string}) => !part.text.includes('[music]'))).toBe(true);
	expect(request[0].contextAfter).toContain('Why not me');
	expect(options.system).toBe(TRANSLATION_SYSTEM);
	expect(article.querySelectorAll('.transcript-bilingual-block')).toHaveLength(request.length);
	expect(article.querySelector('.transcript-translation')!.textContent).not.toContain('[音乐]');
	expect(article.querySelectorAll('.transcript-translation p').length).toBe(request.length * 2);
	expect(transcriptText(article)).toBe(before);
	input.click(); expect(transcriptText(article)).toBe(before);
});

it('keeps provider markup inert and never renders it as HTML', async () => {
	state.stream.mockImplementation(async options => JSON.stringify(JSON.parse(options.messages[0].content).map((part:{id:number}) => ({id:part.id,text:'<img src=x onerror=alert(1)>忠实译文。'}))));
	const {article,input}=setup();input.click();await flush();
	expect(article.querySelector('img')).toBeNull();
	expect(article.querySelector('.transcript-translation')!.textContent).toContain('<img');
});
