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
   chrome.runtime.sendNativeMessage=(_host,m,cb)=>{globalThis.protectedFixture.calls.push(m);let r=m.action==='asrStart'?{ok:true,id:'f'.repeat(32),videoKey:m.videoKey,state:'completed',stage:'字幕已生成',progress:100,segments:[{start:0,end:12,text:'Fixture Channels transcript'}],next:1}:m.action==='asrProbe'?{ok:false,error:'unsupported'}:{ok:true,ready:true,missing:[],hints:[],engine:'cloud',local:[],installable:{base:false,engines:[]}};if(cb)cb(r);else return Promise.resolve(r);};
   return chrome.storage.local.set({language:'zh_CN',qiaomuAsrSettings:{mode:'cloud',engine:'auto',active:'fixture',autoStart:true,autoLogin:false,useContext:false,routes:{},profiles:[{id:'fixture',provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3-ASR-1.7B',protocol:'openai-transcriptions',apiKey:'fixture-key'}]}});
  });
  await context.route('https://school.xetslk.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<p>请用微信扫描上方二维码，或在手机微信内打开链接</p>'}));
  await context.route('https://weixin.qq.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<p>可扫码前往微信观看此内容</p>'}));
  const fixtureMedia=fs.readFileSync(process.env.QIAOMU_TEST_VIDEO);
  await context.route('https://yuanbao.tencent.com/**',route=>route.request().url().includes('/api/weixin/get_parse_result')?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:0,data:{playable_url:'https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture'}})}):route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<p>Fixture Yuanbao sign-in</p>'}));
  await context.route('https://channels.weixin.qq.com/**',route=>route.request().url().includes('/api/feed/get_feed_info')?route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({errCode:0,data:{errMsg:{type:0},feedInfo:{description:'Fixture Channels recording',h264VideoInfo:{videoUrl:'https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture'}}}})}):route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:`<video controls style="width:640px;height:360px" src="data:video/webm;base64,${fixtureMedia.toString('base64')}"></video>`}));
  await context.route('https://finder.video.qq.com/**',route=>route.fulfill({status:200,contentType:'video/webm',body:fixtureMedia}));
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
  await study.locator('.qiaomu-web-retry').filter({hasText:'腾讯元宝解析'}).waitFor();
  const resolverPromise=context.waitForEvent('page');await study.getByRole('button',{name:'打开元宝并验证',exact:true}).click();const resolver=await resolverPromise;await resolver.goto('https://yuanbao.tencent.com/');
  const playbackPromise=context.waitForEvent('page');await study.getByRole('button',{name:'重新读取',exact:true}).click();const playback=await playbackPromise;await playback.goto('https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture');await playback.waitForFunction(()=>document.querySelector('video')?.readyState>=1);await study.locator('.qiaomu-web-retry').filter({hasText:'官方播放页已打开'}).waitFor();checks.push('production serialized resolver opens only the official player after user action');
  await study.getByRole('button',{name:'重新读取',exact:true}).click();await study.getByText('Fixture Channels transcript',{exact:true}).first().waitFor();
  const started=await worker.evaluate(()=>globalThis.protectedFixture.calls.find(m=>m.action==='asrStart'));assert.equal(started.web.url,'https://weixin.qq.com/sph/fixture');assert.equal(started.web.mediaUrl,'https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture');assert(!started.cookies);assert(!started.cookieSnapshot);assert(!JSON.stringify(started).includes('token=fixture'));checks.push('direct Tencent media reaches recognition, stable source survives and login cookies are not lent');
  assert(await study.locator('video').count());await study.screenshot({path:path.join(output,'channels-player-transcript.png')});checks.push('Channels reader displays the player and timed transcript');
  assert.deepEqual(errors,[]);const result={checks,pageErrors:errors,edge:context.browser()?.version(),scope:'Synthetic source pages; mocked Native Messaging; no paid API'};fs.writeFileSync(path.join(output,'edge-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){for(const p of context.pages()) if(p.url().includes('study=web')) console.error(JSON.stringify({fixtureState:(await p.locator('.qiaomu-web-retry').innerText().catch(()=>''))}));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(JSON.stringify({checks,pageErrors:errors}));throw e;}finally{await context.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
