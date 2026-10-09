// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./browser-polyfill', () => ({ default: { runtime: { getURL: (p: string) => 'chrome-extension://fixture/' + p } } }));
vi.mock('./asr-client', () => ({ asrProbe: vi.fn(), thisBrowser: () => 'edge' }));
import { sharedStudyAddress, xiaoeWebEntry, isProtectedStudy, snapshotProtectedPage, protectedPageBridge, probeProtectedStudy } from './protected-study';
const url = 'https://school.xetslk.com/sl/fixture', resolved = 'https://school.mp.xiaoeknow.com/course?id=fixture';
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => document.body.replaceChildren());
it('extracts one share link and discards the surrounding access code; rejects ambiguity', () => {
 expect(sharedStudyAddress('直播链接：[https://school.xetslk.com/sl/fixture](https://school.xetslk.com/sl/fixture)')).toBe(url);
 expect(sharedStudyAddress('直播链接：https://school.xetslk.com/sl/fixture\n直播密码：fixture-secret')).toBe(url);
 expect(sharedStudyAddress('[课程](https://school.xetslk.com/sl/fixture)')).toBe(url);
 expect(sharedStudyAddress('看看 https://weixin.qq.com/sph/fixture 。')).toBe('https://weixin.qq.com/sph/fixture');
 expect(sharedStudyAddress('https://a.example https://b.example')).toBeUndefined();
 expect(sharedStudyAddress('hello world')).toBeUndefined();
});
it('accepts the real platform host families without matching arbitrary WeChat or lookalike domains', () => {
 for (const u of [url, resolved, 'https://school.pc.xiaoe-tech.com/course', 'https://weixin.qq.com/sph/fixture', 'https://channels.weixin.qq.com/finder-preview/pages/sph?sph=fixture']) expect(isProtectedStudy(u)).toBe(true);
 for (const u of ['https://mp.weixin.qq.com/s/x', 'https://weixin.qq.com/about', 'https://weixin.qq.com.evil.example/sph/x', 'https://school.xetslk.com.evil.example/sl/x', 'https://wx.qq.com']) expect(isProtectedStudy(u)).toBe(false);
});
it('classifies the password and WeChat gates without returning text or form values', () => {
 document.body.innerHTML = '<input type="password" value="fixture-secret">'; expect(snapshotProtectedPage()).toEqual({state:'password'});
 document.body.innerHTML = '<p>请用微信扫描上方二维码，或在手机微信内打开链接</p>'; expect(snapshotProtectedPage()).toEqual({state:'wechat'});
 document.body.innerHTML = '<p>可扫码前往微信观看此内容</p>'; expect(snapshotProtectedPage()).toEqual({state:'wechat'});
 document.body.innerHTML = '<p>前往微信打开</p>'; expect(snapshotProtectedPage()).toEqual({state:'wechat'});
 document.body.innerHTML = '<p>没有视频</p>'; expect(snapshotProtectedPage()).toEqual({state:'unavailable'});
});
it('classifies a finite playable recording, rejects a live stream and ignores hidden media', () => {
 const video = document.createElement('video'); document.body.append(video);
 video.getBoundingClientRect = () => ({width:640,height:360}) as DOMRect;
 Object.defineProperty(video,'duration',{configurable:true,value:42}); Object.defineProperty(video,'readyState',{value:2});
 expect(snapshotProtectedPage()).toEqual({state:'ready',url:location.href});
 Object.defineProperty(video,'duration',{value:Infinity}); expect(snapshotProtectedPage()).toEqual({state:'live'});
 video.style.display='none'; expect(snapshotProtectedPage()).toEqual({state:'unavailable'});
});
it('binds redirected tabs to the requesting reader and checks the platform and navigation race', async () => {
 const create=vi.fn().mockResolvedValue({id:7}), get=vi.fn().mockResolvedValue({url:resolved}), inspect=vi.fn().mockResolvedValue({state:'ready',url:resolved});
 const bridge=protectedPageBridge({create,get,inspect,update:vi.fn()});
 expect(await bridge(1,{mode:'read',url,tabId:7})).toEqual({state:'unavailable'});expect(inspect).not.toHaveBeenCalled();
 expect(await bridge(1,{mode:'open',url})).toEqual({tabId:7});
 expect(await bridge(2,{mode:'read',url,tabId:7})).toEqual({state:'unavailable'});
 expect(await bridge(1,{mode:'read',url,tabId:7})).toEqual({state:'ready',url:resolved});
 get.mockResolvedValue({url:'https://evil.example/'}); expect(await bridge(1,{mode:'read',url,tabId:7})).toEqual({state:'unavailable'});
 get.mockResolvedValue({url:resolved}); inspect.mockResolvedValue({state:'ready',url:resolved+'2'}); expect(await bridge(1,{mode:'read',url,tabId:7})).toEqual({state:'unavailable'});
 expect(await bridge(1,{mode:'open',url:'https://user:password@school.xetslk.com/sl/x'})).toEqual({state:'unavailable'});
 expect(await bridge(1,{mode:'open',url:'http://school.xetslk.com/sl/x'})).toEqual({state:'unavailable'});
});
it('shows an original-page/password flow and never starts probing a WeChat-only page', async () => {
 const status=document.createElement('p'), holder=document.createElement('div'); document.body.append(status,holder);
 const request=vi.fn().mockResolvedValueOnce({tabId:7}).mockResolvedValueOnce({state:'wechat'}).mockResolvedValueOnce({state:'password'}).mockResolvedValueOnce({state:'live'}), probe=vi.fn();
 void probeProtectedStudy(url,status,holder,request,probe); await settle();
 expect(request).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
 const [open,retry] = Array.from(holder.querySelectorAll('button'));
 expect(retry.disabled).toBe(true); open.click(); await settle();expect(retry.disabled).toBe(false);
 retry.click();await settle();expect(holder.textContent).toContain('只支持在微信观看');expect(probe).not.toHaveBeenCalled();expect(retry.disabled).toBe(false);
 retry.click();await settle();expect(holder.textContent).toContain('输入访问密码');retry.click();await settle();expect(holder.textContent).toContain('仍在进行的直播');
 expect(holder.querySelector('a')!.href).toContain('reader.html?study=file');
});
it('keeps unsupported downloads recoverable and passes the resolved recording URL on success', async () => {
 const status=document.createElement('p'),holder=document.createElement('div');document.body.append(status,holder);
 const request=vi.fn().mockResolvedValueOnce({tabId:7}).mockResolvedValue({state:'ready',url:resolved});
 const success={ok:true as const,title:'Fixture recording',video:true,mediaUrl:'https://cdn.example/fixture.mp4'};
 const probe=vi.fn().mockResolvedValueOnce({ok:false,error:'unsupported'}).mockResolvedValueOnce(success);
 const done=probeProtectedStudy(url,status,holder,request,probe);await settle();const [open,retry]=Array.from(holder.querySelectorAll('button'));
 open.click();await settle();retry.click();await settle();expect(holder.textContent).toContain('下载工具仍无法读取');expect(retry.disabled).toBe(false);
 retry.click();expect(await done).toEqual({info:success,sourceUrl:resolved});expect(probe).toHaveBeenLastCalledWith(resolved);expect(holder.children).toHaveLength(0);
});

