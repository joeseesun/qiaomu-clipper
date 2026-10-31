// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stream: vi.fn(), models: [{ id: 'm', name: 'Proxy', providerModelId: 'deepseek-flash' }] }));
vi.mock('./chat-llm', () => ({ enabledChatModels: () => state.models, streamChat: (...args: unknown[]) => state.stream(...args) }));
vi.mock('./storage-utils', () => ({ loadSettings: async () => {}, getLocalStorage: async () => 'm' }));
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: vi.fn() } } }));
vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));
import { mountTranslation, translationBatches } from './youtube-translation';
const flush = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
const texts = (count: number) => Array.from({ length: count }, (_, i) => `Caption ${i}: ` + 'source text '.repeat(10));
const items = (options: any): Array<{id: number; text: string; contextBefore?: string; contextAfter?: string}> => JSON.parse(options.messages[0].content);
const response = (options: any) => JSON.stringify(items(options).map(({id}) => ({id, text: `译文 ${id}`})));
function setup(count: number) {
 document.body.innerHTML = '<article><div class="toolbar"><span role="status"></span></div><div class="youtube transcript"></div></article>';
 const article = document.querySelector('article')!;
 for (const text of texts(count)) { const p = document.createElement('p'); p.className = 'transcript-segment'; p.textContent = text; article.querySelector('.transcript')!.append(p); }
 mountTranslation(article, article.querySelector('.toolbar')!, article.querySelector('[role=status]')!);
 const toggle = article.querySelector<HTMLInputElement>('input')!;
 return { article, toggle };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); state.stream.mockImplementation(async options => response(options)); });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it('fits 824 short cues into 35 requests without changing order or exceeding the text budget', () => {
 const source = texts(824), batches = translationBatches(source);
 expect(batches).toHaveLength(35);
 expect(batches.flat().map(p => p.text)).toEqual(source);
 expect(new Set(batches.flat().map(p => p.id)).size).toBe(824);
 expect(batches.every(b => b.length <= 24 && b.reduce((n,p) => n+p.text.length,0) <= 3500)).toBe(true);
});

it('sends in-batch source only once and retains external context at batch boundaries', async () => {
 const {toggle} = setup(50); toggle.click(); await flush();
 expect(state.stream).toHaveBeenCalledTimes(3);
 const first = items(state.stream.mock.calls[0][0]), second = items(state.stream.mock.calls[1][0]);
 expect(first.slice(0,-1).every(p => !p.contextAfter)).toBe(true);
 expect(first.slice(1).every(p => !p.contextBefore)).toBe(true);
 expect(first[first.length-1].contextAfter).toBe(texts(50)[24].trim());
 expect(second[0].contextBefore).toBe(texts(50)[23].trim());
 expect(state.stream.mock.calls[0][0].reasoningEffort).toBe('none');
});

it('runs at most six network calls and applies out-of-order responses to their original cues', async () => {
 const pending: Array<{options:any; resolve:(s:string)=>void}> = [];
 state.stream.mockImplementation(options => new Promise(resolve => pending.push({options,resolve})));
 const {article,toggle} = setup(180); toggle.click(); await flush();
 expect(pending).toHaveLength(6);
 const sixth = pending[5]; sixth.resolve(response(sixth.options)); await flush();
 expect(pending).toHaveLength(7);
 expect(article.querySelectorAll('.transcript-translation')).toHaveLength(24);
 for (let i = 0; i < pending.length; i++) { pending[i].resolve(response(pending[i].options)); await flush(); }
 expect(article.querySelector('[role=status]')!.textContent).toBe('qiaomuTranslationDone');
 const nodes = Array.from(article.querySelectorAll('.transcript-translation'));
 expect(nodes).toHaveLength(180); expect(nodes.every((node,i) => node.textContent === `译文 ${i}`)).toBe(true);
});

