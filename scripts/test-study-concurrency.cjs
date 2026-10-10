// Run against a built extension in a fresh test profile. All media is synthetic; no account/native helper.
const {chromium}=require(process.env.QIAOMU_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.QIAOMU_TEST_OUTPUT || '/tmp/qiaomu-concurrency';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const extension=path.resolve('dist_local');
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{executablePath:process.env.QIAOMU_EDGE,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1280,height:900}});
 const checks=[],errors=[];
 try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).hostname;
  await context.route('https://finder.video.qq.com/**',r=>r.fulfill({status:200,contentType:'video/mp4',body:fs.readFileSync(process.env.QIAOMU_TEST_VIDEO)}));
  const token='a1b2c3d4-1234-4123-a123-123456789abc',source='https://finder.video.qq.com/fixture.mp4?sign=private-fixture';
  await context.addInitScript(({token,source})=>{if(location.protocol==='chrome-extension:' && window.name!=='fixture-expired')sessionStorage.setItem('qiaomuPreviewMedia:'+token,JSON.stringify({src:source,video:true,expires:Date.now()+3600000}));},{token,source});
  const seed=async requestId=>worker.evaluate(async({requestId,token})=>{
   const item={createdAt:Date.now(),studySource:'https://example.com/lesson',clip:{url:'https://example.com/lesson',title:'Lesson',markdown:'**0:00** · Original captions'},local:{requestId,name:'Lesson.md',content:'**0:00** · Original captions',folder:'Clips',vault:'Daily',behavior:'create'},native:false,aggregate:false,remoteMedia:{token,time:0,rate:1,volume:1,muted:false}};
   await chrome.storage.local.set({['qiaomuPreview:'+requestId]:item});
  },{requestId,token});
  const open=async requestId=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(`chrome-extension://${id}/editor.html?id=${requestId}`);await p.locator('video').waitFor();return p;};
  const stored=async requestId=>worker.evaluate(async key=>(await chrome.storage.local.get('qiaomuPreview:'+key))['qiaomuPreview:'+key],requestId);
  const waitText=async(requestId,text)=>{for(let i=0;i<100;i++){if((await stored(requestId)).clip.markdown===text)return;await new Promise(r=>setTimeout(r,25));}throw Error('autosave missing');};
  await seed('shared');const old=await open('shared'),fresh=await open('shared');
  const edited='**0:00** · Recovered B captions\n\nB notes preserved';await fresh.locator('#ce-markdown').fill(edited);await waitText('shared',edited);
  await old.locator('.clip-bar-segment button[aria-selected=false]').click();await old.waitForURL('**/reader.html?preview=shared');await old.locator('article').filter({hasText:'B notes preserved'}).waitFor();assert.equal((await stored('shared')).clip.markdown,edited);checks.push('old tab with a player switches to Read without overwriting newer recovered edits');
  await seed('expired');const expired=await open('expired'),next=await open('expired');await expired.evaluate(()=>{window.name='fixture-expired';sessionStorage.clear();});await expired.reload();await expired.locator('.local-preview-reselect').waitFor();
  const newText='**0:00** · New B captions after expiry';await next.locator('#ce-markdown').fill(newText);await waitText('expired',newText);
  const recovered=context.waitForEvent('page');await expired.getByRole('link',{name:'重新打开转写学习',exact:true}).click();const recovering=await recovered;await recovering.locator('article').filter({hasText:'New B captions after expiry'}).waitFor();assert.equal((await stored('expired')).clip.markdown,newText);checks.push('expired old tab recovery does not rewrite stale text');
  await seed('competing');const a=await open('competing'),b=await open('competing');await b.locator('#ce-markdown').fill('B winning edits');await waitText('competing','B winning edits');await a.locator('#ce-markdown').fill('A pending rescue edits');await a.getByText('编辑内容自动保存失败，请先复制或下载文字后重试。',{exact:true}).waitFor();assert.equal((await stored('competing')).clip.markdown,'B winning edits');checks.push('competing stale edits show a conflict and preserve stored and pending text');
  await a.evaluate(()=>{const original=chrome.storage.local.set.bind(chrome.storage.local);chrome.storage.local.set=(value,...rest)=>{if(Object.keys(value).some(k=>k.startsWith('qiaomuPreview:')))throw Error('fixture quota');return original(value,...rest);};});
  const downloaded=a.waitForEvent('download');await a.locator('#clip-bar-download').click();const download=await downloaded;const filename=path.join(output,'rescued.md');await download.saveAs(filename);assert.match(fs.readFileSync(filename,'utf8'),/A pending rescue edits/);assert.equal((await stored('competing')).clip.markdown,'B winning edits');checks.push('Download rescues current textarea under storage failure without overwriting B');
  await context.grantPermissions(['clipboard-read','clipboard-write']);await a.locator('#clip-bar-copy').click();assert.match(await a.evaluate(()=>navigator.clipboard.readText()),/A pending rescue edits/);checks.push('Copy rescues current textarea under storage failure');
  await a.screenshot({path:path.join(output,'conflict-rescue.png')});
  for(const [provider,url] of [['youtube','https://www.youtube.com/watch?v=dbqweBCynuI'],['bilibili','https://www.bilibili.com/video/BV1hM4m1U7rA']]){
   const requestId='embedded-'+provider,route=`chrome-extension://${id}/reader.html?study=${provider}&url=${encodeURIComponent(url)}`;
   await worker.evaluate(async({requestId,url,route})=>{await chrome.storage.local.set({['qiaomuPreview:'+requestId]:{createdAt:Date.now(),studySource:url,mediaReadUrl:route,studyEditedAt:Date.now(),clip:{url,title:'Edited embedded lesson',markdown:'**0:05** · Edited embedded captions\n\nUser embedded notes'},local:{requestId,name:'Edited.md',content:'**0:05** · Edited embedded captions\n\nUser embedded notes',folder:'Clips',vault:'Daily',behavior:'create'},native:false,aggregate:false}});},{requestId,url,route});
   await context.route(provider==='youtube'?'https://*.youtube.com/**':'https://player.bilibili.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<p>Synthetic embedded playback surface</p>'}));
   const embedded=await context.newPage();embedded.on('pageerror',e=>errors.push(e.message));await embedded.goto(`chrome-extension://${id}/editor.html?id=${requestId}`);await embedded.locator('#ce-markdown').waitFor();await embedded.locator('.clip-bar-segment button[aria-selected=false]').click();await embedded.waitForURL('**/reader.html?study='+provider+'&url=*&resume=*');await embedded.locator('article').filter({hasText:'User embedded notes'}).waitFor();assert.equal(await embedded.locator('iframe').count(),1);assert.match(await embedded.locator('article').innerText(),/Edited embedded captions/);
   await embedded.locator('.clip-bar-segment button[aria-selected=false]').click();await embedded.waitForURL('**/editor.html?id=*');assert.equal(new URL(embedded.url()).searchParams.get('id'),requestId);const nextText=(await embedded.locator('#ce-markdown').inputValue())+'\nMore edits';await embedded.locator('#ce-markdown').fill(nextText);await waitText(requestId,nextText);await embedded.locator('.clip-bar-segment button[aria-selected=false]').click();await embedded.waitForURL('**/reader.html?study='+provider+'&url=*&resume=*');await embedded.locator('article').filter({hasText:'More edits'}).waitFor();assert.equal((await stored(requestId)).clip.markdown,nextText);await embedded.screenshot({path:path.join(output,provider+'-edited-reading.png')});checks.push(provider+': original embedded route and same draft survive Edit/Read with edited text in the reading DOM (fixture iframe)');
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,pageErrors:errors,browser:context.browser().version(),scope:'Built extension in isolated Chrome for Testing, synthetic media, no real account/native helper'},null,2));console.log(JSON.stringify({checks,pageErrors:errors}));
 } finally {await context.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