it('returns missing-helper errors to the existing setup flow instead of suggesting extractor failure', async () => {
 const status=document.createElement('p'),holder=document.createElement('div');document.body.append(status,holder);
 const request=vi.fn().mockResolvedValueOnce({tabId:7}).mockResolvedValue({state:'ready',url:resolved});
 const info={ok:false as const,error:'helper-offline'},probe=vi.fn().mockResolvedValue(info);
 const done=probeProtectedStudy(url,status,holder,request,probe);await settle();const [open,retry]=Array.from(holder.querySelectorAll('button'));
 open.click();await settle();retry.click();expect(await done).toEqual({info,sourceUrl:resolved});expect(holder.children).toHaveLength(0);
});

it('uses only the shop-and-resource-matched H5 handoff and classifies login', () => {
 const make = (h5: string, overrides = {}) => 'https://appfixture.mp.xiaoeknow.com/?params=' + encodeURIComponent(btoa(JSON.stringify({app_id:'appfixture',resource_id:'l_fixture',h5_url:h5,...overrides})));
 const h5 = 'https://appfixture.h5.xiaoeknow.com/v4/course/alive/l_fixture?app_id=appfixture';
 expect(xiaoeWebEntry(make(h5))).toBe(h5);
 for (const bad of [h5.replace('appfixture.h5','other.h5'),h5.replace('l_fixture?','l_other?'),h5+'&token=secret',h5.replace('https:','http:'),'https://evil.example/']) expect(xiaoeWebEntry(make(bad))).toBeUndefined();
 expect(xiaoeWebEntry(make(h5,{app_id:'other'}))).toBeUndefined();
 expect(xiaoeWebEntry('https://appfixture.mp.xiaoeknow.com/?params=bad')).toBeUndefined();
 document.body.innerHTML='<input placeholder="请输入手机号"><p>验证码登录</p>';
 expect(snapshotProtectedPage()).toEqual({state:'login'});
});
it('opens the provided H5 entry only in the owned original tab', async () => {
 const h5='https://appfixture.h5.xiaoeknow.com/v4/course/alive/l_fixture?app_id=appfixture';
 const current='https://appfixture.mp.xiaoeknow.com/?params='+encodeURIComponent(btoa(JSON.stringify({app_id:'appfixture',resource_id:'l_fixture',h5_url:h5})));
 const update=vi.fn(),inspect=vi.fn(),bridge=protectedPageBridge({create:vi.fn().mockResolvedValue({id:7}),get:vi.fn().mockResolvedValue({url:current}),update,inspect});
 await bridge(1,{mode:'open',url});expect(await bridge(2,{mode:'read',url,tabId:7})).toEqual({state:'unavailable'});expect(update).not.toHaveBeenCalled();
 expect(await bridge(1,{mode:'read',url,tabId:7})).toEqual({state:'opening'});expect(update).toHaveBeenCalledWith(7,{url:h5});expect(inspect).not.toHaveBeenCalled();
});
