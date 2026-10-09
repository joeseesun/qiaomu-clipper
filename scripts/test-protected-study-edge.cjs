// Isolated production Edge test. Synthetic pages/media; no user profile, cookies or paid API.
const { chromium } = require(process.env.QIAOMU_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const output = process.env.QIAOMU_TEST_OUTPUT || path.join(os.tmpdir(),'qiaomu-protected-study');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const extension=path.resolve(process.env.QIAOMU_TEST_DIST || path.join(__dirname,'../dist_local'));
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{executablePath:process.env.QIAOMU_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1280,height:900}});
 let worker;const page=await context.newPage(),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');const id=new URL(worker.url()).hostname;
  await worker.evaluate(()=>{
   globalThis.protectedFixture={calls:[]};
   chrome.runtime.sendNativeMessage=(_host,m,cb)=>{globalThis.protectedFixture.calls.push(m);let r=m.action==='asrProbe'?{ok:false,error:'unsupported'}:{ok:true,ready:true,missing:[],hints:[],engine:'cloud',local:[],installable:{base:false,engines:[]}};if(cb)cb(r);else return Promise.resolve(r);};
   return chrome.storage.local.set({language:'zh_CN'});
  });
  await context.route('https://school.xetslk.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<p>请用微信扫描上方二维码，或在手机微信内打开链接</p>'}));
  await context.route('https://weixin.qq.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<p>可扫码前往微信观看此内容</p>'}));
  await page.goto(`chrome-extension://${id}/settings.html?section=study`);
  await page.locator('.qiaomu-home-form input').fill('直播链接：https://school.xetslk.com/sl/fixture\n直播密码：fixture-secret');
  await page.locator('.qiaomu-home-hint').filter({hasText:'先打开原网页完成验证'}).waitFor();
  const studyPromise=context.waitForEvent('page');await page.locator('.qiaomu-home-go').click();const study=await studyPromise;study.setDefaultTimeout(8000);study.on('pageerror',e=>errors.push(e.message));
  await study.locator('.qiaomu-web-retry').waitFor();assert(!study.url().includes('fixture-secret'));checks.push('share message routes to study and drops access code');
  assert.equal((await worker.evaluate(()=>globalThis.protectedFixture.calls.filter(m=>['asrProbe','asrStart','asrUploadStart'].includes(m.action) || m.cookies || m.cookieSnapshot))).length,0);checks.push('no ASR probe/start or cookie access before original-page action');
  const originPromise=context.waitForEvent('page');await study.getByRole('button',{name:'打开原页面',exact:true}).click();const origin=await originPromise;await origin.goto('https://school.xetslk.com/sl/fixture');await study.bringToFront();
  await study.getByRole('button',{name:'重新读取',exact:true}).click();await study.locator('.qiaomu-web-retry').filter({hasText:'只支持在微信观看'}).waitFor();
  assert.equal((await worker.evaluate(()=>globalThis.protectedFixture.calls.filter(m=>['asrProbe','asrStart','asrUploadStart'].includes(m.action) || m.cookies || m.cookieSnapshot))).length,0);checks.push('serialized page inspection identifies Xiaoetong WeChat-only gate without ASR');
  await origin.setContent('<input type="password" value="fixture-secret">');await study.getByRole('button',{name:'重新读取',exact:true}).click();await study.locator('.qiaomu-web-retry').filter({hasText:'请先在原网页输入访问密码'}).waitFor();checks.push('password entry remains on original website');
  const media=fs.readFileSync(process.env.QIAOMU_TEST_VIDEO);
  await origin.setContent(`<video controls style="width:640px;height:360px" src="data:video/webm;base64,${media.toString('base64')}"></video>`);
  await origin.waitForFunction(()=>document.querySelector('video').readyState>=1);await study.getByRole('button',{name:'重新读取',exact:true}).click();await study.locator('.qiaomu-web-retry').filter({hasText:'下载工具仍无法读取'}).waitFor();
  const calls=await worker.evaluate(()=>globalThis.protectedFixture.calls);assert.equal(calls.filter(m=>m.action==='asrProbe').length,1);assert(!JSON.stringify(calls).includes('fixture-secret'));checks.push('playable finite recording is probed; unsupported failure keeps retry and file choice');
  await study.screenshot({path:path.join(output,'xiaoetong-retry.png')});
  await study.goto(`chrome-extension://${id}/reader.html?study=web&url=${encodeURIComponent('https://weixin.qq.com/sph/fixture')}`);
  await study.locator('.qiaomu-web-retry').waitFor();const channelPromise=context.waitForEvent('page');await study.getByRole('button',{name:'打开原页面',exact:true}).click();const channel=await channelPromise;await channel.goto('https://weixin.qq.com/sph/fixture');await study.bringToFront();await study.getByRole('button',{name:'重新读取',exact:true}).click();await study.locator('.qiaomu-web-retry').filter({hasText:'只支持在微信观看'}).waitFor();checks.push('Channels share has the same explicit WeChat-only flow');
  await study.screenshot({path:path.join(output,'channels-gate.png')});
  await study.getByRole('link',{name:'选择本地文件',exact:true}).click();await study.waitForURL('**/reader.html?study=file');await study.locator('input[type=file]').waitFor({state:'attached'});checks.push('fallback reaches existing file upload and recognition page');
  assert.deepEqual(errors,[]);const result={checks,pageErrors:errors,edge:context.browser()?.version(),scope:'Synthetic source pages; mocked Native Messaging; no paid API'};fs.writeFileSync(path.join(output,'edge-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){for(const p of context.pages()) if(p.url().includes('study=web')) console.error(JSON.stringify({fixtureState:(await p.locator('.qiaomu-web-retry').innerText().catch(()=>''))}));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(JSON.stringify({checks,pageErrors:errors}));throw e;}finally{await context.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
