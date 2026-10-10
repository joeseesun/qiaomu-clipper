// Built extension in an isolated profile; public catalogue snapshot and synthetic SSE only.
const {chromium}=require(process.env.QIAOMU_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.QIAOMU_TEST_OUTPUT || '/tmp/qiaomu-opencode';fs.mkdirSync(output,{recursive:true});
const catalogue=JSON.parse(fs.readFileSync(process.env.QIAOMU_TEST_MODELS,'utf8'));
function installFixture(catalogue) {
 const original=globalThis.fetch;globalThis.goCalls=[];
 globalThis.fetch=async(url,init={})=>{
  if(String(url).startsWith('https://opencode.ai/zen/go/v1/')) {
   const headers=Object.fromEntries(new Headers(init.headers).entries());
   globalThis.goCalls.push({url:String(url),headers,method:init.method||'GET'});
   if(String(url).includes('/models'))return new Response(JSON.stringify(catalogue),{headers:{'Content-Type':'application/json'}});
   return new Response('data: {"choices":[{"delta":{"content":"Fixture answer"}}]}\n\ndata: [DONE]\n',{headers:{'Content-Type':'text/event-stream'}});
  }
  return original(url,init);
 };
}
(async()=>{
 const extension=path.resolve('dist_local'),profile=fs.mkdtempSync(path.join(output,'profile-'));
 const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.QIAOMU_EDGE,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1280,height:900}});
 const checks=[],errors=[];
 try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).hostname;
  await context.addInitScript(installFixture,catalogue);await worker.evaluate(installFixture,catalogue);
  await worker.evaluate(async()=>{
   await chrome.storage.local.set({language:'zh_CN',qiaomuChatModel:'fixture-kimi','qiaomuPreview:go-fixture':{createdAt:Date.now(),clip:{url:'https://example.com/go-fixture',title:'OpenCode session fixture',markdown:'Article fixture.'},local:{requestId:'go-fixture',name:'Fixture.md',content:'Article fixture.',folder:'Clips',vault:'Fixture',behavior:'create'},native:false,aggregate:false}});
   await chrome.storage.sync.set({interpreter_settings:{providers:[{id:'fixture-go',presetId:'opencode-go',name:'OpenCode Go',baseUrl:'https://opencode.ai/zen/go/v1/chat/completions',apiKey:'fixture-only-not-a-secret',apiKeyRequired:true}],models:[{id:'fixture-kimi',providerId:'fixture-go',providerModelId:'kimi-k3',name:'Kimi K3',enabled:true}]}});
  });
  let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`chrome-extension://${id}/settings.html?section=interpreter`);
  await page.locator('#add-provider-btn').click();const card=page.locator('#provider-modal .pd-card[aria-label="OpenCode Go"]');await card.waitFor();assert.match(await card.innerText(),/仅显示当前支持的聊天模型/);
  await page.screenshot({path:path.join(output,'provider-picker.png')});await card.click();assert.equal(await page.locator('#pd-url').inputValue(),'https://opencode.ai/zen/go/v1/chat/completions');checks.push('OpenCode Go preset, localized capability note and endpoint render in built settings');
  await page.locator('#provider-modal .pd-actions button').filter({hasText:'取消'}).click();await page.locator('#add-model-btn').click();const chip=page.locator('#model-modal .pd-chip').filter({hasText:'OpenCode Go'});if(await chip.isVisible())await chip.click();await page.locator('#model-modal .pd-model').first().waitFor();
  const models=await page.locator('#model-modal .pd-model').allTextContents();assert.equal(models.length,20);assert(models.some(s=>s.includes('Kimi K3')));assert(!models.some(s=>/minimax|gpt-6-luna|muse-spark|claude-haiku|qwen3\.8/i.test(s)));checks.push('45-model public bare-ID catalogue shows only 20 documented Chat Completions models');
  await page.screenshot({path:path.join(output,'compatible-models.png')});
  await page.goto(`chrome-extension://${id}/reader.html?preview=go-fixture`);await page.locator('#clip-bar-ai').click();await page.locator('.clip-chat-composer textarea:not(:disabled)').waitFor();
  const ask=async text=>{await page.locator('.clip-chat-composer textarea').fill(text);await page.locator('.clip-chat-send').click();await page.locator('.clip-chat-send:not(:disabled)').waitFor();};
  const calls=()=>page.evaluate(()=>goCalls.filter(c=>c.method==='POST'));
  await ask('First question');await ask('Follow-up question');let requests=await calls();assert.equal(requests.length,2);const a=requests[0].headers['x-opencode-session'];assert(a);assert.equal(requests[1].headers['x-opencode-session'],a);checks.push('multi-turn conversation sends one persisted session ID');
  await page.getByRole('button',{name:'新对话',exact:true}).click();await ask('Separate question');requests=await calls();const b=requests[2].headers['x-opencode-session'];assert.notEqual(a,b);checks.push('new conversation uses a distinct session ID');
  await page.getByRole('button',{name:'历史对话',exact:true}).click();await page.locator('.clip-chat-history-open').filter({hasText:'First question'}).click();await ask('History follow-up');requests=await calls();assert.equal(requests[3].headers['x-opencode-session'],a);checks.push('restoring an older conversation restores its session ID');
  await page.reload();await page.locator('#clip-bar-ai').click();await page.locator('.clip-chat-composer textarea:not(:disabled)').waitFor();await ask('Reload follow-up');requests=await calls();assert.equal(requests[0].headers['x-opencode-session'],a);checks.push('reader reload retains the saved conversation session');
  const answer=await page.evaluate(sessionId=>new Promise((resolve,reject)=>{const port=chrome.runtime.connect({name:'qiaomu-study-chat'});port.onMessage.addListener(m=>{if(m.error)reject(Error(m.error));if(m.done){port.disconnect();resolve(true);}});port.postMessage({modelId:'fixture-kimi',system:'fixture',messages:[{role:'user',content:'Background fixture'}],sessionId});}),a);
  assert(answer);const background=await worker.evaluate(()=>goCalls.filter(c=>c.method==='POST'));assert.equal(background[0].headers['x-opencode-session'],a);checks.push('actual background handler forwards persisted session while resolving credentials from settings');
  await page.screenshot({path:path.join(output,'restored-chat.png')});
  await worker.evaluate(async()=>{const stored=await chrome.storage.sync.get('interpreter_settings');stored.interpreter_settings.models[0].providerModelId='gpt-6-luna';await chrome.storage.sync.set(stored);});
  await page.reload();await page.locator('#clip-bar-ai').click();await page.locator('.clip-chat-composer textarea:not(:disabled)').waitFor();
  await page.locator('.clip-chat-composer textarea').fill('Incompatible model question');await page.locator('.clip-chat-send').click();await page.locator('.clip-chat.is-error').count();
  await page.getByText('此 OpenCode Go 模型或端点尚不支持，请从聊天模型列表中选择。',{exact:false}).waitFor();assert.equal((await calls()).length,0);checks.push('manually configured Responses model shows a localized error without an inference request');
  assert.deepEqual(errors,[]);
  const result={checks,pageErrors:errors,browser:context.browser().version(),scope:'Built extension with public catalogue snapshot and mocked inference; no paid API/account test'};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