it('reduces active requests after 429 and cancels queued retries without issuing more calls', async () => {
 let active = 0, peakAfterLimit = 0, limited = false;
 state.stream.mockImplementation(options => {
  if (!limited) { limited = true; return Promise.reject(new Error('Proxy 429: limited')); }
  active++; peakAfterLimit = Math.max(peakAfterLimit, active);
  return new Promise<string>((resolve, reject) => {
   const timer = setTimeout(() => { active--; resolve(response(options)); }, 2000);
   options.signal.addEventListener('abort', () => { clearTimeout(timer); active--; reject(new DOMException('Aborted','AbortError')); }, {once:true});
  });
 });
 const {article,toggle} = setup(240); toggle.click(); await flush();
 // The initial wave may already be on the wire; after it drains, retries share the reduced limit.
 await vi.advanceTimersByTimeAsync(2000); peakAfterLimit = active;
 await vi.advanceTimersByTimeAsync(1000);
 expect(peakAfterLimit).toBeLessThanOrEqual(3);
 toggle.click(); await flush(); const calls = state.stream.mock.calls.length;
 await vi.advanceTimersByTimeAsync(10000);
 expect(state.stream).toHaveBeenCalledTimes(calls);
 expect(article.querySelector('.transcript-translation')).toBeNull();
});

it('benchmarks 824 cues with a fixed simulated provider latency, without reusing translations', async () => {
 let active=0, peak=0, inputChars=0, ended=0;
 const start=Date.now();
 state.stream.mockImplementation(options => {
  active++; peak=Math.max(peak,active); inputChars+=options.system.length+options.messages[0].content.length;
  return new Promise(resolve => setTimeout(() => {active--; ended=Date.now()-start; resolve(response(options));},2000));
 });
 const {article,toggle}=setup(824); toggle.click(); await flush(); await vi.runAllTimersAsync();
 expect(article.querySelectorAll('.transcript-translation')).toHaveLength(824);
 const result={requests:state.stream.mock.calls.length,peak,inputChars,simulatedMs:ended};
 process.stdout.write('TRANSLATION_BENCHMARK '+JSON.stringify(result)+'\n');
 expect(result.requests).toBe(35);expect(peak).toBe(6);expect(ended).toBe(12000);
});

it('keeps original neighbor context when recovering non-contiguous missing cues', async () => {
 state.stream.mockImplementationOnce(async options => JSON.stringify(items(options).filter(p => p.id % 2 === 0).map(({id}) => ({id,text:`译文 ${id}`}))));
 const {article,toggle}=setup(6);toggle.click();await flush();
 const retry=items(state.stream.mock.calls[1][0]);
 expect(retry.map(p=>p.id)).toEqual([1,3,5]);
 expect(retry[0].contextBefore).toBe(texts(6)[0].trim());
 expect(retry[0].contextAfter).toBe(texts(6)[2].trim());
 expect(retry[1].contextBefore).toBe(texts(6)[2].trim());
 expect(retry[1].contextAfter).toBe(texts(6)[4].trim());
 expect(article.querySelectorAll('.transcript-translation')).toHaveLength(6);
});

it('finishes every cue after repeated rate limits, with no duplicate accepted translations', async () => {
 let attempts=0, active=0, peakAfterDrain=0;
 state.stream.mockImplementation(options => {
  if(attempts++ < 2)return Promise.reject(new Error('Proxy 429: limited'));
  active++; if(Date.now()>=2000)peakAfterDrain=Math.max(peakAfterDrain,active);
  return new Promise(resolve=>setTimeout(()=>{active--;resolve(response(options));},2000));
 });
 vi.setSystemTime(0);
 const {article,toggle}=setup(240);toggle.click();await flush();await vi.runAllTimersAsync();
 expect(article.querySelectorAll('.transcript-translation')).toHaveLength(240);
 expect(article.querySelector('[role=status]')!.textContent).toBe(''); // completion feedback has expired
 expect(peakAfterDrain).toBe(1);
 expect(state.stream).toHaveBeenCalledTimes(12);
});
