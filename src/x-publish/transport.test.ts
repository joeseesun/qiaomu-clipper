// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

// Execute the transport functions from the real engines, without opening or writing to X.
const content = readFileSync('src/x-publish/x-content.ts', 'utf8');
const engine = readFileSync('src/x-publish/main-world.js', 'utf8');
function harness(dropFirstRequest = false) {
 const listeners = new Set<(event: any) => void>(); const sent: any[] = [];
 const cancels = new Set<() => void>();
 const window = { setTimeout, clearTimeout,
  addEventListener(_kind: string, fn: (event: any) => void) { listeners.add(fn); },
  removeEventListener(_kind: string, fn: (event: any) => void) { listeners.delete(fn); },
  postMessage(data: any) { sent.push(data); if (dropFirstRequest && data.kind === 'file-request') { dropFirstRequest = false; return; } queueMicrotask(() => { for (const fn of [...listeners]) fn({ source: window, data }); }); },
 };
 const compiled = ts.transpileModule(content.slice(content.indexOf('function runMain('), content.indexOf('const extFor')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const toMain = content.match(/const TO_MAIN = '([^']+)'/)![1], fromMain = content.match(/const FROM_MAIN = '([^']+)'/)![1];
 const run = new Function('window','MAIN_SILENCE_TIMEOUT_MS','FROM_MAIN','TO_MAIN','Cancelled', compiled + '; return runMain;')(window,180000,fromMain,toMain,Error);
 const requestSource = engine.slice(engine.indexOf('  function requestPreparedFile('),engine.indexOf('  function imageSourcesMatch('));
 const request = (runId?: string) => new Function('window','CHANNEL_TO_MAIN','post','setTimeout','clearTimeout','activeRunId','throwIfCancelled','pendingFileCancels', requestSource + '; return requestPreparedFile;')(window,toMain,(kind: string, more: object) => window.postMessage({source:fromMain,kind,runId,...more}),setTimeout,clearTimeout,runId,()=>{},cancels);
 const end = () => sent.filter(item => item.kind === 'run').forEach(item => window.postMessage({source:fromMain,kind:'done',runId:item.runId,summary:{}}));
 return { run, request, sent, end, window, toMain, fromMain, cancels };
}
it('an unrelated stale import cannot reject an image that exists in the current import', async () => {
 const h = harness(); const file = {base64:'YQ==',mime:'image/png',fileName:'fixture.png'};
 const old = h.run({},new Map([['old',file]]),()=>{}), fresh = h.run({},new Map([['fresh',file]]),()=>{});
 const runs = h.sent.filter(item => item.kind === 'run');
 let result: any, error: unknown;
 try { result = await h.request(runs[1].runId)({marker:'fresh',op:{file:{token:'fresh'}}}); } catch (e) { error = e; }
 h.end(); await Promise.all([old,fresh]);
 expect(error).toBeUndefined(); expect(result?.base64).toBe(file.base64);
});
it('retries a lost data request without sending a second upload and removes its timers after receipt', async () => {
 vi.useFakeTimers();
 try {
  const h = harness(true), file = {base64:'YQ=='};
  const done = h.run({},new Map([['fresh',file]]),()=>{}), runId = h.sent.find(item => item.kind === 'run').runId;
  const received = h.request(runId)({marker:'fresh',op:{file:{token:'fresh'}}});
  await vi.advanceTimersByTimeAsync(10000); expect(await received).toEqual(file);
  expect(h.sent.filter(item => item.kind === 'file-request')).toHaveLength(2);
  h.end(); await done; expect(h.cancels.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
 } finally { vi.useRealTimers(); }
});
it('stops an outstanding file wait immediately instead of waiting for its 30-second deadline', async () => {
 const h = harness(); const wait = h.request('one')({marker:'missing',op:{file:{token:'missing'}}});
 const rejected = expect(wait).rejects.toMatchObject({cancelled:true});
 h.cancels.forEach(cancel => cancel()); await rejected; expect(h.cancels.size).toBe(0);
});
it('fails a completely missing data response within its deadline and leaves no outstanding listeners or timers', async () => {
 vi.useFakeTimers();
 try {
  const h=harness(),wait=h.request('one')({marker:'missing',op:{file:{token:'missing'}}});
  const rejected=expect(wait).rejects.toThrow('Prepared image data did not arrive');
  await vi.advanceTimersByTimeAsync(30000);await rejected;expect(h.cancels.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 } finally { vi.useRealTimers(); }
});
it('cancellation removes the file responder immediately instead of leaving a dead task to answer future imports', async () => {
 const h = harness(), controller = new AbortController();
 const done = h.run({},new Map([['old',{base64:'YQ=='}]]),()=>{},controller.signal).catch(() => undefined);
 const runId = h.sent.find(item => item.kind === 'run').runId;
 controller.abort(); await Promise.resolve();
 h.window.postMessage({source:h.fromMain,kind:'file-request',runId,requestId:'late',token:'old'});
 await Promise.resolve(); await Promise.resolve(); h.end(); await done;
 expect(h.sent.filter(item => item.kind === 'file-response' && item.requestId === 'late')).toEqual([]);
});
it('waits for MAIN cleanup acknowledgement before allowing a stopped import to settle', async () => {
 const h=harness(),controller=new AbortController();let settled=false;
 const done=h.run({},new Map(),()=>{},controller.signal).catch(()=>{settled=true});
 const runId=h.sent.find(item=>item.kind==='run').runId;
 controller.abort();await Promise.resolve();expect(settled).toBe(false);
 h.window.postMessage({source:h.fromMain,kind:'cancelled',runId,recovery:{completed:20,total:25}});
 await done;expect(settled).toBe(true);
});
it('reports an unconfirmed stop when MAIN never acknowledges cancellation', async () => {
 vi.useFakeTimers();try {
  const h=harness(),controller=new AbortController();
  const done=h.run({},new Map(),()=>{},controller.signal).catch((error: unknown)=>error);
  controller.abort();await vi.advanceTimersByTimeAsync(10000);expect(await done).toMatchObject({stopUnconfirmed:true});expect(vi.getTimerCount()).toBe(0);
 } finally {vi.useRealTimers();}
});
