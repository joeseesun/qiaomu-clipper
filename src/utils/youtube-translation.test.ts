// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({stream:vi.fn(), models:[{id:'model',name:'Model'}]}));
vi.mock('./chat-llm', () => ({enabledChatModels:()=>state.models, streamChat:(...args:unknown[])=>state.stream(...args)}));
vi.mock('./storage-utils', () => ({loadSettings:async()=>{},getLocalStorage:async()=> 'model'}));
vi.mock('./i18n', () => ({getMessage:(key:string)=>key}));
import { translationBatches, parseTranslation, mountTranslation, TRANSLATION_SYSTEM } from './youtube-translation';
import { transcriptText } from './youtube-study';
afterEach(()=>vi.useRealTimers());
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


it('retains an original-text selection while switching bilingual paragraphs on and off',async()=>{
 const {article,input}=setup(['Original passage. Second sentence.']);
 const text=article.querySelector('.transcript-segment-text')!.firstChild!;
 const selection=document.getSelection()!;selection.setBaseAndExtent(text,0,text,8);
 input.click();await flush();expect(selection.toString()).toBe('Original');
 input.click();expect(selection.toString()).toBe('Original');
});

it('automatically retries malformed JSON as plain blocks and preserves ordinary quotes and newlines',async()=>{
 state.stream.mockResolvedValueOnce('[\n{"id" broken: 0, "text":"bad"}]').mockImplementationOnce(async options=>JSON.parse(options.messages[0].content).map(({id}:{id:number})=>`<<<TRANSLATION:${id}>>>\n他说："中文引语"\n\n第二段。\n<<<END_TRANSLATION>>>`).join('\n\n'));
 const {article,input}=setup();input.click();await flush();
 expect(state.stream).toHaveBeenCalledTimes(2);expect(article.querySelectorAll('.transcript-translation')).toHaveLength(2);
 expect(article.querySelector('.transcript-translation')!.textContent).toContain('"中文引语"');expect(article.querySelector('[role=status]')!.textContent).toBe('qiaomuTranslationDone');
});
it('bounds format retries, shows no JSON parser details and only retries unfinished batches',async()=>{
 state.stream.mockImplementationOnce(async options=>response(options)).mockResolvedValueOnce('[{"id" broken}]').mockResolvedValueOnce('truncated block');
 const {article,input}=setup(Array(10).fill('Text'));input.click();await flush();
 expect(state.stream).toHaveBeenCalledTimes(3);expect(article.querySelectorAll('.transcript-translation')).toHaveLength(8);
 expect(article.querySelector('[role=status]')!.textContent).toContain('qiaomuTranslationInvalid');expect(article.textContent).not.toContain('JSON at position');
 state.stream.mockImplementation(async options=>response(options));article.querySelector<HTMLButtonElement>('.youtube-translation-retry')!.click();await flush();
 expect(JSON.parse(state.stream.mock.calls[3][0].messages[0].content)).toHaveLength(2);expect(article.querySelectorAll('.transcript-translation')).toHaveLength(10);
});
it('never attaches a fallback translation to a missing, duplicated or foreign cue id',async()=>{
 const {parseTranslationBlocks}=await import('./youtube-translation');const batch=[{id:0,segment:0,text:'A'},{id:1,segment:1,text:'B'}];
 for(const ids of [[0],[0,0],[0,9]])expect(()=>parseTranslationBlocks(ids.map(id=>`<<<TRANSLATION:${id}>>>\n译文\n<<<END_TRANSLATION>>>`).join('\n'),batch)).toThrow('qiaomuTranslationInvalid');
 expect(()=>parseTranslation('[{"id" broken}]',batch)).toThrow('qiaomuTranslationInvalid');
});

it('accepts valid JSON on the recovery request even when a model ignores the block format',async()=>{
 state.stream.mockResolvedValueOnce('broken JSON').mockImplementationOnce(async options=>response(options));
 const {article,input}=setup();input.click();await flush();expect(article.querySelectorAll('.transcript-translation')).toHaveLength(2);
});
it('cancels an in-flight format retry when changing subtitle language and ignores its late response',async()=>{
 let resolve!:(text:string)=>void;let options!:Parameters<typeof response>[0]&{signal:AbortSignal};
 state.stream.mockResolvedValueOnce('broken JSON').mockImplementationOnce(value=>{options=value;return new Promise(done=>{resolve=done;});});
 const {article,input}=setup();input.click();await flush();article.dispatchEvent(new CustomEvent('qiaomu-transcript-replaced'));
 expect(options.signal.aborted).toBe(true);resolve(response(options));await flush();expect(article.querySelector('.transcript-translation')).toBeNull();
});

it('clears the short completion feedback after three seconds while keeping failure feedback actionable',async()=>{
 vi.useFakeTimers();const view=setup();view.input.click();await flush();expect(view.article.querySelector('[role=status]')!.textContent).toBe('qiaomuTranslationDone');
 await vi.advanceTimersByTimeAsync(3000);expect((view.article.querySelector('[role=status]') as HTMLElement).dataset.feedbackState).toBe('leaving');
 await vi.advanceTimersByTimeAsync(200);expect(view.article.querySelector('[role=status]')!.textContent).toBe('');
 state.stream.mockRejectedValue(new Error('Offline'));const failed=setup();failed.input.click();await flush();await vi.advanceTimersByTimeAsync(10000);
 expect(failed.article.querySelector('[role=status]')!.textContent).toContain('qiaomuTranslationError');expect(failed.article.querySelector<HTMLButtonElement>('.youtube-translation-retry')!.hidden).toBe(false);
});
