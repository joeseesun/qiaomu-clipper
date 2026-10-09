// Production Edge regression with synthetic video and mocked Native Messaging. No user profile or paid API.
const { chromium } = require(process.env.QIAOMU_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const output = process.env.QIAOMU_TEST_OUTPUT || path.join(os.tmpdir(), 'qiaomu-media-modes'); fs.mkdirSync(output, {recursive:true});
const media = fs.readFileSync(process.env.QIAOMU_TEST_VIDEO), KEY = 'file:'+'a'.repeat(32);
(async () => {
 const extension = path.resolve(process.env.QIAOMU_TEST_DIST || path.join(__dirname, '../dist_local'));
 const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')), { executablePath:process.env.QIAOMU_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`], viewport:{width:1280,height:900} });
 const page = await context.newPage(), errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
 try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).hostname;
  await worker.evaluate(({KEY}) => {
   globalThis.fixture = {starts:0,uploads:0};
   chrome.runtime.sendNativeMessage = (_host,m,cb) => { const f=globalThis.fixture; let reply;
    switch(m.action) {
     case 'asrStatus': reply={ok:true,ready:true,missing:[],hints:[],engine:'cloud',local:[],installable:{base:false,engines:[]}}; break;
     case 'asrUploadStart': f.uploads++; reply={ok:true,uploadId:'c'.repeat(32)}; break;
     case 'asrUploadFinish': reply={ok:true,key:KEY}; break;
     case 'asrStart': f.starts++; reply={ok:true,id:'d'.repeat(32),videoKey:KEY,engine:'cloud',state:'completed',progress:100,segments:[{start:0,end:3,text:'Original transcript'}],next:1};break;
     default: reply={ok:true};
    } if(cb) cb(reply); else return Promise.resolve(reply);
   };
   return chrome.storage.local.set({language:'zh_CN',qiaomuAsrSettings:{mode:'cloud',active:'sf',autoStart:false,profiles:[{id:'sf',provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3-ASR-1.7B',apiKey:'fixture-only',protocol:'openai-transcriptions'}]}});
  },{KEY});
  await page.goto(`chrome-extension://${id}/reader.html?study=file`);
  await page.locator('input[type=file]').setInputFiles({name:'lesson.webm',mimeType:'video/webm',buffer:media});
  await page.locator('.qiaomu-dlg-btn.is-primary').click();
  await page.locator('.transcript-segment').filter({hasText:'Original transcript'}).waitFor();
  await page.locator('video').evaluate(v => {v.currentTime=4;v.playbackRate=1.5;v.volume=.4;v.muted=true;});
  await page.screenshot({path:path.join(output,'read-before.png')});
  await page.locator('.clip-bar-segment button[aria-selected=false]').click(); await page.waitForURL('**/editor.html?id=*');
  if(process.env.QIAOMU_TEST_BASELINE) {
   assert.equal(await page.locator('video').count(),0);await page.screenshot({path:path.join(output,'baseline-edit-no-video.png')});
   await page.locator('.clip-bar-segment button[aria-selected=false]').click();await page.waitForURL('**/reader.html?preview=*');
   await page.locator('article').waitFor();assert.equal(await page.locator('video').count(),0);assert.match(await page.locator('article').innerText(),/Original transcript/);
   await page.screenshot({path:path.join(output,'baseline-read-no-video.png')});
   console.log(JSON.stringify({baseline:'reproduced',editMissingVideo:true,readMissingVideo:true}));return;
  }
  await page.locator('video').waitFor(); await page.waitForFunction(() => document.querySelector('video').readyState>=1 && Math.abs(document.querySelector('video').currentTime-4)<.1);
  assert.deepEqual(await page.locator('video').evaluate(v=>({rate:v.playbackRate,volume:v.volume,muted:v.muted})),{rate:1.5,volume:.4,muted:true});checks.push('editor keeps playable video and playback state');
  const textarea = page.locator('#ce-markdown');await textarea.fill((await textarea.inputValue()).replace('Original transcript','Edited transcript')+'\n\n**0:05** · Second timestamp\n');
  await page.locator('video').evaluate(v=>{v.currentTime=7;v.playbackRate=1.25;});await page.screenshot({path:path.join(output,'edit-with-video.png')});
  await page.locator('.clip-bar-segment button[aria-selected=false]').click();await page.waitForURL('**/reader.html?preview=*');
  await page.locator('video').waitFor();await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-7)<.1);
  assert.match(await page.locator('article').innerText(),/Edited transcript/);assert.equal(await page.locator('.transcript-segment').count(),2);checks.push('reading restores video and edited timestamp transcript');
  await page.locator('.timestamp[data-timestamp="5"]').evaluate(el=>el.click());await page.waitForFunction(()=>document.querySelector('video').currentTime>=5 && document.querySelector('video').currentTime<6);await page.locator('video').evaluate(v=>v.pause());
  await page.locator('video').evaluate(v=>{v.currentTime=0;});
  await page.locator('.transcript-segment').filter({hasText:'Second timestamp'}).locator('.transcript-segment-text').click({position:{x:10,y:2}});await page.waitForFunction(()=>document.querySelector('video').currentTime>=5);await page.locator('video').evaluate(v=>v.pause());checks.push('edited timestamp handler and segment pointer seek video');
  await page.screenshot({path:path.join(output,'read-after-with-video.png')});
  await page.locator('.clip-bar-segment button[aria-selected=false]').click();await page.waitForURL('**/editor.html?id=*');await page.locator('video').waitFor();
  assert.match(await page.locator('#ce-markdown').inputValue(),/Edited transcript/);assert.equal(((await page.locator('#ce-markdown').inputValue()).match(/Second timestamp/g)||[]).length,1);checks.push('repeated mode switches preserve edits without duplicate subtitles');
  await page.reload();await page.locator('video').waitFor();checks.push('editor refresh restores media');
  await page.evaluate(async()=> {const db=await new Promise(resolve=>{const r=indexedDB.open('qiaomu-handoff',1);r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').clear();tx.oncomplete=resolve;});db.close();});
  await page.reload();await page.locator('.local-preview-reselect').waitFor();assert.match(await page.locator('#ce-markdown').inputValue(),/Edited transcript/);
  await page.evaluate(async bytes=> {const id=new URLSearchParams(location.search).get('id');const saved=await chrome.storage.local.get('qiaomuPreview:'+id), info=saved['qiaomuPreview:'+id].localMedia;const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],info.name,{type:'video/webm',lastModified:info.modified}));const input=document.querySelector('.local-preview-reselect input');input.files=dt.files;input.dispatchEvent(new Event('change'));},[...media]);
  await page.locator('video').waitFor();checks.push('expired token reselect restores playback without upload or recognition');
  await page.locator('.clip-bar-segment button[aria-selected=false]').click();await page.waitForURL('**/reader.html?preview=*');await page.locator('video').waitFor();
  const url=page.url();await page.evaluate(()=>{indexedDB.open=()=>{throw new Error('fixture quota');};});
  await page.locator('.clip-bar-segment button[aria-selected=false]').click();await page.locator('#clip-bar-status.is-visible').waitFor();assert.equal(page.url(),url);assert.equal(await page.locator('video').count(),1);checks.push('storage failure blocks destructive navigation and keeps current player');
  assert.deepEqual(await worker.evaluate(()=>globalThis.fixture),{starts:1,uploads:1});assert.deepEqual(errors,[]);
  const result={checks,pageErrors:errors,helper:'mocked; no paid API calls',edge:context.browser()?.version()};fs.writeFileSync(path.join(output,'edge-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } catch(e) {await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(JSON.stringify({checks,pageErrors:errors}));throw e;} finally {await context.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
